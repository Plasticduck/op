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

export async function fetchSiteWorkOrders(locationId: string): Promise<SiteWorkOrders> {
  const { data, error } = await supabase.functions.invoke('site-work-orders', { body: { location_id: locationId } })
  if (error || !data?.workOrders) throw new Error(await fnErrorMessage(error, data, 'Could not load work orders from MaintainX'))
  return data as SiteWorkOrders
}
