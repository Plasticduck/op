import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// A site's work orders still open in MaintainX, read live through the
// site-work-orders function (Mighty Wash only).

export type MxPriority = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
export type MxStatus = 'OPEN' | 'IN_PROGRESS' | 'ON_HOLD'

export type MxWorkOrder = {
  id: number
  number: number | null
  title: string
  status: MxStatus
  priority: MxPriority
  type: string | null
  createdAt: string | null
  dueDate: string | null
  asset: string | null
  location: string | null
  assignees: string[]
  categories: string[]
}

export type SiteWorkOrders = {
  site: string
  // False when the site has no location in MaintainX.
  matched: boolean
  locations: string[]
  workOrders: MxWorkOrder[]
  fetchedAt: string
}

// The list saved on a submitted audit (site_audits_v2.work_orders): the same
// shape, or { error } when MaintainX couldn't be reached at the time.
export type SavedWorkOrders = SiteWorkOrders | { error: string; site?: string; fetchedAt?: string }

export function savedWorkOrders(raw: unknown): SavedWorkOrders | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.error === 'string') return r as SavedWorkOrders
  return Array.isArray(r.workOrders) ? (r as unknown as SiteWorkOrders) : null
}

// A due date at exactly midnight UTC is a whole day, so it's read as that calendar
// date (in Central it would show the day before); any other time is a moment.
export function dueDay(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00:00(?:\.0+)?Z)?$/)
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59) : new Date(iso)
}

export async function fetchSiteWorkOrders(locationId: string): Promise<SiteWorkOrders> {
  const { data, error } = await supabase.functions.invoke('site-work-orders', { body: { location_id: locationId } })
  if (error || !data?.workOrders) throw new Error(await fnErrorMessage(error, data, 'Could not load work orders from MaintainX'))
  return data as SiteWorkOrders
}
