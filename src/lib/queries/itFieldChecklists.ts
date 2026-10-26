import { supabase } from '@/lib/supabase'
import type { Database, Json } from '@/lib/database.types'
import { IT_FIELD_CHECKLIST } from '@/features/it/itFieldChecklistSchema'

// IT Field Checklists: one per site visit by an IT field tech. RLS: techs see
// their own, managers/owners see their sites'; only the tech edits, and only
// while it's a draft. Media (photos/videos) live in the private
// it-field-checklist-media bucket under <account_id>/<checklist_id>/.
type T = Database['public']['Tables']
export type ItFieldChecklist = T['it_field_checklists']['Row']
export type ItFieldChecklistRow = ItFieldChecklist & { location: { name: string } | null }

export type ItMedia = { path: string; kind: 'image' | 'video'; name: string }
export type ItChecklistItem = {
  key: string
  section: string
  label: string
  checked: boolean
  comment: string
  media: ItMedia[]
}

const BUCKET = 'it-field-checklist-media'
// The project's per-file upload limit.
export const IT_MEDIA_MAX_BYTES = 50 * 1024 * 1024

// A fresh set of unchecked items from the current checklist definition.
export function blankItems(): ItChecklistItem[] {
  return IT_FIELD_CHECKLIST.flatMap((s) =>
    s.items.map((i) => ({ key: i.key, section: s.title, label: i.label, checked: false, comment: '', media: [] })),
  )
}

export function itemsOf(r: Pick<ItFieldChecklist, 'items'>): ItChecklistItem[] {
  return Array.isArray(r.items) ? (r.items as unknown as ItChecklistItem[]) : []
}

export const itFieldChecklists = {
  list: () =>
    supabase
      .from('it_field_checklists')
      .select('*, location:location_id(name)')
      .order('created_at', { ascending: false }),
  get: (id: string) =>
    supabase.from('it_field_checklists').select('*, location:location_id(name)').eq('id', id).maybeSingle(),
  start: (row: { account_id: string; location_id: string; tech_id: string; tech_name: string | null }) =>
    supabase
      .from('it_field_checklists')
      .insert({ ...row, items: blankItems() as unknown as Json })
      .select('id')
      .single(),
  save: (id: string, items: ItChecklistItem[], notes: string) =>
    supabase
      .from('it_field_checklists')
      .update({ items: items as unknown as Json, notes: notes || null, updated_at: new Date().toISOString() })
      .eq('id', id),
  submit: (id: string, items: ItChecklistItem[], notes: string) =>
    supabase
      .from('it_field_checklists')
      .update({
        items: items as unknown as Json,
        notes: notes || null,
        status: 'submitted',
        submitted_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', id),
  remove: (id: string) => supabase.from('it_field_checklists').delete().eq('id', id),

  // Upload one photo or video for a checklist, returning its media entry.
  uploadMedia: async (accountId: string, checklistId: string, file: File): Promise<{ media: ItMedia | null; error: string | null }> => {
    const ext = file.name.split('.').pop()?.toLowerCase() || (file.type.startsWith('video/') ? 'mp4' : 'jpg')
    const path = `${accountId}/${checklistId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(path, file, { contentType: file.type || undefined, upsert: false })
    if (error) return { media: null, error: error.message }
    return { media: { path, kind: file.type.startsWith('video/') ? 'video' : 'image', name: file.name }, error: null }
  },
  removeMedia: (path: string) => supabase.storage.from(BUCKET).remove([path]),
  // Signed URLs for media paths, as a path -> url map.
  mediaUrls: async (paths: string[], expiresIn = 3600): Promise<Record<string, string>> => {
    if (!paths.length) return {}
    const { data } = await supabase.storage.from(BUCKET).createSignedUrls(paths, expiresIn)
    const map: Record<string, string> = {}
    for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl
    return map
  },
}
