import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '@/lib/auth'
import {
  itInventory,
  type ItArea,
  type ItCategory,
  type ItCustomField,
  type ItLabelTemplate,
  type ItManufacturer,
  type ItModel,
  type ItSettings,
  type ItStatusLabel,
  type ItSupplier,
} from '@/lib/queries/itInventory'

// The account's IT Inventory setup (settings, categories, statuses, areas,
// models, ...), loaded once per session and shared by every screen so a scan
// or a click into an asset never waits on it. The first staff visit runs
// it_bootstrap(), which seeds a new account and fills in any new sites.

export type ItRefs = {
  settings: ItSettings
  categories: ItCategory[]
  statuses: ItStatusLabel[]
  areas: ItArea[]
  models: ItModel[]
  manufacturers: ItManufacturer[]
  suppliers: ItSupplier[]
  templates: ItLabelTemplate[]
  fields: ItCustomField[]
  // fieldset id -> custom field ids (categories and models point at fieldsets)
  fieldsetFields: Map<string, string[]>
  category: Map<string, ItCategory>
  status: Map<string, ItStatusLabel>
  area: Map<string, ItArea>
  model: Map<string, ItModel>
  manufacturer: Map<string, ItManufacturer>
  supplier: Map<string, ItSupplier>
}

const byId = <R extends { id: string }>(rows: R[]) => new Map(rows.map((r) => [r.id, r]))

let cache: { accountId: string; refs: ItRefs } | null = null
let inflight: Promise<ItRefs> | null = null
const listeners = new Set<(r: ItRefs) => void>()

async function fetchRefs(staff: boolean): Promise<ItRefs> {
  if (staff) {
    const { error } = await itInventory.bootstrap()
    if (error) throw new Error(error.message)
  }
  const [settings, categories, statuses, areas, models, manufacturers, suppliers, templates, fields, links] = await Promise.all([
    itInventory.settings(),
    itInventory.categories(),
    itInventory.statusLabels(),
    itInventory.areas(),
    itInventory.models(),
    itInventory.manufacturers(),
    itInventory.suppliers(),
    itInventory.labelTemplates(),
    itInventory.customFields(),
    itInventory.fieldsetLinks(),
  ])
  const firstError = [settings, categories, statuses, areas, models, manufacturers, suppliers, templates, fields, links].find((r) => r.error)
  if (firstError?.error) throw new Error(firstError.error.message)
  if (!settings.data) throw new Error("IT Inventory isn't set up for your company yet. Ask an admin to open it once.")
  const c = categories.data ?? []
  const s = statuses.data ?? []
  const m = models.data
  const mf = manufacturers.data ?? []
  const sp = suppliers.data ?? []
  const fieldsetFields = new Map<string, string[]>()
  for (const l of links.data ?? []) fieldsetFields.set(l.fieldset_id, [...(fieldsetFields.get(l.fieldset_id) ?? []), l.field_id])
  return {
    settings: settings.data,
    categories: c,
    statuses: s,
    areas: areas.data,
    models: m,
    manufacturers: mf,
    suppliers: sp,
    templates: templates.data ?? [],
    fields: fields.data ?? [],
    fieldsetFields,
    category: byId(c),
    status: byId(s),
    area: byId(areas.data),
    model: byId(m),
    manufacturer: byId(mf),
    supplier: byId(sp),
  }
}

export function useItRefs() {
  const { profile } = useAuth()
  const accountId = profile?.account_id ?? null
  const staff = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'
  const [refs, setRefs] = useState<ItRefs | null>(cache && cache.accountId === accountId ? cache.refs : null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(
    async (force = false) => {
      if (!accountId) return
      if (!force && cache?.accountId === accountId) {
        setRefs(cache.refs)
        return
      }
      if (!inflight || force) {
        inflight = fetchRefs(staff).finally(() => {
          inflight = null
        })
      }
      try {
        const r = await inflight
        cache = { accountId, refs: r }
        setError(null)
        for (const l of listeners) l(r)
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    },
    [accountId, staff],
  )

  useEffect(() => {
    listeners.add(setRefs)
    void load()
    return () => {
      listeners.delete(setRefs)
    }
  }, [load])

  return { refs, error, reload: () => load(true) }
}
