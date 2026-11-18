import { format, parseISO } from 'date-fns'
import type { ChecklistRun, ItemComment, ItemPhoto, MissingItem, SiteRm } from '@/lib/queries/checklistReview'

// Plain helpers for the checklist pages (kept out of the component files).

// A checklist's day ("2026-11-18") as the site saw it, not shifted by time zone.
export function dayLabel(d: string | null | undefined): string {
  if (!d) return '—'
  return format(parseISO(d), 'EEE, MMM d')
}

export function clockTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return format(new Date(iso), 'h:mm a')
}

export const daysSince = (iso: string | null) =>
  iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0
export const daysText = (n: number) => (n === 0 ? 'Today' : `${n} day${n === 1 ? '' : 's'}`)

// Submitted after the checklist's closing time.
export const isLate = (r: Pick<ChecklistRun, 'submitted_at' | 'closes_at'>) =>
  !!r.submitted_at && !!r.closes_at && new Date(r.submitted_at).getTime() > new Date(r.closes_at).getTime()

export const runName = (r: Pick<ChecklistRun, 'checklist' | 'snapshot'>) =>
  r.checklist?.name ?? (r.snapshot as { name?: string } | null)?.name ?? 'Checklist'

// Why a site has nobody to review its checklists.
export function noRmReason(rm: SiteRm | null | undefined): string {
  if (rm?.name) return `${rm.name} has no Regional Manager login`
  if (rm?.region) return `${rm.region} has no Regional Manager`
  return 'This site is in no region'
}

// Just the name, for lists: the RM, or why there's none.
export function rmShort(rm: SiteRm | null | undefined): string {
  if (rm?.name) return rm.name
  return rm?.region ? `No RM (${rm.region})` : 'No RM (no region)'
}

// Can this person review the site's checklists: its Regional Manager, or an Admin.
export const canReviewSite = (rm: SiteRm | null | undefined, userId: string | undefined, role: string | undefined) =>
  role === 'owner' || (!!userId && !!rm?.user_id && rm.user_id === userId)

export const completedText = (r: Pick<ChecklistRun, 'completed_by_name' | 'completed_role'>) =>
  r.completed_by_name ? `${r.completed_by_name} (${r.completed_role === 'admin' ? 'Admin' : 'RM'})` : '—'

export function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const r of rows) {
    const k = key(r)
    const list = m.get(k)
    if (list) list.push(r)
    else m.set(k, [r])
  }
  return m
}

// The same rules the database applies on submit: a checked item that needs a
// photo has one, and an item that isn't checked has a comment saying why.
export function missingBeforeSubmit(
  items: { id: string; label: string; requires_photo: boolean }[],
  checked: (itemId: string) => boolean,
  photos: ItemPhoto[],
  comments: ItemComment[],
): MissingItem[] {
  const out: MissingItem[] = []
  for (const it of items) {
    const done = checked(it.id)
    if (done && it.requires_photo && !photos.some((p) => p.item_id === it.id)) {
      out.push({ item_id: it.id, label: it.label, reason: 'photo' })
    } else if (!done && !comments.some((c) => c.item_id === it.id)) {
      out.push({ item_id: it.id, label: it.label, reason: 'not_done' })
    }
  }
  return out
}

export const MISSING_TEXT: Record<MissingItem['reason'], string> = {
  photo: 'Add a photo',
  not_done: 'Check it off, or comment why it wasn’t done',
}

// Database errors in words a person can act on.
export function friendlyError(message: string | undefined): string {
  const m = message ?? ''
  if (m.includes('already_submitted') || m.includes('checklist_submitted')) return 'This checklist was already submitted, so it can’t be changed. Reload to see it.'
  if (m.includes('checklist_archived')) return 'This checklist is archived, so it can’t take new comments.'
  if (m.includes('not_open')) return 'This checklist isn’t in RM Audit any more. Reload to see where it is.'
  if (m.includes('missing_acks')) return 'Acknowledge every flagged item first.'
  if (m.includes('not_allowed') || m.includes('row-level security')) return 'You don’t have access to do that.'
  if (m.includes('too_many_photos')) return 'That item already has 6 photos.'
  if (m.includes('no_items')) return 'This checklist has no items to submit.'
  return m || 'Something went wrong.'
}
