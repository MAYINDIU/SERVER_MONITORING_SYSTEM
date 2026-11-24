import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar as RBar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, download, qs } from '../lib/api';
import { useLive } from '../context/LiveContext';
import TimeChart from '../components/TimeChart';
import { Bar, Empty, RangeTabs, Spinner, StatCard, StatusDot } from '../components/ui';
import { IconDownload, IconPrint } from '../components/Icons';
import { HistoryTab } from './ServerDetail';
import { duration, health, mbps, METRIC_LABEL, num, pct } from '../lib/format';

const MB = 1024 * 1024;

function useRange() {
  const [range, setRange] = useState('today');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const params = range === 'custom' && from && to ? { from: new Date(from).toISOString(), to: new Date(to).toISOString() } : { range: range === 'custom' ? 'today' : range };
  return { range, setRange, from, setFrom, to, setTo, params };
}

function RangeBar({ r, children }) {
  return (
    <div className="toolbar">
      <RangeTabs
        value={r.range}
        onChange={r.setRange}
        ranges={[
          { key: 'hour', label: 'Last hour' }, { key: 'today', label: 'Today' }, { key: '24h', label: '24 h' },
          { key: '7d', label: '7 days' }, { key: '30d', label: '30 days' }, { key: '12m', label: '12 months' },
          { key: 'custom', label: 'Custom' },
        ]}
      />
      {r.range === 'custom' && (
        <>
          <input type="datetime-local" className="input" style={{ width: 210 }} value={r.from} onChange={(e) => r.setFrom(e.target.value)} />
          <span className="muted">→</span>
          <input type="datetime-local" className="input" style={{ width: 210 }} value={r.to} onChange={(e) => r.setTo(e.target.value)} />
        </>
      )}
      <div className="toolbar-right">{children}</div>
    </div>
  );
}

/* ------------------------- All servers report ------------------------- */

const COLS = [
  ['name', 'Server'], ['cpu_avg', 'CPU avg'], ['cpu_max', 'CPU max'], ['mem_avg', 'RAM avg'], ['mem_max', 'RAM max'],
  ['disk_max', 'Disk max'], ['temp_max', 'Temp max'], ['rx_avg', 'Net ↓ avg'], ['tx_avg', 'Net ↑ avg'],
  ['availability_pct', 'Availability'], ['coverage_pct', 'Data'],
];

function FleetReport() {
  const r = useRange();
  const { servers: live } = useLive();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sort, setSort] = useState(['cpu_avg', -1]);
  const key = JSON.stringify(r.params);

  useEffect(() => {
    setLoading(true);
    api.get(`/reports/fleet${qs(r.params)}`).then(setData).catch(() => {}).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const rows = useMemo(() => {
    const list = [...(data?.servers || [])];
    const [k, dir] = sort;
    list.sort((a, b) => {
      const x = a[k] ?? -1;
      const y = b[k] ?? -1;
      return typeof x === 'string' ? x.localeCompare(y) * dir : (x - y) * dir;
    });
    return list;
  }, [data, sort]);

  const compare = useMemo(
    () => (data?.servers || []).filter((s) => s.samples).map((s) => ({ name: s.name, cpu: s.cpu_avg, ram: s.mem_avg, disk: s.disk_max })),
    [data]
  );
  const series = useMemo(() => (data?.series || []).map((x) => ({ ...x, rx: x.rx / MB, tx: x.tx / MB })), [data]);
  const t = data?.totals || {};
  const b = data?.range?.bucket_sec || 60;

  return (
    <>
      <RangeBar r={r}>
        <button className="btn ghost" onClick={() => download(`/reports/fleet/csv${qs(r.params)}`, 'all_servers.csv')}><IconDownload size={16} /> CSV</button>
        <button className="btn ghost" onClick={() => window.print()}><IconPrint size={16} /> Print / PDF</button>
      </RangeBar>
      {loading && !data ? <Spinner /> : (
        <>
          <div className="stats">
            <StatCard label="Servers reporting" value={`${t.reporting || 0} / ${t.servers || 0}`} />
            <StatCard label="Fleet CPU avg" value={pct(t.cpu_avg, 1)} hint={`highest peak ${pct(t.cpu_max, 1)}`} />
            <StatCard label="Fleet RAM avg" value={pct(t.mem_avg, 1)} hint={`highest peak ${pct(t.mem_max, 1)}`} />
            <StatCard label="Fleet disk avg" value={pct(t.disk_avg, 1)} />
            <StatCard label="Avg availability" value={pct(t.availability_avg, 2)} kind={t.availability_avg < 99 ? 'warn' : 'ok'} />
            <StatCard label="Incidents" value={data?.alerts?.totals?.total || 0} hint={`MTTR ${duration(data?.alerts?.totals?.mttr_sec)}`} />
          </div>

          <div className="grid-2">
            <div className="card">
              <div className="card-head"><h3>Load per server (avg CPU / RAM, max disk)</h3></div>
              {!compare.length ? <Empty>No data</Empty> : (
                <ResponsiveContainer width="100%" height={Math.max(220, compare.length * 34)}>
                  <BarChart data={compare} layout="vertical" margin={{ left: 10, right: 16 }}>
                    <CartesianGrid stroke="var(--grid)" horizontal={false} />
                    <XAxis type="number" domain={[0, 100]} stroke="var(--muted)" fontSize={11} tickFormatter={(v) => `${v}%`} />
                    <YAxis type="category" dataKey="name" stroke="var(--muted)" fontSize={11} width={130} />
                    <Tooltip contentStyle={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 10 }} formatter={(v) => `${Number(v).toFixed(1)}%`} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                    <RBar dataKey="cpu" name="CPU avg" fill="#22d3a6" radius={[0, 4, 4, 0]} barSize={8} />
                    <RBar dataKey="ram" name="RAM avg" fill="#8b5cf6" radius={[0, 4, 4, 0]} barSize={8} />
                    <RBar dataKey="disk" name="Disk max" fill="#38bdf8" radius={[0, 4, 4, 0]} barSize={8} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
            <div className="card">
              <div className="card-head"><h3>Fleet trend</h3></div>
              <TimeChart data={series} bucketSec={b} yMax={100} series={[
                { key: 'cpu', name: 'CPU avg', color: '#22d3a6' },
                { key: 'cpu_max', name: 'CPU peak', color: '#ef4444' },
                { key: 'mem', name: 'RAM avg', color: '#8b5cf6' },
              ]} />
              <div className="card-head"><h3>Total network (MB/s)</h3></div>
              <TimeChart data={series} bucketSec={b} height={170} unit="" fmt={(v) => Number(v).toFixed(2)} series={[
                { key: 'rx', name: 'Download', color: '#f59e0b' },
                { key: 'tx', name: 'Upload', color: '#ec4899' },
              ]} />
            </div>
          </div>

          <div className="card no-pad">
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    {COLS.map(([k, l]) => (
                      <th key={k} className="sortable" onClick={() => setSort([k, sort[0] === k ? -sort[1] : -1])}>
                        {l} {sort[0] === k ? (sort[1] < 0 ? '▾' : '▴') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => (
                    <tr key={s.server_id}>
                      <td>
                        <div className="cell-server">
                          <StatusDot status={health(live[s.server_id] || s)} />
                          <div><Link className="link strong" to={`/servers/${s.server_id}`}>{s.name}</Link><div className="muted sm mono">{s.ip_address}</div></div>
                        </div>
                      </td>
                      <td><div className="bar-cell"><Bar value={s.cpu_avg} /><span>{pct(s.cpu_avg, 1)}</span></div></td>
                      <td className="num">{pct(s.cpu_max, 1)}</td>
                      <td><div className="bar-cell"><Bar value={s.mem_avg} /><span>{pct(s.mem_avg, 1)}</span></div></td>
                      <td className="num">{pct(s.mem_max, 1)}</td>
                      <td className="num">{pct(s.disk_max, 1)}</td>
                      <td className="num">{s.temp_max == null ? '–' : `${num(s.temp_max)}°C`}</td>
                      <td className="num">{mbps(s.rx_avg)}</td>
                      <td className="num">{mbps(s.tx_avg)}</td>
                      <td className={`num ${s.availability_pct < 99 ? 'txt-warn' : 'txt-ok'}`}>{pct(s.availability_pct, 2)}</td>
                      <td className="num muted">{pct(s.coverage_pct, 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* --------------------------- Server-wise ---------------------------- */

function ServerReport() {
  const { serverList, servers } = useLive();
  const [sid, setSid] = useState('');
  const id = Number(sid) || serverList[0]?.id;
  const server = servers[id];
  return (
    <>
      <div className="toolbar">
        <select className="input" style={{ width: 320 }} value={id || ''} onChange={(e) => setSid(e.target.value)}>
          {serverList.map((s) => <option key={s.id} value={s.id}>{s.name} — {s.ip_address}</option>)}
        </select>
        {server && <span className="muted">{server.os_name} · {server.group_name}</span>}
      </div>
      {server ? <HistoryTab key={server.id} server={server} /> : <div className="card"><Empty>No servers yet</Empty></div>}
    </>
  );
}

/* ---------------------------- Incidents ----------------------------- */

function IncidentReport() {
  const r = useRange();
  const [data, setData] = useState(null);
  const key = JSON.stringify(r.params);
  useEffect(() => {
    api.get(`/reports/alerts${qs(r.params)}`).then(setData).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const t = data?.totals || {};
  const sev = Object.fromEntries((data?.bySeverity || []).map((x) => [x.severity, x.total]));

  return (
    <>
      <RangeBar r={r}><button className="btn ghost" onClick={() => window.print()}><IconPrint size={16} /> Print / PDF</button></RangeBar>
      <div className="stats">
        <StatCard label="Total incidents" value={t.total || 0} />
        <StatCard label="Still active" value={t.active || 0} kind={t.active ? 'accent' : 'default'} />
        <StatCard label="Critical" value={sev.critical || 0} kind={sev.critical ? 'crit' : 'default'} />
        <StatCard label="Warning" value={sev.warning || 0} kind={sev.warning ? 'warn' : 'default'} />
        <StatCard label="Mean time to acknowledge" value={duration(t.mtta_sec)} />
        <StatCard label="Mean time to resolve" value={duration(t.mttr_sec)} />
      </div>
      <div className="grid-2-1">
        <div className="card no-pad">
          <div className="card-head pad"><h3>Incidents by server</h3></div>
          {!data?.byServer?.length ? <Empty>No incidents in this period ✓</Empty> : (
            <table className="table">
              <thead><tr><th>Server</th><th className="num">Total</th><th className="num">Critical</th><th className="num">Warning</th><th className="num">Time in alert</th></tr></thead>
              <tbody>
                {data.byServer.map((s) => (
                  <tr key={s.server_id}>
                    <td><Link className="link strong" to={`/servers/${s.server_id}`}>{s.name}</Link> <span className="muted mono sm">{s.ip_address}</span></td>
                    <td className="num">{s.total}</td><td className="num txt-crit">{s.critical}</td><td className="num txt-warn">{s.warning}</td>
                    <td className="num">{duration(s.alert_seconds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
        <div className="card">
          <div className="card-head"><h3>By metric</h3></div>
          {!data?.byMetric?.length && <Empty>–</Empty>}
          <div className="top-list">
            {data?.byMetric?.map((m) => (
              <div key={m.metric} className="top-row">
                <div className="top-main"><div className="top-name">{METRIC_LABEL[m.metric] || m.metric}</div><Bar value={(m.total / (t.total || 1)) * 100} warn={101} crit={101} /></div>
                <b className="top-val">{m.total}</b>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}

export default function Reports() {
  const [tab, setTab] = useState('fleet');
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Reports</h1>
          <p className="muted">Which PC carries how much load – per server and all servers together.</p>
        </div>
        <div className="print-only print-stamp">Generated {new Date().toLocaleString()}</div>
      </div>
      <div className="tabs">
        {[['fleet', 'All servers'], ['server', 'Server-wise'], ['incidents', 'Incidents']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'fleet' && <FleetReport />}
      {tab === 'server' && <ServerReport />}
      {tab === 'incidents' && <IncidentReport />}
    </div>
  );
}
