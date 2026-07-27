import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type Team = T['teams']['Row']
export type TeamMember = T['team_members']['Row']

// A team with its member user_ids attached (for the picker + counts).
export type TeamWithMembers = Team & { members: Array<{ user_id: string }> }

export const teams = {
  list: () =>
    supabase
      .from('teams')
      .select('*, members:team_members(user_id)')
      .eq('archived', false)
      .order('name'),

  create: (row: T['teams']['Insert']) =>
    supabase.from('teams').insert(row).select().single(),

  update: (id: string, patch: T['teams']['Update']) =>
    supabase.from('teams').update(patch).eq('id', id).select().single(),

  remove: (id: string) => supabase.from('teams').delete().eq('id', id),

  // Set-and-replace the team's members (mirrors workOrders.setAssignees).
  setMembers: async (teamId: string, userIds: string[]) => {
    await supabase.from('team_members').delete().eq('team_id', teamId)
    if (userIds.length > 0) {
      await supabase.from('team_members').insert(userIds.map((user_id) => ({ team_id: teamId, user_id })))
    }
  },
}
