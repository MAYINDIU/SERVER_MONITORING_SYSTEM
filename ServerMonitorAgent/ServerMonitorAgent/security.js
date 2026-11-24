/**
 * Login / remote-access collector
 * -------------------------------
 * Finds out WHO got into this machine, HOW and FROM WHICH IP:
 *
 *  Windows
 *   - Security event log 4624 (successful logon) / 4625 (failed logon)
 *       type 2  = local keyboard login        type 7  = screen unlocked
 *       type 10 = Remote Desktop (RDP)        type 11 = cached (domain) login
 *       type 3  = network (file share, WinRM, ...) – recorded, alert is optional
 *     Needs Administrator / SYSTEM, or the agent user in the "Event Log Readers" group.
 *   - AnyDesk   connection_trace.txt  (incoming sessions)
 *   - TeamViewer Connections_incoming.txt
 *  Linux
 *   - journald (auth / authpriv) or /var/log/auth.log | /var/log/secure:
 *     SSH accepted / failed, console + desktop logins
 *  Both
 *   - Who is logged in right now (si.users) – sent as a snapshot every poll
 *   - Fallback when the log cannot be read: new inbound connections to RDP / SSH / VNC / WinRM ports
 *
 * Every event gets a stable `uid`, so re-sending after a crash never creates duplicates on the server.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const si = require('systeminformation');

const IS_WIN = process.platform === 'win32';
const STATE_FILE = path.join(__dirname, '.agent-security.json');
const FIRST_RUN_LOOKBACK_MS = 60 * 60 * 1000; // first start: import the last hour only
const MAX_EVENTS_PER_POLL = 500;

const REMOTE_PORTS = { 3389: 'rdp', 22: 'ssh', 5900: 'vnc', 5901: 'vnc', 5902: 'vnc', 5985: 'winrm', 5986: 'winrm' };
const WIN_LOGON_TYPES = { 2: 'local', 3: 'network', 7: 'unlock', 8: 'network', 10: 'rdp', 11: 'cached' };
const WIN_IGNORE_USERS = /^(SYSTEM|LOCAL SERVICE|NETWORK SERVICE|ANONYMOUS LOGON|DWM-\d+|UMFD-\d+|.*\$)$/i;

const sha1 = (s) => crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 24);
const isLocalIp = (ip) => !ip || ip === '-' || ip === '::1' || ip === '127.0.0.1' || ip === '0.0.0.0' || ip === '::';

/* ------------------------------- state ------------------------------- */

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return {};
  }
}
function saveState(state) {
  try {
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  } catch {
    /* read-only folder – we just re-send (server de-duplicates) */
  }
}

function run(file, args, timeout = 25000) {
  return new Promise((resolve) => {
    execFile(file, args, { timeout, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) =>
      resolve({ err, stdout: String(stdout || ''), stderr: String(stderr || '') })
    );
  });
}

/* --------------------------- Windows events -------------------------- */

const PS_SCRIPT = (xpath) => `
$ErrorActionPreference = 'Stop'
try {
  $ev = Get-WinEvent -LogName Security -FilterXPath "${xpath}" -MaxEvents ${MAX_EVENTS_PER_POLL}
} catch {
  if ($_.FullyQualifiedErrorId -match 'NoMatchingEventsFound') { '[]'; exit 0 }
  'ERR:' + $_.Exception.Message; exit 0
}
$out = foreach ($e in $ev) {
  $x = [xml]$e.ToXml(); $d = @{}
  foreach ($n in $x.Event.EventData.Data) { $d[$n.Name] = $n.'#text' }
  [pscustomobject]@{
    id = $e.Id; rid = $e.RecordId; ts = $e.TimeCreated.ToUniversalTime().ToString('o')
    user = $d.TargetUserName; domain = $d.TargetDomainName; type = $d.LogonType
    ip = $d.IpAddress; ws = $d.WorkstationName; proc = $d.ProcessName; sub = $d.SubStatus
  }
}
ConvertTo-Json -InputObject @($out) -Compress -Depth 3
`;

const FAIL_REASON = {
  '0xc000006a': 'wrong password', '0xc0000064': 'user does not exist', '0xc0000072': 'account disabled',
  '0xc0000234': 'account locked', '0xc000006f': 'outside allowed hours', '0xc0000070': 'workstation restriction',
  '0xc0000071': 'password expired', '0xc0000193': 'account expired', '0xc0000224': 'must change password',
};

async function windowsEvents(state) {
  const lastRid = Number(state.win_rid) || 0;
  const xpath = lastRid
    ? `*[System[(EventID=4624 or EventID=4625) and EventRecordID > ${lastRid}]]`
    : `*[System[(EventID=4624 or EventID=4625) and TimeCreated[timediff(@SystemTime) <= ${FIRST_RUN_LOOKBACK_MS}]]]`;
  const encoded = Buffer.from(PS_SCRIPT(xpath), 'utf16le').toString('base64');
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded]);
  const text = r.stdout.trim();
  if (text.startsWith('ERR:') || (!text && r.err)) {
    const msg = text.slice(4) || r.err?.message || 'unknown error';
    return { status: /unauthorized|access is denied|privilege/i.test(msg) ? 'denied' : 'error', error: msg.slice(0, 200), events: [] };
  }
  let rows;
  try {
    rows = JSON.parse(text || '[]');
  } catch {
    return { status: 'error', error: 'could not parse PowerShell output', events: [] };
  }
  if (!Array.isArray(rows)) rows = [rows];
  rows.sort((a, b) => a.rid - b.rid);

  const events = [];
  const seen = new Map(); // collapse the twin events Windows writes for admin logins (linked tokens)
  for (const e of rows) {
    state.win_rid = Math.max(Number(state.win_rid) || 0, e.rid);
    const user = String(e.user || '').trim();
    if (!user || user === '-' || WIN_IGNORE_USERS.test(user)) continue;
    const method = WIN_LOGON_TYPES[e.type];
    if (!method) continue; // service / batch / proxy logons are noise
    const ip = isLocalIp(e.ip) ? null : e.ip;
    if ((method === 'network') && !ip) continue; // local loopback network logons

    const kind = e.id === 4625 ? 'failed' : 'logon';
    const key = `${kind}|${user}|${e.domain}|${method}|${ip}`;
    const t = new Date(e.ts).getTime();
    if (kind === 'logon' && seen.has(key) && t - seen.get(key) < 5000) continue;
    seen.set(key, t);

    events.push({
      uid: `win:${e.rid}`,
      ts: e.ts,
      kind,
      method,
      user,
      domain: e.domain && e.domain !== '-' ? e.domain : null,
      source_ip: ip,
      source_host: e.ws && e.ws !== '-' ? e.ws : null,
      details: kind === 'failed'
        ? FAIL_REASON[String(e.sub || '').toLowerCase()] || (e.sub ? `status ${e.sub}` : null)
        : e.proc && e.proc !== '-' ? path.basename(e.proc) : null,
    });
  }
  return { status: 'ok', events };
}

/* ------------------------ remote-tool log files ----------------------- */

/** Read only the bytes appended since last time. First sight of a file = start at its end. */
function readNew(state, file) {
  state.files = state.files || {};
  let st;
  try {
    st = fs.statSync(file);
  } catch {
    return null;
  }
  let off = state.files[file];
  if (off == null) {
    state.files[file] = st.size;
    return null;
  }
  if (st.size < off) off = 0; // rotated / truncated
  if (st.size === off) return null;
  const len = Math.min(st.size - off, 2 * 1024 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, 'r');
  try {
    fs.readSync(fd, buf, 0, len, off);
  } finally {
    fs.closeSync(fd);
  }
  state.files[file] = off + len;
  return { text: buf.toString('utf8').replace(/\u0000/g, ''), offset: off };
}

function anydeskFiles() {
  const dirs = [path.join(process.env.ProgramData || 'C:\\ProgramData', 'AnyDesk')];
  if (process.env.APPDATA) dirs.push(path.join(process.env.APPDATA, 'AnyDesk'));
  return dirs;
}

function remoteToolEvents(state) {
  const events = [];

  // AnyDesk: "Incoming    2025-01-10, 14:22    User    123456789    123456789"
  for (const dir of anydeskFiles()) {
    const svcTrace = readNew(state, path.join(dir, 'ad_svc.trace'));
    const ips = svcTrace ? [...svcTrace.text.matchAll(/Logged in from ([0-9a-f.:]+?):\d+/gi)].map((m) => m[1]) : [];
    const file = path.join(dir, 'connection_trace.txt');
    const chunk = readNew(state, file);
    if (!chunk) continue;
    let pos = chunk.offset;
    for (const line of chunk.text.split(/\r?\n/)) {
      const lineOff = pos;
      pos += Buffer.byteLength(line, 'utf8') + 1;
      if (!/incoming/i.test(line)) continue;
      const ids = line.match(/\b\d{9,10}\b/g) || [];
      const authType = (line.match(/\b(Passwd|Token|User|Unattended|Accept)\w*/i) || [])[0];
      events.push({
        uid: `ad:${sha1(file + lineOff + line)}`,
        ts: new Date().toISOString(),
        kind: 'logon',
        method: 'anydesk',
        user: ids[0] ? `AnyDesk ${ids[0]}` : 'AnyDesk',
        source_ip: ips.shift() || null,
        details: [authType && `auth: ${authType}`, line.trim().replace(/\s+/g, ' ')].filter(Boolean).join(' · ').slice(0, 250),
      });
    }
  }

  // TeamViewer: "ID<TAB>Name<TAB>Start<TAB>End<TAB>LocalUser<TAB>Type<TAB>GUID" (written when the session ends)
  const tvDirs = [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean).map((p) => path.join(p, 'TeamViewer'));
  for (const dir of tvDirs) {
    const file = path.join(dir, 'Connections_incoming.txt');
    const chunk = readNew(state, file);
    if (!chunk) continue;
    let pos = chunk.offset;
    for (const line of chunk.text.split(/\r?\n/)) {
      const lineOff = pos;
      pos += Buffer.byteLength(line, 'utf8') + 1;
      const c = line.split('\t').map((x) => x.trim());
      if (c.length < 4 || !/^\d+$/.test(c[0])) continue;
      events.push({
        uid: `tv:${sha1(file + lineOff + line)}`,
        ts: new Date().toISOString(),
        kind: 'logon',
        method: 'teamviewer',
        user: `TeamViewer ${c[0]}${c[1] ? ` (${c[1]})` : ''}`,
        source_ip: null,
        details: `session ${c[2]} → ${c[3]}${c[4] ? ` · local user ${c[4]}` : ''}${c[5] ? ` · ${c[5]}` : ''}`.slice(0, 250),
      });
    }
  }
  return events;
}

/* ------------------------------- Linux ------------------------------- */

const LINUX_PATTERNS = [
  { re: /Accepted (\S+) for (\S+) from (\S+) port \d+/, kind: 'logon', method: 'ssh', user: 2, ip: 3, details: (m) => m[1] },
  { re: /Failed (\S+) for (?:invalid user )?(\S+) from (\S+) port \d+/, kind: 'failed', method: 'ssh', user: 2, ip: 3, details: (m) => m[1] },
  { re: /Invalid user (\S*) from (\S+)/, kind: 'failed', method: 'ssh', user: 1, ip: 2, details: () => 'invalid user' },
  { re: /pam_unix\((login|gdm-password|gdm-autologin|lightdm|sddm|xrdp-sesman)[^)]*\): session opened for user ([^\s(]+)/, kind: 'logon', method: 'local', user: 2, details: (m) => m[1] },
  { re: /pam_unix\((login|gdm-password|lightdm|sddm)[^)]*\): authentication failure;.*?user=(\S+)/, kind: 'failed', method: 'local', user: 2, details: (m) => m[1] },
];

function parseLinuxLine(msg) {
  for (const p of LINUX_PATTERNS) {
    const m = msg.match(p.re);
    if (!m) continue;
    const ip = p.ip ? m[p.ip] : null;
    let method = p.method;
    if (method === 'local' && /xrdp/.test(m[1])) method = 'rdp';
    return { kind: p.kind, method, user: m[p.user] || '?', source_ip: isLocalIp(ip) ? null : ip, details: p.details(m) };
  }
  return null;
}

async function linuxEvents(state) {
  // 1) journald
  const args = ['-o', 'json', '--no-pager', '-q', 'SYSLOG_FACILITY=4', 'SYSLOG_FACILITY=10'];
  if (state.journal_cursor) args.push(`--after-cursor=${state.journal_cursor}`);
  else args.push(`--since=-${Math.round(FIRST_RUN_LOOKBACK_MS / 60000)}min`);
  const r = await run('journalctl', args);
  if (!r.err && !/insufficient permissions/i.test(r.stderr)) {
    const events = [];
    for (const line of r.stdout.split('\n').filter(Boolean).slice(-5000)) {
      let j;
      try {
        j = JSON.parse(line);
      } catch {
        continue;
      }
      state.journal_cursor = j.__CURSOR;
      const msg = Array.isArray(j.MESSAGE) ? Buffer.from(j.MESSAGE).toString('utf8') : String(j.MESSAGE || '');
      const ev = parseLinuxLine(msg);
      if (!ev) continue;
      const ts = j.__REALTIME_TIMESTAMP ? new Date(Number(j.__REALTIME_TIMESTAMP) / 1000).toISOString() : new Date().toISOString();
      events.push({ uid: `j:${sha1(j.__CURSOR)}`, ts, ...ev });
    }
    return { status: 'ok', events };
  }

  // 2) classic syslog files
  for (const file of ['/var/log/auth.log', '/var/log/secure']) {
    if (!fs.existsSync(file)) continue;
    let chunk;
    try {
      chunk = readNew(state, file);
    } catch (err) {
      return { status: 'denied', error: err.message, events: [] };
    }
    const events = [];
    if (chunk) {
      let pos = chunk.offset;
      for (const line of chunk.text.split('\n')) {
        const lineOff = pos;
        pos += Buffer.byteLength(line, 'utf8') + 1;
        const ev = parseLinuxLine(line);
        if (ev) events.push({ uid: `f:${sha1(file + lineOff + line)}`, ts: new Date().toISOString(), ...ev });
      }
    }
    return { status: 'ok', events };
  }
  return { status: 'denied', error: (r.stderr || r.err?.message || 'no readable auth log').slice(0, 200), events: [] };
}

/* ---------------------- live sessions / connections ------------------- */

async function currentSessions() {
  const users = await si.users().catch(() => []);
  return (users || []).slice(0, 50).map((u) => ({
    user: u.user,
    tty: u.tty || null,
    since: u.date ? `${u.date} ${u.time || ''}`.trim() : null,
    ip: isLocalIp(u.ip) ? null : u.ip || null,
  }));
}

/** Fallback used only when the login log can't be read: new inbound remote-access connections. */
async function connectionEvents(state) {
  const conns = await si.networkConnections().catch(() => []);
  const now = new Set();
  const events = [];
  const prev = new Set(state.conns || []);
  for (const c of conns || []) {
    const method = REMOTE_PORTS[Number(c.localPort)];
    if (!method || String(c.state).toUpperCase() !== 'ESTABLISHED' || isLocalIp(c.peerAddress)) continue;
    const key = `${c.localPort}|${c.peerAddress}`;
    now.add(key);
    if (prev.has(key) || !state.conns) continue; // first poll: just learn what is already open
    events.push({
      uid: `c:${sha1(key + Date.now())}`,
      ts: new Date().toISOString(),
      kind: 'connection',
      method,
      user: null,
      source_ip: c.peerAddress,
      details: `inbound connection to port ${c.localPort}${c.process ? ` (${c.process})` : ''}`,
    });
  }
  state.conns = [...now];
  return events;
}

/* -------------------------------- main -------------------------------- */

/**
 * Collect everything new since the last successful send.
 * Returns { payload, commit } – call commit() only after the server accepted the payload.
 */
async function collect() {
  const state = loadState();
  let log = { status: 'n/a', events: [] };
  try {
    log = IS_WIN ? await windowsEvents(state) : await linuxEvents(state);
  } catch (err) {
    log = { status: 'error', error: err.message, events: [] };
  }
  let events = log.events;
  if (IS_WIN) {
    try {
      events = events.concat(remoteToolEvents(state));
    } catch {
      /* ignore unreadable tool logs */
    }
  }
  if (log.status !== 'ok') events = events.concat(await connectionEvents(state));

  return {
    payload: {
      log_status: log.status,
      log_error: log.error || null,
      hostname: os.hostname(),
      sessions: await currentSessions(),
      events: events.slice(-MAX_EVENTS_PER_POLL),
    },
    commit: () => saveState(state),
  };
}

module.exports = { collect, parseLinuxLine };
