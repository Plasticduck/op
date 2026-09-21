import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Interior/detail sales from the DRB (SiteWatch) sites: every item in the
// "Detail Services" and "Detail Extras" report categories, plus the specific MVP
// ARM plan items the owner counts as interior. Revenue is in dollars.
export type DrbInteriorItem = { name: string; category: string; count: number; qty: number; revenue: number }
export type DrbInteriorReport = {
  items: DrbInteriorItem[]
  total: { count: number; qty: number; revenue: number }
  truncated: boolean
}

export const drbInterior = {
  report: async (start: string, end: string): Promise<DrbInteriorReport> => {
    const { data, error } = await supabase.functions.invoke('drb-interior', { body: { start, end } })
    if (error) throw new Error(await fnErrorMessage(error, data, 'DRB interior request failed.'))
    const d = (data ?? {}) as Partial<DrbInteriorReport>
    return {
      items: d.items ?? [],
      total: d.total ?? { count: 0, qty: 0, revenue: 0 },
      truncated: !!d.truncated,
    }
  },
}
