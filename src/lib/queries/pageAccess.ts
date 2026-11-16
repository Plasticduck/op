import { supabase } from '@/lib/supabase'
import type { PermRole } from '@/lib/rbac'

// Page grants and blocks set by the super admin (migration 0241). RLS returns a
// person's own rows and their role's rows; the super admin gets the account's.
export type PageAccessRow = {
  id: string
  user_id: string | null
  perm_role: PermRole | null
  page: string
  allowed: boolean
  updated_at: string
}

// allowed: null removes the row, so the page goes back to its usual rule.
export type PageAccessChange = { user_id?: string; perm_role?: PermRole; page: string; allowed: boolean | null }

export const pageAccess = {
  list: async (): Promise<PageAccessRow[]> => {
    const { data, error } = await supabase.from('page_access').select('id, user_id, perm_role, page, allowed, updated_at')
    if (error) throw error
    return (data ?? []) as PageAccessRow[]
  },
  save: async (changes: PageAccessChange[]): Promise<void> => {
    if (!changes.length) return
    const { error } = await supabase.rpc('page_access_save', { p_changes: changes })
    if (error) throw error
  },
}
