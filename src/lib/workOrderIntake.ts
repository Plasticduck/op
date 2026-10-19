import type { Profile } from '@/lib/auth'

// Work order intake: staff submit tickets to a department; that department's
// reviewers triage them (see migration 0155).

export type Department = 'maintenance' | 'facilities' | 'it'

export const DEPARTMENT_OPTIONS: Array<{ value: Department; label: string }> = [
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'it', label: 'IT' },
]

// MaintainX-synced and older work orders have no department; they are all
// maintenance work, so they display and filter as Maintenance.
export const departmentOf = (d: Department | null | undefined): Department => d ?? 'maintenance'
export const departmentLabel = (d: Department | null | undefined): string =>
  DEPARTMENT_OPTIONS.find((o) => o.value === departmentOf(d))?.label ?? 'Maintenance'

type ReviewerProfile = Pick<Profile, 'role' | 'role_category' | 'location_ids'>

// Mirrors public.auth_is_wo_reviewer in migration 0155. This copy only shapes the
// UI; row-level security is the real gate, so keep the two in step.
export function canReviewTicket(p: ReviewerProfile | null | undefined, dept: Department, locationId: string): boolean {
  if (!p) return false
  if (p.role === 'owner') return true
  const regionalHere = p.role_category === 'regional_manager' && p.location_ids.includes(locationId)
  if (dept === 'maintenance') return p.role === 'technician' || regionalHere
  // IT Personnel joins Facilities/IT review once that role exists.
  return regionalHere
}

// Whether this person reviews tickets for any department at all, which decides
// whether they get the review queues or only "My Submissions".
export function isTicketReviewer(p: ReviewerProfile | null | undefined): boolean {
  if (!p) return false
  return p.role === 'owner' || p.role === 'technician' || p.role_category === 'regional_manager'
}

// Title used until the classifier writes a better one (or if it never runs):
// the description's first line, cut at a word boundary.
export function provisionalTitle(description: string): string {
  const firstLine = description.trim().split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine.length <= 60) return firstLine || 'Work order'
  const cut = firstLine.slice(0, 60)
  const space = cut.lastIndexOf(' ')
  return (space > 30 ? cut.slice(0, space) : cut).trimEnd() + '...'
}
