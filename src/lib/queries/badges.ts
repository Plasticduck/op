import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import { certStatus } from '@/lib/queries/training'

type T = Database['public']['Tables']

export type BadgeDef = T['badges']['Row']
export type EmployeeBadge = T['employee_badges']['Row'] & {
  badge: Pick<BadgeDef, 'id' | 'name' | 'description' | 'emoji' | 'tone'> | null
}

export type BadgeTone = 'accent' | 'ok' | 'warn' | 'danger' | 'neutral'

// What actually renders next to a name. Manual awards and computed auto badges
// both normalize to this shape.
export type EarnedBadge = {
  key: string
  name: string
  description?: string | null
  emoji?: string | null
  tone: BadgeTone
  auto: boolean
}

export const badges = {
  listDefs: () => supabase.from('badges').select('*').order('name'),
  createDef: (row: T['badges']['Insert']) =>
    supabase.from('badges').insert(row).select().single(),
  updateDef: (id: string, patch: T['badges']['Update']) =>
    supabase.from('badges').update(patch).eq('id', id),
  deleteDef: (id: string) => supabase.from('badges').delete().eq('id', id),

  listAwards: () =>
    supabase
      .from('employee_badges')
      .select('*, badge:badge_id(id, name, description, emoji, tone)')
      .order('earned_at', { ascending: false }),
  award: (rows: T['employee_badges']['Insert'][]) =>
    supabase.from('employee_badges').upsert(rows, { onConflict: 'employee_id,badge_id' }),
  removeAward: (id: string) => supabase.from('employee_badges').delete().eq('id', id),
}

// ---- Auto badges ----
//
// Derived from data Operator already tracks so they can never drift out of sync
// with reality. Computed per employee at render time.
export type AutoBadgeInput = {
  onboardings: { employee_id: string; completed_at: string | null }[]
  assignments: { employee_id: string; completed_at: string | null }[]
  certifications: { employee_id: string; expires_on: string | null }[]
}

export const AUTO_BADGES: Record<string, { name: string; description: string; emoji: string; tone: BadgeTone }> = {
  onboarded: {
    name: 'Onboarded',
    description: 'Finished every step of their onboarding checklist.',
    emoji: '🎓',
    tone: 'accent',
  },
  trained: {
    name: 'Training complete',
    description: 'Completed all training assigned to them.',
    emoji: '✅',
    tone: 'ok',
  },
  certified: {
    name: 'Certified',
    description: 'Holds at least one certification that has not expired.',
    emoji: '📜',
    tone: 'warn',
  },
}

export function computeAutoBadges(employeeId: string, input: AutoBadgeInput): EarnedBadge[] {
  const out: EarnedBadge[] = []

  if (input.onboardings.some((o) => o.employee_id === employeeId && o.completed_at)) {
    out.push({ key: 'onboarded', auto: true, ...AUTO_BADGES.onboarded })
  }

  const mine = input.assignments.filter((a) => a.employee_id === employeeId)
  if (mine.length > 0 && mine.every((a) => a.completed_at)) {
    out.push({ key: 'trained', auto: true, ...AUTO_BADGES.trained })
  }

  const hasValidCert = input.certifications.some(
    (c) => c.employee_id === employeeId && certStatus(c.expires_on) !== 'expired',
  )
  if (hasValidCert) {
    out.push({ key: 'certified', auto: true, ...AUTO_BADGES.certified })
  }

  return out
}

// Manual awards for one employee, normalized for display.
export function manualBadgesFor(employeeId: string, awards: EmployeeBadge[]): EarnedBadge[] {
  return awards
    .filter((a) => a.employee_id === employeeId && a.badge)
    .map((a) => ({
      key: `m:${a.badge_id}`,
      name: a.badge?.name ?? 'Badge',
      description: a.badge?.description,
      emoji: a.badge?.emoji,
      tone: (a.badge?.tone as BadgeTone) ?? 'accent',
      auto: false,
    }))
}

// Everything an employee has earned, auto first.
export function badgesFor(
  employeeId: string,
  awards: EmployeeBadge[],
  auto: AutoBadgeInput,
): EarnedBadge[] {
  return [...computeAutoBadges(employeeId, auto), ...manualBadgesFor(employeeId, awards)]
}
