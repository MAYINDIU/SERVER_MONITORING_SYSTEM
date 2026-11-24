/**
 * Speedometer-style gauge (270° sweep) with colour zones, ticks and an animated needle.
 *  value     current value (null = not supported)
 *  max       scale maximum (default 100)
 *  warn/crit zone thresholds in the same unit as value
 */
const CX = 100;
const CY = 100;
const START = 135; // degrees (bottom-left)
const SWEEP = 270;

const polar = (r, deg) => {
  const a = (deg * Math.PI) / 180;
  return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
};
const arc = (r, a0, a1) => {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
};

export default function Gauge({
  value, max = 100, warn = 75, crit = 90, label, sublabel, display, size = 190, decimals = 0, unit = '%',
}) {
  const has = value != null && !Number.isNaN(Number(value));
  const v = has ? Math.max(0, Math.min(Number(value), max)) : 0;
  const ratio = v / max;
  const angle = START + ratio * SWEEP;
  const wA = START + Math.min(warn / max, 1) * SWEEP;
  const cA = START + Math.min(crit / max, 1) * SWEEP;
  const level = !has ? 'na' : v >= crit ? 'crit' : v >= warn ? 'warn' : 'ok';
  const color = { ok: 'var(--ok)', warn: 'var(--warn)', crit: 'var(--crit)', na: 'var(--muted)' }[level];

  const ticks = [];
  for (let i = 0; i <= 20; i++) {
    const deg = START + (i / 20) * SWEEP;
    const major = i % 2 === 0;
    const [x0, y0] = polar(major ? 63 : 66, deg);
    const [x1, y1] = polar(71, deg);
    ticks.push(
      <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="currentColor" strokeOpacity={major ? 0.55 : 0.25} strokeWidth={major ? 1.6 : 1} />
    );
    if (i % 4 === 0) {
      const [tx, ty] = polar(52, deg);
      const n = (max * i) / 20;
      ticks.push(
        <text key={`t${i}`} x={tx} y={ty + 3} textAnchor="middle" className="gauge-tick">
          {n >= 1000 ? `${n / 1000}k` : Number.isInteger(n) ? n : n.toFixed(1)}
        </text>
      );
    }
  }

  const text = display ?? (has ? `${Number(value).toFixed(decimals)}${unit}` : 'N/A');

  return (
    <div className={`gauge gauge-${level}`} style={{ width: size }}>
      <svg viewBox="0 0 200 172" width={size} height={size * 0.86}>
        {/* outer colour zones */}
        <path d={arc(84, START, wA)} stroke="var(--ok)" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.9" />
        <path d={arc(84, wA, cA)} stroke="var(--warn)" strokeWidth="4" fill="none" opacity="0.9" />
        <path d={arc(84, cA, START + SWEEP)} stroke="var(--crit)" strokeWidth="4" fill="none" strokeLinecap="round" opacity="0.9" />
        {/* track + progress */}
        <path d={arc(76, START, START + SWEEP)} stroke="var(--track)" strokeWidth="7" fill="none" strokeLinecap="round" />
        {has && ratio > 0.002 && (
          <path d={arc(76, START, angle)} stroke={color} strokeWidth="7" fill="none" strokeLinecap="round" className="gauge-progress" />
        )}
        <g className="gauge-ticks">{ticks}</g>
        {/* needle */}
        <g style={{ transform: `rotate(${angle}deg)`, transformOrigin: `${CX}px ${CY}px`, transition: 'transform 0.9s cubic-bezier(.2,.8,.2,1)' }}>
          <path d={`M${CX - 6} ${CY - 3} L${CX + 66} ${CY} L${CX - 6} ${CY + 3} Z`} fill={has ? 'var(--text)' : 'var(--muted)'} />
        </g>
        <circle cx={CX} cy={CY} r="8" fill="var(--panel-2)" stroke={color} strokeWidth="3" />
        <text x={CX} y={CY + 38} textAnchor="middle" className="gauge-value" fill={has ? 'var(--text)' : 'var(--muted)'}>
          {text}
        </text>
        <text x={CX} y={CY + 56} textAnchor="middle" className="gauge-label">
          {label}
        </text>
      </svg>
      {sublabel && <div className="gauge-sub">{sublabel}</div>}
    </div>
  );
}

/** Pick a "nice" scale maximum for unbounded values like network MB/s. */
export function niceMax(v, steps = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000]) {
  const n = Number(v) || 0;
  return steps.find((s) => s >= n * 1.15) || steps[steps.length - 1];
}
