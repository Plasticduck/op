import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'
import type { Database, Json } from '@/lib/database.types'

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

export type ItAssignment = T['it_assignments']['Row']
export type ItSavedView = T['it_saved_views']['Row']
export type ImportEntity = 'assets' | 'models' | 'subscriptions'
export type ImportResult = { row: number; action: 'create' | 'update' | 'error'; asset_id?: string; id?: string; tag?: string; error?: string }
export type SearchHit = { id: string; asset_tag: string; name: string; site: string; category: string; matched: string | null; exact: boolean }
export type BulkItem = { asset_id: string; ok: boolean; error?: string | null }

function bulkResult(r: { data: unknown; error: { message: string } | null }): { items: BulkItem[]; error: string | null } {
  if (r.error) return { items: [], error: r.error.message }
  return { items: (r.data as BulkItem[] | null) ?? [], error: null }
}

export type PublicAsset ={ tag: string; name: string; category: string | null; site: string | null }

export type ItSubscription = T['it_subscriptions']['Row']
// With the ids of the devices it covers.
export type ItSubscriptionRow = ItSubscription & { links: { asset_id: string }[] }
const SUB_SELECT = '*, links:it_subscription_assets(asset_id)'
export type ItConsumableEvent = T['it_consumable_events']['Row']
export type ItReminderRule = T['it_reminder_rules']['Row']
export type ItPerson = Pick<T['users']['Row'], 'id' | 'name' | 'role' | 'email' | 'phone' | 'sms_opt_in' | 'location_ids'>

type Count = number
export type ItOverview = {
  total: Count
  attention: { not_working: Count; repair: Count; warranty: Count; audits: Count; stickers: Count; renewals: Count; low_stock: Count }
  by_site: {
    id: string; name: string; total: Count; not_working: Count; repair: Count
    audits_overdue: Count; next_audit: string | null; last_audit: string | null
  }[]
  by_category: { id: string; name: string; icon: string | null; total: Count; not_working: Count }[]
  spend: { monthly: number; unpriced: Count; by_site: { id: string | null; name: string; monthly: number | null; items: Count }[] }
  repair_spend_90d: number
}

export type ItAuditRun = T['it_audit_runs']['Row']
export type AuditSummary = {
  total: number; found: number; missing: number; damaged: number; wrong_location: number
  unregistered: number; moved: number; stickers: number
}
// An audit row with the item it's about (null for stickers not in the
// inventory, or items at a site you can't see).
export type ItAuditItem = T['it_audit_items']['Row'] & {
  asset: Pick<ItAsset, 'id' | 'asset_tag' | 'name' | 'category_id' | 'model_id' | 'area_id' | 'location_id'
    | 'status_label_id' | 'assigned_type' | 'assigned_label' | 'custom_values'> | null
}
const AUDIT_ITEM_SELECT = '*, asset:it_assets(id, asset_tag, name, category_id, model_id, area_id, location_id, status_label_id, assigned_type, assigned_label, custom_values)'
export type AuditScan =
  | { result: 'found' | 'damaged'; item_id: string; asset_id: string; tag: string; name: string; again: boolean; listed_area_id: string | null; found_area_id: string | null }
  | { result: 'wrong_location'; item_id: string; asset_id: string; tag: string; name: string | null; site: string; can_move: boolean }
  | { result: 'unregistered'; item_id: string; tag: string; unused: boolean }

export type RemindersPreview = {
  ok: true
  today: string
  enabled: boolean
  people: {
    id: string
    name: string
    role: string
    text: string[]
    email: { to: string; subject: string } | null
    no_text_reason: string | null
    items: { kind: string; threshold: number; text: string }[]
  }[]
}

// functions.invoke puts non-2xx bodies on error.context (see lib/fnError.ts).
async function scanResult<R>(data: unknown, error: unknown): Promise<{ data: R | null; message: string | null }> {
  if (!error) return { data: data as R, message: null }
  const msg = await fnErrorMessage(error as Parameters<typeof fnErrorMessage>[0], data as { message?: string } | null, 'Something went wrong. Try again.')
  return { data: null, message: msg }
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
  // One site's equipment (the overview's area-by-area view).
  assetsForSite: (locationId: string) =>
    fetchAll<ItAssetRow>((f, t) =>
      supabase.from('it_assets').select(ASSET_SELECT).eq('location_id', locationId).is('deleted_at', null).order('asset_tag').range(f, t)),
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

  // ---- Check-out, check-in, status, move (one item or many) ----
  // Each returns one result per asset; one failing doesn't stop the rest.
  checkOut: async (assetIds: string[], target: { type: 'site' | 'area' | 'user' | 'asset'; id: string }, opts: { expected?: string | null; note?: string; signaturePath?: string | null } = {}) =>
    bulkResult(await supabase.rpc('it_check_out', {
      p_asset_ids: assetIds, p_type: target.type, p_target: target.id,
      p_expected: opts.expected ?? undefined, p_note: opts.note || undefined, p_signature: opts.signaturePath ?? undefined,
    })),
  checkIn: async (assetIds: string[], statusId: string | null, note?: string) =>
    bulkResult(await supabase.rpc('it_check_in', { p_asset_ids: assetIds, p_status_id: statusId ?? undefined, p_note: note || undefined })),
  setStatus: async (assetIds: string[], statusId: string, note?: string) =>
    bulkResult(await supabase.rpc('it_set_status', { p_asset_ids: assetIds, p_status_id: statusId, p_note: note || undefined })),
  move: async (assetIds: string[], locationId: string, areaId: string | null, note?: string) =>
    bulkResult(await supabase.rpc('it_move', { p_asset_ids: assetIds, p_location: locationId, p_area: areaId ?? undefined, p_note: note || undefined })),
  // Devices at a site, for checking something out to another device.
  assetsAtSite: (locationId: string) =>
    supabase.from('it_assets').select('id, asset_tag, name, category_id')
      .eq('location_id', locationId).is('deleted_at', null).order('asset_tag').limit(1000),
  archiveMany: (ids: string[]) =>
    supabase.from('it_assets').update({ deleted_at: new Date().toISOString() }).in('id', ids).select('id'),
  openAssignment: (assetId: string) =>
    supabase.from('it_assignments').select('*').eq('asset_id', assetId).is('checked_in_at', null).maybeSingle(),
  // The people at a site, for checking something out to a person.
  roster: (locationId: string) =>
    supabase.from('employees').select('id, first_name, last_name, role_title')
      .eq('location_id', locationId).eq('status', 'active').order('first_name'),
  uploadSignature: async (accountId: string, assetId: string, blob: Blob) => {
    const path = `${accountId}/assignment/${assetId}/${crypto.randomUUID()}.png`
    const { error } = await supabase.storage.from(BUCKET).upload(path, blob, { contentType: 'image/png' })
    return error ? { path: null, error: error.message } : { path, error: null }
  },
  // A photo kept on the asset's record (condition at check-out / check-in),
  // without replacing its main picture. Shows on the Timeline.
  addPhoto: async (accountId: string, assetId: string, locationId: string, file: File, caption: string) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${accountId}/asset/${assetId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
    if (error) return { error: error.message }
    const { data: me } = await supabase.auth.getUser()
    const { error: err } = await supabase.from('it_attachments').insert({
      account_id: accountId, location_id: locationId, entity_type: 'asset', entity_id: assetId,
      storage_path: path, mime_type: file.type || 'image/jpeg', kind: 'photo', caption, uploaded_by: me.user?.id,
    })
    return { error: err?.message ?? null }
  },

  // ---- Search, saved views, import ----
  // Tag, name, serial, model, manufacturer, IP, MAC, hostname, notes; an exact
  // tag or serial comes first with exact = true.
  search: (q: string, limit = 8) => supabase.rpc('it_search', { p_q: q, p_limit: limit }),
  savedViews: () => supabase.from('it_saved_views').select('*').eq('entity', 'asset').order('name'),
  saveView: (row: T['it_saved_views']['Insert']) => supabase.from('it_saved_views').insert(row).select('*').single(),
  deleteView: (id: string) => supabase.from('it_saved_views').delete().eq('id', id),
  // One call per chunk (each its own transaction). commit false = dry run.
  importRows: async (entity: ImportEntity, rows: Record<string, unknown>[], commit: boolean, create: Record<string, boolean>) => {
    const fn = entity === 'assets' ? 'it_import_assets' : entity === 'models' ? 'it_import_models' : 'it_import_subscriptions'
    const { data, error } = await supabase.rpc(fn, { p_rows: rows as unknown as Json, p_commit: commit, p_create: create as unknown as Json })
    return { results: (data as ImportResult[] | null) ?? [], error: error?.message ?? null }
  },
  logImport: (summary: Record<string, unknown>) => supabase.rpc('it_log_import', { p_summary: summary as unknown as Json }),
  uploadImportReport: async (accountId: string, csv: string) => {
    const path = `${accountId}/import/${new Date().toISOString().slice(0, 10)}-${crypto.randomUUID()}.csv`
    const { error } = await supabase.storage.from(BUCKET).upload(path, new Blob([csv], { type: 'text/csv' }), { contentType: 'text/csv' })
    return error ? null : path
  },

  // ---- Settings and custom fields (admins) ----
  updateSettings: (id: string, patch: T['it_settings']['Update']) => supabase.from('it_settings').update(patch).eq('id', id),
  updateCategory: (id: string, patch: T['it_categories']['Update']) => supabase.from('it_categories').update(patch).eq('id', id),
  saveField: (row: T['it_custom_fields']['Insert'] & { id?: string }) =>
    row.id
      ? supabase.from('it_custom_fields').update(row).eq('id', row.id).select('*').single()
      : supabase.from('it_custom_fields').insert(row).select('*').single(),
  removeField: (id: string) => supabase.from('it_custom_fields').update({ deleted_at: new Date().toISOString() }).eq('id', id),
  fieldsetLinks: () => supabase.from('it_fieldset_fields').select('fieldset_id, field_id'),
  // Which categories a field shows on. Each category gets its own fieldset the
  // first time it needs one; this keeps the links in step with the choice.
  setFieldCategories: async (accountId: string, fieldId: string, categoryIds: string[], categories: ItCategory[]) => {
    const want = new Set(categoryIds)
    for (const c of categories) {
      let fieldset = c.default_fieldset_id
      if (want.has(c.id) && !fieldset) {
        const { data, error } = await supabase.from('it_fieldsets').insert({ account_id: accountId, name: c.name }).select('id').single()
        if (error) return error.message
        fieldset = data.id
        const { error: e2 } = await supabase.from('it_categories').update({ default_fieldset_id: fieldset }).eq('id', c.id)
        if (e2) return e2.message
      }
      if (!fieldset) continue
      if (want.has(c.id)) {
        const { error } = await supabase.from('it_fieldset_fields')
          .upsert({ account_id: accountId, fieldset_id: fieldset, field_id: fieldId }, { onConflict: 'fieldset_id,field_id', ignoreDuplicates: true })
        if (error) return error.message
      } else {
        await supabase.from('it_fieldset_fields').delete().eq('fieldset_id', fieldset).eq('field_id', fieldId)
      }
    }
    return null
  },
  setSecret: (assetId: string, fieldId: string, value: string) =>
    supabase.rpc('it_set_secret', { p_asset: assetId, p_field: fieldId, p_value: value }),
  revealSecret: (assetId: string, fieldId: string) =>
    supabase.rpc('it_reveal_secret', { p_asset: assetId, p_field: fieldId }),

  // ---- Sticker scans and problem reports (it-scan-public edge function) ----
  // Public: only the asset's name, category and site come back. Signed-in
  // callers are recorded as the reporter (invoke sends their session).
  scanInfo: async (short: string, tag: string) => {
    const { data, error } = await supabase.functions.invoke('it-scan-public', { body: { action: 'info', short, tag } })
    return scanResult<{ ok: true; company: string | null; asset: PublicAsset }>(data, error)
  },
  reportProblem: async (row: { short: string; tag: string; description: string; name?: string; contact?: string; down?: boolean }) => {
    const { data, error } = await supabase.functions.invoke('it-scan-public', { body: { action: 'report', ...row } })
    return scanResult<{ ok: true }>(data, error)
  },
  reportUnknownSticker: async (row: { tag: string; description: string; location_id: string }) => {
    const { data, error } = await supabase.functions.invoke('it-scan-public', { body: { action: 'report_unknown', ...row } })
    return scanResult<{ ok: true }>(data, error)
  },

  // ---- Overview (dashboard tiles) ----
  // One site, or null for every site you can see. Today is your date, so the
  // counts match the list filters.
  overview: async (locationId: string | null, today: string) => {
    const { data, error } = await supabase.rpc('it_overview', { p_location: locationId ?? undefined, p_today: today })
    return { data: (data as ItOverview | null) ?? null, error: error?.message ?? null }
  },

  // ---- Subscriptions ----
  subscriptions: () =>
    fetchAll<ItSubscriptionRow>((f, t) =>
      supabase.from('it_subscriptions').select(SUB_SELECT).is('deleted_at', null).order('name').range(f, t)),
  saveSubscription: (row: T['it_subscriptions']['Insert'] & { id?: string }) =>
    row.id
      ? supabase.from('it_subscriptions').update(row).eq('id', row.id).select(SUB_SELECT).single()
      : supabase.from('it_subscriptions').insert(row).select(SUB_SELECT).single(),
  removeSubscription: (id: string) => supabase.from('it_subscriptions').update({ deleted_at: new Date().toISOString() }).eq('id', id),
  // Which devices it covers: add and remove links to match the list.
  setSubscriptionAssets: async (accountId: string, subscriptionId: string, assetIds: string[], current: string[]) => {
    const add = assetIds.filter((id) => !current.includes(id))
    const drop = current.filter((id) => !assetIds.includes(id))
    if (add.length) {
      const { error } = await supabase.from('it_subscription_assets')
        .insert(add.map((asset_id) => ({ account_id: accountId, subscription_id: subscriptionId, asset_id })))
      if (error) return error.message
    }
    if (drop.length) {
      const { error } = await supabase.from('it_subscription_assets').delete().eq('subscription_id', subscriptionId).in('asset_id', drop)
      if (error) return error.message
    }
    return null
  },
  subscriptionsForAsset: (assetId: string) =>
    supabase.from('it_subscription_assets')
      .select('subscription:it_subscriptions(id, name, location_id, cost, billing_cycle, renewal_date, auto_renew, cancel_notice_days, deleted_at)')
      .eq('asset_id', assetId),
  assetsByIds: (ids: string[]) =>
    ids.length
      ? supabase.from('it_assets').select('id, asset_tag, name, location_id').in('id', ids)
      : Promise.resolve({ data: [] as { id: string; asset_tag: string; name: string; location_id: string }[], error: null }),

  // ---- Supplies (consumables) ----
  // Stock only moves through events (restock, used, adjustment), so every
  // change is explained; counting means an adjustment to the number on hand.
  consumables: () =>
    fetchAll<ItConsumable>((f, t) => supabase.from('it_consumables').select('*').is('deleted_at', null).order('name').range(f, t)),
  consumableEvents: (consumableId: string) =>
    supabase.from('it_consumable_events').select('*').eq('consumable_id', consumableId).order('created_at', { ascending: false }).limit(100),
  saveConsumable: (row: T['it_consumables']['Insert'] & { id?: string }) =>
    row.id
      ? supabase.from('it_consumables').update(row).eq('id', row.id).select('*').single()
      : supabase.from('it_consumables').insert(row).select('*').single(),
  removeConsumable: (id: string) => supabase.from('it_consumables').update({ deleted_at: new Date().toISOString() }).eq('id', id),
  // A count that matches what's on record still counts as counted.
  markCounted: (id: string) => supabase.from('it_consumables').update({ counted_at: new Date().toISOString() }).eq('id', id),

  // ---- Audits (walk a site, scan every sticker) ----
  auditRuns: () =>
    supabase.from('it_audit_runs').select('*').order('started_at', { ascending: false }).limit(200),
  auditRun: (id: string) => supabase.from('it_audit_runs').select('*').eq('id', id).maybeSingle(),
  auditItems: (runId: string) =>
    fetchAll<ItAuditItem>((f, t) =>
      supabase.from('it_audit_items').select(AUDIT_ITEM_SELECT).eq('audit_run_id', runId).order('created_at').range(f, t)),
  // Opens the site's audit, or the one already open there.
  startAudit: (locationId: string) => supabase.rpc('it_start_audit', { p_location: locationId }),
  auditScan: async (runId: string, tag: string, areaId: string | null) => {
    const { data, error } = await supabase.rpc('it_audit_scan', { p_run: runId, p_tag: tag, p_area: areaId ?? undefined })
    return { data: (data as AuditScan | null) ?? null, error: error?.message ?? null }
  },
  // Result, sticker, area found in, audit fields, photo, note.
  updateAuditItem: (id: string, patch: T['it_audit_items']['Update']) =>
    supabase.from('it_audit_items').update(patch).eq('id', id),
  // The rest of the list in one go ("mark the rest missing").
  markUnchecked: (runId: string, result: 'missing' | 'found') =>
    supabase.from('it_audit_items').update({ result }).eq('audit_run_id', runId).eq('result', 'not_checked'),
  completeAudit: async (runId: string, note?: string) => {
    const { data, error } = await supabase.rpc('it_complete_audit', { p_run: runId, p_note: note || undefined })
    return { data: (data as AuditSummary | null) ?? null, error: error?.message ?? null }
  },
  cancelAudit: (runId: string) => supabase.rpc('it_cancel_audit', { p_run: runId }),
  uploadAuditPhoto: async (accountId: string, runId: string, file: File) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'jpg'
    const path = `${accountId}/audit/${runId}/${crypto.randomUUID()}.${ext}`
    const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type || 'image/jpeg' })
    return error ? { path: null, error: error.message } : { path, error: null }
  },
  assetsByIdsFull: (ids: string[]) =>
    ids.length
      ? supabase.from('it_assets').select(ASSET_SELECT).in('id', ids)
      : Promise.resolve({ data: [] as ItAssetRow[], error: null }),

  // ---- Working order ----
  // "It's not working" / "It's working again". Holds until the opposite report.
  // (The site is set from the asset by trigger; it's here for the types.)
  reportHealth: (accountId: string, asset: { id: string; location_id: string }, state: 'offline' | 'online', note?: string) =>
    supabase.from('it_health_events').insert({
      account_id: accountId, location_id: asset.location_id, asset_id: asset.id, state, source: 'manual', note: note || null,
    }),
  lastHealthReport: (assetId: string) =>
    supabase.from('it_health_events').select('state, source, note, observed_at')
      .eq('asset_id', assetId).order('observed_at', { ascending: false }).limit(1).maybeSingle(),

  // ---- Reminders (admins) ----
  reminderRules: () => supabase.from('it_reminder_rules').select('*').order('kind'),
  updateReminderRule: (id: string, patch: T['it_reminder_rules']['Update']) =>
    supabase.from('it_reminder_rules').update(patch).eq('id', id),
  // Everyone in the company, for "who gets reminders" and subscription owners.
  people: () => supabase.from('users').select('id, name, role, email, phone, sms_opt_in, location_ids').order('name'),
  remindersPreview: async () => {
    const { data, error } = await supabase.functions.invoke('it-reminders', { body: { preview: true } })
    return scanResult<RemindersPreview>(data, error)
  },
  remindersTest: async () => {
    const { data, error } = await supabase.functions.invoke('it-reminders', { body: { test: true } })
    return scanResult<{ ok: true; sms: { ok: boolean; error?: string }; email: { ok: boolean; error?: string } }>(data, error)
  },

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
