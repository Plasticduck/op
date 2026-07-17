import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type GmBonusBase = T['gm_bonus_base']['Row']
export type GmBonusMonth = T['gm_bonus_months']['Row']

// GM / AGM bonus persistence. Effective-dated baseline history per site (a reset
// takes effect the month after it is entered), one input row per site per month.
// Amounts are not stored: they are derived from these rows in src/lib/gmBonus.ts
// so the formula lives in exactly one place.
export const gmBonus = {
  // Account-wide (RLS scopes to the owner's account) so the page can drive both
  // a single site and the All Sites view from one fetch of each table.
  allBaselines: () =>
    supabase.from('gm_bonus_base').select('*').order('effective_from', { ascending: true }),
  allMonths: () =>
    supabase.from('gm_bonus_months').select('*').order('period', { ascending: false }),
  upsertBaseline: (row: T['gm_bonus_base']['Insert']) =>
    supabase
      .from('gm_bonus_base')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'location_id,kind,effective_from' })
      .select()
      .single(),
  upsertMonth: (row: T['gm_bonus_months']['Insert']) =>
    supabase
      .from('gm_bonus_months')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'location_id,period' })
      .select()
      .single(),
}
