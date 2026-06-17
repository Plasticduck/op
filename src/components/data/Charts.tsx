import { format } from 'date-fns'
import { cn } from '@/lib/utils'

// Lightweight inline-SVG charts. Avoids pulling in a chart library so the
// reporting bundle stays small. Designed for the MaintainX-clone reporting
// page; not meant to be a general charting toolkit.

// ---- Donut --------------------------------------------------------------
// Renders a single donut from segments. Empty data renders an outline circle.
export function Donut({
  segments, size = 180, label, sublabel,
}: {
  segments: Array<{ label: string; value: number; color: string }>
  size?: number
  label?: string
  sublabel?: string
}) {
  const total = segments.reduce((a, s) => a + s.value, 0)
  const cx = size / 2
  const cy = size / 2
  const r = size / 2 - 10
  const inner = r - 28
  const ring = (() => {
    if (total === 0) {
      return <circle cx={cx} cy={cy} r={r} fill="none" stroke="rgba(0,0,0,0.08)" strokeWidth={r - inner} />
    }
    let start = -Math.PI / 2
    return segments.map((s, i) => {
      const angle = (s.value / total) * Math.PI * 2
      const end = start + angle
      const x1 = cx + r * Math.cos(start)
      const y1 = cy + r * Math.sin(start)
      const x2 = cx + r * Math.cos(end)
      const y2 = cy + r * Math.sin(end)
      const x3 = cx + inner * Math.cos(end)
      const y3 = cy + inner * Math.sin(end)
      const x4 = cx + inner * Math.cos(start)
      const y4 = cy + inner * Math.sin(start)
      const large = angle > Math.PI ? 1 : 0
      const path = `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`
      start = end
      return <path key={i} d={path} fill={s.color}><title>{s.label}: {s.value}</title></path>
    })
  })()

  return (
    <div className="flex items-center gap-4">
      <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
        {ring}
        {(label || sublabel) && (
          <g>
            <text x={cx} y={cy - 4} textAnchor="middle" className="fill-ink text-[18px] font-semibold">{label}</text>
            <text x={cx} y={cy + 14} textAnchor="middle" className="fill-ink-muted text-[10px]">{sublabel}</text>
          </g>
        )}
      </svg>
      <div className="flex flex-col gap-1">
        {segments.map((s, i) => (
          <div key={i} className="flex items-center gap-2 text-xs">
            <span className="size-2.5 rounded-full" style={{ backgroundColor: s.color }} />
            <span className="text-ink-muted">{s.label}</span>
            <span className="ml-auto tabular font-medium text-ink">{s.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ---- Bars ---------------------------------------------------------------
// Vertical bar chart with x-axis labels. Max value is computed from data.
export function BarChart({
  data, height = 200, color = '#2563eb',
}: {
  data: Array<{ label: string; value: number }>
  height?: number
  color?: string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  const barW = 100 / Math.max(1, data.length)
  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {/* gridlines at 0/50/100% of max */}
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1={0} y1={height - height * p + 16} x2={100} y2={height - height * p + 16}
            stroke="rgba(0,0,0,0.06)" strokeWidth={0.3} />
        ))}
        {data.map((d, i) => {
          const h = (d.value / max) * (height - 32)
          const x = i * barW + barW * 0.15
          const w = barW * 0.7
          const y = height - h - 16
          return (
            <g key={i}>
              <rect x={x} y={y} width={w} height={h} fill={color} rx={0.8}>
                <title>{d.label}: {d.value}</title>
              </rect>
              {d.value > 0 && (
                <text x={x + w / 2} y={y - 2} textAnchor="middle" className="fill-ink-muted text-[3px]">{d.value}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="mt-1 grid text-[10px] text-ink-subtle" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }}>
        {data.map((d, i) => <span key={i} className="truncate text-center">{d.label}</span>)}
      </div>
    </div>
  )
}

// ---- Two-line chart -----------------------------------------------------
// Used by "Created vs. Completed" — two series sharing an x-axis of week
// buckets. Polylines + circle markers, no library.
export function TwoLineChart({
  buckets, height = 200,
}: {
  buckets: Array<{ weekStart: Date; created: number; completed: number }>
  height?: number
}) {
  if (buckets.length === 0) {
    return <p className="text-sm text-ink-muted">No data in range.</p>
  }
  const max = Math.max(1, ...buckets.map((b) => Math.max(b.created, b.completed)))
  const stepX = 100 / Math.max(1, buckets.length - 1)
  const yFor = (v: number) => height - 16 - (v / max) * (height - 32)
  const polyCreated = buckets.map((b, i) => `${i * stepX},${yFor(b.created)}`).join(' ')
  const polyCompleted = buckets.map((b, i) => `${i * stepX},${yFor(b.completed)}`).join(' ')

  return (
    <div className="w-full">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }}>
        {[0.25, 0.5, 0.75, 1].map((p) => (
          <line key={p} x1={0} y1={height - (height - 32) * p - 16} x2={100} y2={height - (height - 32) * p - 16}
            stroke="rgba(0,0,0,0.06)" strokeWidth={0.3} />
        ))}
        <polyline fill="none" stroke="#2563eb" strokeWidth={0.6} points={polyCreated} />
        <polyline fill="none" stroke="#22c55e" strokeWidth={0.6} points={polyCompleted} />
        {buckets.map((b, i) => (
          <g key={i}>
            <circle cx={i * stepX} cy={yFor(b.created)} r={0.8} fill="#2563eb"><title>{format(b.weekStart, 'M/d')}: {b.created} created</title></circle>
            <circle cx={i * stepX} cy={yFor(b.completed)} r={0.8} fill="#22c55e"><title>{format(b.weekStart, 'M/d')}: {b.completed} completed</title></circle>
          </g>
        ))}
      </svg>
      <div className="mt-1 flex justify-between text-[10px] text-ink-subtle">
        {buckets.map((b, i) => <span key={i}>{format(b.weekStart, 'M/d')}</span>)}
      </div>
      <div className="mt-2 flex justify-center gap-4 text-xs">
        <LegendItem color="#2563eb" label="Created" />
        <LegendItem color="#22c55e" label="Completed" />
      </div>
    </div>
  )
}

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 text-ink-muted">
      <span className="size-2.5 rounded-full" style={{ backgroundColor: color }} /> {label}
    </span>
  )
}

// ---- Stat tile ----------------------------------------------------------
export function StatTile({
  value, label, tone, sublabel,
}: {
  value: React.ReactNode
  label: string
  tone?: 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'
  sublabel?: string
}) {
  const cls =
    tone === 'ok' ? 'text-ok border-ok/30' :
    tone === 'warn' ? 'text-warn border-warn/30' :
    tone === 'danger' ? 'text-danger border-danger/30' :
    tone === 'accent' ? 'text-accent border-accent/30' :
    'text-ink border-border'
  return (
    <div className="rounded-md border border-border bg-card p-4">
      <div className={cn('text-3xl font-semibold tabular', cls.split(' ')[0])}>{value}</div>
      <div className={cn('mt-1 inline-flex rounded-md border px-2 py-0.5 text-[11px] font-medium', cls)}>{label}</div>
      {sublabel && <div className="mt-1 text-[10px] text-ink-subtle">{sublabel}</div>}
    </div>
  )
}
