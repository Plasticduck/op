import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Event Pay Requests: pay for team members who work an event (the Mighty Maxx
// mascot at a flat amount, everyone else at their hourly rate for the time
// present). RLS: each user sees only the requests they submitted; only
// kevan@washlyfe.com and tayler@mighty-wash.com see every request (0175/0176).
type T = Database['public']['Tables']
export type EventPayRequest = T['event_pay_requests']['Row']
export type EventPayInsert = T['event_pay_requests']['Insert']
// Hydrated row used by the list and the PDF: includes the site name.
export type EventPayRow = EventPayRequest & { location: { name: string } | null }

// One team member on a request (stored in the jsonb `attendees` column).
// arrival/departure are 24-hour "HH:mm"; amount is set only for Mighty Maxx.
export type EventAttendee = {
  name: string
  arrival: string
  departure: string
  hours: number
  mighty_maxx: boolean
  amount: number | null
}

// The usual Mighty Maxx flat amount for an event up to 2 to 3 hours.
export const MIGHTY_MAXX_DEFAULT = 50

// Hours between two "HH:mm" times, rounded to 0.01. A departure earlier than the
// arrival is taken to be after midnight.
export function hoursBetween(arrival: string, departure: string): number {
  const toMin = (t: string) => {
    const m = t.match(/^(\d{1,2}):(\d{2})/)
    return m ? Number(m[1]) * 60 + Number(m[2]) : null
  }
  const a = toMin(arrival)
  const d = toMin(departure)
  if (a == null || d == null) return 0
  const mins = d >= a ? d - a : d + 24 * 60 - a
  return Math.round((mins / 60) * 100) / 100
}

// "14:05" -> "2:05 PM".
export function fmtTime(t: string): string {
  const m = t.match(/^(\d{1,2}):(\d{2})/)
  if (!m) return t
  const h = Number(m[1])
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`
}

export function attendeesOf(r: Pick<EventPayRequest, 'attendees'>): EventAttendee[] {
  return Array.isArray(r.attendees) ? (r.attendees as unknown as EventAttendee[]) : []
}

export const eventPay = {
  list: () =>
    supabase
      .from('event_pay_requests')
      .select('*, location:location_id(name)')
      .order('created_at', { ascending: false }),
  create: (row: EventPayInsert) =>
    supabase.from('event_pay_requests').insert(row).select('*, location:location_id(name)').single(),
  // kevan@washlyfe.com only (RLS).
  remove: (id: string) => supabase.from('event_pay_requests').delete().eq('id', id),
  // Email the request (with its PDF attached) to Tayler. Best-effort: the row
  // is already saved; emailed_at is stamped on success.
  email: (requestId: string, pdfBase64: string | null) =>
    supabase.functions.invoke('event-pay-request-email', { body: { request_id: requestId, pdf_base64: pdfBase64 } }),
}
