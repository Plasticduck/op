import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']

export type TrainingItem = T['training_items']['Row']
export type TrainingAssignment = T['training_assignments']['Row']
export type OnboardingTemplate = T['onboarding_templates']['Row']
export type EmployeeOnboarding = T['employee_onboarding']['Row']
export type Certification = T['certifications']['Row']

// A step on an onboarding template. Stored as a jsonb array on the template.
export type OnboardingStep = { key: string; label: string }
// Per-step sign-off state, stored as jsonb on employee_onboarding.
export type StepState = Record<
  string,
  { done: boolean; by_name?: string | null; at?: string | null; note?: string | null }
>

// Assignment joined to its item + employee, for the roster views.
export type AssignmentRow = TrainingAssignment & {
  training_item: Pick<TrainingItem, 'id' | 'title' | 'category' | 'required'> | null
  employee: { first_name: string; last_name: string } | null
}

export const training = {
  // ---- library ----
  listItems: () =>
    supabase.from('training_items').select('*').order('category').order('title'),
  createItem: (row: T['training_items']['Insert']) =>
    supabase.from('training_items').insert(row).select().single(),
  updateItem: (id: string, patch: T['training_items']['Update']) =>
    supabase
      .from('training_items')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id),
  deleteItem: (id: string) => supabase.from('training_items').delete().eq('id', id),

  // ---- assignments ----
  listAssignments: () =>
    supabase
      .from('training_assignments')
      .select('*, training_item:training_item_id(id, title, category, required), employee:employee_id(first_name, last_name)')
      .order('due_date', { nullsFirst: false }),
  assign: (rows: T['training_assignments']['Insert'][]) =>
    supabase.from('training_assignments').upsert(rows, { onConflict: 'training_item_id,employee_id' }),
  setComplete: (id: string, completed: boolean, userId: string | null) =>
    supabase
      .from('training_assignments')
      .update({
        completed_at: completed ? new Date().toISOString() : null,
        completed_by: completed ? userId : null,
      })
      .eq('id', id),
  removeAssignment: (id: string) => supabase.from('training_assignments').delete().eq('id', id),

  // ---- onboarding ----
  listTemplates: () => supabase.from('onboarding_templates').select('*').order('name'),
  createTemplate: (row: T['onboarding_templates']['Insert']) =>
    supabase.from('onboarding_templates').insert(row).select().single(),
  updateTemplate: (id: string, patch: T['onboarding_templates']['Update']) =>
    supabase
      .from('onboarding_templates')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id),
  deleteTemplate: (id: string) => supabase.from('onboarding_templates').delete().eq('id', id),

  listOnboarding: () =>
    supabase
      .from('employee_onboarding')
      .select('*, employee:employee_id(first_name, last_name), template:template_id(name, steps)')
      .order('started_at', { ascending: false }),
  startOnboarding: (row: T['employee_onboarding']['Insert']) =>
    supabase
      .from('employee_onboarding')
      .upsert(row, { onConflict: 'employee_id,template_id' })
      .select()
      .single(),
  updateOnboarding: (id: string, patch: T['employee_onboarding']['Update']) =>
    supabase
      .from('employee_onboarding')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id),
  deleteOnboarding: (id: string) => supabase.from('employee_onboarding').delete().eq('id', id),

  // ---- certifications ----
  listCertifications: () =>
    supabase
      .from('certifications')
      .select('*, employee:employee_id(first_name, last_name)')
      .order('expires_on', { nullsFirst: false }),
  createCertification: (row: T['certifications']['Insert']) =>
    supabase.from('certifications').insert(row).select().single(),
  updateCertification: (id: string, patch: T['certifications']['Update']) =>
    supabase
      .from('certifications')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', id),
  deleteCertification: (id: string) => supabase.from('certifications').delete().eq('id', id),
}

// Expiration status for a certification, used for the badge + sorting.
export type CertStatus = 'expired' | 'expiring' | 'valid' | 'none'
export function certStatus(expiresOn: string | null, warnDays = 30): CertStatus {
  if (!expiresOn) return 'none'
  const now = new Date()
  const exp = new Date(expiresOn + 'T00:00:00')
  const days = Math.floor((exp.getTime() - now.getTime()) / 86400000)
  if (days < 0) return 'expired'
  if (days <= warnDays) return 'expiring'
  return 'valid'
}
