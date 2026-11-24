import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { tickLabel } from '../lib/format';

function ChartTooltip({ active, payload, label, unit, fmt }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <div className="chart-tip-time">{new Date(label * 1000).toLocaleString()}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="chart-tip-row">
          <span className="dot" style={{ background: p.color }} />
          <span>{p.name}</span>
          <b>{p.value == null ? '–' : fmt ? fmt(p.value) : `${Number(p.value).toFixed(2)}${unit}`}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * Area chart for time-series. `data` rows must contain `ts` (epoch seconds).
 * series: [{ key, name, color }]
 */
export default function TimeChart({ data = [], series, unit = '%', height = 240, yMax, bucketSec = 60, fmt, legend = true }) {
  if (!data.length) return <div className="chart-empty" style={{ height }}>No data for this period yet</div>;
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 0 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`g-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={s.color} stopOpacity={0} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="ts"
          type="number"
          domain={['dataMin', 'dataMax']}
          scale="time"
          tickFormatter={(t) => tickLabel(t, bucketSec)}
          stroke="var(--muted)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          minTickGap={40}
        />
        <YAxis
          domain={[0, yMax ?? 'auto']}
          stroke="var(--muted)"
          fontSize={11}
          tickLine={false}
          axisLine={false}
          width={48}
          tickFormatter={(v) => (fmt ? fmt(v) : `${v}${unit}`)}
        />
        <Tooltip content={<ChartTooltip unit={unit} fmt={fmt} />} />
        {legend && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--text-2)' }} />}
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.color}
            strokeWidth={2}
            fill={`url(#g-${s.key})`}
            dot={false}
            connectNulls
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  );
}
