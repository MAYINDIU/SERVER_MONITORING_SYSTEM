/**
 * Demo / load-test simulator – pretends to be several PCs so you can try the
 * dashboard, reports, alerts and SMS without installing the agent everywhere.
 *
 *   node simulate.js            (5 fake servers)
 *   node simulate.js 20         (20 fake servers)
 *
 * Behaviour: random-walk load, occasional random spikes (to trigger alerts /
 * anomaly detection) and one server that drops offline every few minutes.
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const SERVER_URL = (process.env.SERVER_URL || 'http://localhost:5000').replace(/\/+$/, '');
const ENROLL_KEY = process.env.ENROLL_KEY || 'SCL-ENROLL-2026';
const COUNT = Number(process.argv[2]) || 5;
const GB = 1024 ** 3;
const MB = 1024 ** 2;

const NAMES = [
  'VMWARE-Dell-R230', 'VMWARE-Dell-R330', 'Sentinel-Factory-VM', 'ADC-Factory', 'ERP-DB-01',
  'File-Server', 'Mail-Gateway', 'HR-App-01', 'Backup-NAS', 'Web-Portal',
];

const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

async function post(p, body, token) {
  const res = await fetch(`${SERVER_URL}/api${p}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `HTTP ${res.status}`);
  return data;
}

function makeServer(i) {
  const memTotal = [8, 16, 32, 64][i % 4] * GB;
  return {
    i,
    name: NAMES[i] || `Demo-PC-${i + 1}`,
    ip: `10.99.0.${11 + i}`,
    memTotal,
    diskTotal: [256, 512, 1024, 2048][i % 4] * GB,
    cpu: rand(5, 40),
    mem: rand(30, 70),
    disk: rand(40, 88),
    temp: rand(40, 55),
    uptime: Math.round(rand(3600, 3600 * 24 * 40)),
    spike: 0,
    offlineUntil: 0,
    token: null,
  };
}

async function register(s) {
  const r = await post('/agent/register', {
    enroll_key: ENROLL_KEY,
    hostname: s.name,
    ip: s.ip,
    inventory: {
      os_name: s.i % 3 === 2 ? 'Ubuntu 22.04.4 LTS' : 'Microsoft Windows Server 2022 Datacenter',
      os_version: s.i % 3 === 2 ? '5.15.0' : '10.0.20348',
      platform: s.i % 3 === 2 ? 'linux' : 'win32',
      arch: 'x64',
      cpu_model: 'Intel Xeon E3-1220 v6',
      cpu_cores: 4,
      cpu_threads: 4,
      mem_total: s.memTotal,
      manufacturer: 'Dell Inc.',
      model: 'PowerEdge R230',
      nics: [{ name: 'Ethernet0', ip4: s.ip, mac: `00:50:56:00:00:${(11 + s.i).toString(16).padStart(2, '0')}`, speed: 1000 }],
      agent_version: 'sim-1.0',
    },
  });
  s.token = r.token;
  console.log(`registered ${r.server_code} ${s.name} ${s.ip}`);
}

function step(s) {
  // random walk
  s.cpu = clamp(s.cpu + rand(-6, 6), 2, 70);
  s.mem = clamp(s.mem + rand(-1.5, 1.5), 20, 85);
  s.disk = clamp(s.disk + rand(-0.01, 0.03), 10, 99);
  s.temp = clamp(s.temp + rand(-1, 1), 35, 70);
  s.uptime += 10;

  // random spike: ~1 in 60 samples per server, lasts 30–120 s
  if (!s.spike && Math.random() < 1 / 60) s.spike = Math.round(rand(3, 12));
  let cpu = s.cpu;
  let mem = s.mem;
  let temp = s.temp;
  if (s.spike) {
    cpu = rand(88, 100);
    mem = clamp(s.mem + rand(10, 25), 0, 99);
    temp = rand(72, 92);
    s.spike--;
  }
  const rx = Math.max(0, rand(0.01, 3) * MB * (s.spike ? 20 : 1));
  const tx = Math.max(0, rand(0.01, 1.5) * MB * (s.spike ? 10 : 1));
  const diskUsed = (s.disk / 100) * s.diskTotal;

  return {
    sample: {
      ts: new Date().toISOString(),
      cpu_pct: +cpu.toFixed(2),
      cpu_temp: +temp.toFixed(1),
      mem_used: Math.round((mem / 100) * s.memTotal),
      mem_total: s.memTotal,
      mem_pct: +mem.toFixed(2),
      swap_pct: +clamp(mem - 40, 0, 100).toFixed(2),
      disk_pct: +s.disk.toFixed(2),
      disk_used: Math.round(diskUsed),
      disk_total: s.diskTotal,
      disk_read_bps: Math.round(rand(0, 20) * MB),
      disk_write_bps: Math.round(rand(0, 10) * MB),
      net_rx_bps: Math.round(rx),
      net_tx_bps: Math.round(tx),
      uptime_sec: s.uptime,
    },
    disks: [
      { mount: 'C:', fs: 'C:', type: 'NTFS', size: s.diskTotal * 0.25, used: s.diskTotal * 0.25 * (s.disk / 100), use_pct: +s.disk.toFixed(2) },
      { mount: 'D:', fs: 'D:', type: 'NTFS', size: s.diskTotal * 0.75, used: s.diskTotal * 0.75 * 0.42, use_pct: 42 },
    ],
  };
}

async function main() {
  console.log(`Simulating ${COUNT} servers -> ${SERVER_URL}`);
  const servers = Array.from({ length: COUNT }, (_, i) => makeServer(i));
  for (const s of servers) await register(s);

  setInterval(async () => {
    const now = Date.now();
    // last server goes offline for ~90 s roughly every 10 minutes
    const flaky = servers[servers.length - 1];
    if (COUNT > 1 && !flaky.offlineUntil && Math.random() < 1 / 60) {
      flaky.offlineUntil = now + 90 * 1000;
      console.log(`${flaky.name} going OFFLINE for 90 s`);
    }
    await Promise.all(
      servers.map(async (s) => {
        if (s.offlineUntil > now) return;
        s.offlineUntil = 0;
        try {
          const { sample, disks } = step(s);
          await post('/agent/metrics', { samples: [sample], disks }, s.token);
        } catch (err) {
          console.error(`${s.name}: ${err.message}`);
          if (/token/i.test(err.message)) await register(s).catch(() => {});
        }
      })
    );
  }, 10 * 1000);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
