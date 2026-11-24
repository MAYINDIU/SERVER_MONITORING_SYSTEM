import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useLive, useSocketEvent } from '../context/LiveContext';
import Gauge from '../components/Gauge';
import TimeChart from '../components/TimeChart';
import { Badge, Bar, Empty, SeverityBadge, StatCard, StatusDot } from '../components/ui';
import { IconAlert, IconServer, IconWifiOff, IconCheck } from '../components/Icons';
import { ago, duration, health, mbps, pct } from '../lib/format';

function ServerTile({ s }) {
  const nav = useNavigate();
  const h = health(s);
  const live = s.status === 'online' ? s.live : null;
  return (
    <div className={`tile h-${h}`} onClick={() => nav(`/servers/${s.id}`)}>
      <div className="tile-head">
        <StatusDot status={h} pulse={h === 'critical'} />
        <div className="tile-title">
          <div className="tile-name">{s.name}</div>
          <div className="tile-ip">{s.ip_address} · {s.group_name}</div>
        </div>
        {h === 'offline' ? <Badge kind="crit-outline">offline</Badge> : s.critical_count > 0 ? <Badge kind="critical">{s.critical_count} critical</Badge> : s.warning_count > 0 ? <Badge kind="warning">{s.warning_count} warning</Badge> : null}
      </div>
      <div className="tile-gauges">
        <Gauge value={live?.cpu_pct} label="CPU" size={112} warn={80} crit={95} />
        <Gauge value={live?.mem_pct} label="RAM" size={112} warn={85} crit={95} />
        <Gauge value={live?.disk_pct} label="Disk" size={112} warn={85} crit={95} />
      </div>
      <div className="tile-foot">
        <span title="Network download / upload">↓ {mbps(live?.net_rx_bps)} · ↑ {mbps(live?.net_tx_bps)} MB/s</span>
        <span>{s.status === 'online' ? `up ${duration(live?.uptime_sec)}` : `seen ${ago(s.last_seen_at)}`}</span>
      </div>
    </div>
  );
}

function TopList({ title, rows, fmt = (v) => pct(v, 1), bar = true }) {
  return (
    <div className="card">
      <div className="card-head">
        <h3>{title}</h3>
      </div>
      {!rows.length && <Empty>No live data</Empty>}
      <div className="top-list">
        {rows.map((r, i) => (
          <Link key={r.id} to={`/servers/${r.id}`} className="top-row">
            <span className="top-rank">{i + 1}</span>
            <div className="top-main">
              <div className="top-name">
                {r.name} <span className="muted">{r.ip_address}</span>
              </div>
              {bar && <Bar value={r.value} />}
            </div>
            <b className="top-val">{fmt(r.value)}</b>
          </Link>
        ))}
      </div>
    </div>
  );
}

export default function Overview() {
  const { serverList, alertSummary } = useLive();
  const [data, setData] = useState(null);
  const [group, setGroup] = useState('');

  const load = () => api.get('/dashboard/overview').then(setData).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, []);
  useSocketEvent('alert', () => load());

  const counts = useMemo(() => {
    const c = { total: serverList.length, online: 0, offline: 0, critical: 0, warning: 0 };
    serverList.forEach((s) => {
      const h = health(s);
      if (s.status === 'online') c.online++;
      if (h === 'offline') c.offline++;
      if (h === 'critical') c.critical++;
      if (h === 'warning') c.warning++;
    });
    return c;
  }, [serverList]);

  const top = (key) =>
    serverList
      .filter((s) => s.status === 'online' && s.live?.[key] != null)
      .sort((a, b) => b.live[key] - a.live[key])
      .slice(0, 5)
      .map((s) => ({ id: s.id, name: s.name, ip_address: s.ip_address, value: s.live[key] }));

  const groups = [...new Set(serverList.map((s) => s.group_name))];
  const tiles = serverList.filter((s) => !group || s.group_name === group);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Overview</h1>
          <p className="muted">All servers at a glance · samples every 10 seconds</p>
        </div>
      </div>

      <div className="section-head">
        <h2>Servers</h2>
        <div className="seg">
          <button className={!group ? 'active' : ''} onClick={() => setGroup('')}>All</button>
          {groups.map((g) => (
            <button key={g} className={group === g ? 'active' : ''} onClick={() => setGroup(g)}>
              {g}
            </button>
          ))}
        </div>
      </div>
      {!tiles.length && (
        <div className="card">
          <Empty>
            No servers registered yet. Install the agent on a PC (see README) or run <code>npm run simulate</code> in
            <code>/agent</code> for demo data.
          </Empty>
        </div>
      )}
      <div className="tiles">
        {tiles.map((s) => (
          <ServerTile key={s.id} s={s} />
        ))}
      </div>

      <div className="stats">
        <StatCard label="Total servers" value={counts.total} icon={<IconServer />} hint={`${groups.length} group(s)`} />
        <StatCard label="Online" value={counts.online} kind="ok" icon={<IconCheck />} hint={counts.total ? `${Math.round((counts.online / counts.total) * 100)}% reachable` : ''} />
        <StatCard label="Offline" value={counts.offline} kind={counts.offline ? 'crit' : 'default'} icon={<IconWifiOff />} hint="no data received" />
        <StatCard label="Critical servers" value={counts.critical} kind={counts.critical ? 'crit' : 'default'} icon={<IconAlert />} />
        <StatCard label="Warning servers" value={counts.warning} kind={counts.warning ? 'warn' : 'default'} icon={<IconAlert />} />
        <StatCard label="Active incidents" value={alertSummary.active || 0} kind={alertSummary.active ? 'accent' : 'default'} hint={`${alertSummary.unacknowledged || 0} unacknowledged · ${alertSummary.last_24h || 0} in 24h`} />
      </div>

      <div className="grid-2-1">
        <div className="card">
          <div className="card-head">
            <h3>Fleet load · last hour</h3>
            <span className="muted sm">average across all servers</span>
          </div>
          <TimeChart
            data={data?.fleetSeries || []}
            bucketSec={60}
            yMax={100}
            series={[
              { key: 'cpu', name: 'CPU avg', color: '#22d3a6' },
              { key: 'mem', name: 'RAM avg', color: '#8b5cf6' },
              { key: 'disk', name: 'Disk avg', color: '#38bdf8' },
            ]}
          />
        </div>
        <div className="card">
          <div className="card-head">
            <h3>Recent incidents</h3>
            <Link to="/alerts" className="link sm">View all</Link>
          </div>
          {!data?.recentAlerts?.length && <Empty>No incidents – all quiet ✓</Empty>}
          <div className="recent-list">
            {data?.recentAlerts?.map((a) => (
              <Link key={a.id} to={`/alerts?open=${a.id}`} className={`recent-row ${a.status === 'resolved' ? 'dim' : ''}`}>
                <SeverityBadge severity={a.severity} />
                <div className="recent-text">
                  <div className="recent-msg">{a.message}</div>
                  <div className="muted sm">
                    {ago(a.first_detected_at)} · {a.status}
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      </div>

      <div className="grid-3">
        <TopList title="Top CPU" rows={top('cpu_pct')} />
        <TopList title="Top RAM" rows={top('mem_pct')} />
        <TopList title="Top network ↓ (MB/s)" rows={top('net_rx_bps')} fmt={(v) => mbps(v)} bar={false} />
      </div>
    </div>
  );
}
