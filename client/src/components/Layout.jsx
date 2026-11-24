import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useLive } from '../context/LiveContext';
import { health, pct } from '../lib/format';
import { StatusDot } from './ui';
import Toasts from './Toasts';
import Logo from './Logo';
import ThemeToggle from './ThemeToggle';
import {
  IconBell, IconChart, IconGrid, IconLock, IconLogout, IconMenu, IconMute, IconServer, IconSettings, IconUsers, IconVolume,
} from './Icons';

function Clock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <span className="clock">
      {now.toLocaleDateString(undefined, { weekday: 'short', day: '2-digit', month: 'short' })}{' '}
      <b>{now.toLocaleTimeString()}</b>
    </span>
  );
}

export default function Layout() {
  const { user, logout, can } = useAuth();
  const { serverList, alertSummary, connected, lastUpdate, settings, sound, toggleSound } = useLive();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const loc = useLocation();
  const nav = useNavigate();

  useEffect(() => setOpen(false), [loc.pathname]);

  const shown = serverList.filter(
    (s) => !filter || s.name.toLowerCase().includes(filter.toLowerCase()) || s.ip_address.includes(filter)
  );
  const active = Number(alertSummary.active || 0);

  return (
    <div className={`shell ${open ? 'nav-open' : ''}`}>
      <aside className="sidebar">
        <div className="brand">
          <Logo size={44} className="brand-logo" />
          <div>
            <div className="brand-title">{settings.app_title || 'Server Monitor'}</div>
            <div className="brand-sub">{settings.company_name || 'Infrastructure monitoring'}</div>
          </div>
        </div>

        <nav className="nav">
          <div className="nav-section">Monitor</div>
          <NavLink to="/" end className="nav-item">
            <IconGrid /> Overview
          </NavLink>
          <NavLink to="/servers" className="nav-item">
            <IconServer /> Servers <span className="nav-count">{serverList.length}</span>
          </NavLink>

          <div className="server-mini">
            <input className="input sm" placeholder="Name or IP…" value={filter} onChange={(e) => setFilter(e.target.value)} />
            <div className="server-mini-list">
              {shown.map((s) => (
                <NavLink key={s.id} to={`/servers/${s.id}`} className="server-mini-item">
                  <StatusDot status={health(s)} />
                  <div className="smi-text">
                    <div className="smi-name">{s.name}</div>
                    <div className="smi-ip">{s.ip_address}</div>
                  </div>
                  <span className="smi-val">{s.status === 'online' ? pct(s.live?.cpu_pct) : '–'}</span>
                  {s.critical_count + s.warning_count > 0 && <span className="smi-alert">{s.critical_count + s.warning_count}</span>}
                </NavLink>
              ))}
              {!shown.length && <div className="smi-empty">No servers yet</div>}
            </div>
          </div>

          <NavLink to="/alerts" className="nav-item">
            <IconBell /> Incidents {active > 0 && <span className="nav-badge">{active}</span>}
          </NavLink>
          <NavLink to="/logins" className="nav-item">
            <IconLock /> Access log
          </NavLink>
          <NavLink to="/reports" className="nav-item">
            <IconChart /> Reports
          </NavLink>

          {can('admin') && (
            <>
              <div className="nav-section">Admin</div>
              <NavLink to="/settings" className="nav-item">
                <IconSettings /> Settings
              </NavLink>
              <NavLink to="/users" className="nav-item">
                <IconUsers /> Users
              </NavLink>
            </>
          )}
        </nav>
      </aside>
      <div className="scrim" onClick={() => setOpen(false)} />

      <div className="main">
        <header className="topbar">
          <button className="icon-btn mobile-only" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <IconMenu />
          </button>
          <div className={`live-pill ${connected ? 'on' : 'off'}`}>
            <span className="live-dot" />
            {connected ? 'Live' : 'Reconnecting…'}
            {lastUpdate && <span className="live-time">updated {lastUpdate.toLocaleTimeString()}</span>}
          </div>
          <div className="topbar-right">
            <Clock />
            <ThemeToggle />
            <button className="icon-btn" onClick={toggleSound} title={sound ? 'Mute alert sound' : 'Enable alert sound'}>
              {sound ? <IconVolume /> : <IconMute />}
            </button>
            <button className="icon-btn bell" onClick={() => nav('/alerts')} title="Active incidents">
              <IconBell />
              {active > 0 && <span className={`bell-count ${alertSummary.critical > 0 ? 'crit' : ''}`}>{active}</span>}
            </button>
            <div className="user-chip">
              <div className="avatar">{user?.name?.[0]?.toUpperCase()}</div>
              <div className="user-meta">
                <div className="user-name">{user?.name}</div>
                <div className="user-role">{user?.role}</div>
              </div>
            </div>
            <button className="icon-btn" onClick={logout} title="Log out">
              <IconLogout />
            </button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
      <Toasts />
    </div>
  );
}
