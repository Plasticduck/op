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

export type Scorecard = {
  total: number       // 0..100 weighted
  letter: string      // A+ .. F
  factors: ScorecardFactor[]
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

export async function computeScorecard(locationId: string): Promise<Scorecard> {
  const now = new Date()
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000).toISOString()

  const [woRes, assetRes, checklistRes, closeoutRes, partsRes] = await Promise.all([
    supabase
      .from('work_orders')
      .select('id, status, priority, due_at, created_at')
      .eq('location_id', locationId)
      .not('status', 'in', '("done","skipped")'),
    supabase
      .from('equipment')
      .select('id, status')
      .eq('location_id', locationId),
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

  // -- Work orders: start from 100, deduct per problem ------------------------
  const wos = woRes.data ?? []
  const openHigh = wos.filter((w) => w.priority === 'high').length
  const overdue = wos.filter((w) => w.due_at && new Date(w.due_at) < now).length
  const stale = wos.filter((w) => new Date(w.created_at) < new Date(now.getTime() - 14 * 86400000)).length
  const woScore = clamp(100 - openHigh * 15 - overdue * 10 - stale * 5)

  // -- Assets: share of non-retired assets that are online --------------------
  const assets = (assetRes.data ?? []).filter((a) => a.status !== 'retired')
  const online = assets.filter((a) => a.status === 'online').length
  const assetScore = assets.length === 0 ? 100 : clamp((online / assets.length) * 100)

  // -- Checklists: distinct days with a completion in the last 7 --------------
  const checklistDays = new Set((checklistRes.data ?? []).map((c) => (c.completed_at as string).slice(0, 10)))
  const checklistScore = clamp((checklistDays.size / 7) * 100)

  // -- Closeouts: distinct days with a closeout in the last 7 -----------------
  const closeoutDays = new Set((closeoutRes.data ?? []).map((c) => c.date as string))
  const closeoutScore = clamp((closeoutDays.size / 7) * 100)

  // -- Parts: share of stock rows at/above minimum ----------------------------
  const stock = partsRes.data ?? []
  const okStock = stock.filter((s) => Number(s.quantity_on_hand) >= Number(s.minimum_in_stock ?? 0)).length
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
  return { total, letter: letterFor(total), factors }
}
