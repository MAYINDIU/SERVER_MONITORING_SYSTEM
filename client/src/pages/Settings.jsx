import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useLive } from '../context/LiveContext';
import { Badge, Empty, Field, Modal } from '../components/ui';
import { dateTime, METRIC_LABEL } from '../lib/format';

const UNIT = { cpu: '%', memory: '%', disk: '%', swap: '%', temperature: '°C', net_rx: 'MB/s', net_tx: 'MB/s', offline: 'sec', anomaly: 'z-score', login: 'event', login_failed: 'attempts' };
const EMPTY_RULE = { name: '', metric: 'cpu', warning_threshold: '', critical_threshold: '', duration_sec: 60, server_id: '', sms_enabled: 1, enabled: 1 };

/* ------------------------------ Rules ------------------------------ */

function RuleForm({ rule, onClose, onSaved }) {
  const { serverList } = useLive();
  const [f, setF] = useState({ ...EMPTY_RULE, ...rule, server_id: rule?.server_id || '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });

  const save = async () => {
    try {
      if (f.id) await api.put(`/rules/${f.id}`, f);
      else await api.post('/rules', f);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };

  return (
    <Modal title={f.id ? 'Edit rule' : 'New alert rule'} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save rule</button></>}>
      {err && <div className="alert-box">{err}</div>}
      <Field label="Name"><input className="input" value={f.name} onChange={set('name')} placeholder="e.g. ERP DB high CPU" /></Field>
      <div className="form-grid">
        <Field label="Metric">
          <select className="input" value={f.metric} onChange={set('metric')}>
            {Object.keys(UNIT).map((m) => <option key={m} value={m}>{METRIC_LABEL[m]} ({UNIT[m]})</option>)}
          </select>
        </Field>
        <Field label="Applies to" hint="A server-specific rule overrides the global rule for that metric">
          <select className="input" value={f.server_id} onChange={set('server_id')}>
            <option value="">All servers (global)</option>
            {serverList.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.ip_address})</option>)}
          </select>
        </Field>
        {f.metric === 'login' ? (
          <p className="muted sm" style={{ gridColumn: '1 / -1' }}>
            Every login raises an incident: <b className="txt-crit">critical</b> for remote access (Remote Desktop, SSH, AnyDesk, TeamViewer, VNC, WinRM),{' '}
            <b className="txt-warn">warning</b> for local keyboard login / screen unlock. Trusted IPs and users are set in <b>Settings → Login alerts</b>.
          </p>
        ) : (
          <>
            <Field label={`Warning ≥ (${UNIT[f.metric]})`}><input className="input" type="number" value={f.warning_threshold ?? ''} onChange={set('warning_threshold')} /></Field>
            <Field label={`Critical ≥ (${UNIT[f.metric]})`}><input className="input" type="number" value={f.critical_threshold ?? ''} onChange={set('critical_threshold')} /></Field>
            {f.metric === 'login_failed' ? (
              <Field label="Counting window (seconds)" hint="Number of failed logins within this time is compared with the thresholds (300 = 5 minutes)">
                <input className="input" type="number" min="60" step="60" value={f.duration_sec} onChange={set('duration_sec')} />
              </Field>
            ) : (
              <Field label="For at least (seconds)" hint="Breach must last this long before alerting – avoids noise from short spikes">
                <input className="input" type="number" min="0" step="10" value={f.duration_sec} onChange={set('duration_sec')} />
              </Field>
            )}
          </>
        )}
        <Field label="Options">
          <label className="check"><input type="checkbox" checked={!!Number(f.enabled)} onChange={set('enabled')} /> Enabled</label>
          <label className="check"><input type="checkbox" checked={!!Number(f.sms_enabled)} onChange={set('sms_enabled')} /> Send SMS</label>
        </Field>
      </div>
    </Modal>
  );
}

function RulesTab() {
  const [rules, setRules] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/rules').then(setRules), []);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (r) => {
    if (!window.confirm(`Delete rule "${r.name}"?`)) return;
    await api.del(`/rules/${r.id}`);
    load();
  };
  const toggle = async (r) => {
    await api.put(`/rules/${r.id}`, { ...r, enabled: r.enabled ? 0 : 1 });
    load();
  };

  return (
    <div className="card no-pad">
      <div className="card-head pad">
        <h3>Alert rules</h3>
        <button className="btn primary sm" onClick={() => setEditing({})}>+ New rule</button>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Rule</th><th>Metric</th><th>Scope</th><th className="num">Warning</th><th className="num">Critical</th><th className="num">For</th><th>SMS</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rules.map((r) => (
              <tr key={r.id} className={r.enabled ? '' : 'dim'}>
                <td className="strong">{r.name}</td>
                <td>{METRIC_LABEL[r.metric]}</td>
                <td>{r.server_id ? <Badge kind="accent">{r.server_name}</Badge> : <span className="muted">All servers</span>}</td>
                <td className="num txt-warn">{r.warning_threshold ?? '–'} <span className="muted sm">{r.warning_threshold != null && UNIT[r.metric]}</span></td>
                <td className="num txt-crit">{r.critical_threshold ?? '–'} <span className="muted sm">{r.critical_threshold != null && UNIT[r.metric]}</span></td>
                <td className="num">{r.duration_sec ? `${r.duration_sec}s` : '–'}</td>
                <td>{r.sms_enabled ? '✓' : '–'}</td>
                <td><button className={`switch ${r.enabled ? 'on' : ''}`} onClick={() => toggle(r)} aria-label="toggle" /></td>
                <td className="nowrap">
                  <button className="btn ghost sm" onClick={() => setEditing(r)}>Edit</button>{' '}
                  <button className="btn ghost sm danger" onClick={() => remove(r)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted sm pad">
        <b>Anomaly</b> flags sudden random spikes in CPU/RAM (value far above the last 10 minutes' normal, z-score ≥ warning) as <i>info</i> incidents.
        <b> Offline</b> fires when no data arrives for the given seconds.
        <b> Login</b> pages on every login to a PC / server; <b>Failed logins</b> fires on password guessing (N failures within the window).
      </p>
      {editing && <RuleForm rule={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}

/* ------------------------------ Settings form ------------------------------ */

function useSettings() {
  const [s, setS] = useState(null);
  useEffect(() => {
    api.get('/settings').then(setS);
  }, []);
  return [s, setS];
}

function SmsTab() {
  const { pushToast } = useLive();
  const [s, setS] = useSettings();
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState(false);
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });

  const save = async () => {
    await api.put('/settings', s);
    pushToast({ kind: 'ok', title: 'Saved', message: 'SMS settings updated', ttl: 3000 });
  };
  const test = async () => {
    setBusy(true);
    try {
      await api.put('/settings', s);
      const r = await api.post('/settings/sms/test', { to: testTo });
      const ok = r.results.filter((x) => x.ok).length;
      pushToast({ kind: ok ? 'ok' : 'critical', title: 'SMS test', message: r.results.map((x) => `${x.to}: ${x.response}`).join(' | '), ttl: 12000 });
    } catch (e) {
      pushToast({ kind: 'critical', title: 'SMS test failed', message: e.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <div className="card-head">
        <h3>SMS gateway</h3>
        <label className="check"><input type="checkbox" checked={s.sms_enabled === '1'} onChange={set('sms_enabled')} /> Enable SMS alerts</label>
      </div>
      <p className="muted sm">
        Works with any HTTP bulk-SMS provider. Use placeholders <code>{'{to}'}</code> <code>{'{message}'}</code> <code>{'{api_key}'}</code> <code>{'{sender_id}'}</code> in the URL / body.
      </p>
      <div className="form-grid">
        <Field label="Method">
          <select className="input" value={s.sms_method} onChange={set('sms_method')}><option>GET</option><option>POST</option></select>
        </Field>
        <Field label="API key"><input className="input" value={s.sms_api_key} onChange={set('sms_api_key')} /></Field>
      </div>
      <Field label="API URL"><input className="input mono" value={s.sms_api_url} onChange={set('sms_api_url')} /></Field>
      {s.sms_method === 'POST' && (
        <Field label="POST JSON body"><textarea className="input mono" rows={3} value={s.sms_post_body} onChange={set('sms_post_body')} /></Field>
      )}
      <div className="form-grid">
        <Field label="Sender ID / mask"><input className="input" value={s.sms_sender_id} onChange={set('sms_sender_id')} /></Field>
        <Field label="Recipients" hint="Comma separated, e.g. 8801711000000, 8801811000000">
          <input className="input" value={s.sms_recipients} onChange={set('sms_recipients')} />
        </Field>
        <Field label="Minimum severity to SMS">
          <select className="input" value={s.sms_min_severity} onChange={set('sms_min_severity')}>
            <option value="critical">Critical only</option><option value="warning">Warning + critical</option><option value="info">Everything (incl. anomalies)</option>
          </select>
        </Field>
        <Field label="Cooldown per alert (minutes)" hint="Don't SMS the same server/rule again within this time">
          <input className="input" type="number" min="0" value={s.sms_cooldown_min} onChange={set('sms_cooldown_min')} />
        </Field>
      </div>
      <label className="check"><input type="checkbox" checked={s.sms_on_recovery === '1'} onChange={set('sms_on_recovery')} /> Also send an SMS when a problem recovers</label>
      <div className="row-gap mt">
        <input className="input" style={{ maxWidth: 240 }} placeholder="Test number (optional)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
        <button className="btn ghost" onClick={test} disabled={busy}>{busy ? 'Sending…' : 'Send test SMS'}</button>
        <span className="spacer" />
        <button className="btn primary" onClick={save}>Save</button>
      </div>
    </div>
  );
}

function GeneralTab() {
  const { pushToast, setSettings } = useLive();
  const [s, setS] = useSettings();
  const [sys, setSys] = useState(null);
  useEffect(() => {
    api.get('/dashboard/system').then(setSys).catch(() => {});
  }, []);
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.value });
  const save = async () => {
    await api.put('/settings', s);
    setSettings((prev) => ({ ...prev, company_name: s.company_name, app_title: s.app_title }));
    pushToast({ kind: 'ok', title: 'Saved', message: 'Settings updated', ttl: 3000 });
  };
  return (
    <div className="grid-2">
      <div className="card">
        <div className="card-head"><h3>General</h3></div>
        <div className="form-grid">
          <Field label="Application title"><input className="input" value={s.app_title} onChange={set('app_title')} /></Field>
          <Field label="Company name"><input className="input" value={s.company_name} onChange={set('company_name')} /></Field>
          <Field label="Mark offline after (seconds)" hint="Status turns offline when no sample arrives for this long"><input className="input" type="number" min="15" value={s.offline_after_sec} onChange={set('offline_after_sec')} /></Field>
          <Field label="Keep raw 10-second data (days)" hint="Older raw rows are deleted after being rolled up hourly"><input className="input" type="number" min="1" value={s.raw_retention_days} onChange={set('raw_retention_days')} /></Field>
          <Field label="Keep history (days)" hint="Hourly history, resolved incidents and SMS log older than this are deleted automatically (60 = 2 months)"><input className="input" type="number" min="1" value={s.hourly_retention_days} onChange={set('hourly_retention_days')} /></Field>
        </div>
        <div className="row-gap mt"><span className="spacer" /><button className="btn primary" onClick={save}>Save</button></div>
      </div>
      <div className="card">
        <div className="card-head"><h3>Monitoring system health</h3></div>
        {sys && (
          <dl className="kv">
            <div><dt>API uptime</dt><dd>{Math.round(sys.uptime_sec / 60)} min</dd></div>
            <div><dt>Node.js</dt><dd>{sys.node}</dd></div>
            <div><dt>API memory</dt><dd>{sys.memory_mb} MB</dd></div>
            {sys.storage.map((t) => (
              <div key={t.name}><dt>Table {t.name}</dt><dd>~{Number(t.approx_rows || 0).toLocaleString()} rows · {t.size_mb} MB</dd></div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
}

function LoginAlertsTab() {
  const { pushToast } = useLive();
  const [s, setS] = useSettings();
  if (!s) return null;
  const set = (k) => (e) => setS({ ...s, [k]: e.target.type === 'checkbox' ? (e.target.checked ? '1' : '0') : e.target.value });
  const save = async () => {
    await api.put('/settings', {
      login_trusted_ips: s.login_trusted_ips, login_ignore_users: s.login_ignore_users,
      login_alert_local: s.login_alert_local, login_alert_network: s.login_alert_network,
    });
    pushToast({ kind: 'ok', title: 'Saved', message: 'Login alert settings updated', ttl: 3000 });
  };
  return (
    <div className="card">
      <div className="card-head"><h3>Login / remote-access alerts</h3></div>
      <p className="muted sm">
        Every login is always recorded in <b>Access log</b>. These options only decide which logins raise an incident (toast + sound + SMS).
        Turn the whole thing on/off or change SMS in <b>Alert rules</b> → “Login / remote access detected”.
      </p>
      <Field label="Trusted IPs – never alert" hint="Your own admin PCs. Comma separated. Prefix match with * or a trailing dot, e.g. 192.168.11.133, 10.99.0.*">
        <input className="input mono" value={s.login_trusted_ips || ''} onChange={set('login_trusted_ips')} placeholder="192.168.11.133, 10.99.0.*" />
      </Field>
      <Field label="Ignored user names" hint="Service / backup accounts that log in automatically. Comma separated.">
        <input className="input mono" value={s.login_ignore_users || ''} onChange={set('login_ignore_users')} placeholder="backup, svc_sql" />
      </Field>
      <label className="check"><input type="checkbox" checked={s.login_alert_local !== '0'} onChange={set('login_alert_local')} /> Alert on local keyboard login and screen unlock (someone sitting at the PC)</label>
      <label className="check"><input type="checkbox" checked={s.login_alert_network === '1'} onChange={set('login_alert_network')} /> Alert on network logons too (file share, mapped drive – can be very frequent)</label>
      <div className="row-gap mt"><span className="spacer" /><button className="btn primary" onClick={save}>Save</button></div>
    </div>
  );
}

function AgentTab() {
  const [s] = useSettings();
  const host = window.location.hostname;
  const url = `${window.location.protocol}//${host}:5000`;
  if (!s) return null;
  return (
    <div className="card">
      <div className="card-head"><h3>Install the agent on a PC / server</h3></div>
      <ol className="steps">
        <li>Install <b>Node.js 18+</b> on the PC.</li>
        <li>Copy the <code>agent</code> folder to the PC (e.g. <code>C:\ServerMonitorAgent</code>) and run <code>npm install</code> inside it.</li>
        <li>
          Create <code>.env</code> in that folder:
          <pre className="code">{`SERVER_URL=${url}\nENROLL_KEY=${s.enroll_key || '<AGENT_ENROLL_KEY from server/.env>'}`}</pre>
        </li>
        <li>Start it: <code>node agent.js</code> – the PC appears in the dashboard within 10 seconds, identified by its IP.</li>
        <li>
          Keep it running after reboot (Windows):
          <pre className="code">{`npm install -g pm2 pm2-windows-startup\npm2 start agent.js --name sm-agent\npm2 save\npm2-startup install`}</pre>
          Linux: <code>pm2 start agent.js --name sm-agent &amp;&amp; pm2 save &amp;&amp; pm2 startup</code>
        </li>
      </ol>
      <p className="muted sm">Allow inbound TCP port 5000 on the monitoring server's firewall. If the server is unreachable the agent buffers up to 1 hour of samples and sends them when it reconnects.</p>
    </div>
  );
}

function LogTab({ kind }) {
  const [rows, setRows] = useState([]);
  useEffect(() => {
    api.get(kind === 'sms' ? '/notifications' : '/audit').then(setRows).catch(() => {});
  }, [kind]);
  if (!rows.length) return <div className="card"><Empty>Nothing logged yet</Empty></div>;
  return (
    <div className="card no-pad">
      <div className="table-wrap">
        <table className="table">
          {kind === 'sms' ? (
            <>
              <thead><tr><th>Time</th><th>To</th><th>Message</th><th>Status</th><th>Gateway response</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}><td className="nowrap muted">{dateTime(r.created_at)}</td><td className="mono">{r.recipient}</td><td>{r.message}</td>
                  <td><Badge kind={r.status === 'sent' ? 'ok-outline' : 'crit-outline'}>{r.status}</Badge></td><td className="muted sm">{r.response}</td></tr>
              ))}</tbody>
            </>
          ) : (
            <>
              <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Object</th><th>IP</th><th>Details</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.id}><td className="nowrap muted">{dateTime(r.created_at)}</td><td>{r.username || '–'}</td><td><Badge>{r.action}</Badge></td>
                  <td>{r.entity ? `${r.entity} #${r.entity_id ?? ''}` : '–'}</td><td className="mono sm">{r.ip}</td><td className="muted sm trunc">{r.details}</td></tr>
              ))}</tbody>
            </>
          )}
        </table>
      </div>
    </div>
  );
}

export default function Settings() {
  const [tab, setTab] = useState('rules');
  return (
    <div className="page">
      <div className="page-head"><div><h1>Settings</h1><p className="muted">Alert thresholds, SMS, retention and agent setup.</p></div></div>
      <div className="tabs">
        {[['rules', 'Alert rules'], ['logins', 'Login alerts'], ['sms', 'SMS gateway'], ['general', 'General'], ['agent', 'Agent setup'], ['smslog', 'SMS log'], ['audit', 'Audit log']].map(([k, l]) => (
          <button key={k} className={tab === k ? 'active' : ''} onClick={() => setTab(k)}>{l}</button>
        ))}
      </div>
      {tab === 'rules' && <RulesTab />}
      {tab === 'logins' && <LoginAlertsTab />}
      {tab === 'sms' && <SmsTab />}
      {tab === 'general' && <GeneralTab />}
      {tab === 'agent' && <AgentTab />}
      {tab === 'smslog' && <LogTab kind="sms" />}
      {tab === 'audit' && <LogTab kind="audit" />}
    </div>
  );
}
