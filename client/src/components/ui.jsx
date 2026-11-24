import { useEffect } from 'react';
import { RANGES } from '../lib/format';

export const StatusDot = ({ status, pulse }) => <span className={`status-dot s-${status} ${pulse ? 'pulse' : ''}`} />;

export const Badge = ({ kind = 'default', children }) => <span className={`badge b-${kind}`}>{children}</span>;

export function StatCard({ label, value, hint, kind = 'default', icon }) {
  return (
    <div className={`stat-card k-${kind}`}>
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {icon && <span className="stat-icon">{icon}</span>}
      </div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </div>
  );
}

export function RangeTabs({ value, onChange, ranges = RANGES }) {
  return (
    <div className="seg">
      {ranges.map((r) => (
        <button key={r.key} className={value === r.key ? 'active' : ''} onClick={() => onChange(r.key)}>
          {r.label}
        </button>
      ))}
    </div>
  );
}

export function Bar({ value, warn = 75, crit = 90 }) {
  const v = value == null ? 0 : Math.min(100, Math.max(0, value));
  const cls = value == null ? 'na' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';
  return (
    <div className="bar">
      <div className={`bar-fill f-${cls}`} style={{ width: `${v}%` }} />
    </div>
  );
}

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className={`modal ${wide ? 'wide' : ''}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

export const Field = ({ label, children, hint }) => (
  <label className="field">
    <span className="field-label">{label}</span>
    {children}
    {hint && <span className="field-hint">{hint}</span>}
  </label>
);

export const Empty = ({ children }) => <div className="empty">{children}</div>;

export const Spinner = () => <div className="spinner" />;

export const SeverityBadge = ({ severity }) => <Badge kind={severity}>{severity}</Badge>;

export const AlertStatusBadge = ({ status }) => (
  <Badge kind={status === 'open' ? 'crit-outline' : status === 'acknowledged' ? 'warn-outline' : 'ok-outline'}>{status}</Badge>
);
