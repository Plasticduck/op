import { supabase } from '@/lib/supabase'

// Site Scorecard: a single letter grade per location, computed live from five
// operational factors. No stored state — every load recomputes from the same
// tables the rest of the app uses, so the grade always matches reality.
//
// Factors and weights (sum 100):
//   workOrders  25  — penalty for open high-priority WOs and overdue WOs
//   assets      25  — % of non-retired assets currently online
//   checklists  20  — days in the last 7 with at least one checklist completion
//   closeouts   15  — days in the last 7 with a submitted closeout
//   parts       15  — % of stocked parts at or above their minimum

export type ScorecardFactor = {
  key: 'workOrders' | 'assets' | 'checklists' | 'closeouts' | 'parts'
  label: string
  score: number      // 0..100
  weight: number     // contribution weight, sums to 100 across factors
  detail: string     // one-line human explanation
}

// Raw priority signals for a site (surfaced on the multi-site dashboard).
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

// The rows a single site's scorecard is computed from. Used both by the live
// per-site fetch below and by the batched multi-site dashboard (which fetches
// account-wide once and groups by location_id).
export type ScorecardInput = {
  workOrders: { status: string | null; priority: string | null; due_at: string | null; created_at: string }[]
  equipment: { status: string | null }[]
  checklistCompletions: { completed_at: string }[]
  closeouts: { date: string }[]
  parts: { quantity_on_hand: number | string | null; minimum_in_stock: number | string | null }[]
  now?: Date
}

// Pure scoring — no I/O. Given a site's rows, produce its grade + signals.
export function scoreFrom(input: ScorecardInput): Scorecard {
  const now = input.now ?? new Date()

  // -- Work orders: start from 100, deduct per problem ------------------------
  const wos = input.workOrders
  const openHigh = wos.filter((w) => w.priority === 'high').length
  const overdue = wos.filter((w) => w.due_at && new Date(w.due_at) < now).length
  const stale = wos.filter((w) => new Date(w.created_at) < new Date(now.getTime() - 14 * 86400000)).length
  const woScore = clamp(100 - openHigh * 15 - overdue * 10 - stale * 5)

  // -- Assets: share of non-retired assets that are online --------------------
  const assetsAll = input.equipment
  const assets = assetsAll.filter((a) => a.status !== 'retired')
  const online = assets.filter((a) => a.status === 'online').length
  const equipmentDown = assetsAll.filter((a) => a.status === 'down').length
  const assetScore = assets.length === 0 ? 100 : clamp((online / assets.length) * 100)

  // -- Checklists: distinct days with a completion in the last 7 --------------
  const checklistDays = new Set(input.checklistCompletions.map((c) => c.completed_at.slice(0, 10)))
  const checklistScore = clamp((checklistDays.size / 7) * 100)

  // -- Closeouts: distinct days with a closeout in the last 7 -----------------
  const closeoutDays = new Set(input.closeouts.map((c) => c.date))
  const closeoutScore = clamp((closeoutDays.size / 7) * 100)

  // -- Parts: share of stock rows at/above minimum ----------------------------
  const stock = input.parts
  const okStock = stock.filter((s) => Number(s.quantity_on_hand) >= Number(s.minimum_in_stock ?? 0)).length
  const lowStock = stock.length - okStock
  const partsScore = stock.length === 0 ? 100 : clamp((okStock / stock.length) * 100)

  const factors: ScorecardFactor[] = [
    {
      key: 'workOrders', label: 'Work Orders', score: woScore, weight: 25,
      detail: wos.length === 0 ? 'No open work orders'
        : `${wos.length} open${openHigh ? `, ${openHigh} high-priority` : ''}${overdue ? `, ${overdue} overdue` : ''}`,
    },
    {
      key: 'assets', label: 'Asset Health', score: assetScore, weight: 25,
      detail: assets.length === 0 ? 'No assets tracked yet' : `${online} of ${assets.length} assets online`,
    },
    {
      key: 'checklists', label: 'Checklists', score: checklistScore, weight: 20,
      detail: `Completed on ${checklistDays.size} of the last 7 days`,
    },
    {
      key: 'closeouts', label: 'Closeouts', score: closeoutScore, weight: 15,
      detail: `Submitted on ${closeoutDays.size} of the last 7 days`,
    },
    {
      key: 'parts', label: 'Parts Stock', score: partsScore, weight: 15,
      detail: stock.length === 0 ? 'No parts tracked yet' : `${okStock} of ${stock.length} parts at or above minimum`,
    },
  ]

  const total = Math.round(factors.reduce((a, f) => a + (f.score * f.weight) / 100, 0))
  return {
    total,
    letter: letterFor(total),
    factors,
    signals: {
      openWorkOrders: wos.length,
      highPriority: openHigh,
      overdue,
      equipmentDown,
      lowStock,
    },
  }
}

// Live per-site scorecard: fetch this location's rows, then score them.
export async function computeScorecard(locationId: string): Promise<Scorecard> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [woRes, assetRes, checklistRes, closeoutRes, partsRes] = await Promise.all([
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
      .from('closeouts')
      .select('date')
      .eq('location_id', locationId)
      .gte('date', sevenDaysAgo.slice(0, 10)),
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
    closeouts: (closeoutRes.data ?? []) as { date: string }[],
    parts: partsRes.data ?? [],
  })
}

// Batched multi-site scorecards: fetch account-wide once, group by location,
// and score each. Returns a map keyed by location id. Far cheaper than calling
// computeScorecard per site (5 queries total instead of 5 x N).
export async function computeScorecards(
  locationIds: string[],
): Promise<Record<string, Scorecard>> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()
  const wanted = new Set(locationIds)

  const [woRes, assetRes, checklistRes, closeoutRes, partsRes] = await Promise.all([
    supabase
      .from('work_orders')
      .select('location_id, status, priority, due_at, created_at')
      .not('status', 'in', '("done","skipped")'),
    supabase.from('equipment').select('location_id, status'),
    supabase
      .from('checklist_completions')
      .select('location_id, completed_at')
      .gte('completed_at', sevenDaysAgo),
    supabase.from('closeouts').select('location_id, date').gte('date', sevenDaysAgo.slice(0, 10)),
    supabase.from('parts_inventory').select('location_id, quantity_on_hand, minimum_in_stock'),
  ])

  // Group each result set by location id.
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
  const co = bucket(closeoutRes.data as ({ location_id: string | null } & { date: string })[] | null)
  const pt = bucket(partsRes.data as ({ location_id: string | null } & ScorecardInput['parts'][number])[] | null)

  const out: Record<string, Scorecard> = {}
  for (const id of locationIds) {
    out[id] = scoreFrom({
      now,
      workOrders: wo.get(id) ?? [],
      equipment: eq.get(id) ?? [],
      checklistCompletions: cl.get(id) ?? [],
      closeouts: co.get(id) ?? [],
      parts: pt.get(id) ?? [],
    })
  }
  return out
}
