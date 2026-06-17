import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type SavedReport = T['saved_reports']['Row']

export const savedReports = {
  list: () =>
    supabase.from('saved_reports').select('*').order('created_at', { ascending: false }),
  create: (row: T['saved_reports']['Insert']) =>
    supabase.from('saved_reports').insert(row).select().single(),
  remove: (id: string) => supabase.from('saved_reports').delete().eq('id', id),
}
