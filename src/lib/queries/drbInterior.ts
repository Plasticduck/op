import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Interior/detail sales from the DRB (SiteWatch) sites: every item in the
// "Detail Services" and "Detail Extras" report categories, plus the specific MVP
// ARM plan items the owner counts as interior. Revenue is in dollars.
export type DrbSite = { site_number: number; name: string }
export type DrbInteriorItem = { name: string; category: string; count: number; qty: number; revenue: number }
export type DrbInteriorSite = { site_number: number; name: string; count: number; qty: number; revenue: number }
export type DrbInteriorReport = {
  items: DrbInteriorItem[]
  bySite: DrbInteriorSite[]
  total: { count: number; qty: number; revenue: number }
  truncated: boolean
}

export const drbInterior = {
  // Selectable DRB site numbers (recent, non-FlexWash, non-HQ), for the picker.
  sites: async (): Promise<DrbSite[]> => {
    const { data, error } = await supabase.functions.invoke('drb-interior', { body: { list: true } })
    if (error) throw new Error(await fnErrorMessage(error, data, 'DRB sites request failed.'))
    return ((data ?? {}) as { sites?: DrbSite[] }).sites ?? []
  },

  // Interior detail report. Pass site numbers to scope to specific DRB sites;
  // omit for the all-DRB rollup (which excludes FlexWash + HQ sites).
  report: async (start: string, end: string, siteNumbers?: number[]): Promise<DrbInteriorReport> => {
    const body: Record<string, unknown> = { start, end }
    if (siteNumbers && siteNumbers.length) body.sites = siteNumbers
    const { data, error } = await supabase.functions.invoke('drb-interior', { body })
    if (error) throw new Error(await fnErrorMessage(error, data, 'DRB interior request failed.'))
    const d = (data ?? {}) as Partial<DrbInteriorReport>
    return {
      items: d.items ?? [],
      bySite: d.bySite ?? [],
      total: d.total ?? { count: 0, qty: 0, revenue: 0 },
      truncated: !!d.truncated,
    }
  },
}
