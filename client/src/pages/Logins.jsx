import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { useLive, useSocketEvent } from '../context/LiveContext';
import { Badge, StatCard } from '../components/ui';
import LoginTable from '../components/LoginTable';
import { ago, LOGIN_METHOD } from '../lib/format';

export default function Logins() {
  const { serverList } = useLive();
  const [kind, setKind] = useState('');
  const [method, setMethod] = useState('');
  const [serverId, setServerId] = useState('');
  const [ip, setIp] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState({ rows: [], total: 0, limit: 50 });
  const [sum, setSum] = useState(null);

  const load = useCallback(() => {
    api.get(`/logins${qs({ kind, method, server_id: serverId, ip, q, page, limit: 50 })}`).then(setData).catch(() => {});
  }, [kind, method, serverId, ip, q, page]);
  const loadSummary = useCallback(() => api.get('/logins/summary').then(setSum).catch(() => {}), []);
  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useSocketEvent('login', () => {
    load();
    loadSummary();
  });

  const reset = (fn) => (e) => {
    fn(e.target.value);
    setPage(1);
  };
  const pages = Math.max(1, Math.ceil(data.total / data.limit));
  const loggedIn = serverList.filter((s) => s.sessions?.length);
  const blind = serverList.filter((s) => s.login_log_status && s.login_log_status !== 'ok');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Access log</h1>
          <p className="muted">Who logged in to which PC or server, how (Remote Desktop, SSH, keyboard, AnyDesk, TeamViewer) and from which IP. Failed passwords are listed too.</p>
        </div>
      </div>

      <div className="stats">
        <StatCard label="Logins (24 h)" value={sum?.logons || 0} />
        <StatCard label="Remote access (24 h)" value={sum?.remote || 0} kind={sum?.remote ? 'accent' : 'default'} />
        <StatCard label="Failed logins (24 h)" value={sum?.failed || 0} kind={sum?.failed ? 'crit' : 'default'} />
        <StatCard label="Different source IPs (24 h)" value={sum?.unique_ips || 0} />
        <StatCard label="Logged in right now" value={loggedIn.reduce((a, s) => a + s.sessions.length, 0)} hint={`${loggedIn.length} machine(s)`} />
      </div>

      {blind.length > 0 && (
        <div className="alert-box">
          {blind.length} agent(s) cannot read the login log, so user names and failed passwords are missing there:{' '}
          {blind.map((s, i) => (
            <span key={s.id}>{i > 0 && ', '}<Link className="link" to={`/servers/${s.id}`}>{s.name}</Link></span>
          ))}
          . Re-run the agent installer <b>as Administrator</b> on those PCs.
        </div>
      )}

      <div className="grid-2">
        <div className="card">
          <div className="card-head"><h3>Logged in right now</h3></div>
          {!loggedIn.length && <p className="muted sm">Nobody is logged in on any monitored machine.</p>}
          <table className="table">
            <tbody>
              {loggedIn.flatMap((s) =>
                s.sessions.map((x, i) => (
                  <tr key={`${s.id}-${i}`}>
                    <td className="nowrap"><Link className="link strong" to={`/servers/${s.id}`}>{s.name}</Link></td>
                    <td className="strong">{x.user}</td>
                    <td>{/rdp/i.test(x.tty || '') ? <Badge kind="accent">Remote Desktop</Badge> : <span className="muted">{x.tty || '–'}</span>}</td>
                    <td className="mono">{x.ip || ''}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="card">
          <div className="card-head"><h3>Top source IPs (7 days)</h3></div>
          {!sum?.top_ips?.length && <p className="muted sm">No remote source IPs recorded yet.</p>}
          <table className="table">
            <tbody>
              {sum?.top_ips?.map((r) => (
                <tr key={r.source_ip}>
                  <td><button className="link mono btn-link" onClick={() => { setIp(r.source_ip); setPage(1); }}>{r.source_ip}</button>{r.host && <div className="muted sm">{r.host}</div>}</td>
                  <td className="num">{r.total} <span className="muted sm">events</span></td>
                  <td className="num">{r.failed > 0 ? <span className="txt-crit">{r.failed} failed</span> : <span className="muted">0 failed</span>}</td>
                  <td className="num muted sm">{r.servers} server(s)</td>
                  <td className="muted sm nowrap">{ago(r.last_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="toolbar">
        <div className="seg">
          {[['', 'All'], ['logon', 'Logins'], ['failed', 'Failed'], ['connection', 'Connections']].map(([k, l]) => (
            <button key={k} className={kind === k ? 'active' : ''} onClick={() => { setKind(k); setPage(1); }}>{l}</button>
          ))}
        </div>
        <select className="input" style={{ width: 180 }} value={method} onChange={reset(setMethod)}>
          <option value="">Any method</option>
          <option value="remote">All remote access</option>
          {Object.entries(LOGIN_METHOD).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
        <select className="input" style={{ width: 220 }} value={serverId} onChange={reset(setServerId)}>
          <option value="">All servers</option>
          {serverList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.ip_address})</option>)}
        </select>
        <input className="input" style={{ width: 200 }} placeholder="User, IP, PC name…" value={q} onChange={reset(setQ)} />
        {ip && <button className="btn ghost sm" onClick={() => { setIp(''); setPage(1); }}>IP {ip} ✕</button>}
      </div>

      <div className="card no-pad">
        <LoginTable rows={data.rows} showServer onIp={(v) => { setIp(v); setPage(1); }} />
      </div>
      {pages > 1 && (
        <div className="pager">
          <button className="btn ghost sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
          <span className="muted">Page {page} / {pages} · {data.total} events</span>
          <button className="btn ghost sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
