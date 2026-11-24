const MB = 1024 * 1024;

export const pct = (v, d = 0) => (v == null || Number.isNaN(Number(v)) ? '–' : `${Number(v).toFixed(d)}%`);

export const num = (v, d = 1) => (v == null || Number.isNaN(Number(v)) ? '–' : Number(v).toFixed(d));

export function bytes(v, d = 1) {
  if (v == null) return '–';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = Number(v);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : d)} ${units[i]}`;
}

export const mbps = (bps, d = 2) => (bps == null ? '–' : (Number(bps) / MB).toFixed(d));
export const rate = (bps) => (bps == null ? '–' : `${bytes(bps)}/s`);

export function duration(sec) {
  if (sec == null) return '–';
  sec = Math.max(0, Math.round(sec));
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${sec % 60}s`;
  return `${sec}s`;
}

export function ago(date) {
  if (!date) return 'never';
  const s = (Date.now() - new Date(date).getTime()) / 1000;
  if (s < 5) return 'just now';
  if (s < 60) return `${Math.round(s)}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export const dateTime = (d) =>
  d
    ? new Date(d).toLocaleString(undefined, {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
      })
    : '–';

/** Axis label for a bucket timestamp (seconds) depending on bucket size. */
export function tickLabel(tsSec, bucketSec) {
  const d = new Date(tsSec * 1000);
  if (bucketSec >= 86400) return d.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
  if (bucketSec >= 3600) return d.toLocaleString(undefined, { day: '2-digit', month: 'short', hour: '2-digit' });
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

export const levelColor = (v, warn = 75, crit = 90) =>
  v == null ? 'var(--muted)' : v >= crit ? 'var(--crit)' : v >= warn ? 'var(--warn)' : 'var(--ok)';

/** Overall health of a server for colouring dots / badges. */
export function health(s) {
  if (!s) return 'unknown';
  if (!s.is_enabled) return 'disabled';
  if (s.status === 'offline') return 'offline';
  if (s.status === 'unknown') return 'unknown';
  if (s.critical_count > 0) return 'critical';
  if (s.warning_count > 0) return 'warning';
  return 'online';
}

export const METRIC_LABEL = {
  cpu: 'CPU', memory: 'RAM', disk: 'Disk', swap: 'Swap', temperature: 'Temperature',
  net_rx: 'Net download', net_tx: 'Net upload', offline: 'Offline', anomaly: 'Anomaly',
  login: 'Login / remote access', login_failed: 'Failed logins',
};

export const LOGIN_METHOD = {
  rdp: 'Remote Desktop', ssh: 'SSH', local: 'Local login', unlock: 'Screen unlock', cached: 'Cached login',
  network: 'Network / file share', anydesk: 'AnyDesk', teamviewer: 'TeamViewer', vnc: 'VNC', winrm: 'WinRM',
};
export const REMOTE_METHODS = ['rdp', 'ssh', 'anydesk', 'teamviewer', 'vnc', 'winrm'];

export const RANGES = [
  { key: 'hour', label: 'Last hour' },
  { key: 'today', label: 'Today' },
  { key: '7d', label: 'Last 7 days' },
  { key: '30d', label: 'Last 30 days' },
  { key: '12m', label: 'Last 12 months' },
];
