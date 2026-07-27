import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type PmPlan = T['pm_plans']['Row']

export type PmPlanRow = PmPlan & {
  equipment: { id: string; name: string } | null
  location: { id: string; name: string } | null
  procedure: { id: string; name: string } | null
  team: { id: string; name: string } | null
}

export const FREQ_UNITS: Array<{ value: 'days' | 'weeks' | 'months'; label: string }> = [
  { value: 'days', label: 'day(s)' },
  { value: 'weeks', label: 'week(s)' },
  { value: 'months', label: 'month(s)' },
]

export const pm = {
  list: () =>
    supabase
      .from('pm_plans')
      .select('*, equipment:equipment(id, name), location:locations(id, name), procedure:procedure_templates(id, name), team:teams(id, name)')
      .order('next_due_date'),

  create: (row: T['pm_plans']['Insert']) =>
    supabase.from('pm_plans').insert(row).select().single(),

  update: (id: string, patch: T['pm_plans']['Update']) =>
    supabase.from('pm_plans').update(patch).eq('id', id).select().single(),

  remove: (id: string) => supabase.from('pm_plans').delete().eq('id', id),

  // Force-create one work order from the plan now (does not shift the schedule).
  generateNow: (id: string) => supabase.rpc('generate_pm_plan', { p_plan_id: id }),
}
