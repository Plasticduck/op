import { useState, type ReactNode } from 'react'
import { ExternalLink, Loader2, RotateCw, Star, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CnSection, CnTab } from '@/lib/queries/corenavMap'
import { labelFor, showValue } from './format'

// One site's CoreNav sidebar, drawn from CoreNav's own sidebar setup (tabs of
// sections). Used by the CoreNav Map page.

export type PanelHead = {
  name: string
  subtitle: string
  badges: { text: string; tone?: 'accent' | 'warn' | 'ok' | 'neutral' }[]
  rating: { value: number; count: number | null } | null
  stats: { label: string; value: string }[]
}

// The washes inside this site's drive-time area (CoreNav's "competitors" view),
// worked out on the page from the area and the sites already on the map.
export type Competitors = {
  loading: boolean
  minutes: number
  error: string | null
  rows: { id: string; name: string; sub: string; format: string; rating: number | null; tier: string | null; mi: number; mw: boolean }[]
  onPick: (id: string) => void
}

export function SitePanel({ head, tabs, loading, error, onRetry, labels, openUrl, onClose, competitors }: {
  head: PanelHead
  tabs: CnTab[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  labels: Record<string, string>
  openUrl: string
  onClose: () => void
  competitors: Competitors | null
}) {
  const [active, setActive] = useState(0)
  const tab = tabs?.[Math.min(active, (tabs?.length ?? 1) - 1)]

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="border-b border-border px-4 pb-3 pt-3.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="text-[15px] font-semibold leading-snug text-ink">{head.name}</h2>
            {head.subtitle && <p className="mt-0.5 text-xs text-ink-muted">{head.subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-1 rounded-md p-1 text-ink-subtle hover:bg-content hover:text-ink">
            <X className="size-4" />
          </button>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {head.badges.map((b) => (
            <span key={b.text} className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium',
              b.tone === 'accent' ? 'bg-accent-soft text-accent' : b.tone === 'warn' ? 'bg-warn-soft text-warn' : b.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-content text-ink-muted')}>
              {b.text}
            </span>
          ))}
          {head.rating && (
            <span className="inline-flex items-center gap-1 text-[12px] text-ink-muted">
              <Star className="size-3.5 fill-current text-warn" /> {head.rating.value.toFixed(1)}
              {head.rating.count != null && <span className="text-ink-subtle">({head.rating.count.toLocaleString()})</span>}
            </span>
          )}
        </div>
        {head.stats.length > 0 && (
          <div className="mt-3 grid grid-cols-3 gap-2">
            {head.stats.map((s) => (
              <div key={s.label} className="rounded-lg bg-content px-2 py-1.5">
                <div className="text-[10px] uppercase tracking-wide text-ink-subtle">{s.label}</div>
                <div className="text-[13px] font-semibold tabular text-ink">{s.value}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      {tabs && tabs.length > 0 && (
        <div className="scrollbar-slim flex gap-1 overflow-x-auto border-b border-border px-3 py-2">
          {tabs.map((t, i) => (
            <button key={t.tab} type="button" onClick={() => setActive(i)}
              className={cn('shrink-0 rounded-full px-2.5 py-1 text-xs font-medium transition', i === active ? 'bg-accent text-white' : 'text-ink-muted hover:bg-content hover:text-ink')}>
              {t.tab}
            </button>
          ))}
        </div>
      )}

      <div className="scrollbar-slim min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Reading this site from CoreNav…</div>
        ) : error ? (
          <div data-testid="cn-site-error">
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
            <button type="button" onClick={onRetry} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-ink hover:border-accent/50">
              <RotateCw className="size-4" /> Try again
            </button>
          </div>
        ) : tab ? (
          <div className="space-y-5">
            {tab.sections.map((s, i) => <Section key={i} s={s} labels={labels} openUrl={openUrl} competitors={competitors} />)}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function Title({ children }: { children: ReactNode }) {
  return <h3 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{children}</h3>
}

function CompetitorList({ title, c }: { title: string | null; c: Competitors }) {
  return (
    <section>
      <Title>{title ?? `Competitors inside ${c.minutes} minutes`}</Title>
      {c.loading ? (
        <p className="flex items-center gap-2 text-[12.5px] text-ink-subtle"><Loader2 className="size-3.5 animate-spin" /> Working out the {c.minutes}-minute drive area…</p>
      ) : c.error ? (
        <p className="text-[12.5px] text-danger">{c.error}</p>
      ) : !c.rows.length ? (
        <p className="text-[12.5px] text-ink-subtle">No other washes inside the {c.minutes}-minute drive area.</p>
      ) : (
        <>
          <p className="mb-1.5 text-[11.5px] text-ink-subtle">{c.rows.length} other wash{c.rows.length === 1 ? '' : 'es'} inside the {c.minutes}-minute drive area, nearest first.</p>
          <ul className="divide-y divide-border/60 rounded-lg border border-border">
            {c.rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => c.onPick(r.id)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-content">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{r.mw ? '★ ' : ''}{r.name}</span>
                    <span className="block truncate text-[11px] text-ink-subtle">{[r.format, r.sub].filter(Boolean).join(' · ')}</span>
                  </span>
                  {r.tier && <span className="rounded-full bg-warn-soft px-1.5 py-0.5 text-[10px] font-medium text-warn">Tier {r.tier}</span>}
                  {r.rating != null && <span className="text-[11px] text-ink-muted">{r.rating.toFixed(1)}★</span>}
                  <span className="w-12 text-right text-[11px] tabular text-ink-muted">{r.mi.toFixed(1)} mi</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

function Section({ s, labels, openUrl, competitors }: { s: CnSection; labels: Record<string, string>; openUrl: string; competitors: Competitors | null }) {
  switch (s.kind) {
    case 'fields': {
      const entries = Object.entries(s.values).filter(([, v]) => v != null && v !== '')
      if (!entries.length) return null
      return (
        <section>
          {s.title && <Title>{s.title}</Title>}
          <dl className="divide-y divide-border/60">
            {entries.map(([k, v]) => {
              const shown = showValue(k, v)
              return (
                <div key={k} className="flex gap-3 py-1.5 text-[13px]">
                  <dt className="w-[45%] shrink-0 text-ink-muted">{labelFor(labels, s.table, k)}</dt>
                  <dd className="min-w-0 flex-1 break-words text-ink">
                    {shown.href ? <a href={shown.href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{shown.text}</a> : shown.text}
                  </dd>
                </div>
              )
            })}
          </dl>
        </section>
      )
    }
    case 'scorecard': {
      const top = Math.max(10, ...s.factors.map((f) => f.pts ?? 0))
      return (
        <section>
          <Title>{s.title ?? 'Scorecard'}</Title>
          <div className="mb-2 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular text-ink">{s.score != null ? s.score.toLocaleString(undefined, { maximumFractionDigits: 1 }) : '—'}</span>
            {s.max != null && <span className="text-sm text-ink-muted">of {s.max}</span>}
          </div>
          <ul className="space-y-1.5">
            {s.factors.map((f) => (
              <li key={f.id}>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-2 text-[12.5px]">
                    <span className="w-[42%] shrink-0 text-ink-muted">{labelFor({}, 'site_scores', f.id)}</span>
                    <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-content">
                      <span className="block h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, ((f.pts ?? 0) / top) * 100))}%` }} />
                    </span>
                    <span className="w-9 text-right tabular text-ink">{f.pts ?? '—'}</span>
                  </summary>
                  {f.basis && <p className="mt-1 pl-1 text-[11.5px] leading-relaxed text-ink-subtle">{f.basis}</p>}
                </details>
              </li>
            ))}
          </ul>
        </section>
      )
    }
    case 'table':
      return (
        <section>
          {s.title && <Title>{s.title}</Title>}
          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-[12px]">
              <thead className="bg-content text-left text-ink-muted">
                <tr>{s.columns.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">{labelFor({}, '', c)}</th>)}</tr>
              </thead>
              <tbody>
                {s.rows.map((r, i) => (
                  <tr key={i} className="border-t border-border/60">
                    {r.map((v, j) => {
                      const shown = showValue(s.columns[j], v)
                      return (
                        <td key={j} className="max-w-[16rem] px-2 py-1.5 align-top text-ink">
                          {shown.href ? <a href={shown.href} target="_blank" rel="noopener noreferrer" className="break-all text-accent hover:underline">{shown.text}</a> : shown.text}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )
    case 'series': {
      const xi = s.columns.indexOf(s.x)
      const bi = s.bars ? s.columns.indexOf(s.bars) : -1
      const li = s.line ? s.columns.indexOf(s.line) : -1
      const bars = s.rows.map((r) => Number(r[bi]) || 0)
      const line = s.rows.map((r) => (r[li] == null ? null : Number(r[li])))
      const bMax = Math.max(1, ...bars)
      const lv = line.filter((v): v is number => v != null)
      const lMin = lv.length ? Math.min(...lv) : 0
      const lMax = lv.length ? Math.max(...lv) : 1
      const W = 300, H = 90, n = s.rows.length, bw = W / Math.max(1, n)
      const ly = (v: number) => H - 6 - ((v - lMin) / Math.max(0.0001, lMax - lMin)) * (H - 16)
      const pts = line.map((v, i) => (v == null ? null : `${(i + 0.5) * bw},${ly(v)}`)).filter(Boolean).join(' ')
      return (
        <section>
          {s.title && <Title>{s.title}</Title>}
          <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" preserveAspectRatio="none" role="img" aria-label={s.title ?? 'Chart'}>
            {bars.map((b, i) => <rect key={i} x={i * bw + 1} width={Math.max(1, bw - 2)} y={H - (b / bMax) * (H - 10)} height={(b / bMax) * (H - 10)} className="fill-accent/30" />)}
            {pts && <polyline points={pts} fill="none" strokeWidth={1.5} className="stroke-accent" vectorEffect="non-scaling-stroke" />}
          </svg>
          <div className="mt-1 flex justify-between text-[10.5px] text-ink-subtle">
            <span>{String(s.rows[0]?.[xi] ?? '')}</span>
            <span>{s.bars && `bars: ${labelFor({}, '', s.bars)}`}{s.line && ` · line: ${labelFor({}, '', s.line)} ${lMin.toFixed(2)}–${lMax.toFixed(2)}`}</span>
            <span>{String(s.rows[n - 1]?.[xi] ?? '')}</span>
          </div>
        </section>
      )
    }
    case 'week': {
      const order = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
      const days = [...new Set(s.rows.map((r) => r[0]))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
      const max = Math.max(1, ...s.rows.map((r) => r[2] ?? 0))
      const at = new Map(s.rows.map((r) => [`${r[0]}|${r[1]}`, r[2]]))
      return (
        <section>
          {s.title && <Title>{s.title}</Title>}
          <div className="space-y-0.5">
            {days.map((d) => (
              <div key={d} className="flex items-center gap-1">
                <span className="w-8 shrink-0 text-[10.5px] text-ink-subtle">{d}</span>
                <div className="grid flex-1 gap-px" style={{ gridTemplateColumns: 'repeat(24, minmax(0, 1fr))' }}>
                  {Array.from({ length: 24 }, (_, h) => {
                    const v = at.get(`${d}|${h}`) ?? 0
                    return <span key={h} title={`${d} ${h}:00, ${Math.round(v).toLocaleString()} vehicles`} className="h-3 rounded-[2px] bg-accent" style={{ opacity: 0.08 + 0.92 * (v / max) }} />
                  })}
                </div>
              </div>
            ))}
            <div className="flex justify-between pl-9 text-[10px] text-ink-subtle"><span>12a</span><span>6a</span><span>12p</span><span>6p</span><span>11p</span></div>
          </div>
        </section>
      )
    }
    case 'timeline':
      return (
        <section>
          {s.title && <Title>{s.title}</Title>}
          <ol className="space-y-2.5">
            {s.rows.map((r, i) => (
              <li key={i} className="border-l-2 border-accent/40 pl-3 text-[12.5px]">
                <div className="text-[11px] text-ink-subtle">{String(r.date ?? '')}</div>
                {r.headline != null && <div className="font-medium text-ink">{String(r.headline).replace(/_/g, ' ')}</div>}
                {r.detail != null && <div className="text-ink-muted">{String(r.detail)}</div>}
                {typeof r.url === 'string' && /^https?:/.test(r.url) && (
                  <a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-[11.5px] text-accent hover:underline">
                    Source <ExternalLink className="size-3" />
                  </a>
                )}
              </li>
            ))}
          </ol>
        </section>
      )
    case 'empty':
      return s.title ? <section><Title>{s.title}</Title><p className="text-[12.5px] text-ink-subtle">Nothing on file.</p></section> : null
    case 'unsupported':
      if (s.view === 'competitors' && competitors) return <CompetitorList title={s.title} c={competitors} />
      return (
        <section>
          {s.title && <Title>{s.title}</Title>}
          <p className="text-[12.5px] text-ink-subtle">
            Shown on CoreNav's own map. <a href={openUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">Open in CoreNav</a>
          </p>
        </section>
      )
    case 'error':
      return <section>{s.title && <Title>{s.title}</Title>}<p className="text-[12.5px] text-danger">{s.message}</p></section>
  }
}
