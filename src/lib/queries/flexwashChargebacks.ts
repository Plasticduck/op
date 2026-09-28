import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Chargebacks = failed/declined card charges (mostly membership rebills) for a
// FlexWash site, from the FlexWash API. Membership rebills carry the customer;
// walk-up single-wash declines do not. Card last-four is usually null on a decline.

export type CbSite = { car_wash_id: string; site_number: number; name: string }

export type Chargeback = {
  orderId: string
  at: string | null
  status: string | null
  type: string | null
  amountCents: number
  reason: string | null
  processor: string | null
  cardLastFour: string | null
  package: string | null
  customerId: string | null
  customer: string | null
  email: string | null
  site: string | null
  receipt: string | null
}
export type ChargebackReport = {
  range: { start: string; end: string }
  count: number
  totalCents: number
  byReason: Record<string, number>
  chargebacks: Chargeback[]
}

export type CustomerEvent = {
  type: string | null
  name: string | null
  at: string | null
  orderId: string | null
  totalCents: number | null
  text: string | null
  user: string | null
  items: string[]
}

export const flexwashChargebacks = {
  sites: async (): Promise<CbSite[]> => {
    const { data, error } = await supabase.functions.invoke('flexwash-chargebacks', { body: { mode: 'sites' } })
    if (error) throw new Error(await fnErrorMessage(error, data, 'Could not load FlexWash sites.'))
    return ((data ?? {}) as { sites?: CbSite[] }).sites ?? []
  },

  list: async (carWashId: string, start: string, end: string): Promise<ChargebackReport> => {
    const { data, error } = await supabase.functions.invoke('flexwash-chargebacks', {
      body: { mode: 'list', car_wash_id: carWashId, start, end },
    })
    if (error) throw new Error(await fnErrorMessage(error, data, 'Could not load chargebacks.'))
    const d = (data ?? {}) as Partial<ChargebackReport>
    return {
      range: d.range ?? { start, end },
      count: d.count ?? 0,
      totalCents: d.totalCents ?? 0,
      byReason: d.byReason ?? {},
      chargebacks: d.chargebacks ?? [],
    }
  },

  customer: async (customerId: string): Promise<{ timezone: string | null; events: CustomerEvent[] }> => {
    const { data, error } = await supabase.functions.invoke('flexwash-chargebacks', {
      body: { mode: 'customer', customer_id: customerId },
    })
    if (error) throw new Error(await fnErrorMessage(error, data, 'Could not load customer activity.'))
    const d = (data ?? {}) as { timezone?: string | null; events?: CustomerEvent[] }
    return { timezone: d.timezone ?? null, events: d.events ?? [] }
  },
}
