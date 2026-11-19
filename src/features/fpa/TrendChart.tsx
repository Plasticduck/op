import { cn } from '@/lib/utils'
import { money, monthLabel } from './model'

// Bars for one series and a line for another on a shared axis that crosses
// zero, since EBITDA can be negative. Inline SVG, no library.
export function TrendChart({ points, aLabel, bLabel, height = 200 }: {
  points: { month: string; a: number | null; b: number | null }[]
  aLabel: string
  bLabel: string
  height?: number
}) {
  const vals = points.flatMap((p) => [p.a ?? 0, p.b ?? 0])
  if (!points.length || vals.every((v) => v === 0)) return <p className="mt-2 text-sm text-ink-muted">No values for these months.</p>
  const max = Math.max(0, ...vals)
  const min = Math.min(0, ...vals)
  const span = max - min || 1
  const pad = 8
  const y = (v: number) => pad + ((max - v) / span) * (height - 2 * pad)
  const w = 100 / points.length
  const zero = y(0)
  const line = points
    .map((p, i) => (p.b == null ? null : `${(i + 0.5) * w},${y(p.b)}`))
    .filter(Boolean)
    .join(' ')
  return (
    <div className="mt-3">
      <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="w-full" style={{ height }} role="img" aria-label={`${aLabel} and ${bLabel} by month`}>
        <line x1={0} x2={100} y1={zero} y2={zero} stroke="currentColor" className="text-border" strokeWidth={0.3} />
        {points.map((p, i) => {
          if (p.a == null) return null
          const top = Math.min(y(p.a), zero)
          return (
            <rect key={p.month} x={i * w + w * 0.15} width={w * 0.7} y={top} height={Math.max(0.5, Math.abs(y(p.a) - zero))} className="fill-accent/30">
              <title>{`${monthLabel(p.month)}: ${aLabel} ${money(p.a)}, ${bLabel} ${money(p.b)}`}</title>
            </rect>
          )
        })}
        <polyline fill="none" points={line} className="stroke-ok" strokeWidth={0.6} vectorEffect="non-scaling-stroke" style={{ strokeWidth: 2 }} />
      </svg>
      {/* Labels sit under their bar without taking width: every third month, every sixth on a phone. */}
      <div className="relative mt-1 h-4 text-[10px] text-ink-subtle">
        {points.map((p, i) => (i % 3 !== 0 ? null : (
          <span
            key={p.month}
            className={cn('absolute -translate-x-1/2 whitespace-nowrap', i % 6 !== 0 && 'hidden sm:block')}
            style={{ left: `${(i + 0.5) * w}%` }}
          >
            {monthLabel(p.month).replace(' 20', " '")}
          </span>
        )))}
      </div>
      <div className="mt-2 flex flex-wrap justify-center gap-4 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1"><span className="size-2.5 rounded-sm bg-accent/30" /> {aLabel}</span>
        <span className="inline-flex items-center gap-1"><span className="h-0.5 w-3 bg-ok" /> {bLabel}</span>
      </div>
    </div>
  )
}
