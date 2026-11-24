/**
 * Rule-based alert engine.
 *
 *  - Threshold rules with warning / critical levels and a "for duration" (no flapping on single spikes)
 *  - Deduplication: one open alert per fingerprint (rule + server); repeated breaches only update it
 *  - Escalation warning -> critical, automatic recovery when the value drops below warning
 *  - Offline detection (no data for N seconds)
 *  - Anomaly detection: z-score against the last 10 minutes (catches sudden random spikes)
 *  - SMS + real-time Socket.IO notifications
 */
const AlertModel = require('../models/alertModel');
const RuleModel = require('../models/ruleModel');
const ServerModel = require('../models/serverModel');
const SettingModel = require('../models/settingModel');
const LogModel = require('../models/logModel');
const LoginModel = require('../models/loginModel');
const { sendSms, SEVERITY_RANK } = require('./smsService');
const { emit } = require('./socket');

const MB = 1024 * 1024;
const TOUCH_EVERY_MS = 60 * 1000;
const ANOMALY_WINDOW = 60; // samples (10 min at 10 s)
const ANOMALY_MIN_SAMPLES = 30;

let rules = [];
const pending = new Map(); // fingerprint -> first breach time (ms)
const active = new Map(); // fingerprint -> { id, severity, status, lastTouch, serverId, metric }
const windows = new Map(); // `${serverId}:${metric}` -> number[]

const METRIC_LABEL = {
  cpu: 'CPU', memory: 'RAM', disk: 'Disk', swap: 'Swap', temperature: 'CPU temperature',
  net_rx: 'Network download', net_tx: 'Network upload', offline: 'Offline', anomaly: 'Anomaly',
  login: 'Login', login_failed: 'Failed logins',
};

const LOGIN_METHOD = {
  rdp: 'Remote Desktop (RDP)', ssh: 'SSH', local: 'Local (keyboard)', unlock: 'Screen unlock', cached: 'Cached login',
  network: 'Network logon', anydesk: 'AnyDesk', teamviewer: 'TeamViewer', vnc: 'VNC', winrm: 'WinRM / PowerShell',
};
const REMOTE_METHODS = new Set(['rdp', 'ssh', 'anydesk', 'teamviewer', 'vnc', 'winrm']);
const LOCAL_METHODS = new Set(['local', 'unlock', 'cached']);
const LOGIN_ALERT_MAX_AGE_MS = 15 * 60 * 1000; // backfilled history is stored, but doesn't page anyone
const failures = new Map(); // serverId -> { server, items: [{ t, ip, user }] }

function valueOf(metric, s) {
  switch (metric) {
    case 'cpu': return s.cpu_pct;
    case 'memory': return s.mem_pct;
    case 'disk': return s.disk_pct;
    case 'swap': return s.swap_pct;
    case 'temperature': return s.cpu_temp;
    case 'net_rx': return s.net_rx_bps == null ? null : s.net_rx_bps / MB;
    case 'net_tx': return s.net_tx_bps == null ? null : s.net_tx_bps / MB;
    default: return null;
  }
}

function fmt(metric, v) {
  if (v == null) return '-';
  const n = Number(v);
  if (['cpu', 'memory', 'disk', 'swap'].includes(metric)) return `${n.toFixed(1)}%`;
  if (metric === 'temperature') return `${n.toFixed(1)}°C`;
  if (metric === 'net_rx' || metric === 'net_tx') return `${n.toFixed(2)} MB/s`;
  if (metric === 'offline') return fmtDuration(n);
  if (metric === 'login_failed') return `${Math.round(n)} attempt(s)`;
  return n.toFixed(2);
}

function fmtDuration(sec) {
  sec = Math.round(sec);
  if (sec < 60) return `${sec}s`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s`;
  return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
}

const rank = (sev) => SEVERITY_RANK[sev] || 0;

/** Server-specific rules override the global rules of the same metric. */
function rulesFor(serverId) {
  const specific = rules.filter((r) => r.server_id === serverId);
  const overridden = new Set(specific.map((r) => r.metric));
  return [...specific, ...rules.filter((r) => r.server_id == null && !overridden.has(r.metric))];
}

async function reloadRules() {
  rules = (await RuleModel.enabled()).map((r) => ({
    ...r,
    warning_threshold: r.warning_threshold == null ? null : Number(r.warning_threshold),
    critical_threshold: r.critical_threshold == null ? null : Number(r.critical_threshold),
  }));
}

async function init() {
  await reloadRules();
  for (const a of await AlertModel.active()) {
    active.set(a.fingerprint, {
      id: a.id, severity: a.severity, status: a.status, lastTouch: Date.now(),
      serverId: a.server_id, metric: a.metric,
    });
  }
  setInterval(() => reloadRules().catch(() => {}), 60 * 1000).unref();
}

/* ------------------------------------------------------------------ */

async function notify({ alertId, fp, rule, severity, text, kind }) {
  try {
    if (rule && !rule.sms_enabled) return;
    const s = await SettingModel.all();
    if (s.sms_enabled !== '1') return;
    if (kind === 'recovery' && s.sms_on_recovery !== '1') return;
    if (kind === 'open') {
      const cooldown = Number(s.sms_cooldown_min || 0) * 60 * 1000;
      if (cooldown) {
        const last = await LogModel.lastSmsForFingerprint(fp);
        if (last?.at && Date.now() - new Date(last.at).getTime() < cooldown) return;
      }
    }
    const r = await sendSms(text, { alertId, severity });
    if (r.results?.length) {
      const ok = r.results.filter((x) => x.ok).length;
      await AlertModel.addEvent(alertId, 'notified', `SMS sent to ${ok}/${r.results.length} recipient(s)`);
    }
  } catch (err) {
    console.error('[alert] notify failed:', err.message);
  }
}

async function open({ fp, rule, server, severity, threshold, value, metric, message }) {
  const placeholder = { id: null, severity, status: 'open', lastTouch: Date.now(), serverId: server.id, metric };
  active.set(fp, placeholder);
  try {
    const at = new Date();
    const id = await AlertModel.create({
      fingerprint: fp, server_id: server.id, rule_id: rule?.id, metric, severity,
      value: round(value), threshold, message, at,
    });
    placeholder.id = id;
    await AlertModel.addEvent(id, 'opened', message);
    const alert = await AlertModel.findById(id);
    emit('alert:new', alert);
    notify({ alertId: id, fp, rule, severity, text: `[${severity.toUpperCase()}] ${message}`, kind: 'open' });
  } catch (err) {
    active.delete(fp);
    throw err;
  }
}

async function escalate(fp, act, { rule, severity, threshold, value, message }) {
  act.severity = severity;
  act.lastTouch = Date.now();
  await AlertModel.touch(act.id, { value: round(value), severity, threshold, message, at: new Date() });
  await AlertModel.addEvent(act.id, 'escalated', message);
  const alert = await AlertModel.findById(act.id);
  emit('alert:new', alert);
  notify({ alertId: act.id, fp, rule, severity, text: `[${severity.toUpperCase()}] ${message}`, kind: 'escalate' });
}

async function recover(fp, act, server, value, metric, rule) {
  active.delete(fp);
  if (!act.id) return;
  const label = METRIC_LABEL[metric] || metric;
  const msg =
    metric === 'offline'
      ? `${server.name} (${server.ip_address}) is back ONLINE`
      : metric === 'login_failed'
        ? `Failed login attempts stopped on ${server.name} (${server.ip_address})`
        : `${label} back to normal on ${server.name} (${server.ip_address}) – now ${fmt(metric, value)}`;
  await AlertModel.resolve(act.id, { note: 'Auto-recovered' });
  await AlertModel.addEvent(act.id, 'recovered', msg);
  emit('alert:resolved', { id: act.id, server_id: server.id, message: msg });
  if (rank(act.severity) >= rank('warning')) {
    notify({ alertId: act.id, fp, rule, severity: act.severity, text: `[RECOVERED] ${msg}`, kind: 'recovery' });
  }
}

const round = (v) => (v == null ? null : Math.round(Number(v) * 100) / 100);

/** Core state machine for one fingerprint. */
async function apply({ fp, rule, server, severity, threshold, value, metric, message, durationSec }) {
  const act = active.get(fp);
  const now = Date.now();

  if (!severity) {
    pending.delete(fp);
    if (act) await recover(fp, act, server, value, metric, rule);
    return;
  }

  if (!pending.has(fp)) pending.set(fp, now);
  if (!act && now - pending.get(fp) < (durationSec ?? rule?.duration_sec ?? 0) * 1000) return;

  if (!act) return open({ fp, rule, server, severity, threshold, value, metric, message });
  if (!act.id) return; // still being created
  if (rank(severity) > rank(act.severity)) return escalate(fp, act, { rule, severity, threshold, value, message });
  if (now - act.lastTouch >= TOUCH_EVERY_MS) {
    act.lastTouch = now;
    await AlertModel.touch(act.id, { value: round(value), at: new Date() });
  }
}

/* ------------------------------------------------------------------ */

/** Evaluate threshold + anomaly rules for a freshly received sample. */
async function evaluate(server, sample) {
  for (const rule of rulesFor(server.id)) {
    if (rule.metric === 'offline') continue;
    if (rule.metric === 'anomaly') {
      await evaluateAnomaly(server, sample, rule);
      continue;
    }
    const v = valueOf(rule.metric, sample);
    if (v == null) continue;

    let severity = null;
    let threshold = null;
    if (rule.critical_threshold != null && v >= rule.critical_threshold) {
      severity = 'critical';
      threshold = rule.critical_threshold;
    } else if (rule.warning_threshold != null && v >= rule.warning_threshold) {
      severity = 'warning';
      threshold = rule.warning_threshold;
    }
    const label = METRIC_LABEL[rule.metric];
    const message = severity
      ? `${label} ${fmt(rule.metric, v)} on ${server.name} (${server.ip_address}) – threshold ${fmt(rule.metric, threshold)}`
      : null;

    await apply({
      fp: `r${rule.id}:s${server.id}`, rule, server, severity, threshold, value: v, metric: rule.metric, message,
    });
  }
}

/** z-score spike detection for CPU and RAM. */
async function evaluateAnomaly(server, sample, rule) {
  const zLimit = rule.warning_threshold || 3;
  for (const metric of ['cpu', 'memory']) {
    const v = valueOf(metric, sample);
    if (v == null) continue;
    const key = `${server.id}:${metric}`;
    const win = windows.get(key) || [];
    windows.set(key, win);

    let z = 0;
    let mean = v;
    if (win.length >= ANOMALY_MIN_SAMPLES) {
      mean = win.reduce((a, b) => a + b, 0) / win.length;
      const sd = Math.sqrt(win.reduce((a, b) => a + (b - mean) ** 2, 0) / win.length);
      z = sd > 0.5 ? (v - mean) / sd : v - mean > 25 ? 99 : 0;
    }
    win.push(v);
    if (win.length > ANOMALY_WINDOW) win.shift();

    const fp = `anom:${metric}:s${server.id}`;
    const breach = z >= zLimit && v - mean >= 25 && v >= 50;
    const label = METRIC_LABEL[metric];
    if (breach) {
      await apply({
        fp, rule, server, severity: 'info', threshold: zLimit, value: v, metric: 'anomaly', durationSec: 0,
        message: `Unusual ${label} spike on ${server.name} (${server.ip_address}): ${fmt(metric, v)} vs normal ${fmt(metric, mean)}`,
      });
    } else if (z < 1 && active.has(fp)) {
      await apply({ fp, rule, server, severity: null, value: v, metric: 'anomaly' });
    }
  }
}

/** Called by the scheduler every 10 s – detects servers that stopped reporting. */
async function checkOffline() {
  const s = await SettingModel.all();
  const offlineAfter = Number(s.offline_after_sec) || 30;
  const now = Date.now();

  const flipped = await ServerModel.markStaleOffline(new Date(now - offlineAfter * 1000));
  for (const f of flipped) emit('server:status', { id: f.id, status: 'offline', last_seen_at: f.last_seen_at });

  const servers = await ServerModel.enabledForOfflineCheck();
  for (const srv of servers) {
    const gap = (now - new Date(srv.last_seen_at).getTime()) / 1000;
    for (const rule of rulesFor(srv.id).filter((r) => r.metric === 'offline')) {
      let severity = null;
      let threshold = null;
      if (rule.critical_threshold != null && gap >= rule.critical_threshold) {
        severity = 'critical';
        threshold = rule.critical_threshold;
      } else if (rule.warning_threshold != null && gap >= rule.warning_threshold) {
        severity = 'warning';
        threshold = rule.warning_threshold;
      }
      await apply({
        fp: `r${rule.id}:s${srv.id}`, rule, server: srv, severity, threshold, value: gap,
        metric: 'offline', durationSec: 0,
        message: `${srv.name} (${srv.ip_address}) is OFFLINE – no data for ${fmtDuration(gap)}`,
      });
    }
  }
}

/** A server just reported – clear its offline alert immediately. */
async function onSeen(server) {
  for (const rule of rulesFor(server.id).filter((r) => r.metric === 'offline')) {
    const fp = `r${rule.id}:s${server.id}`;
    if (active.has(fp)) await apply({ fp, rule, server, severity: null, value: 0, metric: 'offline' });
  }
}

/* --------------------------- logins / access --------------------------- */

/** "192.168.11.133, 10.99.0.*, 192.168.5." -> matcher. Exact IPs, trailing * or trailing dot = prefix. */
function ipMatcher(list) {
  const items = String(list || '').split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  return (ip) =>
    !!ip && items.some((p) => (p.endsWith('*') ? ip.startsWith(p.slice(0, -1)) : p.endsWith('.') ? ip.startsWith(p) : ip === p));
}

const who = (e) => {
  const user = e.user ? (e.domain && !/^(workgroup|\.)$/i.test(e.domain) ? `${e.domain}\\${e.user}` : e.user) : null;
  const from = e.source_ip ? `${e.source_ip}${e.source_host && e.source_host !== e.source_ip ? ` (${e.source_host})` : ''}` : e.source_host;
  return [user && `user ${user}`, from && `from ${from}`].filter(Boolean).join(' ');
};

/** New login events from an agent: page for each real login, and feed the failed-attempt counter. */
async function onLoginEvents(server, events) {
  const s = await SettingModel.all();
  const trusted = ipMatcher(s.login_trusted_ips);
  const ignoredUsers = new Set(String(s.login_ignore_users || '').toLowerCase().split(/[\s,;]+/).filter(Boolean));
  const loginRule = rulesFor(server.id).find((r) => r.metric === 'login');
  const now = Date.now();

  for (const e of events) {
    const t = new Date(e.ts).getTime();
    if (e.kind === 'failed') {
      const f = failures.get(server.id) || { server, items: [] };
      f.server = server;
      f.items.push({ t, ip: e.source_ip, user: e.user });
      if (f.items.length > 5000) f.items.splice(0, f.items.length - 5000);
      failures.set(server.id, f);
      continue;
    }

    if (!loginRule || now - t > LOGIN_ALERT_MAX_AGE_MS) continue;
    if (trusted(e.source_ip)) continue;
    if (e.user && ignoredUsers.has(String(e.user).toLowerCase())) continue;
    if (e.method === 'network' && s.login_alert_network !== '1') continue;
    if (LOCAL_METHODS.has(e.method) && s.login_alert_local === '0') continue;

    const remote = REMOTE_METHODS.has(e.method);
    const label = LOGIN_METHOD[e.method] || e.method;
    const message =
      e.kind === 'connection'
        ? `New ${label} connection to ${server.name} (${server.ip_address}) ${who(e)}`
        : `${label} login on ${server.name} (${server.ip_address}): ${who(e) || 'unknown user'}`;
    try {
      await open({
        fp: `login:s${server.id}:e${e.id}`, rule: loginRule, server, severity: remote ? 'critical' : 'warning',
        threshold: null, value: null, metric: 'login', message: message.slice(0, 500),
      });
      await LoginModel.markAlerted(e.id);
    } catch (err) {
      console.error('[alert] login alert failed:', err.message);
    }
  }
  await checkLoginFailures([server.id]);
}

/** Password guessing: N failed logins within the rule's window (duration_sec, default 5 min). */
async function checkLoginFailures(onlyIds) {
  const now = Date.now();
  for (const [serverId, f] of failures) {
    if (onlyIds && !onlyIds.includes(serverId)) continue;
    for (const rule of rulesFor(serverId).filter((r) => r.metric === 'login_failed')) {
      const windowMs = (rule.duration_sec || 300) * 1000;
      const recent = f.items.filter((x) => now - x.t <= windowMs);
      const count = recent.length;
      let severity = null;
      let threshold = null;
      if (rule.critical_threshold != null && count >= rule.critical_threshold) {
        severity = 'critical';
        threshold = rule.critical_threshold;
      } else if (rule.warning_threshold != null && count >= rule.warning_threshold) {
        severity = 'warning';
        threshold = rule.warning_threshold;
      }
      const ips = [...new Set(recent.map((x) => x.ip).filter(Boolean))];
      const users = [...new Set(recent.map((x) => x.user).filter(Boolean))];
      await apply({
        fp: `r${rule.id}:s${serverId}`, rule, server: f.server, severity, threshold, value: count,
        metric: 'login_failed', durationSec: 0,
        message:
          `${count} failed logins in ${fmtDuration(windowMs / 1000)} on ${f.server.name} (${f.server.ip_address})` +
          `${ips.length ? ` – from ${ips.slice(0, 5).join(', ')}${ips.length > 5 ? ` +${ips.length - 5}` : ''}` : ''}` +
          `${users.length ? ` – users: ${users.slice(0, 5).join(', ')}` : ''}`,
      });
    }
    const maxWindow = Math.max(300, ...rules.filter((r) => r.metric === 'login_failed').map((r) => r.duration_sec || 300)) * 1000;
    f.items = f.items.filter((x) => now - x.t <= maxWindow);
    const stillOpen = [...active.values()].some((a) => a.serverId === serverId && a.metric === 'login_failed');
    if (!f.items.length && !stillOpen) failures.delete(serverId);
  }
}

/** Manual resolve from the UI – drop engine state so a still-breaching rule re-opens cleanly. */
function forget(fingerprint) {
  active.delete(fingerprint);
  pending.delete(fingerprint);
}

function markAcknowledged(fingerprint) {
  const a = active.get(fingerprint);
  if (a) a.status = 'acknowledged';
}

function forgetServer(serverId) {
  for (const [fp, a] of active) if (a.serverId === Number(serverId)) active.delete(fp);
  for (const key of windows.keys()) if (key.startsWith(`${serverId}:`)) windows.delete(key);
  failures.delete(Number(serverId));
}

module.exports = {
  init, reloadRules, evaluate, checkOffline, onSeen, forget, forgetServer, markAcknowledged, METRIC_LABEL,
  onLoginEvents, checkLoginFailures,
};
