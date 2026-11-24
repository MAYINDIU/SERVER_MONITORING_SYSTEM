import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import Logo from '../components/Logo';
import ThemeToggle from '../components/ThemeToggle';
import { IconAlert, IconChart, IconEye, IconEyeOff, IconLock, IconServer, IconUser } from '../components/Icons';

const BARS = [38, 52, 44, 63, 58, 72, 49, 66, 81, 60, 54, 70, 46, 62, 77, 58, 50, 68, 74, 56, 64, 48, 60, 71];

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-screen">
      <section className="login-hero">
        <div className="hero-brand">
          <Logo size={54} />
          <div>
            <div className="hero-brand-name">Server Monitor</div>
            <div className="hero-brand-sub">Infrastructure monitoring</div>
          </div>
        </div>

        <div className="hero-copy">
          <h2>
            Every server, <span>live</span> in one place.
          </h2>
          <p>CPU, memory, disk and network for all your PCs and servers, refreshed every 10 seconds, with instant alerts when something goes wrong.</p>
          <div className="hero-feats">
            <div className="hero-feat">
              <IconServer />
              <b>Live status</b>
              <span>Online / offline at a glance</span>
            </div>
            <div className="hero-feat">
              <IconAlert />
              <b>Smart alerts</b>
              <span>Thresholds &amp; incidents</span>
            </div>
            <div className="hero-feat">
              <IconChart />
              <b>Reports</b>
              <span>Daily trends &amp; PDF export</span>
            </div>
          </div>
          <div className="hero-pulse" aria-hidden="true">
            {BARS.map((h, i) => (
              <i key={i} style={{ height: `${h}%`, animationDelay: `${(i % 8) * -0.3}s` }} />
            ))}
          </div>
        </div>

        <div className="hero-foot">© {new Date().getFullYear()} Server Monitor</div>
      </section>

      <section className="login-side">
        <div className="login-side-top">
          <ThemeToggle label />
        </div>
        <div className="login-form-wrap">
          <form className="login-card" onSubmit={submit}>
            <div className="mobile-brand">
              <Logo size={64} />
            </div>
            <h1>Welcome back</h1>
            <p className="muted">Sign in to your monitoring dashboard</p>
            {error && <div className="alert-box">{error}</div>}
            <label className="field">
              <span className="field-label">Username</span>
              <div className="input-icon">
                <IconUser size={17} />
                <input
                  className="input"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Enter your username"
                  autoComplete="username"
                  autoFocus
                  required
                />
              </div>
            </label>
            <label className="field">
              <span className="field-label">Password</span>
              <div className="input-icon">
                <IconLock size={17} />
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  autoComplete="current-password"
                  required
                />
                <button type="button" className="eye" onClick={() => setShow((s) => !s)} aria-label={show ? 'Hide password' : 'Show password'}>
                  {show ? <IconEyeOff size={17} /> : <IconEye size={17} />}
                </button>
              </div>
            </label>
            <button className="btn primary block" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="login-note">
              <span className="live-dot" /> Secure connection to monitoring server
            </div>
          </form>
        </div>
      </section>
    </div>
  );
}
