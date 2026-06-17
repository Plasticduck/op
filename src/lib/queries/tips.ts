import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type Tip = T['tips']['Row']

export const tips = {
  // All paid tips for one location on one local calendar day.
  forDay: (locationId: string, dayStartIso: string, dayEndIso: string) =>
    supabase
      .from('tips')
      .select('*')
      .eq('location_id', locationId)
      .eq('status', 'paid')
      .gte('tipped_at', dayStartIso)
      .lte('tipped_at', dayEndIso)
      .order('tipped_at'),

  // Time entries that STARTED on the day, with employee names, for the
  // hours-weighted disbursement split.
  hoursForDay: (locationId: string, dayStartIso: string, dayEndIso: string) =>
    supabase
      .from('time_entries')
      .select('id, employee_id, clock_in, clock_out, employee:employee_id(first_name, last_name)')
      .eq('location_id', locationId)
      .gte('clock_in', dayStartIso)
      .lte('clock_in', dayEndIso),
}

export type DisbursementRow = {
  employeeId: string
  name: string
  hours: number
  shareCents: number
}

// Hours-weighted split of the day's tip pool. Floors each share to whole
// cents, then hands the leftover cents (at most one per employee) to the
// largest fractional remainders so the rows always sum exactly to the pool.
export function computeDisbursements(
  poolCents: number,
  entries: Array<{ employee_id: string; clock_in: string; clock_out: string | null; employee: { first_name: string; last_name: string } | null }>,
): DisbursementRow[] {
  const byEmployee = new Map<string, { name: string; hours: number }>()
  for (const e of entries) {
    const end = e.clock_out ? new Date(e.clock_out).getTime() : Date.now()
    const hours = Math.max(0, (end - new Date(e.clock_in).getTime()) / 3600000)
    const name = e.employee ? `${e.employee.first_name} ${e.employee.last_name}`.trim() : 'Unknown'
    const cur = byEmployee.get(e.employee_id) ?? { name, hours: 0 }
    cur.hours += hours
    byEmployee.set(e.employee_id, cur)
  }
  const totalHours = [...byEmployee.values()].reduce((a, v) => a + v.hours, 0)
  if (totalHours === 0 || poolCents <= 0) {
    return [...byEmployee.entries()].map(([id, v]) => ({
      employeeId: id, name: v.name, hours: round2(v.hours), shareCents: 0,
    }))
  }
  const raw = [...byEmployee.entries()].map(([id, v]) => {
    const exact = (poolCents * v.hours) / totalHours
    return { employeeId: id, name: v.name, hours: v.hours, floor: Math.floor(exact), frac: exact - Math.floor(exact) }
  })
  let leftover = poolCents - raw.reduce((a, r) => a + r.floor, 0)
  // Largest remainders get the leftover cents.
  const order = [...raw].sort((a, b) => b.frac - a.frac)
  for (const r of order) {
    if (leftover <= 0) break
    r.floor += 1
    leftover -= 1
  }
  return raw
    .map((r) => ({ employeeId: r.employeeId, name: r.name, hours: round2(r.hours), shareCents: r.floor }))
    .sort((a, b) => b.shareCents - a.shareCents)
}

const round2 = (n: number) => Math.round(n * 100) / 100
