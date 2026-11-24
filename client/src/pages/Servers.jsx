import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useLive } from '../context/LiveContext';
import { useAuth } from '../context/AuthContext';
import { Badge, Bar, Empty, Field, Modal, StatusDot } from '../components/ui';
import { ago, duration, health, mbps, pct } from '../lib/format';

function EditServer({ server, onClose }) {
  const { can } = useAuth();
  const { loadServers, pushToast } = useLive();
  const [f, setF] = useState({
    name: server.name, group_name: server.group_name, location: server.location || '',
    environment: server.environment, owner: server.owner || '', notes: server.notes || '', is_enabled: !!server.is_enabled,
  });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const save = async () => {
    try {
      await api.put(`/servers/${server.id}`, f);
      await loadServers();
      pushToast({ kind: 'ok', title: 'Saved', message: `${f.name} updated`, ttl: 3000 });
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };
  const remove = async () => {
    if (!window.confirm(`Delete ${server.name} (${server.ip_address}) and ALL its history? This cannot be undone.`)) return;
    try {
      await api.del(`/servers/${server.id}`);
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Modal
      title={`Edit · ${server.ip_address}`}
      onClose={onClose}
      footer={
        <>
          {can('admin') && <button className="btn danger ghost" onClick={remove}>Delete server</button>}
          <span className="spacer" />
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save</button>
        </>
      }
    >
      {err && <div className="alert-box">{err}</div>}
      <div className="form-grid">
        <Field label="Display name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Group"><input className="input" value={f.group_name} onChange={set('group_name')} placeholder="e.g. Factory, Head office" /></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={set('location')} placeholder="Server room / rack" /></Field>
        <Field label="Environment">
          <select className="input" value={f.environment} onChange={set('environment')}>
            {['production', 'staging', 'development', 'office'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Owner / responsible"><input className="input" value={f.owner} onChange={set('owner')} /></Field>
        <Field label="Monitoring">
          <label className="check"><input type="checkbox" checked={f.is_enabled} onChange={set('is_enabled')} /> Enabled (uncheck to pause alerts & storage)</label>
        </Field>
      </div>
      <Field label="Notes"><textarea className="input" rows={3} value={f.notes} onChange={set('notes')} /></Field>
    </Modal>
  );
}

function AddServer({ onClose }) {
  const { loadServers, pushToast } = useLive();
  const [f, setF] = useState({ ip_address: '', name: '', group_name: 'Default', location: '', environment: 'production', owner: '' });
  const [err, setErr] = useState('');
  const [ping, setPing] = useState(null);
  const [added, setAdded] = useState(null);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const serverUrl = `${window.location.protocol}//${window.location.hostname}:5000`;

  const testPing = async () => {
    setPing({ busy: true });
    try {
      setPing(await api.post('/servers/ping', { ip: f.ip_address.trim() }));
    } catch (e) {
      setPing({ error: e.message });
    }
  };
  const save = async () => {
    try {
      setErr('');
      const s = await api.post('/servers', f);
      await loadServers();
      pushToast({ kind: 'ok', title: 'Server added', message: `${s.name} (${s.ip_address}) – waiting for agent`, ttl: 4000 });
      setAdded(s);
    } catch (e) {
      setErr(e.message);
    }
  };

  if (added) {
    return (
      <Modal title={`Added · ${added.ip_address}`} onClose={onClose}
        footer={<><span className="spacer" /><button className="btn primary" onClick={onClose}>Done</button></>}>
        <p><b>{added.name}</b> is now in the list with status <Badge>waiting for agent</Badge>.</p>
        <p className="muted">To start receiving data, install the agent on <b>{added.ip_address}</b>:</p>
        <ol className="steps">
          <li>Install Node.js on that PC (nodejs.org, LTS).</li>
          <li>Copy <code>ServerMonitorAgent.zip</code> to it and extract to <code>C:\ServerMonitorAgent</code>.</li>
          <li>Right-click <code>install-agent.bat</code> → <b>Run as administrator</b> → press Enter twice.</li>
        </ol>
        <pre className="code">{`SERVER_URL=${serverUrl}\nENROLL_KEY=SCL-ENROLL-2026`}</pre>
        <p className="muted sm">It turns green within 10 seconds of the agent starting. Make sure TCP port 5000 is open in this server's firewall.</p>
      </Modal>
    );
  }

  return (
    <Modal title="Add server / PC" onClose={onClose}
      footer={<><span className="spacer" /><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Add server</button></>}>
      {err && <div className="alert-box">{err}</div>}
      <Field label="IP address" hint="The LAN IP of the PC, e.g. 192.168.11.155">
        <div className="row-gap">
          <input className="input mono" style={{ flex: 1 }} value={f.ip_address} onChange={set('ip_address')} placeholder="192.168.11.155" autoFocus />
          <button className="btn ghost" onClick={testPing} disabled={!f.ip_address || ping?.busy}>{ping?.busy ? 'Pinging…' : 'Ping'}</button>
        </div>
        {ping && !ping.busy && (
          <span className={`sm ${ping.reachable ? 'txt-ok' : 'txt-crit'}`}>
            {ping.error ? ping.error : ping.reachable ? `✓ Reachable · ${ping.time_ms} ms` : '✕ No reply (PC off, wrong IP or ping blocked by its firewall)'}
          </span>
        )}
      </Field>
      <div className="form-grid">
        <Field label="Display name"><input className="input" value={f.name} onChange={set('name')} placeholder="e.g. Accounts PC" /></Field>
        <Field label="Group"><input className="input" value={f.group_name} onChange={set('group_name')} placeholder="e.g. Head Office" /></Field>
        <Field label="Location"><input className="input" value={f.location} onChange={set('location')} /></Field>
        <Field label="Environment">
          <select className="input" value={f.environment} onChange={set('environment')}>
            {['production', 'staging', 'development', 'office'].map((x) => <option key={x}>{x}</option>)}
          </select>
        </Field>
        <Field label="Owner / responsible"><input className="input" value={f.owner} onChange={set('owner')} /></Field>
      </div>
    </Modal>
  );
}

export default function Servers() {
  const { serverList, servers } = useLive();
  const { can } = useAuth();
  const nav = useNavigate();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [adding, setAdding] = useState(false);
  const editId = Number(params.get('edit'));
  const editing = editId ? servers[editId] : null;

  const rows = serverList.filter((s) => {
    const h = health(s);
    if (status && h !== status && !(status === 'online' && ['online', 'warning', 'critical'].includes(h))) return false;
    if (!q) return true;
    const t = q.toLowerCase();
    return [s.name, s.ip_address, s.hostname, s.group_name, s.os_name].some((x) => x?.toLowerCase().includes(t));
  });

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Servers</h1>
          <p className="muted">{serverList.length} PCs / servers registered by IP · live values refresh every 10 s</p>
        </div>
        {can('admin', 'operator') && <button className="btn primary" onClick={() => setAdding(true)}>+ Add server</button>}
      </div>
      <div className="toolbar">
        <input className="input" style={{ maxWidth: 320 }} placeholder="Search name, IP, OS, group…" value={q} onChange={(e) => setQ(e.target.value)} />
        <div className="seg">
          {[['', 'All'], ['online', 'Online'], ['critical', 'Critical'], ['warning', 'Warning'], ['offline', 'Offline']].map(([k, l]) => (
            <button key={k} className={status === k ? 'active' : ''} onClick={() => setStatus(k)}>{l}</button>
          ))}
        </div>
      </div>

      <div className="card no-pad">
        {!rows.length ? (
          <Empty>No servers match</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table hover">
              <thead>
                <tr>
                  <th>Server</th><th>IP</th><th>Group</th><th style={{ width: 130 }}>CPU</th><th style={{ width: 130 }}>RAM</th>
                  <th style={{ width: 130 }}>Disk</th><th>Net ↓/↑ MB/s</th><th>Uptime</th><th>Alerts</th><th>Last data</th>
                  {can('admin', 'operator') && <th />}
                </tr>
              </thead>
              <tbody>
                {rows.map((s) => {
                  const h = health(s);
                  const live = s.status === 'online' ? s.live : null;
                  return (
                    <tr key={s.id} onClick={() => nav(`/servers/${s.id}`)}>
                      <td>
                        <div className="cell-server">
                          <StatusDot status={h} pulse={h === 'critical'} />
                          <div>
                            <div className="strong">{s.name}</div>
                            <div className="muted sm">{s.os_name || s.hostname || '—'}</div>
                          </div>
                        </div>
                      </td>
                      <td className="mono">{s.ip_address}</td>
                      <td>{s.group_name}</td>
                      <td><div className="bar-cell"><Bar value={live?.cpu_pct} warn={80} crit={95} /><span>{pct(live?.cpu_pct)}</span></div></td>
                      <td><div className="bar-cell"><Bar value={live?.mem_pct} warn={85} crit={95} /><span>{pct(live?.mem_pct)}</span></div></td>
                      <td><div className="bar-cell"><Bar value={live?.disk_pct} warn={85} crit={95} /><span>{pct(live?.disk_pct)}</span></div></td>
                      <td className="mono nowrap">{mbps(live?.net_rx_bps)} / {mbps(live?.net_tx_bps)}</td>
                      <td className="nowrap">{live ? duration(live.uptime_sec) : '–'}</td>
                      <td>
                        {s.critical_count > 0 && <Badge kind="critical">{s.critical_count}</Badge>}{' '}
                        {s.warning_count > 0 && <Badge kind="warning">{s.warning_count}</Badge>}
                        {!s.critical_count && !s.warning_count && <span className="muted">–</span>}
                      </td>
                      <td className="muted nowrap">{h === 'disabled' ? 'paused' : s.last_seen_at ? ago(s.last_seen_at) : <span className="txt-warn">waiting for agent</span>}</td>
                      {can('admin', 'operator') && (
                        <td onClick={(e) => e.stopPropagation()}>
                          <button className="btn ghost sm" onClick={() => setParams({ edit: s.id })}>Edit</button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
      <p className="muted sm">
        New PCs appear automatically when the agent starts on them. See <Link className="link" to="/settings">Settings → Agent setup</Link>.
      </p>
      {editing && <EditServer server={editing} onClose={() => setParams({})} />}
      {adding && <AddServer onClose={() => setAdding(false)} />}
    </div>
  );
}
