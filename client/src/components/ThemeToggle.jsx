import { useTheme } from '../lib/theme';
import { IconMoon, IconSun } from './Icons';

export default function ThemeToggle({ label = false }) {
  const [theme, toggle] = useTheme();
  const next = theme === 'dark' ? 'Light' : 'Dark';
  return (
    <button type="button" className="icon-btn theme-toggle" onClick={toggle} title={`Switch to ${next.toLowerCase()} mode`} aria-label={`Switch to ${next.toLowerCase()} mode`}>
      {theme === 'dark' ? <IconSun /> : <IconMoon />}
      {label && <span>{next} mode</span>}
    </button>
  );
}
