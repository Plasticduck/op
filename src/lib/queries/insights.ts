import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type Insight = T['ai_insights']['Row']

export const insights = {
  active: () =>
    supabase
      .from('ai_insights')
      .select('*')
      .eq('acknowledged', false)
      .eq('archived', false)
      .order('generated_at', { ascending: false }),
  history: () =>
    supabase
      .from('ai_insights')
      .select('*')
      .or('acknowledged.eq.true,archived.eq.true')
      .order('generated_at', { ascending: false })
      .limit(100),
  acknowledge: (id: string, userId: string) =>
    supabase
      .from('ai_insights')
      .update({
        acknowledged: true,
        acknowledged_by: userId,
        acknowledged_at: new Date().toISOString(),
      })
      .eq('id', id),
  refresh: () => supabase.functions.invoke('generate-insights', { body: {} }),
}
