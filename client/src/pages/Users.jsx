import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { Badge, Field, Modal } from '../components/ui';
import { ago } from '../lib/format';

function UserForm({ user, onClose, onSaved }) {
  const [f, setF] = useState({ name: '', username: '', role: 'viewer', phone: '', is_active: 1, ...user, password: '' });
  const [err, setErr] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0) : e.target.value });
  const save = async () => {
    try {
      if (f.id) await api.put(`/users/${f.id}`, { ...f, password: f.password || undefined });
      else await api.post('/users', f);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e.message);
    }
  };
  return (
    <Modal title={f.id ? `Edit ${f.username}` : 'New user'} onClose={onClose}
      footer={<><span className="spacer" /><button className="btn ghost" onClick={onClose}>Cancel</button><button className="btn primary" onClick={save}>Save</button></>}>
      {err && <div className="alert-box">{err}</div>}
      <div className="form-grid">
        <Field label="Full name"><input className="input" value={f.name} onChange={set('name')} /></Field>
        <Field label="Username"><input className="input" value={f.username} onChange={set('username')} disabled={!!f.id} /></Field>
        <Field label={f.id ? 'New password (leave blank to keep)' : 'Password'}><input className="input" type="password" value={f.password} onChange={set('password')} /></Field>
        <Field label="Role" hint="Admin: everything · Operator: ack/resolve, edit servers · Viewer: read-only">
          <select className="input" value={f.role} onChange={set('role')}>
            <option value="admin">Admin</option><option value="operator">Operator</option><option value="viewer">Viewer</option>
          </select>
        </Field>
        <Field label="Mobile"><input className="input" value={f.phone || ''} onChange={set('phone')} /></Field>
        <Field label="Status"><label className="check"><input type="checkbox" checked={!!f.is_active} onChange={set('is_active')} /> Active</label></Field>
      </div>
    </Modal>
  );
}

export default function Users() {
  const { user: me } = useAuth();
  const [users, setUsers] = useState([]);
  const [editing, setEditing] = useState(null);
  const load = useCallback(() => api.get('/users').then(setUsers), []);
  useEffect(() => {
    load();
  }, [load]);

  const remove = async (u) => {
    if (!window.confirm(`Delete user ${u.username}?`)) return;
    await api.del(`/users/${u.id}`);
    load();
  };

  return (
    <div className="page">
      <div className="page-head">
        <div><h1>Users</h1><p className="muted">Who can access the monitoring portal.</p></div>
        <button className="btn primary" onClick={() => setEditing({})}>+ New user</button>
      </div>
      <div className="card no-pad">
        <table className="table">
          <thead><tr><th>Name</th><th>Username</th><th>Role</th><th>Mobile</th><th>Status</th><th>Last login</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className={u.is_active ? '' : 'dim'}>
                <td className="strong">{u.name}</td>
                <td className="mono">{u.username}</td>
                <td><Badge kind={u.role === 'admin' ? 'accent' : u.role === 'operator' ? 'warning' : 'default'}>{u.role}</Badge></td>
                <td>{u.phone || '–'}</td>
                <td>{u.is_active ? 'Active' : 'Disabled'}</td>
                <td className="muted">{ago(u.last_login_at)}</td>
                <td className="nowrap">
                  <button className="btn ghost sm" onClick={() => setEditing(u)}>Edit</button>{' '}
                  {u.id !== me.id && <button className="btn ghost sm danger" onClick={() => remove(u)}>Delete</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {editing && <UserForm user={editing.id ? editing : null} onClose={() => setEditing(null)} onSaved={load} />}
    </div>
  );
}
