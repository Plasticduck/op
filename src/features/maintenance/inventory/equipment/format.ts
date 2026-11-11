import { differenceInCalendarDays, parseISO } from 'date-fns'
import type { EquipmentRow, EquipmentStatus, Usage, UsageBasis } from '@/lib/queries/miEquipment'
import type { Tone } from '../format'

export const EQUIPMENT_BASE = '/app/maintenance-inventory/equipment'

export const STATUS: Record<EquipmentStatus, { label: string; tone: Tone; short: string }> = {
  online: { label: 'Running', tone: 'ok', short: 'Running' },
  offline_planned: { label: 'Down for maintenance', tone: 'warn', short: 'Planned down' },
  offline_unplanned: { label: 'Broken down', tone: 'danger', short: 'Broken down' },
  retired: { label: 'Retired', tone: 'neutral', short: 'Retired' },
}

export const CRIT: Record<'A' | 'B' | 'C', { label: string; tone: Tone }> = {
  A: { label: 'A: stops the site', tone: 'danger' },
  B: { label: 'B: slows it down', tone: 'warn' },
  C: { label: 'C: can wait', tone: 'neutral' },
}

export const USAGE_BASIS: Record<UsageBasis, string> = {
  all_cars: 'Every car through the tunnel',
  packages: 'Only some wash packages (counted as every car for now)',
  none: "Not counted (it doesn't run per car)",
}

// MaintainX named every machine "#02 - Top Brush 1". On screens that already show the
// site, the number in front is noise.
export function shortName(name: string): string {
  return name.replace(/^#?\s*\d+\s*[-:]\s*/, '') || name
}

export const cars = (n: number | null | undefined): string =>
  n == null ? '-' : Math.round(Number(n)).toLocaleString('en-US')

// "48,210 cars since Aug 2" or why there isn't a number.
export function usageHeadline(u: Usage | null | undefined): { value: string; sub: string } {
  if (!u) return { value: '-', sub: '' }
  if (u.state === 'not_counted') return { value: 'Not counted', sub: "This machine doesn't run per car." }
  if (u.state === 'no_site_number') return { value: '-', sub: "This site's name has no number, so its car counts can't be matched." }
  if (u.state === 'no_data') return { value: '-', sub: 'No daily car counts for this site yet.' }
  if (u.cars_since == null || !u.since) return { value: cars(u.cars_30d), sub: 'cars in the last 30 days. Set an install date or mark it Replaced to start a running count.' }
  return { value: cars(u.cars_since), sub: `cars since it was ${u.since_source === 'reset' ? 'replaced' : 'installed'}` }
}

export const daysSince = (iso: string | null | undefined): number | null =>
  iso ? differenceInCalendarDays(new Date(), parseISO(iso)) : null

export const isMachine = (r: Pick<EquipmentRow, 'parent_id'>) => !r.parent_id

// A machine (not a component) with no sticker, one never printed, or one marked faded,
// missing or damaged.
export const needsSticker = (r: EquipmentRow) =>
  r.status !== 'retired' && isMachine(r) && (!r.tag || !r.tag_printed || (!!r.tag_condition && r.tag_condition !== 'ok'))

export const TAG_CONDITION: Record<'ok' | 'faded' | 'missing' | 'damaged', { label: string; tone: Tone }> = {
  ok: { label: 'Readable', tone: 'ok' },
  faded: { label: 'Faded', tone: 'warn' },
  missing: { label: 'Missing', tone: 'danger' },
  damaged: { label: 'Damaged', tone: 'danger' },
}

export function warrantyState(iso: string | null | undefined): { label: string; tone: Tone } | null {
  if (!iso) return null
  const d = differenceInCalendarDays(parseISO(iso), new Date())
  if (d < 0) return { label: 'Warranty ended', tone: 'neutral' }
  if (d <= 60) return { label: `Warranty ends in ${d} day${d === 1 ? '' : 's'}`, tone: 'warn' }
  return { label: 'Under warranty', tone: 'ok' }
}
