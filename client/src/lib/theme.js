import { useSyncExternalStore } from 'react';

/**
 * Dark / light theme. Stored in localStorage and applied as <html data-theme="...">.
 * index.html applies the saved theme before React loads, so there is no flash.
 */
const KEY = 'sm-theme';
const listeners = new Set();

function initial() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* ignore */ }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

let theme = initial();
document.documentElement.dataset.theme = theme;

export function setTheme(next) {
  theme = next;
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(KEY, next); } catch { /* ignore */ }
  listeners.forEach((l) => l());
}

export function useTheme() {
  const t = useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => theme
  );
  return [t, () => setTheme(t === 'dark' ? 'light' : 'dark')];
}
