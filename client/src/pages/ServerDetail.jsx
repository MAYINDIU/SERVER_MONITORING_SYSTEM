import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, download, qs } from '../lib/api';
import { useLive, useSocketEvent } from '../context/LiveContext';
import { useAuth } from '../context/AuthContext';
import Gauge, { niceMax } from '../components/Gauge';
import TimeChart from '../components/TimeChart';
import {
  AlertStatusBadge, Badge, Bar, Empty, RangeTabs, SeverityBadge, Spinner, StatCard, StatusDot,
} from '../components/ui';
import { IconBack, IconDownload, IconPrint } from '../components/Icons';
import LoginTable, { LogStatusNote, SessionList } from '../components/LoginTable';
import { ago, bytes, dateTime, duration, health, mbps, num, pct, rate } from '../lib/format';

const MB = 1024 * 1024;
const DEFAULTS = { cpu: [80, 95], memory: [85, 95], disk: [85, 95], swap: [70, 90], temperature: [75, 90] };

/** Effective warn/crit for a metric (server rule overrides global rule). */
function thresholds(rules, serverId, metric) {
  const r =
    rules.find((x) => x.enabled && x.metric === metric && x.server_id === serverId) ||
    rules.find((x) => x.enabled && x.metric === metric && x.server_id == null);
  const d = DEFAULTS[metric] || [75, 90];
  return [r?.warning_threshold ?? d[0], r?.critical_threshold ?? d[1]];
}

const toPoint = (m) => ({
  ts: Math.floor(new Date(m.created_at).getTime() / 1000),
  cpu: m.cpu_pct,
  mem: m.mem_pct,
  disk: m.disk_pct,
  swap: m.swap_pct,
  temp: m.cpu_temp,
  rx: m.net_rx_bps == null ? null : m.net_rx_bps / MB,
  tx: m.net_tx_bps == null ? null : m.net_tx_bps / MB,
});

/* ------------------------------ Live tab ------------------------------ */

function LiveTab({ server, rules }) {
  const [points, setPoints] = useState([]);
  const live = server.status === 'online' ? server.live : null;

  useEffect(() => {
    api.get(`/servers/${server.id}/latest?limit=90`).then((rows) => setPoints(rows.map(toPoint))).catch(() => {});
  }, [server.id]);

  useSocketEvent('metrics', (m) => {
    if (m.server_id !== server.id) return;
    setPoints((prev) => [...prev, toPoint(m)].slice(-180));
  });

  const [cw, cc] = thresholds(rules, server.id, 'cpu');
  const [mw, mc] = thresholds(rules, server.id, 'memory');
  const [dw, dc] = thresholds(rules, server.id, 'disk');
  const [sw, sc] = thresholds(rules, server.id, 'swap');
  const [tw, tc] = thresholds(rules, server.id, 'temperature');
  const netMb = live ? ((live.net_rx_bps || 0) + (live.net_tx_bps || 0)) / MB : null;
  const netMax = niceMax(Math.max(netMb || 0, ...points.slice(-30).map((p) => (p.rx || 0) + (p.tx || 0))));

  return (
    <>
      <div className="card gauges-card">
        <div className="gauges">
          <Gauge value={live?.cpu_pct} label="CPU" warn={cw} crit={cc}
            sublabel={`${server.cpu_threads || '?'} threads · up ${duration(live?.uptime_sec)}`} />
          <Gauge value={live?.cpu_temp} label="Temperature" unit="°C" max={110} warn={tw} crit={tc}
            sublabel={live && live.cpu_temp == null ? 'sensor not supported' : 'CPU package'} />
          <Gauge value={live?.mem_pct} label="RAM" warn={mw} crit={mc}
            sublabel={`${bytes(live?.mem_used)} / ${bytes(live?.mem_total || server.mem_total)}`} />
          <Gauge value={live?.swap_pct} label="Swap" warn={sw} crit={sc}
            sublabel={live && live.swap_pct == null ? 'no swap / page file' : 'page file / swap'} />
          <Gauge value={live?.disk_pct} label="Disk" warn={dw} crit={dc}
            sublabel={`${bytes(live?.disk_used)} / ${bytes(live?.disk_total)}`} />
          <Gauge value={netMb} label="Network (MB/s)" max={netMax} warn={netMax * 0.7} crit={netMax * 0.9}
            decimals={2} unit="" sublabel={`↓ ${mbps(live?.net_rx_bps)} · ↑ ${mbps(live?.net_tx_bps)} MB/s`} />
        </div>
        {!live && (
          <div className="offline-banner">
            {server.last_seen_at
              ? `Server is ${server.status} – last data ${ago(server.last_seen_at)}`
              : `Waiting for agent – install the agent on ${server.ip_address} (Settings → Agent setup)`}
          </div>
        )}
      </div>

      <div className="grid-2">
        <div className="card">
          <div className="card-head">
            <h3>CPU · RAM · Disk (live, last 15 min)</h3>
          </div>
          <TimeChart data={points} bucketSec={10} yMax={100} series={[
            { key: 'cpu', name: 'CPU', color: '#22d3a6' },
            { key: 'mem', name: 'RAM', color: '#8b5cf6' },
            { key: 'disk', name: 'Disk', color: '#38bdf8' },
          ]} />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Network (live, MB/s)</h3>
          </div>
          <TimeChart data={points} bucketSec={10} unit="" fmt={(v) => Number(v).toFixed(2)} series={[
            { key: 'rx', name: 'Download', color: '#f59e0b' },
            { key: 'tx', name: 'Upload', color: '#ec4899' },
          ]} />
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Disk volumes</h3>
          <span className="muted sm">read {rate(live?.disk_read_bps)} · write {rate(live?.disk_write_bps)}</span>
        </div>
        {!server.disks?.length && <Empty>No volume data yet</Empty>}
        <table className="table">
          <tbody>
            {server.disks?.map((d) => (
              <tr key={d.mount}>
                <td className="mono">{d.mount}</td>
                <td className="muted">{d.type}</td>
                <td style={{ width: '45%' }}><Bar value={d.use_pct} warn={dw} crit={dc} /></td>
                <td className="num">{pct(d.use_pct, 1)}</td>
                <td className="num muted">{bytes(d.used)} / {bytes(d.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ----------------------------- History tab ---------------------------- */

export function HistoryTab({ server }) {
  const [range, setRange] = useState('hour');
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api
      .get(`/reports/server/${server.id}${qs({ range })}`)
      .then(setReport)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [server.id, range]);
  useEffect(load, [load]);

  const series = useMemo(
    () => (report?.series || []).map((r) => ({ ...r, rx: r.rx == null ? null : r.rx / MB, tx: r.tx == null ? null : r.tx / MB })),
    [report]
  );
  const s = report?.summary || {};
  const b = report?.range?.bucket_sec || 60;

  return (
    <>
      <div className="toolbar">
        <RangeTabs value={range} onChange={setRange} />
        <div className="toolbar-right">
          <button className="btn ghost" onClick={() => download(`/reports/server/${server.id}/csv${qs({ range })}`, 'report.csv')}>
            <IconDownload size={16} /> CSV
          </button>
          <button className="btn ghost" onClick={() => window.print()}>
            <IconPrint size={16} /> Print / PDF
          </button>
        </div>
      </div>
      {loading && !report ? (
        <Spinner />
      ) : (
        <>
          <div className="stats">
            <StatCard label="CPU avg / max" value={`${pct(s.cpu_avg, 1)}`} hint={`max ${pct(s.cpu_max, 1)}`} />
            <StatCard label="RAM avg / max" value={`${pct(s.mem_avg, 1)}`} hint={`max ${pct(s.mem_max, 1)}`} />
            <StatCard label="Disk max" value={pct(s.disk_max, 1)} hint={`avg ${pct(s.disk_avg, 1)}`} />
            <StatCard label="Temperature max" value={s.temp_max == null ? 'N/A' : `${num(s.temp_max)}°C`} hint={s.temp_avg == null ? '' : `avg ${num(s.temp_avg)}°C`} />
            <StatCard label="Network avg ↓ / ↑" value={`${mbps(s.rx_avg)} / ${mbps(s.tx_avg)}`} hint={`peak ↓ ${mbps(s.rx_max)} MB/s`} />
            <StatCard label="Availability" value={pct(s.availability_pct, 2)} kind={s.availability_pct < 99 ? 'warn' : 'ok'} hint={`offline ${duration(s.offline_sec)} · coverage ${pct(s.coverage_pct, 1)}`} />
          </div>
          <div className="card">
            <div className="card-head"><h3>CPU · RAM · Disk (%)</h3><span className="muted sm">{report?.range?.source === 'hourly' ? 'hourly rollup' : `${b}s buckets`}</span></div>
            <TimeChart data={series} bucketSec={b} yMax={100} height={280} series={[
              { key: 'cpu', name: 'CPU avg', color: '#22d3a6' },
              { key: 'cpu_max', name: 'CPU peak', color: '#ef4444' },
              { key: 'mem', name: 'RAM avg', color: '#8b5cf6' },
              { key: 'disk', name: 'Disk', color: '#38bdf8' },
            ]} />
          </div>
          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h3>Network (MB/s)</h3></div>
              <TimeChart data={series} bucketSec={b} unit="" fmt={(v) => Number(v).toFixed(2)} series={[
                { key: 'rx', name: 'Download avg', color: '#f59e0b' },
                { key: 'tx', name: 'Upload avg', color: '#ec4899' },
              ]} />
            </div>
            <div className="card">
              <div className="card-head"><h3>Temperature · Swap</h3></div>
              <TimeChart data={series} bucketSec={b} unit="" series={[
                { key: 'temp', name: 'Temp °C', color: '#f97316' },
                { key: 'swap', name: 'Swap %', color: '#a3e635' },
              ]} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------------------------- Incidents tab --------------------------- */

function IncidentsTab({ server }) {
  const [rows, setRows] = useState([]);
  const load = useCallback(
    () => api.get(`/alerts${qs({ server_id: server.id, limit: 100 })}`).then((r) => setRows(r.rows)).catch(() => {}),
    [server.id]
  );
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent('alert', load);

  if (!rows.length) return <div className="card"><Empty>No incidents recorded for this server</Empty></div>;
  return (
    <div className="card">
      <table className="table">
        <thead>
          <tr><th>Severity</th><th>Message</th><th>Status</th><th>Started</th><th>Duration</th><th>Peak</th></tr>
        </thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td><SeverityBadge severity={a.severity} /></td>
              <td><Link className="link" to={`/alerts?open=${a.id}`}>{a.message}</Link></td>
              <td><AlertStatusBadge status={a.status} /></td>
              <td className="muted nowrap">{dateTime(a.first_detected_at)}</td>
              <td className="nowrap">{duration(((a.resolved_at ? new Date(a.resolved_at) : new Date()) - new Date(a.first_detected_at)) / 1000)}</td>
              <td className="num">{num(a.peak_value, 2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ----------------------------- Logins tab ----------------------------- */

function LoginsTab({ server }) {
  const [kind, setKind] = useState('');
  const [data, setData] = useState({ rows: [], total: 0 });
  const load = useCallback(
    () => api.get(`/logins${qs({ server_id: server.id, kind, limit: 200 })}`).then(setData).catch(() => {}),
    [server.id, kind]
  );
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent('login', (e) => e.server_id === server.id && load());

  return (
    <>
      <LogStatusNote server={server} />
      <div className="card">
        <div className="card-head"><h3>Logged in right now</h3></div>
        <SessionList server={server} />
      </div>
      <div className="card no-pad">
        <div className="card-head pad">
          <h3>Login history <span className="muted sm">({data.total})</span></h3>
          <div className="seg">
            {[['', 'All'], ['logon', 'Logins'], ['failed', 'Failed'], ['connection', 'Connections']].map(([k, l]) => (
              <button key={k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>{l}</button>
            ))}
          </div>
        </div>
        <LoginTable rows={data.rows} />
      </div>
    </>
  );
}

/* ----------------------------- System tab ----------------------------- */

function SystemTab({ server }) {
  const rows = [
    ['Server code', server.server_code], ['Hostname', server.hostname], ['IP address', server.ip_address],
    ['MAC address', server.mac_address], ['Operating system', server.os_name], ['OS build', server.os_version],
    ['Architecture', server.arch], ['Manufacturer', server.manufacturer], ['Model', server.model],
    ['Serial', server.serial], ['CPU', server.cpu_model],
    ['Cores / threads', server.cpu_cores ? `${server.cpu_cores} / ${server.cpu_threads}` : null],
    ['Installed RAM', bytes(server.mem_total)], ['Boot time', dateTime(server.boot_time)],
    ['Agent version', server.agent_version], ['Inventory scanned', dateTime(server.inventory_at)],
    ['Registered', dateTime(server.created_at)], ['Group', server.group_name], ['Location', server.location],
    ['Environment', server.environment], ['Owner', server.owner],
  ];
  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-head"><h3>Hardware &amp; OS</h3></div>
        <dl className="kv">
          {rows.map(([k, v]) => (
            <div key={k}><dt>{k}</dt><dd>{v || <span className="muted">–</span>}</dd></div>
          ))}
        </dl>
      </div>
      <div className="card">
        <div className="card-head"><h3>Network interfaces</h3></div>
        {!server.nics?.length && <Empty>No interface data</Empty>}
        <table className="table">
          <tbody>
            {server.nics?.map((n) => (
              <tr key={n.name + n.mac}>
                <td>{n.name}</td><td className="mono">{n.ip4 || '–'}</td><td className="mono muted">{n.mac}</td>
                <td className="num muted">{n.speed ? `${n.speed} Mb/s` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {server.notes && (<><div className="card-head"><h3>Notes</h3></div><p className="muted">{server.notes}</p></>)}
      </div>
    </div>
  );
}

/* ------------------------------- Page ------------------------------- */

export default function ServerDetail() {
  const { id } = useParams();
  const sid = Number(id);
  const { servers } = useLive();
  const { can } = useAuth();
  const [rules, setRules] = useState([]);
  const [tab, setTab] = useState('live');
  const server = servers[sid];

  useEffect(() => {
    api.get('/rules').then(setRules).catch(() => {});
  }, []);

  if (!server) {
    return <div className="page"><Spinner /></div>;
  }
  const h = health(server);

  return (
    <div className="page">
      <div className="detail-head">
        <Link to="/servers" className="icon-btn" title="All servers"><IconBack /></Link>
        <div className="detail-title">
          <h1>
            <StatusDot status={h} pulse={h === 'critical'} /> {server.name}
            <span className="muted"> — {server.ip_address}</span>
          </h1>
          <div className="detail-meta">
            <Badge kind={h === 'online' ? 'ok-outline' : h === 'offline' ? 'crit-outline' : h}>{h}</Badge>
            <span>{server.server_code}</span>
            <span>{server.os_name || 'Unknown OS'}</span>
            <span>{server.group_name}{server.location ? ` · ${server.location}` : ''}</span>
            <span>last data {ago(server.last_seen_at)}</span>
          </div>
        </div>
        {can('admin', 'operator') && <Link className="btn ghost" to={`/servers?edit=${server.id}`}>Edit</Link>}
      </div>

      <div className="tabs">
        {[['live', 'Live'], ['history', 'History & report'], ['incidents', `Incidents${server.critical_count + server.warning_count ? ` (${server.critical_count + server.warning_count})` : ''}`], ['logins', `Logins${server.sessions?.length ? ` (${server.sessions.length} online)` : ''}`], ['system', 'System info']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>

      {tab === 'live' && <LiveTab server={server} rules={rules} />}
      {tab === 'history' && <HistoryTab server={server} />}
      {tab === 'incidents' && <IncidentsTab server={server} />}
      {tab === 'logins' && <LoginsTab server={server} />}
      {tab === 'system' && <SystemTab server={server} />}
    </div>
  );
}
