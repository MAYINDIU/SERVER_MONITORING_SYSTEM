import { useNavigate } from 'react-router-dom';
import { useLive } from '../context/LiveContext';
import { IconAlert, IconCheck } from './Icons';

export default function Toasts() {
  const { toasts, dismissToast } = useLive();
  const nav = useNavigate();
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast t-${t.kind}`}
          onClick={() => {
            if (t.alertId) nav(`/alerts?open=${t.alertId}`);
            dismissToast(t.id);
          }}
        >
          <div className="toast-icon">{t.kind === 'ok' ? <IconCheck /> : <IconAlert />}</div>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            <div className="toast-msg">{t.message}</div>
          </div>
          <button
            className="toast-x"
            onClick={(e) => {
              e.stopPropagation();
              dismissToast(t.id);
            }}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
