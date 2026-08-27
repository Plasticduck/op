import { supabase } from '@/lib/supabase'

// Site Scorecard: a single letter grade per location, computed live. No stored
// state, always recomputed. The grade is a weighted average over whatever
// factors have data, renormalized to 100, so a site with sparse data still gets
// a fair grade (and a dash instead of a grade when none of them have data).
//
// Grade factors (from the live Site Performance feed):
//   conversion  membership conversion %, higher is better
//   churn       voluntary churn %, lower is better
//   labor       labor %, lower is better
//   rating      Google rating, higher is better
//
// Additional performance/operational factors (throughput, work orders, asset
// health, checklists, parts stock) are intentionally left OUT of the grade for
// now and will be reintroduced later. Work-order / asset / parts counts are still
// computed as dashboard `signals`, just not folded into the grade.

export type ScorecardKey =
  | 'workOrders' | 'assets' | 'checklists' | 'parts'
  | 'conversion' | 'churn' | 'throughput' | 'labor' | 'rating'

export type ScorecardFactor = {
  key: ScorecardKey
  label: string
  score: number      // 0..100
  weight: number     // effective weight (%), renormalized across included factors
  detail: string     // one-line human explanation
}

export type SiteSignals = {
  openWorkOrders: number
  highPriority: number
  overdue: number
  equipmentDown: number
  lowStock: number
}

export type Scorecard = {
  total: number       // 0..100 weighted
  letter: string      // A+ .. F
  factors: ScorecardFactor[]
  signals: SiteSignals
}

// Benchmarks for scoring live metrics 0..100. Tune here to recalibrate grades.
export const BENCHMARKS = {
  conversion: { lo: 8, hi: 22 }, // %
  churn: { good: 5, bad: 15 }, // %
  throughput: { lo: 3, hi: 8 }, // cars / man-hour
  labor: { good: 25, bad: 45 }, // %
  rating: { lo: 3.5, hi: 4.8 }, // stars
}

export function letterFor(total: number): string {
  if (total >= 97) return 'A+'
  if (total >= 93) return 'A'
  if (total >= 90) return 'A-'
  if (total >= 87) return 'B+'
  if (total >= 83) return 'B'
  if (total >= 80) return 'B-'
  if (total >= 77) return 'C+'
  if (total >= 73) return 'C'
  if (total >= 70) return 'C-'
  if (total >= 67) return 'D+'
  if (total >= 63) return 'D'
  if (total >= 60) return 'D-'
  return 'F'
}

const clamp = (n: number) => Math.max(0, Math.min(100, n))
// Higher value -> higher score.
const mapUp = (v: number, lo: number, hi: number) => clamp(((v - lo) / (hi - lo)) * 100)
// Lower value -> higher score.
const mapDown = (v: number, good: number, bad: number) => clamp(((bad - v) / (bad - good)) * 100)

// Live performance metrics for one site, sourced from the Site Performance feed.
export type SitePerformanceInput = {
  carsPerHour?: number | null
  laborPct?: number | null
  conversion?: number | null
  churn?: number | null
  googleRating?: number | null
}

export type ScorecardInput = {
  workOrders: { status: string | null; priority: string | null; due_at: string | null; created_at: string }[]
  equipment: { status: string | null }[]
  checklistCompletions: { completed_at: string }[]
  parts: { quantity_on_hand: number | string | null; minimum_in_stock: number | string | null }[]
  performance?: SitePerformanceInput
  now?: Date
}

type Candidate = ScorecardFactor & { rawWeight: number; include: boolean }

// Pure scoring, no I/O. Factors without data are excluded, and the remaining
// weights are renormalized to 100 so the total stays comparable.
export function scoreFrom(input: ScorecardInput): Scorecard {
  const now = input.now ?? new Date()

  // Operational signals surfaced on the dashboard (chips + counts). These are NOT
  // part of the grade for now, but still shown alongside it.
  const wos = input.workOrders
  const openHigh = wos.filter((w) => w.priority === 'high').length
  const overdue = wos.filter((w) => w.due_at && new Date(w.due_at) < now).length
  const equipmentDown = input.equipment.filter((a) => a.status === 'down').length
  const stock = input.parts
  const okStock = stock.filter((s) => Number(s.quantity_on_hand) >= Number(s.minimum_in_stock ?? 0)).length
  const lowStock = stock.length - okStock

  const p = input.performance ?? {}
  const has = (v: number | null | undefined): v is number => v != null && Number.isFinite(v)

  // The grade is a weighted average of the performance metrics that have data:
  // Conversion, Churn, Labor %, and Google Rating. (More factors to come later.)
  const candidates: Candidate[] = [
    {
      key: 'conversion', label: 'Conversion', score: has(p.conversion) ? mapUp(p.conversion, BENCHMARKS.conversion.lo, BENCHMARKS.conversion.hi) : 0,
      rawWeight: 18, include: has(p.conversion), weight: 0,
      detail: has(p.conversion) ? `Conversion ${p.conversion}%` : 'No conversion data',
    },
    {
      key: 'churn', label: 'Churn', score: has(p.churn) ? mapDown(p.churn, BENCHMARKS.churn.good, BENCHMARKS.churn.bad) : 0,
      rawWeight: 14, include: has(p.churn), weight: 0,
      detail: has(p.churn) ? `Churn ${p.churn}%` : 'No churn data',
    },
    {
      key: 'labor', label: 'Labor Efficiency', score: has(p.laborPct) ? mapDown(p.laborPct, BENCHMARKS.labor.good, BENCHMARKS.labor.bad) : 0,
      rawWeight: 8, include: has(p.laborPct), weight: 0,
      detail: has(p.laborPct) ? `Labor ${p.laborPct}% of sales` : 'No labor data',
    },
    {
      key: 'rating', label: 'Google Rating', score: has(p.googleRating) ? mapUp(p.googleRating, BENCHMARKS.rating.lo, BENCHMARKS.rating.hi) : 0,
      rawWeight: 8, include: has(p.googleRating), weight: 0,
      detail: has(p.googleRating) ? `${p.googleRating.toFixed(1)} stars` : 'No rating yet',
    },
  ]

  const included = candidates.filter((c) => c.include)
  const wsum = included.reduce((a, c) => a + c.rawWeight, 0) || 1
  const factors: ScorecardFactor[] = included.map((c) => ({
    key: c.key, label: c.label, score: c.score, detail: c.detail, weight: Math.round((c.rawWeight / wsum) * 100),
  }))
  const total = included.length ? Math.round(included.reduce((a, c) => a + c.score * (c.rawWeight / wsum), 0)) : 0

  return {
    total,
    // No gradeable data yet -> a dash rather than a misleading F.
    letter: included.length ? letterFor(total) : '—',
    factors,
    signals: { openWorkOrders: wos.length, highPriority: openHigh, overdue, equipmentDown, lowStock },
  }
}

// Live per-site scorecard. Pass live performance metrics to fold them in.
export async function computeScorecard(
  locationId: string,
  performance?: SitePerformanceInput,
): Promise<Scorecard> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [woRes, assetRes, checklistRes, partsRes] = await Promise.all([
    supabase
      .from('work_orders')
      .select('id, status, priority, due_at, created_at')
      .eq('location_id', locationId)
      .not('status', 'in', '("done","skipped")'),
    supabase.from('equipment').select('id, status').eq('location_id', locationId),
    supabase
      .from('checklist_completions')
      .select('completed_at')
      .eq('location_id', locationId)
      .gte('completed_at', sevenDaysAgo),
    supabase
      .from('parts_inventory')
      .select('quantity_on_hand, minimum_in_stock')
      .eq('location_id', locationId),
  ])

  return scoreFrom({
    now,
    workOrders: woRes.data ?? [],
    equipment: assetRes.data ?? [],
    checklistCompletions: (checklistRes.data ?? []) as { completed_at: string }[],
    parts: partsRes.data ?? [],
    performance,
  })
}

// Batched multi-site scorecards: fetch account-wide once and score each. Pass a
// per-location performance map to fold live metrics into each site's grade.
export async function computeScorecards(
  locationIds: string[],
  perfByLocation?: Record<string, SitePerformanceInput>,
): Promise<Record<string, Scorecard>> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
  const wanted = new Set(locationIds)

  const [woRes, assetRes, checklistRes, partsRes] = await Promise.all([
    supabase
      .from('work_orders')
      .select('location_id, status, priority, due_at, created_at')
      .not('status', 'in', '("done","skipped")'),
    supabase.from('equipment').select('location_id, status'),
    supabase
      .from('checklist_completions')
      .select('location_id, completed_at')
      .gte('completed_at', sevenDaysAgo),
    supabase.from('parts_inventory').select('location_id, quantity_on_hand, minimum_in_stock'),
  ])

  const bucket = <T extends { location_id: string | null }>(rows: T[] | null) => {
    const m = new Map<string, T[]>()
    for (const r of rows ?? []) {
      if (!r.location_id || !wanted.has(r.location_id)) continue
      const arr = m.get(r.location_id)
      if (arr) arr.push(r)
      else m.set(r.location_id, [r])
    }
    return m
  }

  const wo = bucket(woRes.data as ({ location_id: string | null } & ScorecardInput['workOrders'][number])[] | null)
  const eq = bucket(assetRes.data as ({ location_id: string | null } & { status: string | null })[] | null)
  const cl = bucket(checklistRes.data as ({ location_id: string | null } & { completed_at: string })[] | null)
  const pt = bucket(partsRes.data as ({ location_id: string | null } & ScorecardInput['parts'][number])[] | null)

  const out: Record<string, Scorecard> = {}
  for (const id of locationIds) {
    out[id] = scoreFrom({
      now,
      workOrders: wo.get(id) ?? [],
      equipment: eq.get(id) ?? [],
      checklistCompletions: cl.get(id) ?? [],
      parts: pt.get(id) ?? [],
      performance: perfByLocation?.[id],
    })
  }
  return out
}
