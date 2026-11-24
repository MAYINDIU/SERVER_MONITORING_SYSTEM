import { Link } from 'react-router-dom';
import { Badge, Empty } from './ui';
import { ago, dateTime, LOGIN_METHOD, REMOTE_METHODS } from '../lib/format';

export function KindBadge({ kind }) {
  if (kind === 'failed') return <Badge kind="crit-outline">failed</Badge>;
  if (kind === 'connection') return <Badge kind="warn-outline">connection</Badge>;
  return <Badge kind="ok-outline">login</Badge>;
}

export function MethodBadge({ method }) {
  const remote = REMOTE_METHODS.includes(method);
  return <Badge kind={remote ? 'accent' : 'default'}>{LOGIN_METHOD[method] || method}</Badge>;
}

const userOf = (e) => (e.domain && e.username && !/^(workgroup|\.)$/i.test(e.domain) ? `${e.domain}\\${e.username}` : e.username);

/** Table of login events. `showServer` adds the server column (global access log). */
export default function LoginTable({ rows, showServer, onIp }) {
  if (!rows.length) return <Empty>No login activity recorded yet</Empty>;
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Time</th>{showServer && <th>Server</th>}<th>Result</th><th>How</th><th>User</th><th>From (IP / PC)</th><th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((e) => (
            <tr key={e.id} className={e.kind === 'failed' ? 'row-failed' : ''}>
              <td className="nowrap" title={dateTime(e.event_time)}>
                <div>{dateTime(e.event_time)}</div>
                <div className="muted sm">{ago(e.event_time)}</div>
              </td>
              {showServer && (
                <td className="nowrap">
                  <Link className="link strong" to={`/servers/${e.server_id}`}>{e.server_name}</Link>
                  <div className="muted sm mono">{e.ip_address}</div>
                </td>
              )}
              <td><KindBadge kind={e.kind} /></td>
              <td><MethodBadge method={e.method} /></td>
              <td className="strong">{userOf(e) || <span className="muted">–</span>}</td>
              <td className="nowrap">
                {e.source_ip ? (
                  onIp ? <button className="link mono btn-link" onClick={() => onIp(e.source_ip)} title="Show only this IP">{e.source_ip}</button> : <span className="mono">{e.source_ip}</span>
                ) : <span className="muted">{e.method === 'local' || e.method === 'unlock' ? 'this PC (keyboard)' : '–'}</span>}
                {e.source_host && e.source_host !== e.source_ip && <div className="muted sm">{e.source_host}</div>}
              </td>
              <td className="muted sm">
                {e.details}
                {e.alerted ? <> <Badge kind="warn">alerted</Badge></> : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Who is logged in right now" list for one server. */
export function SessionList({ server }) {
  const sessions = server.sessions || [];
  if (!sessions.length) return <p className="muted sm">Nobody is logged in{server.sessions_at ? ` (checked ${ago(server.sessions_at)})` : ''}.</p>;
  return (
    <table className="table">
      <tbody>
        {sessions.map((s, i) => (
          <tr key={i}>
            <td className="strong">{s.user}</td>
            <td>{/rdp/i.test(s.tty || '') ? <Badge kind="accent">Remote Desktop</Badge> : /console/i.test(s.tty || '') ? <Badge>console</Badge> : <span className="muted">{s.tty || '–'}</span>}</td>
            <td className="mono">{s.ip || <span className="muted">–</span>}</td>
            <td className="muted sm nowrap">{s.since ? `since ${s.since}` : ''}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Warning when the agent can't read the OS login log. */
export function LogStatusNote({ server }) {
  const st = server.login_log_status;
  if (!st || st === 'ok') return null;
  return (
    <div className="alert-box">
      This agent cannot read the {server.platform === 'linux' ? 'auth log' : 'Windows Security log'} ({st}). Only remote connections and AnyDesk/TeamViewer are
      tracked – user names and failed passwords are missing. Run the agent as <b>Administrator</b> (Windows: re-run <code>install-agent.bat</code> as
      administrator) or <b>root</b> (Linux).
    </div>
  );
}
