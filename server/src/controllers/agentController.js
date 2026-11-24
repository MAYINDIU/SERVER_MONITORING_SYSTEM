/**
 * Endpoints used by the monitoring agent installed on every PC / server.
 *   POST /api/agent/register   (enroll key)  -> issues a per-server token
 *   POST /api/agent/metrics    (agent token) -> pushes one or more 10-second samples
 *   POST /api/agent/security   (agent token) -> login / remote-access events + current sessions
 */
const crypto = require('crypto');
const env = require('../config/env');
const ServerModel = require('../models/serverModel');
const MetricModel = require('../models/metricModel');
const LoginModel = require('../models/loginModel');
const alertEngine = require('../services/alertEngine');
const liveCache = require('../services/liveCache');
const { emit } = require('../services/socket');
const { sha256 } = require('../middleware/auth');
const { HttpError, clientIp } = require('../utils/http');

const MAX_BATCH = 500;

const num = (v, min, max, digits = 2) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  const f = 10 ** digits;
  return Math.round(Math.min(Math.max(n, min), max) * f) / f;
};
const int = (v) => {
  const n = num(v, 0, Number.MAX_SAFE_INTEGER, 0);
  return n == null ? null : Math.round(n);
};

/** Validate + normalise one sample coming from an agent. */
function cleanSample(serverId, s, now) {
  let ts = s.ts ? new Date(s.ts).getTime() : now;
  if (!Number.isFinite(ts) || ts > now + 60 * 1000 || ts < now - 6 * 3600 * 1000) ts = now;

  const memUsed = int(s.mem_used);
  const memTotal = int(s.mem_total);
  let memPct = num(s.mem_pct, 0, 100);
  if (memPct == null && memUsed != null && memTotal) memPct = num((memUsed / memTotal) * 100, 0, 100);

  const temp = num(s.cpu_temp, -50, 150, 1);
  return {
    server_id: serverId,
    created_at: new Date(ts),
    cpu_pct: num(s.cpu_pct, 0, 100),
    cpu_temp: temp && temp > 0 ? temp : null, // many boards report 0 = "not supported"
    mem_used: memUsed,
    mem_total: memTotal,
    mem_pct: memPct,
    swap_pct: num(s.swap_pct, 0, 100),
    disk_pct: num(s.disk_pct, 0, 100),
    disk_used: int(s.disk_used),
    disk_total: int(s.disk_total),
    disk_read_bps: int(s.disk_read_bps),
    disk_write_bps: int(s.disk_write_bps),
    net_rx_bps: int(s.net_rx_bps),
    net_tx_bps: int(s.net_tx_bps),
    process_count: int(s.process_count),
    uptime_sec: int(s.uptime_sec),
  };
}

exports.register = async (req, res) => {
  const b = req.body || {};
  if (b.enroll_key !== env.enrollKey) throw new HttpError(401, 'Invalid enroll key');
  const ip = String(b.ip || clientIp(req)).trim();
  if (!ip) throw new HttpError(400, 'IP address is required');

  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = sha256(token);

  let server = await ServerModel.findByIp(ip);
  let id;
  if (server) {
    id = server.id;
    await ServerModel.setToken(id, tokenHash);
  } else {
    id = await ServerModel.create({ ip, hostname: b.hostname, tokenHash });
  }
  if (b.inventory) await ServerModel.updateInventory(id, { ...b.inventory, hostname: b.hostname });

  server = await ServerModel.findById(id);
  emit('server:registered', server);
  console.log(`[agent] registered ${server.server_code} ${server.name} (${ip})`);

  res.json({
    server_id: id,
    server_code: server.server_code,
    token,
    interval_sec: env.sampleIntervalSec,
  });
};

exports.metrics = async (req, res) => {
  const server = req.server;
  if (!server.is_enabled) return res.json({ ok: true, disabled: true, interval_sec: env.sampleIntervalSec });

  const b = req.body || {};
  const raw = Array.isArray(b.samples) ? b.samples : [b];
  if (!raw.length) throw new HttpError(400, 'No samples');
  const now = Date.now();
  const samples = raw
    .slice(-MAX_BATCH)
    .map((s) => cleanSample(server.id, s || {}, now))
    .filter((s) => s.cpu_pct != null || s.mem_pct != null || s.disk_pct != null);
  if (!samples.length) throw new HttpError(400, 'Samples contain no metric values (expected { samples: [...] })');
  samples.sort((a, b2) => a.created_at - b2.created_at);

  await MetricModel.insertMany(samples);
  if (b.inventory) await ServerModel.updateInventory(server.id, b.inventory);

  const latest = samples[samples.length - 1];
  const wasOffline = server.status !== 'online';
  await ServerModel.touchSeen(server.id, latest.created_at, Array.isArray(b.disks) ? b.disks : null);

  liveCache.set(server.id, latest);
  emit('metrics', { ...latest, disks: b.disks || undefined });
  if (wasOffline) emit('server:status', { id: server.id, status: 'online', last_seen_at: latest.created_at });

  // only evaluate real-time samples (not old buffered ones)
  const srv = { id: server.id, name: server.name, ip_address: server.ip_address };
  try {
    await alertEngine.onSeen(srv);
    if (now - latest.created_at.getTime() < 60 * 1000) await alertEngine.evaluate(srv, latest);
  } catch (err) {
    console.error('[alert] evaluate failed:', err.message);
  }

  res.json({ ok: true, stored: samples.length, interval_sec: env.sampleIntervalSec });
};

/* ----------------------- logins / remote access ----------------------- */

const KINDS = new Set(['logon', 'failed', 'connection']);
const str = (v, max) => {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
};
const ipOrNull = (v) => {
  const s = str(v, 45);
  return s && /^[0-9a-fA-F:.]+$/.test(s) ? s.replace(/^::ffff:/, '') : null;
};

function cleanLoginEvent(e, now) {
  if (!e || !KINDS.has(e.kind) || !e.uid) return null;
  let ts = e.ts ? new Date(e.ts).getTime() : now;
  if (!Number.isFinite(ts) || ts > now + 60 * 1000) ts = now;
  const method = String(e.method || '').toLowerCase();
  return {
    uid: str(e.uid, 64),
    ts: new Date(ts),
    kind: e.kind,
    method: /^[a-z_]{1,20}$/.test(method) ? method : 'other',
    user: str(e.user, 150),
    domain: str(e.domain, 150),
    source_ip: ipOrNull(e.source_ip),
    source_host: str(e.source_host, 150),
    details: str(e.details, 255),
  };
}

/** POST /api/agent/security – login events + "who is logged in now" snapshot, every 30 s. */
exports.security = async (req, res) => {
  const server = req.server;
  const b = req.body || {};
  const now = Date.now();

  const sessions = (Array.isArray(b.sessions) ? b.sessions : []).slice(0, 50).map((s) => ({
    user: str(s?.user, 100), tty: str(s?.tty, 50), since: str(s?.since, 40), ip: ipOrNull(s?.ip),
  }));
  const logStatus = str(b.log_status, 20);
  await LoginModel.updateSessions(server.id, sessions, logStatus);
  emit('server:sessions', { id: server.id, sessions, login_log_status: logStatus });

  const events = (Array.isArray(b.events) ? b.events : [])
    .slice(0, 1000)
    .map((e) => cleanLoginEvent(e, now))
    .filter(Boolean)
    .sort((x, y) => x.ts - y.ts);

  const inserted = [];
  for (const ev of events) {
    const id = await LoginModel.insert(server.id, ev);
    if (id) inserted.push({ ...ev, id });
  }

  if (inserted.length) {
    const srv = { id: server.id, name: server.name, ip_address: server.ip_address };
    for (const ev of inserted.slice(-20)) emit('login:new', { ...ev, server_id: server.id, server_name: server.name, ip_address: server.ip_address });
    if (server.is_enabled) {
      try {
        await alertEngine.onLoginEvents(srv, inserted);
      } catch (err) {
        console.error('[alert] login evaluate failed:', err.message);
      }
    }
  }
  res.json({ ok: true, stored: inserted.length });
};
