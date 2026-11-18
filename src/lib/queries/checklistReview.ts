import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Checklists after the site fills them out (migration 0249): the site submits a
// day's checklist, it waits in RM Audit for the site's Regional Manager, and the
// RM marks it complete, which moves it to Archive. Comments and photos hang off
// each item of a day's checklist. Writes to the follow-up only go through the
// checklist_submit / checklist_review functions.

type T = Database['public']['Tables']
export type ChecklistRun = T['checklist_instances']['Row'] & {
  checklist: { name: string } | null
  location: { name: string } | null
}
export type ItemComment = T['checklist_item_comments']['Row']
export type ItemPhoto = T['checklist_item_photos']['Row']
export type SnapshotItem = {
  id: string
  label: string
  requires_photo: boolean
  done: boolean
  done_by: string | null
  done_at: string | null
}
export type MissingItem = { item_id: string; label: string; reason: 'photo' | 'not_done' }
export type SubmitResult = { ok: true; flagged: number } | { ok: false; missing: MissingItem[] }
// A site's region and its Regional Manager this quarter. user_id is null when
// the region is vacant or the name matches no RM login.
export type SiteRm = { location_id: string; region: string | null; user_id: string | null; name: string | null }

const SEL = '*, checklist:checklists(name), location:locations(name)'
const BUCKET = 'checklist-photos'
const PAGE = 1000

// PostgREST answers at most 1000 rows at a time.
async function allPages(build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>) {
  const out: ChecklistRun[] = []
  for (let from = 0; from < 20 * PAGE; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) return { data: out, error }
    out.push(...((data ?? []) as ChecklistRun[]))
    if ((data ?? []).length < PAGE) break
  }
  return { data: out, error: null }
}

export const snapshotItems = (run: Pick<ChecklistRun, 'snapshot'>): SnapshotItem[] => {
  const items = (run.snapshot as { items?: unknown } | null)?.items
  return Array.isArray(items) ? (items as SnapshotItem[]) : []
}

export const checklistReview = {
  // Waiting in RM Audit, oldest first doesn't matter here: the page sorts.
  listRmAudit: () =>
    allPages((from, to) =>
      supabase.from('checklist_instances').select(SEL).eq('review_status', 'rm_audit')
        .order('submitted_at', { ascending: false }).range(from, to)),
  // Archive, completed since `sinceIso`.
  listArchive: (sinceIso: string) =>
    allPages((from, to) =>
      supabase.from('checklist_instances').select(SEL).eq('review_status', 'archived').gte('completed_at', sinceIso)
        .order('completed_at', { ascending: false }).range(from, to)),
  get: (id: string) =>
    supabase.from('checklist_instances').select(SEL).eq('id', id).maybeSingle<ChecklistRun>(),

  submit: async (id: string): Promise<{ data: SubmitResult | null; error: { message: string } | null }> => {
    const { data, error } = await supabase.rpc('checklist_submit', { p_instance: id })
    return { data: (data ?? null) as SubmitResult | null, error }
  },
  // Acknowledgements ({ itemId: true }) and the note save as the RM goes;
  // complete moves it to Archive and needs every flagged item acknowledged.
  review: (id: string, acks: Record<string, boolean>, note: string, complete: boolean) =>
    supabase.rpc('checklist_review', { p_instance: id, p_acks: acks, p_note: note, p_complete: complete }),
  // Marks complete the given checklists that have nothing flagged. Returns how many moved.
  completeClean: (ids: string[]) => supabase.rpc('checklist_review_bulk', { p_ids: ids }),
  rms: async (): Promise<{ data: SiteRm[]; error: { message: string } | null }> => {
    const { data, error } = await supabase.rpc('checklist_site_rms')
    return { data: (data ?? []) as SiteRm[], error }
  },

  comments: (instanceIds: string[]) =>
    instanceIds.length === 0
      ? Promise.resolve({ data: [] as ItemComment[], error: null })
      : supabase.from('checklist_item_comments').select('*').in('instance_id', instanceIds).order('created_at'),
  // Who wrote it and in what role is filled in by the database.
  addComment: (row: { instance_id: string; item_id: string; location_id: string; body: string }) =>
    supabase.from('checklist_item_comments').insert(row).select('*').single(),
  removeComment: (id: string) =>
    supabase.from('checklist_item_comments').delete().eq('id', id).select('id'),

  photos: (instanceIds: string[]) =>
    instanceIds.length === 0
      ? Promise.resolve({ data: [] as ItemPhoto[], error: null })
      : supabase.from('checklist_item_photos').select('*').in('instance_id', instanceIds).order('created_at'),
  addPhoto: async (p: { accountId: string; instanceId: string; itemId: string; locationId: string; file: File }) => {
    const ext = (p.file.type === 'image/jpeg' ? 'jpg' : p.file.name.split('.').pop()?.toLowerCase()) || 'jpg'
    const path = `${p.accountId}/${p.instanceId}/${p.itemId}/${crypto.randomUUID()}.${ext}`
    const up = await supabase.storage.from(BUCKET).upload(path, p.file, { contentType: p.file.type || undefined, upsert: false })
    if (up.error) return { data: null, error: up.error }
    const res = await supabase.from('checklist_item_photos')
      .insert({ instance_id: p.instanceId, item_id: p.itemId, location_id: p.locationId, path })
      .select('*').single()
    if (res.error) void supabase.storage.from(BUCKET).remove([path])
    return res
  },
  removePhoto: async (photo: Pick<ItemPhoto, 'id' | 'path'>) => {
    const res = await supabase.from('checklist_item_photos').delete().eq('id', photo.id).select('id')
    if (!res.error && (res.data ?? []).length > 0) void supabase.storage.from(BUCKET).remove([photo.path])
    return res
  },
  // With `resizeTo`, a copy from Storage's resizer, which reads every common
  // format (HEIC, TIFF, AVIF...) and answers in one the browser can show.
  photoUrl: async (path: string, resizeTo?: number): Promise<string | null> => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(
      path,
      3600,
      resizeTo ? { transform: { width: resizeTo, height: resizeTo, resize: 'contain' } } : undefined,
    )
    return data?.signedUrl ?? null
  },
}
