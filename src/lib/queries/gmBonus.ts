import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type GmBonusBase = T['gm_bonus_base']['Row']
export type GmBonusMonth = T['gm_bonus_months']['Row']

// GM / AGM bonus persistence. One base snapshot per site, one input row per site
// per month. Amounts are not stored: they are derived from these rows in
// src/lib/gmBonus.ts so the formula lives in exactly one place.
export const gmBonus = {
  base: (locationId: string) =>
    supabase.from('gm_bonus_base').select('*').eq('location_id', locationId).maybeSingle(),
  upsertBase: (row: T['gm_bonus_base']['Insert']) =>
    supabase
      .from('gm_bonus_base')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'location_id' })
      .select()
      .single(),
  months: (locationId: string) =>
    supabase
      .from('gm_bonus_months')
      .select('*')
      .eq('location_id', locationId)
      .order('period', { ascending: false }),
  upsertMonth: (row: T['gm_bonus_months']['Insert']) =>
    supabase
      .from('gm_bonus_months')
      .upsert({ ...row, updated_at: new Date().toISOString() }, { onConflict: 'location_id,period' })
      .select()
      .single(),
}
