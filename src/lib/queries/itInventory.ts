import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// IT Inventory (docs/it-inventory). Every rule that matters is enforced in the
// database: RLS by site (it_can_read / it_can_write), tags generated and never
// reused, serial and MAC unique per account, check-out only for deployable
// statuses, and the activity log written by triggers. This module only reads
// and writes rows.
type T = Database['public']['Tables']
export type ItSettings = T['it_settings']['Row']
export type ItCategory = T['it_categories']['Row']
export type ItStatusLabel = T['it_status_labels']['Row']
export type ItArea = T['it_site_areas']['Row']
export type ItModel = T['it_asset_models']['Row']
export type ItManufacturer = T['it_manufacturers']['Row']
export type ItSupplier = T['it_suppliers']['Row']
export type ItLabelTemplate = T['it_label_templates']['Row']
export type ItCustomField = T['it_custom_fields']['Row']
export type ItAsset = T['it_assets']['Row']
export type ItAssetInsert = T['it_assets']['Insert']
export type ItAssetPatch = T['it_assets']['Update']
export type ItTag = T['it_asset_tags']['Row']
export type ItActivity = T['it_activity_log']['Row']
export type ItConsumable = T['it_consumables']['Row']

// Rows carry their tag's print state so lists can show "needs a sticker".
export type ItAssetRow = ItAsset & { tag: Pick<ItTag, 'printed_count' | 'last_printed_at' | 'status'> | null }
const ASSET_SELECT = '*, tag:it_asset_tags!it_assets_account_id_asset_tag_fkey(printed_count, last_printed_at, status)'

export type ResolveResult =
  | { result: 'asset'; asset_id: string; tag: string; archived: boolean }
  | { result: 'unused' | 'unknown' | 'other_account' | 'signed_out'; tag?: string }
  | { result: 'no_access'; tag: string; site: string | null }

export type DuplicateHit = {
  field: 'serial' | 'mac'
  asset_id: string | null
  asset_tag: string
  asset_name: string | null
  site_name: string
  can_open: boolean
}

const BUCKET = 'it-inventory'
// PostgREST caps a response at 1,000 rows; page through for big accounts.
const PAGE = 1000

async function fetchAll<R>(
  page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: R[]; error: { message: string } | null }> {
  const out: R[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) return { data: out, error }
    const rows = (data as R[] | null) ?? []
    out.push(...rows)
    if (rows.length < PAGE) return { data: out, error: null }
  }
}

export const itInventory = {
  // Sets the account up on first use and fills in new sites. Idempotent.
  bootstrap: () => supabase.rpc('it_bootstrap'),
  settings: () => supabase.from('it_settings').select('*').maybeSingle(),
  categories: () => supabase.from('it_categories').select('*').is('deleted_at', null).order('sort_order'),
  statusLabels: () => supabase.from('it_status_labels').select('*').is('deleted_at', null).order('sort_order'),
  areas: () =>
    fetchAll<ItArea>((f, t) =>
      supabase.from('it_site_areas').select('*').is('deleted_at', null).order('sort_order').range(f, t)),
  models: () =>
    fetchAll<ItModel>((f, t) => supabase.from('it_asset_models').select('*').is('deleted_at', null).order('name').range(f, t)),
  manufacturers: () => supabase.from('it_manufacturers').select('*').is('deleted_at', null).order('name'),
  suppliers: () => supabase.from('it_suppliers').select('*').is('deleted_at', null).order('name'),
  labelTemplates: () => supabase.from('it_label_templates').select('*').is('deleted_at', null).order('sort_order'),
  customFields: () => supabase.from('it_custom_fields').select('*').is('deleted_at', null).order('sort_order'),

  addModel: (row: T['it_asset_models']['Insert']) => supabase.from('it_asset_models').insert(row).select('*').single(),
  addManufacturer: (accountId: string, name: string) =>
    supabase.from('it_manufacturers').insert({ account_id: accountId, name }).select('*').single(),
  addSupplier: (accountId: string, name: string) =>
    supabase.from('it_suppliers').insert({ account_id: accountId, name }).select('*').single(),

  listAssets: (opts?: { archived?: boolean }) =>
    fetchAll<ItAssetRow>((f, t) => {
      const q = supabase.from('it_assets').select(ASSET_SELECT)
      return (opts?.archived ? q.not('deleted_at', 'is', null) : q.is('deleted_at', null)).order('asset_tag').range(f, t)
    }),
  getAsset: (id: string) => supabase.from('it_assets').select(ASSET_SELECT).eq('id', id).maybeSingle(),
  // Leave asset_tag empty for the next generated tag. Many rows = add N identical.
  createAssets: (rows: ItAssetInsert[]) => supabase.from('it_assets').insert(rows).select('id, asset_tag'),
  updateAsset: (id: string, patch: ItAssetPatch) => supabase.from('it_assets').update(patch).eq('id', id),
  archiveAsset: (id: string) => supabase.from('it_assets').update({ deleted_at: new Date().toISOString() }).eq('id', id),
  restoreAsset: (id: string) => supabase.from('it_assets').update({ deleted_at: null }).eq('id', id),
  deleteAsset: (id: string) => supabase.from('it_assets').delete().eq('id', id),

  activity: (assetId: string) =>
    supabase.from('it_activity_log').select('*').eq('asset_id', assetId).order('created_at', { ascending: false }).limit(500),

  findDuplicates: (serial: string | null, mac: string | null, excludeId?: string | null) =>
    supabase.rpc('it_find_duplicates', { p_serial: serial ?? '', p_mac: mac ?? '', p_exclude: excludeId ?? undefined }),
  resolveTag: async (shortCode: string | null, tag: string): Promise<ResolveResult | null> => {
    const { data } = await supabase.rpc('it_resolve_tag', { p_short: shortCode ?? '', p_tag: tag })
    return (data as ResolveResult | null) ?? null
  },

  // ---- Stickers ----
  // Logged per asset as label_printed, counts the stickers and uses up the
  // site's Sticker Stock (all by trigger).
  recordPrint: (row: T['it_label_print_jobs']['Insert']) => supabase.from('it_label_print_jobs').insert(row),
  setSticker: (id: string, condition: 'ok' | 'faded' | 'missing') =>
    supabase.from('it_assets').update({ sticker_condition: condition, sticker_last_verified_at: new Date().toISOString() }).eq('id', id),
  updateTemplate: (id: string, patch: T['it_label_templates']['Update']) =>
    supabase.from('it_label_templates').update(patch).eq('id', id),
  // Blank tags for a pre-printed sticker order (next numbers in sequence).
  generateTags: (count: number, locationId?: string | null) =>
    supabase.rpc('it_generate_tags', { p_count: count, p_location: locationId ?? undefined }),
  // Tags from a vendor's list. Ones that already exist are skipped, never changed.
  importTags: (rows: { account_id: string; tag: string; batch_id: string }[]) =>
    supabase
      .from('it_asset_tags')
      .upsert(rows.map((r) => ({ ...r, status: 'unused', source: 'imported' })), { onConflict: 'account_id,tag', ignoreDuplicates: true })
      .select('id'),
  unusedTags: () =>
    fetchAll<ItTag>((f, t) => supabase.from('it_asset_tags').select('*').eq('status', 'unused').order('tag').range(f, t)),
  deleteUnusedBatch: (batchId: string) =>
    supabase.from('it_asset_tags').delete().eq('batch_id', batchId).eq('status', 'unused'),
  stickerStock: () => supabase.from('it_consumables').select('*').eq('is_sticker_stock', true).is('deleted_at', null),
  adjustStock: (row: { account_id: string; location_id: string; consumable_id: string; delta: number; reason: 'restock' | 'used' | 'adjustment'; note?: string }) =>
    supabase.from('it_consumable_events').insert(row),

  // Photos: <account>/asset/<asset>/<uuid>.jpg in the private it-inventory bucket.
  uploadAssetPhoto: async (accountId: string, assetId: string, locationId: string, file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${accountId}/asset/${assetId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
    if (error) return { error: error.message }
    const { data: me } = await supabase.auth.getUser()
    await supabase.from('it_attachments').insert({
      account_id: accountId,
      location_id: locationId,
      entity_type: 'asset',
      entity_id: assetId,
      storage_path: path,
      mime_type: file.type || 'image/jpeg',
      kind: 'photo',
      uploaded_by: me.user?.id,
    })
    const { error: upErr } = await supabase.from('it_assets').update({ image_path: path }).eq('id', assetId)
    return { error: upErr?.message ?? null }
  },
  photoUrl: async (path: string, expiresIn = 3600) => {
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(path, expiresIn)
    return data?.signedUrl ?? null
  },
}
