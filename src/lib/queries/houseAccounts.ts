import { supabase } from '@/lib/supabase'

// House Account activity for MW19 (DRB Lube). The drb-house-accounts edge function
// returns per-account charge revenue for a period vs. the preceding equal period,
// with % change and new/lapsed flags. Credentials live server-side (MW mgr+ gated).

export type HouseAccount = {
  customerId: string
  name: string
  company: string
  companyKey: string
  phone: string | null
  revenue: number
  priorRevenue: number
  visits: number
  priorVisits: number
  avgTicket: number
  lastVisit: string | null
  pctChange: number | null // null = new account (no prior revenue)
  isNew: boolean
  isLapsed: boolean
}

export type HouseAccountsResult = {
  ok: boolean
  site: number
  siteLabel: string
  range: { start: string; end: string }
  priorRange: { start: string; end: string }
  summary: {
    totalRevenue: number
    priorTotalRevenue: number
    revenuePctChange: number | null
    activeAccounts: number
    priorActiveAccounts: number
    totalVisits: number
    priorTotalVisits: number
    avgTicket: number
    newAccounts: number
    lapsedAccounts: number
  }
  accounts: HouseAccount[]
  truncated: boolean
  note?: string
  error?: string
  message?: string
}

export const houseAccounts = (start: string, end: string) =>
  supabase.functions.invoke<HouseAccountsResult>('drb-house-accounts', { body: { start, end } })
