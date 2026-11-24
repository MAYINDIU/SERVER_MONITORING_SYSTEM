import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useLive, useSocketEvent } from '../context/LiveContext';
import { useAuth } from '../context/AuthContext';
import { AlertStatusBadge, Empty, Modal, SeverityBadge, StatCard } from '../components/ui';
import { ago, dateTime, duration, METRIC_LABEL, num } from '../lib/format';

function AlertDetail({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const [a, setA] = useState(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');

  const load = useCallback(() => api.get(`/alerts/${id}`).then(setA).catch((e) => setErr(e.message)), [id]);
  useEffect(() => {
    load();
  }, [load]);

  const act = async (action) => {
    try {
      setErr('');
      if (action === 'note') {
        if (!note.trim()) return;
        await api.post(`/alerts/${id}/notes`, { note });
      } else {
        await api.post(`/alerts/${id}/${action}`, { note: note || undefined });
      }
      setNote('');
      await load();
      onChanged();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Modal title={a ? `Incident #${a.id}` : 'Incident'} onClose={onClose} wide>
      {err && <div className="alert-box">{err}</div>}
      {a && (
        <>
          <div className="incident-head">
            <SeverityBadge severity={a.severity} /> <AlertStatusBadge status={a.status} />
            <h3>{a.message}</h3>
          </div>
          <dl className="kv cols-3">
            <div><dt>Server</dt><dd><Link className="link" to={`/servers/${a.server_id}`} onClick={onClose}>{a.server_name}</Link> <span className="muted">{a.ip_address}</span></dd></div>
            <div><dt>Metric</dt><dd>{METRIC_LABEL[a.metric] || a.metric}</dd></div>
            <div><dt>Threshold</dt><dd>{num(a.threshold_value, 2)}</dd></div>
            <div><dt>Current / peak</dt><dd>{num(a.current_value, 2)} / {num(a.peak_value, 2)}</dd></div>
            <div><dt>First detected</dt><dd>{dateTime(a.first_detected_at)}</dd></div>
            <div><dt>Last detected</dt><dd>{dateTime(a.last_detected_at)}</dd></div>
            <div><dt>Acknowledged</dt><dd>{a.acknowledged_at ? `${a.acknowledged_by_name} · ${dateTime(a.acknowledged_at)}` : '–'}</dd></div>
            <div><dt>Resolved</dt><dd>{a.resolved_at ? `${a.resolved_by_name || 'auto'} · ${dateTime(a.resolved_at)}` : '–'}</dd></div>
            <div><dt>Duration</dt><dd>{duration(((a.resolved_at ? new Date(a.resolved_at) : new Date()) - new Date(a.first_detected_at)) / 1000)}</dd></div>
          </dl>

          <h4 className="sub-title">Timeline</h4>
          <ol className="timeline">
            {a.events.map((e) => (
              <li key={e.id} className={`ev-${e.event_type}`}>
                <div className="tl-dot" />
                <div>
                  <div className="tl-head"><b>{e.event_type}</b> <span className="muted sm">{dateTime(e.created_at)}{e.user_name ? ` · ${e.user_name}` : ''}</span></div>
                  {e.message && <div className="tl-msg">{e.message}</div>}
                </div>
              </li>
            ))}
          </ol>

          {can('admin', 'operator') && (
            <div className="incident-actions">
              <textarea className="input" rows={2} placeholder="Add a note / root cause / action taken…" value={note} onChange={(e) => setNote(e.target.value)} />
              <div className="row-gap">
                <button className="btn ghost" onClick={() => act('note')}>Add note</button>
                <span className="spacer" />
                {a.status === 'open' && <button className="btn warn" onClick={() => act('ack')}>Acknowledge</button>}
                {a.status !== 'resolved' && <button className="btn primary" onClick={() => act('resolve')}>Resolve</button>}
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
}

export default function Alerts() {
  const { serverList, alertSummary, loadSummary } = useLive();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const [status, setStatus] = useState('active');
  const [severity, setSeverity] = useState('');
  const [serverId, setServerId] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, limit: 50 });
  const openId = params.get('open');

  const load = useCallback(() => {
    api
      .get(`/alerts${qs({ status, severity, server_id: serverId, q, page, limit: 50 })}`)
      .then(setData)
      .catch(() => {});
  }, [status, severity, serverId, q, page]);
  useEffect(() => {
    load();
  }, [load]);
  useSocketEvent('alert', load);

  const quick = async (e, id, action) => {
    e.stopPropagation();
    await api.post(`/alerts/${id}/${action}`).catch(() => {});
    load();
    loadSummary();
  };

  const pages = Math.max(1, Math.ceil(data.total / data.limit));

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Incidents</h1>
          <p className="muted">Alerts are deduplicated per rule + server, auto-resolve on recovery and keep a full timeline.</p>
        </div>
      </div>
      <div className="stats">
        <StatCard label="Active" value={alertSummary.active || 0} kind={alertSummary.active ? 'accent' : 'default'} />
        <StatCard label="Unacknowledged" value={alertSummary.unacknowledged || 0} kind={alertSummary.unacknowledged ? 'warn' : 'default'} />
        <StatCard label="Critical" value={alertSummary.critical || 0} kind={alertSummary.critical ? 'crit' : 'default'} />
        <StatCard label="Warning" value={alertSummary.warning || 0} kind={alertSummary.warning ? 'warn' : 'default'} />
        <StatCard label="Anomalies (info)" value={alertSummary.info || 0} />
        <StatCard label="Last 24 hours" value={alertSummary.last_24h || 0} />
      </div>

      <div className="toolbar">
        <div className="seg">
          {[['active', 'Active'], ['open', 'Unacknowledged'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved'], ['', 'All']].map(([k, l]) => (
            <button key={k} className={status === k ? 'active' : ''} onClick={() => { setStatus(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        <select className="input" style={{ width: 150 }} value={severity} onChange={(e) => { setSeverity(e.target.value); setPage(1); }}>
          <option value="">All severities</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info / anomaly</option>
        </select>
        <select className="input" style={{ width: 220 }} value={serverId} onChange={(e) => { setServerId(e.target.value); setPage(1); }}>
          <option value="">All servers</option>
          {serverList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.ip_address})</option>)}
        </select>
        <input className="input" style={{ width: 220 }} placeholder="Search…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
      </div>

      <div className="card no-pad">
        {!data.rows.length ? (
          <Empty>No incidents for this filter ✓</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table hover">
              <thead>
                <tr><th>Severity</th><th>Server</th><th>Message</th><th>Status</th><th>Started</th><th>Duration</th>{can('admin', 'operator') && <th />}</tr>
              </thead>
              <tbody>
                {data.rows.map((a) => (
                  <tr key={a.id} onClick={() => setParams({ open: a.id })} className={a.status === 'resolved' ? 'dim' : ''}>
                    <td><SeverityBadge severity={a.severity} /></td>
                    <td className="nowrap"><div className="strong">{a.server_name}</div><div className="muted sm mono">{a.ip_address}</div></td>
                    <td>{a.message}</td>
                    <td><AlertStatusBadge status={a.status} /></td>
                    <td className="nowrap muted" title={dateTime(a.first_detected_at)}>{ago(a.first_detected_at)}</td>
                    <td className="nowrap">{duration(((a.resolved_at ? new Date(a.resolved_at) : new Date()) - new Date(a.first_detected_at)) / 1000)}</td>
                    {can('admin', 'operator') && (
                      <td className="nowrap" onClick={(e) => e.stopPropagation()}>
                        {a.status === 'open' && <button className="btn ghost sm" onClick={(e) => quick(e, a.id, 'ack')}>Ack</button>}{' '}
                        {a.status !== 'resolved' && <button className="btn ghost sm" onClick={(e) => quick(e, a.id, 'resolve')}>Resolve</button>}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="muted">Page {page} / {pages} · {data.total} incidents</span>
          <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
      {openId && <AlertDetail id={openId} onClose={() => setParams({})} onChanged={() => { load(); loadSummary(); }} />}
    </div>
  );
}
