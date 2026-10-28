import { useEffect, useState } from 'react'
import { siteVisits, canonicalPeople, type SiteVisit } from '@/lib/queries/fleet'

// RM Site Reviews vehicle check: was the reviewer's vehicle (Verizon Connect)
// parked at the reviewed site around the time the review was submitted?
// Reviewers are linked to Reveal drivers through fleet_people.user_id (merged
// entries, such as their vehicle on days it had no driver, count too). A visit
// counts if it overlaps the 18 hours before submission (reviews are often
// written up after leaving) through 1 hour after. Pre-launch: kevan only.

const BEFORE_MS = 18 * 3600_000
const AFTER_MS = 3600_000

export type VehicleCheck =
  | { kind: 'at_site'; visit: SiteVisit }
  | { kind: 'not_found' }
  | { kind: 'untracked' } // reviewer has no vehicle in Verizon Connect
  | { kind: 'no_data' } // submitted before visit tracking began

type Review = { id: string; location_id: string | null; submitted_by: string | null; submitted_at: string }

export function useReviewVehicleChecks(rows: Review[], enabled: boolean): Map<string, VehicleCheck> {
  const [checks, setChecks] = useState<Map<string, VehicleCheck>>(new Map())

  useEffect(() => {
    if (!enabled || rows.length === 0) return
    let cancelled = false
    void (async () => {
      try {
        const { data: people, error } = await siteVisits.people()
        if (error) throw error
        // A reviewer's keys: their own plus any entries merged into them.
        const canon = canonicalPeople(people ?? [])
        const keysByUser = new Map<string, string[]>()
        for (const p of people ?? []) {
          const userId = canon.get(p.person_key)?.user_id
          if (!userId) continue
          keysByUser.set(userId, [...(keysByUser.get(userId) ?? []), p.person_key])
        }
        const earliest = rows.reduce((m, r) => (r.submitted_at < m ? r.submitted_at : m), rows[0].submitted_at)
        const since = new Date(Date.parse(earliest) - BEFORE_MS).toISOString()
        const [visits, firstArrival] = await Promise.all([
          siteVisits.forPeople([...new Set([...keysByUser.values()].flat())], since),
          siteVisits.firstArrival(),
        ])

        const out = new Map<string, VehicleCheck>()
        for (const r of rows) {
          const keys = r.submitted_by ? keysByUser.get(r.submitted_by) : undefined
          if (!keys?.length) { out.set(r.id, { kind: 'untracked' }); continue }
          if (!firstArrival || r.submitted_at < firstArrival) { out.set(r.id, { kind: 'no_data' }); continue }
          const sub = Date.parse(r.submitted_at)
          // visits are newest first: the first overlap is the latest arrival.
          const match = visits.find((v) =>
            keys.includes(v.person_key ?? '') &&
            v.location_id === r.location_id &&
            Date.parse(v.arrived_at) <= sub + AFTER_MS &&
            (v.departed_at ? Date.parse(v.departed_at) : Date.now()) >= sub - BEFORE_MS,
          )
          out.set(r.id, match ? { kind: 'at_site', visit: match } : { kind: 'not_found' })
        }
        if (!cancelled) setChecks(out)
      } catch {
        if (!cancelled) setChecks(new Map())
      }
    })()
    return () => { cancelled = true }
  }, [rows, enabled])

  return checks
}
