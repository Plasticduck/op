import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'
import type { DrbSite } from '@/lib/queries/drbInterior'

// Sale-level MSA conversion audit for DRB (SiteWatch) sites. Lets the MSA
// Performance conversion % (sourced from the external dashboard) be checked
// against raw sales: memberships sold and eligible washes per associate, with the
// underlying transactions and why each membership sale did or didn't count.

export type MsaAuditRow = {
  employeeId: string
  name: string
  kiosk: boolean
  eligibleWashes: number
  soldRaw: number
  soldNet: number
  excludedPlanChange: number
  excludedReactivation: number
  conversionPct: number | null
}
export type MsaAuditSale = {
  code: string
  day: string
  customer: string | null
  employeeId: string
  employee: string
  kiosk: boolean
  items: string[]
  excluded: 'plan_change' | 'reactivation_90d' | null
}
export type MsaAuditReport = {
  site: number
  siteLabel: string
  range: { start: string; end: string }
  rows: MsaAuditRow[]
  detail: MsaAuditSale[]
  rules: { attribution: string; soldExclusions: string; eligibleWash: string }
  diag: { soldSales: number; excludedPlanChange: number; excludedReactivation: number }
}

export const drbMsaAudit = {
  // Selectable DRB site numbers (recent, non-FlexWash, non-HQ), for the picker.
  sites: async (): Promise<DrbSite[]> => {
    const { data, error } = await supabase.functions.invoke('drb-msa-audit', { body: { list: true } })
    if (error) throw new Error(await fnErrorMessage(error, data, 'DRB sites request failed.'))
    return ((data ?? {}) as { sites?: DrbSite[] }).sites ?? []
  },

  report: async (site: number, start: string, end: string): Promise<MsaAuditReport> => {
    const { data, error } = await supabase.functions.invoke('drb-msa-audit', { body: { site, start, end } })
    if (error) throw new Error(await fnErrorMessage(error, data, 'MSA audit request failed.'))
    const d = (data ?? {}) as Partial<MsaAuditReport>
    return {
      site: d.site ?? site,
      siteLabel: d.siteLabel ?? `Site ${site}`,
      range: d.range ?? { start, end },
      rows: d.rows ?? [],
      detail: d.detail ?? [],
      rules: d.rules ?? { attribution: '', soldExclusions: '', eligibleWash: '' },
      diag: d.diag ?? { soldSales: 0, excludedPlanChange: 0, excludedReactivation: 0 },
    }
  },
}
