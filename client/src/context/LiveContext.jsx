import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import { api, getToken } from '../lib/api';
import { useAuth } from './AuthContext';

const LiveCtx = createContext(null);

function beep(severity) {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const tones = severity === 'critical' ? [880, 660, 880] : [660];
    tones.forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + i * 0.18);
      o.stop(ctx.currentTime + i * 0.18 + 0.17);
    });
    setTimeout(() => ctx.close(), 1000);
  } catch {
    /* audio not allowed until user interacts – ignore */
  }
}

export function LiveProvider({ children }) {
  const { user } = useAuth();
  const [servers, setServers] = useState({});
  const [alertSummary, setAlertSummary] = useState({});
  const [settings, setSettings] = useState({});
  const [connected, setConnected] = useState(false);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [toasts, setToasts] = useState([]);
  const [sound, setSound] = useState(() => localStorage.getItem('sm_sound') !== '0');
  const socketRef = useRef(null);
  const listeners = useRef(new Map());
  const refreshTimer = useRef(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const loadServers = useCallback(async () => {
    const list = await api.get('/servers');
    setServers(Object.fromEntries(list.map((s) => [s.id, s])));
  }, []);

  const loadSummary = useCallback(async () => setAlertSummary(await api.get('/alerts/summary')), []);

  const refreshSoon = useCallback(() => {
    clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      loadServers().catch(() => {});
      loadSummary().catch(() => {});
    }, 800);
  }, [loadServers, loadSummary]);

  const pushToast = useCallback((t) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((prev) => [{ id, ...t }, ...prev].slice(0, 5));
    setTimeout(() => setToasts((prev) => prev.filter((x) => x.id !== id)), t.ttl || 8000);
  }, []);
  const dismissToast = useCallback((id) => setToasts((prev) => prev.filter((x) => x.id !== id)), []);

  /** Pages can subscribe to raw socket events. Returns an unsubscribe fn. */
  const subscribe = useCallback((event, fn) => {
    if (!listeners.current.has(event)) listeners.current.set(event, new Set());
    listeners.current.get(event).add(fn);
    return () => listeners.current.get(event)?.delete(fn);
  }, []);
  const fire = (event, payload) => listeners.current.get(event)?.forEach((fn) => fn(payload));

  useEffect(() => {
    if (!user) return undefined;
    loadServers().catch(() => {});
    loadSummary().catch(() => {});
    api.get('/settings').then(setSettings).catch(() => {});

    const socket = io({ auth: { token: getToken() }, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => {
      setConnected(true);
      refreshSoon();
    });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));

    socket.on('metrics', (m) => {
      setLastUpdate(new Date());
      setServers((prev) => {
        const s = prev[m.server_id];
        if (!s) {
          refreshSoon();
          return prev;
        }
        return {
          ...prev,
          [m.server_id]: {
            ...s, live: m, status: 'online', last_seen_at: m.created_at, disks: m.disks || s.disks,
          },
        };
      });
      fire('metrics', m);
    });
    socket.on('server:status', (e) => {
      setServers((prev) => (prev[e.id] ? { ...prev, [e.id]: { ...prev[e.id], status: e.status } } : prev));
      if (e.status === 'offline') refreshSoon();
      fire('server:status', e);
    });
    socket.on('server:registered', refreshSoon);
    socket.on('server:updated', (s) => setServers((prev) => ({ ...prev, [s.id]: { ...prev[s.id], ...s } })));
    socket.on('server:deleted', ({ id }) =>
      setServers((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      })
    );
    socket.on('server:sessions', (e) =>
      setServers((prev) =>
        prev[e.id]
          ? { ...prev, [e.id]: { ...prev[e.id], sessions: e.sessions, login_log_status: e.login_log_status, sessions_at: new Date().toISOString() } }
          : prev
      )
    );
    socket.on('login:new', (e) => fire('login', e));
    socket.on('alert:new', (a) => {
      pushToast({ kind: a.severity, title: `${a.severity.toUpperCase()} · ${a.server_name}`, message: a.message, alertId: a.id });
      if (soundRef.current && a.severity !== 'info') beep(a.severity);
      refreshSoon();
      fire('alert', a);
    });
    socket.on('alert:resolved', (a) => {
      pushToast({ kind: 'ok', title: 'Recovered', message: a.message, ttl: 6000 });
      refreshSoon();
      fire('alert', a);
    });
    socket.on('alert:updated', (a) => {
      refreshSoon();
      fire('alert', a);
    });

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const toggleSound = () => {
    setSound((s) => {
      localStorage.setItem('sm_sound', s ? '0' : '1');
      return !s;
    });
  };

  const serverList = useMemo(
    () => Object.values(servers).sort((a, b) => a.group_name.localeCompare(b.group_name) || a.name.localeCompare(b.name)),
    [servers]
  );

  const value = {
    servers, serverList, alertSummary, settings, setSettings, connected, lastUpdate, toasts,
    dismissToast, pushToast, subscribe, loadServers, loadSummary, sound, toggleSound,
  };
  return <LiveCtx.Provider value={value}>{children}</LiveCtx.Provider>;
}

export const useLive = () => useContext(LiveCtx);

/** Subscribe to a socket event for the lifetime of a component. */
export function useSocketEvent(event, handler) {
  const { subscribe } = useLive();
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => subscribe(event, (p) => ref.current(p)), [event, subscribe]);
}
