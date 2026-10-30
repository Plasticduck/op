import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import type { ItAsset, ItAssetRow, ItStatusLabel } from '@/lib/queries/itInventory'
import { SITE_URL } from '@/lib/siteUrl'

export type Tone = 'ok' | 'accent' | 'neutral' | 'warn' | 'danger'

export const fmtDay = (day: string) => format(parseISO(day), 'MMM d, yyyy')
export const daysUntil = (day: string) => differenceInCalendarDays(parseISO(day), new Date())

// The sticker's QR link. Scanning it with any phone camera opens the asset (or
// the report-a-problem page when signed out).
export const tagUrl = (shortCode: string, tag: string) => `${SITE_URL}/t/${shortCode}/${encodeURIComponent(tag)}`

export function statusTone(s: Pick<ItStatusLabel, 'color'> | null | undefined): Tone {
  const c = s?.color
  return c === 'ok' || c === 'accent' || c === 'warn' || c === 'danger' ? c : 'neutral'
}

// Status, assignment and health are separate questions and get separate badges.
export function assignmentBadge(a: Pick<ItAsset, 'assigned_type' | 'assigned_label'>): { label: string; tone: Tone } {
  if (!a.assigned_type) return { label: 'Not checked out', tone: 'neutral' }
  return { label: `Checked out to ${a.assigned_label ?? 'someone'}`, tone: 'accent' }
}

export function healthBadge(state: string | null | undefined): { label: string; tone: Tone } {
  if (state === 'online') return { label: 'Online', tone: 'ok' }
  if (state === 'degraded') return { label: 'Degraded', tone: 'warn' }
  if (state === 'offline') return { label: 'Offline', tone: 'danger' }
  return { label: 'Health unknown', tone: 'neutral' }
}

export const WARRANTY_WINDOW_DAYS = 60

export function warrantyState(end: string | null): { label: string; tone: Tone; days: number | null } {
  if (!end) return { label: 'No warranty date', tone: 'neutral', days: null }
  const days = daysUntil(end)
  if (days < 0) return { label: 'Warranty expired', tone: 'danger', days }
  if (days <= WARRANTY_WINDOW_DAYS) return { label: `Warranty ends in ${days}d`, tone: 'warn', days }
  return { label: 'Under warranty', tone: 'ok', days }
}

// In the site print queue: never printed, or the sticker on it is faded or gone.
export function needsSticker(a: Pick<ItAssetRow, 'tag' | 'sticker_condition'>): boolean {
  return (a.tag?.printed_count ?? 0) === 0 || a.sticker_condition === 'faded' || a.sticker_condition === 'missing'
}

// aa:bb:cc:dd:ee:ff from any common way of writing a MAC, or null if it isn't one.
export function normalizeMac(input: string): string | null {
  const hex = input.trim().toLowerCase().replace(/[:\-.\s]/g, '')
  if (!/^[0-9a-f]{12}$/.test(hex)) return null
  return hex.replace(/(..)(?!$)/g, '$1:')
}

export function isIp(input: string): boolean {
  const v = input.trim()
  if (/^(\d{1,3})(\.\d{1,3}){3}$/.test(v)) return v.split('.').every((p) => Number(p) <= 255)
  return /^[0-9a-f:]+$/i.test(v) && v.includes(':') && v.split(':').length <= 8
}

// Postgres error text to something a site manager can act on.
export function friendlyError(message: string): string {
  if (/it_assets_serial_unq/.test(message)) return 'That serial number is already on another item.'
  if (/it_assets_mac_unq/.test(message)) return 'That MAC address is already on another item.'
  if (/invalid input syntax for type inet/.test(message)) return "That IP address doesn't look right."
  if (/invalid input syntax for type macaddr/.test(message)) return "That MAC address doesn't look right."
  if (/row-level security/.test(message)) return "You don't have access to make that change at this site."
  return message
}
