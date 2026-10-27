import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Quarterly Goal Tracker: executive goals per quarter, with milestones and
// check-ins. Goals belong to a person by name (one admin enters everything).
// RLS: account owners only.
type T = Database['public']['Tables']
export type ExecGoal = T['exec_goals']['Row']
export type ExecGoalInsert = T['exec_goals']['Insert']
export type ExecGoalMilestone = T['exec_goal_milestones']['Row']
export type ExecGoalCheckin = T['exec_goal_checkins']['Row']
export type GoalWithDetail = ExecGoal & { milestones: ExecGoalMilestone[]; checkins: ExecGoalCheckin[] }

// The executives who set goals, in display order.
export const GOAL_EXECS = [
  'Kevin Spiller',
  'Kelly Spiller',
  'Kevan Jowers',
  'Laramie Keith',
  'Justin Gamboa',
  'Jay Wyatt',
  'Al Rodriguez',
] as const

export const GOAL_CATEGORIES = [
  'Growth',
  'Membership',
  'Operations',
  'People',
  'Customer Experience',
  'Facilities',
  'Marketing',
  'Finance',
  'Technology',
] as const

export const execGoals = {
  listQuarter: (quarter: string) =>
    supabase
      .from('exec_goals')
      .select('*, milestones:exec_goal_milestones(*), checkins:exec_goal_checkins(*)')
      .eq('quarter', quarter)
      .order('created_at'),
  create: (row: ExecGoalInsert) => supabase.from('exec_goals').insert(row).select('id').single(),
  update: (id: string, patch: T['exec_goals']['Update']) =>
    supabase.from('exec_goals').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id),
  remove: (id: string) => supabase.from('exec_goals').delete().eq('id', id),

  addMilestones: (rows: T['exec_goal_milestones']['Insert'][]) =>
    rows.length ? supabase.from('exec_goal_milestones').insert(rows) : Promise.resolve({ error: null }),
  updateMilestone: (id: string, patch: T['exec_goal_milestones']['Update']) =>
    supabase.from('exec_goal_milestones').update(patch).eq('id', id),
  removeMilestone: (id: string) => supabase.from('exec_goal_milestones').delete().eq('id', id),

  addCheckin: (row: T['exec_goal_checkins']['Insert']) => supabase.from('exec_goal_checkins').insert(row),
  removeCheckin: (id: string) => supabase.from('exec_goal_checkins').delete().eq('id', id),
}
