/**
 * Server Monitor Agent
 * --------------------
 * Install on every PC / server you want to monitor (Windows or Linux).
 *  1. Registers itself with the monitoring server using ENROLL_KEY (once) and stores its token in .agent-token.json
 *  2. Every 10 s collects CPU, RAM, swap, disk, disk I/O, network throughput, temperature and uptime
 *  3. Pushes samples to the server; if the server is unreachable, samples are buffered (up to 1 hour)
 *     and sent in one batch when the connection returns – no history gaps.
 *  4. Sends hardware / OS inventory on start-up and once a day.
 *  5. Every 30 s reports logins / remote access (RDP, SSH, local, unlock, failed passwords,
 *     AnyDesk, TeamViewer) with the source IP, plus who is logged in right now – see security.js.
 *
 * Run:   node agent.js        (keep alive with pm2 or install as a Windows service – see README)
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });
const si = require('systeminformation');
const security = require('./security');

const VERSION = '1.1.0';
const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:5000').replace(/\/+$/, '');
const ENROLL_KEY = process.env.ENROLL_KEY || 'SCL-ENROLL-2026';
const TOKEN_FILE = path.join(__dirname, '.agent-token.json');
const MAX_BUFFER = 360; // 1 hour at 10 s
const INVENTORY_EVERY_MS = 24 * 3600 * 1000;
const SECURITY_EVERY_MS = 30 * 1000;
const SECURITY_ENABLED = process.env.SECURITY_MONITOR !== '0';

let intervalSec = 10;
let credentials = loadCredentials();
let buffer = [];
let lastInventoryAt = 0;
let sending = false;

/* ----------------------------- helpers ----------------------------- */

const log = (...a) => console.log(new Date().toISOString(), ...a);

function loadCredentials() {
  try {
    const c = JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8'));
    // token belongs to another machine (folder was copied) or another server -> register again
    if (c.server_url !== SERVER_URL || (c.ip && c.ip !== primaryIPv4()) || (c.hostname && c.hostname !== os.hostname())) return null;
    return c;
  } catch {
    return null;
  }
}

function primaryIPv4() {
  if (process.env.AGENT_IP) return process.env.AGENT_IP.trim();
  const candidates = [];
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    for (const a of addrs || []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')) {
        const virtual = /vmware|virtualbox|vEthernet|docker|loopback|hyper-v|tap|tun/i.test(name);
        candidates.push({ name, address: a.address, mac: a.mac, virtual });
      }
    }
  }
  candidates.sort((x, y) => x.virtual - y.virtual);
  return candidates[0]?.address || '127.0.0.1';
}

async function api(pathname, body, token) {
  const res = await fetch(`${SERVER_URL}/api${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------------------- collection --------------------------- */

async function collectInventory() {
  const [osInfo, cpu, mem, system, nets, time] = await Promise.all([
    si.osInfo(), si.cpu(), si.mem(), si.system(), si.networkInterfaces(), si.time(),
  ]);
  const ip = primaryIPv4();
  const nics = (Array.isArray(nets) ? nets : [nets])
    .filter((n) => !n.internal && (n.ip4 || n.mac))
    .map((n) => ({ name: n.iface, ip4: n.ip4, mac: n.mac, speed: n.speed, type: n.type, operstate: n.operstate }));
  const main = nics.find((n) => n.ip4 === ip);
  return {
    os_name: `${osInfo.distro} ${osInfo.release}`.trim(),
    os_version: osInfo.build || osInfo.kernel,
    platform: osInfo.platform,
    arch: osInfo.arch,
    cpu_model: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cpu_cores: cpu.physicalCores,
    cpu_threads: cpu.cores,
    mem_total: mem.total,
    manufacturer: system.manufacturer,
    model: system.model,
    serial: system.serial && system.serial !== '-' ? system.serial : null,
    mac: main?.mac || null,
    nics,
    boot_time: new Date(Date.now() - time.uptime * 1000).toISOString(),
    agent_version: VERSION,
  };
}

let warmedUp = false;

async function collectSample() {
  const [load, mem, fsSize, net, temp, fsStats, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize().catch(() => []),
    si.networkStats('*').catch(() => []),
    si.cpuTemperature().catch(() => ({})),
    si.fsStats().catch(() => null),
    si.time(),
  ]);

  // Disks: ignore tiny / virtual volumes
  const disks = (fsSize || [])
    .filter((d) => d.size > 1024 ** 3 && !/^(tmpfs|devtmpfs|overlay|squashfs)$/i.test(d.type || ''))
    .map((d) => ({
      mount: d.mount, fs: d.fs, type: d.type, size: d.size, used: d.used,
      use_pct: Math.round((d.use ?? (d.used / d.size) * 100) * 100) / 100,
    }));
  const diskUsed = disks.reduce((a, d) => a + d.used, 0);
  const diskTotal = disks.reduce((a, d) => a + d.size, 0);
  const diskPct = disks.length ? Math.max(...disks.map((d) => d.use_pct)) : null; // fullest volume drives alerts

  // Network: sum all physical interfaces (rx_sec is null on the very first call)
  const nets = (Array.isArray(net) ? net : [net]).filter((n) => n && !/loopback|^lo$/i.test(n.iface));
  const rx = nets.reduce((a, n) => a + (n.rx_sec > 0 ? n.rx_sec : 0), 0);
  const tx = nets.reduce((a, n) => a + (n.tx_sec > 0 ? n.tx_sec : 0), 0);

  const sample = {
    ts: new Date().toISOString(),
    cpu_pct: round(load.currentLoad),
    cpu_temp: temp && temp.main > 0 ? round(temp.main, 1) : null,
    mem_used: mem.active ?? mem.used,
    mem_total: mem.total,
    mem_pct: round(((mem.active ?? mem.used) / mem.total) * 100),
    swap_pct: mem.swaptotal ? round((mem.swapused / mem.swaptotal) * 100) : null,
    disk_pct: diskPct,
    disk_used: diskUsed || null,
    disk_total: diskTotal || null,
    disk_read_bps: fsStats && fsStats.rx_sec > 0 ? Math.round(fsStats.rx_sec) : null,
    disk_write_bps: fsStats && fsStats.wx_sec > 0 ? Math.round(fsStats.wx_sec) : null,
    net_rx_bps: warmedUp ? Math.round(rx) : null,
    net_tx_bps: warmedUp ? Math.round(tx) : null,
    uptime_sec: Math.round(time.uptime),
  };
  warmedUp = true;
  return { sample, disks };
}

const round = (v, d = 2) => (v == null || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/* ------------------------------ network ---------------------------- */

async function register() {
  const inventory = await collectInventory();
  const body = {
    enroll_key: ENROLL_KEY,
    hostname: process.env.AGENT_NAME || os.hostname(),
    ip: primaryIPv4(),
    inventory,
  };
  const r = await api('/agent/register', body);
  credentials = {
    server_url: SERVER_URL, server_id: r.server_id, server_code: r.server_code, token: r.token,
    ip: body.ip, hostname: os.hostname(),
  };
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(credentials, null, 2));
  intervalSec = r.interval_sec || intervalSec;
  lastInventoryAt = Date.now();
  log(`Registered as ${r.server_code} (${body.ip}) -> ${SERVER_URL}`);
}

async function tick() {
  let collected;
  try {
    collected = await collectSample();
  } catch (err) {
    log('Collect failed:', err.message);
    return;
  }
  buffer.push(collected.sample);
  if (buffer.length > MAX_BUFFER) buffer = buffer.slice(-MAX_BUFFER);
  if (sending) return;

  sending = true;
  try {
    if (!credentials) await register();
    const batch = buffer.slice();
    const body = { samples: batch, disks: collected.disks };
    if (Date.now() - lastInventoryAt > INVENTORY_EVERY_MS) {
      body.inventory = await collectInventory();
      lastInventoryAt = Date.now();
    }
    const r = await api('/agent/metrics', body, credentials.token);
    if (batch.length > 1) log(`Flushed ${batch.length} buffered samples`);
    buffer = buffer.slice(batch.length);
    if (r.interval_sec && r.interval_sec !== intervalSec) {
      intervalSec = r.interval_sec;
      restartTimer();
    }
  } catch (err) {
    if (err.status === 401) {
      log('Token rejected – re-registering');
      credentials = null;
      try { fs.unlinkSync(TOKEN_FILE); } catch { /* ignore */ }
    } else {
      log(`Send failed (${buffer.length} buffered):`, err.message);
    }
  } finally {
    sending = false;
  }
}

/* --------------------------- login monitor -------------------------- */

let securityBusy = false;
let lastLogStatus = null;
async function securityTick() {
  if (securityBusy || !credentials) return;
  securityBusy = true;
  try {
    const { payload, commit } = await security.collect();
    if (payload.log_status !== lastLogStatus) {
      lastLogStatus = payload.log_status;
      if (payload.log_status === 'ok') log('Login monitor: reading the system login log');
      else log(`Login monitor: cannot read the login log (${payload.log_status}: ${payload.log_error || '-'}) – run the agent as Administrator/root. Falling back to connection tracking.`);
    }
    await api('/agent/security', payload, credentials.token);
    commit(); // only advance the read position once the server has the events
    if (payload.events.length) log(`Reported ${payload.events.length} login event(s)`);
  } catch (err) {
    if (err.status !== 401) log('Login report failed:', err.message);
  } finally {
    securityBusy = false;
  }
}

let timer = null;
function restartTimer() {
  clearInterval(timer);
  timer = setInterval(tick, intervalSec * 1000);
}

log(`Server Monitor Agent v${VERSION} starting – host ${os.hostname()} ip ${primaryIPv4()} -> ${SERVER_URL}`);
tick();
restartTimer();
if (SECURITY_ENABLED) {
  setTimeout(securityTick, 5000);
  setInterval(securityTick, SECURITY_EVERY_MS);
}

process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
