import type { AssetRow, LabelSetup, MiMe, MiRefs } from '@/lib/queries/maintenanceInventory'
import type { EquipmentDetail, EquipmentInput, EquipmentStatus } from '@/lib/queries/miEquipment'
import type { ApplyReport, TemplateList, TunnelAsset, TunnelData, TunnelItem, TunnelLayout, TunnelSave } from '@/lib/queries/miTunnel'
import { supabase } from '@/lib/supabase'
import { EXPRESS_TEMPLATE_NAME, expressTemplate } from '../../expressTemplate'
import { sampleTunnel } from './fixtures'

// A stand-in for the server, for the dev page only (dev/tunnel3d-page.html): it answers
// the mi_* database functions the Tunnel page, its side panel and a machine's page call
// (and mi_areas, the one table they read directly), from sample data held in memory, so
// the whole page can be used and tested without signing in. Nothing in the app imports
// this. The answers have the shapes of lib/queries/miTunnel.ts, and the
// tunnel functions follow migration 0228 closely enough to catch a wrong payload: a save
// is turned away on a stale version, shapes are matched by uuid, the rest are replaced.

export type FakeOptions = {
  // The first site has no drawing yet.
  empty: boolean
  // 4: director (templates too), 2: site manager (can edit drawings), 1: tech (read only).
  rank: number
  // Someone else changes the drawing just before the next save lands, once.
  conflict: boolean
  // The account has the standard template.
  templates: boolean
  // Milliseconds each answer takes.
  lag: number
}

type Answer = { data: unknown; error: { message: string } | null }
type Rpc = (name: string, args?: Record<string, unknown>) => PromiseLike<Answer>

type WorkOrder = { id: string; number: number; title: string; status: string; priority: string }
type Machine = TunnelAsset & { site: string; wos: WorkOrder[] }
type Drawing = { layout: TunnelLayout; items: TunnelItem[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Ids shaped like the real ones: mi_tunnel_save tells a saved shape from a new one by it.
const uid = (group: string, n: number) => `00000000-0000-4000-8000-${group}${n.toString(16).padStart(12 - group.length, '0')}`

const SITES = [
  { id: uid('51', 7), name: 'Mighty Wash 07', site_number: 7 },
  { id: uid('51', 12), name: 'Mighty Wash 12', site_number: 12 },
]
const ME = 'Sam Sample'
const TODAY = '2026-11-12'

class Refused extends Error {}
const refuse = (message: string): never => { throw new Refused(message) }
// What crosses the wire is JSON: no shared objects, no undefined.
const wire = <T,>(v: T): T => (v === undefined ? v : (JSON.parse(JSON.stringify(v)) as T))

export function installFakeBackend(opts: FakeOptions) {
  const machines = new Map<string, Machine>()
  const drawings = new Map<string, Drawing>()
  const calls: Array<{ name: string; args: Record<string, unknown>; error: string | null }> = []
  let serial = 0
  let woNumber = 4100
  let conflictArmed = opts.conflict
  let failNext: string | null = null
  let failLoad: string | null = null
  const fresh = () => uid('ee', ++serial)
  const stamp = () => new Date().toISOString()

  // ---- Sample data ------------------------------------------------------------------
  // Every site has the standard machines; the first also has them drawn (unless empty).
  SITES.forEach((site, s) => {
    const sample = sampleTunnel()
    const assetId = (old: string) => uid(s === 0 ? 'a0' : 'b0', Number(old.slice(-2)))
    for (const a of Object.values(sample.assets)) {
      const id = assetId(a.id)
      const down = s === 0 ? a : { ...a, status: 'online' as EquipmentStatus, open_wos: 0 }
      machines.set(id, {
        ...down, id, name: a.name.replace('#07', `#${String(site.site_number).padStart(2, '0')}`), site: site.id,
        wos: Array.from({ length: down.open_wos }, (_, k) => ({ id: fresh(), number: ++woNumber, title: `${k ? 'Follow up on' : 'Check'} ${a.type ?? 'it'}`, status: 'open', priority: k ? 'medium' : 'high' })),
      })
    }
    if (s === 0 && !opts.empty) {
      const layout: TunnelLayout = {
        id: uid('1a', 1), location_id: site.id, tunnel_no: 1, name: 'Tunnel', is_template: false, length_ft: sample.layout.length_ft, width_ft: sample.layout.width_ft,
        zones: sample.layout.zones, based_on: opts.templates ? uid('7e', 1) : null, version: 3, updated_at: '2026-11-11T15:04:00.000Z', updated_by: 'Dana Director',
      }
      drawings.set(layout.id, { layout, items: sample.items.map((i, k) => ({ ...i, id: uid('10', k), asset_id: i.asset_id ? assetId(i.asset_id) : null })) })
    }
  })
  if (opts.templates) {
    const t = expressTemplate()
    drawings.set(uid('7e', 1), {
      layout: {
        id: uid('7e', 1), location_id: null, tunnel_no: 1, name: EXPRESS_TEMPLATE_NAME, is_template: true, length_ft: t.length_ft ?? 134, width_ft: t.width_ft ?? 16,
        zones: t.zones ?? [], based_on: null, version: 1, updated_at: '2026-11-11T14:30:00.000Z', updated_by: 'Dana Director',
      },
      items: (t.items ?? []).map((i, k) => ({ ...i, id: uid('7f', k) })),
    })
  }

  // ---- Helpers ----------------------------------------------------------------------
  const siteOf = (id: unknown) => SITES.find((s) => s.id === id) ?? refuse("That site isn't one of yours.")
  const need = (rank: number, what: string) => { if (opts.rank < rank) refuse(`Your role can't ${what}.`) }
  const drawingFor = (site: string, tunnel = 1) => [...drawings.values()].find((d) => d.layout.location_id === site && d.layout.tunnel_no === tunnel) ?? null
  const templates = () => [...drawings.values()].filter((d) => d.layout.is_template).sort((a, b) => a.layout.name.localeCompare(b.layout.name))
  const sorted = (items: TunnelItem[]) => [...items].sort((a, b) => a.sort_order - b.sort_order || Number(a.x_ft) - Number(b.x_ft))
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  const num = (v: unknown, fallback: number) => (v == null || v === '' || Number.isNaN(Number(v)) ? fallback : Number(v))
  const asAsset = (m: Machine): TunnelAsset => {
    const a: Partial<Machine> = { ...m, open_wos: m.wos.length }
    delete a.site
    delete a.wos
    return a as TunnelAsset
  }

  function touch(d: Drawing, by = ME) {
    d.layout = { ...d.layout, version: d.layout.version + 1, updated_at: stamp(), updated_by: by }
  }

  // ---- The functions ----------------------------------------------------------------
  function tunnelGet(a: Record<string, unknown>): TunnelData {
    const site = siteOf(a.p_site)
    const d = drawingFor(site.id, num(a.p_tunnel, 1))
    const linked = new Set((d?.items ?? []).map((i) => i.asset_id).filter((x): x is string => !!x))
    const assets: Record<string, TunnelAsset> = {}
    for (const id of linked) {
      const m = machines.get(id)
      if (m) assets[id] = asAsset(m)
    }
    return {
      layout: d?.layout ?? null,
      items: d ? sorted(d.items) : [],
      assets,
      site: { id: site.id, name: site.name, site_number: site.site_number, cars_today: 412, cars_30d: 14380, data_through: TODAY },
      tunnels: [...drawings.values()].filter((x) => x.layout.location_id === site.id).sort((x, y) => x.layout.tunnel_no - y.layout.tunnel_no).map((x) => ({ tunnel_no: x.layout.tunnel_no, name: x.layout.name })),
      unplaced: [...machines.values()].filter((m) => m.site === site.id && !m.parent_id && m.status !== 'retired' && !linked.has(m.id))
        .sort((x, y) => x.name.localeCompare(y.name)).map((m) => ({ id: m.id, name: m.name, type: m.type ?? null, status: m.status, area_name: m.area_name ?? null })),
      templates: templates().map((t) => ({ id: t.layout.id, name: t.layout.name, items: t.items.length })),
      can_edit: opts.rank >= 2,
      can_edit_templates: opts.rank >= 4,
    }
  }

  function tunnelTemplates(): TemplateList {
    return {
      templates: templates().map((t) => ({ ...t.layout, items: t.items.length, sites_using: [...drawings.values()].filter((d) => d.layout.based_on === t.layout.id).length })),
      site_layouts: [...drawings.values()].filter((d) => !d.layout.is_template).map((d) => ({
        location_id: d.layout.location_id ?? '', tunnel_no: d.layout.tunnel_no, name: d.layout.name, based_on: d.layout.based_on, updated_at: d.layout.updated_at,
        items: d.items.length, linked: d.items.filter((i) => i.asset_id).length,
      })),
      can_edit_templates: opts.rank >= 4,
    }
  }

  function tunnelTemplate(a: Record<string, unknown>) {
    const d = drawings.get(String(a.p_layout))
    if (!d || !d.layout.is_template) return refuse('Template not found.')
    return { layout: d.layout, items: sorted(d.items), can_edit: opts.rank >= 4 }
  }

  function tunnelSave(a: Record<string, unknown>): { id: string; version: number } {
    const p = (a.p ?? {}) as TunnelSave
    let d = p.id ? drawings.get(p.id) ?? refuse('Diagram not found.') : null
    if (d && !d.layout.is_template && conflictArmed) {
      conflictArmed = false
      someoneElse(d)
    }
    if (d && 'version' in p && Number(p.version) !== d.layout.version) {
      return refuse('Someone else changed this diagram while you were editing. Reload to see their changes.')
    }
    const template = d ? d.layout.is_template : !!p.is_template
    const site = d ? d.layout.location_id : template ? null : text(p.location_id)
    if (!template && !site) return refuse('Pick a site.')
    if (template) need(4, 'change tunnel templates')
    else {
      need(2, 'change tunnel diagrams')
      siteOf(site)
    }
    const sent = p.items ?? []
    if (!Array.isArray(sent)) return refuse('Items must be a list.')
    if (sent.length > 400) return refuse("That's more than 400 shapes. Split it into a second tunnel.")
    const strangers = sent.filter((i) => i.asset_id && (template || machines.get(i.asset_id)?.site !== site)).map((i) => machines.get(i.asset_id ?? '')?.name ?? String(i.asset_id))
    if (strangers.length) return refuse(template ? "A template can't be linked to real machines. Use the type instead." : `These aren't at this site: ${[...new Set(strangers)].join(', ')}`)

    if (!d) {
      const name = text(p.name) ?? (template ? 'Tunnel template' : 'Tunnel')
      const tunnel = num(p.tunnel_no, 1)
      if (template ? templates().some((t) => t.layout.name.toLowerCase() === name.toLowerCase()) : !!drawingFor(site ?? '', tunnel)) {
        return refuse(template ? "There's already a template with that name." : 'This site already has a diagram for that tunnel.')
      }
      d = {
        layout: {
          id: fresh(), location_id: site, tunnel_no: tunnel, name, is_template: template, length_ft: num(p.length_ft, 140), width_ft: num(p.width_ft, 16),
          zones: p.zones ?? [], based_on: text(p.based_on), version: 1, updated_at: stamp(), updated_by: ME,
        },
        items: [],
      }
      drawings.set(d.layout.id, d)
    } else {
      d.layout = { ...d.layout, name: text(p.name) ?? d.layout.name, length_ft: num(p.length_ft, d.layout.length_ft), width_ft: num(p.width_ft, d.layout.width_ft), zones: p.zones ?? d.layout.zones }
      touch(d)
    }

    if ('items' in p) {
      const before = new Map(d.items.map((i) => [i.id, i]))
      // A shape whose id is a saved one is updated in place; anything else is new, and
      // whatever the payload leaves out is gone.
      d.items = sent.map((it, n) => ({
        id: it.id && UUID.test(it.id) && before.has(it.id) ? it.id : fresh(),
        kind: String(it.kind), label: it.label ?? '', x_ft: num(it.x_ft, 0), y_ft: num(it.y_ft, 0), w_ft: num(it.w_ft, 4), h_ft: num(it.h_ft, 4),
        rotation: num(it.rotation, 0) as TunnelItem['rotation'], side: it.side || 'center', zone: text(it.zone), match_type: text(it.match_type),
        asset_id: text(it.asset_id), sort_order: num(it.sort_order, n), props: it.props ?? {},
      }))
    }
    return { id: d.layout.id, version: d.layout.version }
  }

  function tunnelLinkItem(a: Record<string, unknown>): { version: number } {
    need(2, 'change tunnel diagrams')
    const d = [...drawings.values()].find((x) => x.items.some((i) => i.id === a.p_item)) ?? refuse("That shape isn't on a diagram anymore. Reload.")
    if (d.layout.is_template) return refuse('Templates link by type, not to machines.')
    const asset = text(a.p_asset)
    if (asset && machines.get(asset)?.site !== d.layout.location_id) return refuse("That machine isn't at this site.")
    d.items = d.items.map((i) => (i.id === a.p_item ? { ...i, asset_id: asset } : i))
    touch(d)
    return { version: d.layout.version }
  }

  // A plain version of mi_tunnel_apply: each shape links to the site's machine of its type.
  function tunnelApply(a: Record<string, unknown>): ApplyReport {
    const source = drawings.get(String(a.p_source)) ?? refuse('Diagram not found.')
    const o = (a.p_opts ?? {}) as { mode?: string; tunnel_no?: number }
    const commit = a.p_commit === true
    need(2, 'set up tunnel diagrams')
    const sites = (a.p_sites as string[] | undefined) ?? []
    if (sites.length > 1) need(4, 'set up several sites at once')
    const report: ApplyReport = { committed: commit, sites: [] }
    for (const id of sites) {
      const site = siteOf(id)
      const tunnel = num(o.tunnel_no, 1)
      const had = drawingFor(site.id, tunnel)
      if (had && o.mode !== 'replace') {
        report.sites.push({ site_id: site.id, site_name: site.name, result: 'skipped' })
        continue
      }
      const here = [...machines.values()].filter((m) => m.site === site.id && m.status !== 'retired')
      const unmatched: string[] = []
      const items = sorted(source.items).map((i) => {
        const m = i.match_type ? here.find((x) => x.type === i.match_type) : undefined
        if (i.match_type && !m) unmatched.push(i.label || i.match_type)
        return { ...i, id: fresh(), asset_id: m?.id ?? null }
      })
      report.sites.push({
        site_id: site.id, site_name: site.name, result: had ? 'replaced' : 'created', items: items.length, linked: items.filter((i) => i.asset_id).length,
        unmatched, ambiguous: [], zones_created: commit ? source.layout.zones.length : 0, areas_set: 0,
      })
      if (!commit) continue
      if (had) drawings.delete(had.layout.id)
      const layout: TunnelLayout = {
        ...source.layout, id: fresh(), location_id: site.id, tunnel_no: tunnel, name: 'Tunnel', is_template: false,
        based_on: source.layout.is_template ? source.layout.id : source.layout.based_on, version: 1, updated_at: stamp(), updated_by: ME,
      }
      drawings.set(layout.id, { layout, items })
    }
    return report
  }

  function tunnelDelete(a: Record<string, unknown>) {
    const d = drawings.get(String(a.p_layout)) ?? refuse('Diagram not found.')
    need(d.layout.is_template ? 4 : 2, 'remove tunnel diagrams')
    drawings.delete(d.layout.id)
  }

  function equipmentDetail(a: Record<string, unknown>): EquipmentDetail & { hidden?: boolean; message?: string } {
    const m = machines.get(String(a.p_asset)) ?? refuse('That machine was not found.')
    const site = siteOf(m.site)
    const counted = m.cars_since != null
    return {
      asset: {
        id: m.id, name: m.name, type: m.type ?? null, status: m.status, description: null, location_id: m.site, manufacturer: 'MacNeil', model: null, serial_number: null,
        install_date: m.usage_since ?? null, purchase_date: null, warranty_expiry: null, crit_class: m.crit_class ?? null, area_id: null, vendor_id: null,
        site_name: site.name, area_name: m.area_name ?? null, vendor_name: null, parent_name: null, parent_asset_id: null, tag: m.tag ?? null, can_manage: opts.rank >= 2,
        asset_number: null, usage_basis: m.usage_basis ?? 'all_cars', last_audited_at: null, last_serviced_at: m.last_serviced_at ?? null, retired_at: null, maintainx_id: null,
        tag_printed_count: m.tag_printed ? 1 : 0, tag_last_printed_at: m.tag_printed ? '2026-11-03T16:00:00.000Z' : null, tag_condition: m.tag ? 'ok' : null,
        site_number: site.site_number, can_move_site: opts.rank >= 4,
      },
      children: [], ancestors: [], bom: [],
      open_work_orders: m.wos,
      service_history: [], parts_cost: 0, parts_used: [],
      usage: {
        asset_id: m.id, basis: m.usage_basis ?? 'all_cars', since: m.usage_since ?? null, since_source: m.usage_since ? 'install' : null, cars_since: m.cars_since ?? null,
        cars_today: 412, cars_30d: 14380, cars_12m: 171200, cars_all: 402000, data_from: '2024-01-01', data_through: TODAY, state: counted ? 'ok' : 'not_counted',
      },
      resets: [],
      diagram: [...drawings.values()].filter((d) => d.layout.location_id === m.site)
        .flatMap((d) => sorted(d.items).filter((i) => i.asset_id === m.id).map((i) => ({ layout_id: d.layout.id, item_id: i.id, label: i.label, tunnel_no: d.layout.tunnel_no, via_parent: false }))),
    }
  }

  function assetsList(a: Record<string, unknown>): AssetRow[] {
    const site = siteOf(a.p_site)
    const q = (text(a.p_q) ?? '').toLowerCase()
    return [...machines.values()].filter((m) => m.site === site.id && (!q || m.name.toLowerCase().includes(q))).sort((x, y) => x.name.localeCompare(y.name))
      .map((m) => ({ id: m.id, name: m.name, type: m.type ?? null, status: m.status, parent_id: m.parent_id ?? null, crit_class: m.crit_class ?? null, area_id: null, area_name: m.area_name ?? null, bom_lines: 0 }))
  }

  // Add a machine (the panel's New, on a shape with nothing linked) or edit one.
  function equipmentSave(a: Record<string, unknown>): { id: string; name: string } {
    need(2, 'change machines')
    const p = (a.p ?? {}) as EquipmentInput
    const fields = (m: Machine): Machine => ({
      ...m, name: text(p.name) ?? m.name, type: text(p.type) ?? undefined, status: p.status ?? m.status,
      crit_class: (text(p.crit_class) ?? undefined) as Machine['crit_class'], area_name: text(p.area_name) ?? undefined,
    })
    if (p.id) {
      const m = machines.get(p.id) ?? refuse('That machine was not found.')
      machines.set(m.id, fields(m))
      return { id: m.id, name: machines.get(m.id)!.name }
    }
    const site = siteOf(p.location_id).id
    if (!text(p.name)) return refuse('Give the machine a name.')
    const m = fields({ id: uid('c0', ++serial), name: '', status: 'online', open_wos: 0, children: 0, site, wos: [] })
    machines.set(m.id, m)
    return { id: m.id, name: m.name }
  }

  function createWorkOrder(a: Record<string, unknown>) {
    const wo: WorkOrder = { id: fresh(), number: ++woNumber, title: String(a.p_title ?? 'Work order'), status: 'open', priority: String(a.p_priority ?? 'medium') }
    machines.get(String(a.p_asset))?.wos.push(wo)
    return { id: wo.id, number: wo.number }
  }

  function equipmentBulk(a: Record<string, unknown>) {
    need(2, 'change machines')
    const hit = ((a.p_ids as string[] | undefined) ?? []).map((id) => machines.get(id)).filter((m): m is Machine => !!m)
    if (a.p_op !== 'status' && a.p_op !== 'crit') return refuse(`The dev page can't change a machine's ${String(a.p_op)}.`)
    for (const m of hit) {
      if (a.p_op === 'status') m.status = String(a.p_value) as EquipmentStatus
      else m.crit_class = String(a.p_value) as Machine['crit_class']
    }
    return { changed: hit.length }
  }

  function resetUsage(a: Record<string, unknown>) {
    const m = machines.get(String(a.p_asset)) ?? refuse('That machine was not found.')
    m.usage_since = text(a.p_on) ?? TODAY
    m.cars_since = 0
    return { ok: true, id: fresh() }
  }

  const me = (): MiMe => ({
    member: true, role: opts.rank >= 4 ? 'corporate_maintenance_director' : opts.rank >= 2 ? 'site_manager' : 'site_tech', rank: opts.rank, site_ids: SITES.map((s) => s.id),
    region_names: [], my_regions: [], has_sample_data: true,
    settings: {
      account_id: uid('ac', 1), sms_enabled: false, quiet_start_hour: 21, quiet_end_hour: 7, timezone: 'America/Chicago', count_variance_threshold: 100, count_tolerance_pct: 5,
      po_limits: {}, stale_days: 180, carrying_rate: 0.2, auto_counts_enabled: false, count_schedule: { critical_days: 30, a_days: 60, b_days: 90, c_days: 180 }, high_value_photo_cost: null,
    },
  })
  const refs = (): MiRefs => ({ sites: SITES.map(({ id, name }) => ({ id, name })), locations: [], bins: [], categories: [], vendors: [], people: [], regions: [] })
  const labelSetup = (): LabelSetup => ({ settings: { short_code: 'DEV', support_phone: null, label_logo_path: null, label_show_logo: false }, templates: [] })

  const answers: Record<string, (a: Record<string, unknown>) => unknown> = {
    mi_me: me,
    mi_refs: refs,
    mi_tunnel_get: tunnelGet,
    mi_tunnel_templates: tunnelTemplates,
    mi_tunnel_template: tunnelTemplate,
    mi_tunnel_save: tunnelSave,
    mi_tunnel_link_item: tunnelLinkItem,
    mi_tunnel_apply: tunnelApply,
    mi_tunnel_delete: tunnelDelete,
    mi_equipment_detail: equipmentDetail,
    mi_assets_list: assetsList,
    mi_create_work_order: createWorkOrder,
    mi_equipment_bulk: equipmentBulk,
    mi_equipment_save: equipmentSave,
    mi_reset_usage: resetUsage,
    mi_label_setup: labelSetup,
    mi_schedules_list: () => [],
    mi_equipment_timeline: () => [],
    mi_parts_list: () => ({ total: 0, rows: [] }),
  }

  // ---- "Someone else" ---------------------------------------------------------------
  // What a second person saving first looks like from here: the drawing changes and its
  // version moves on. By default they slide the Short Brush two feet toward the exit.
  function someoneElse(d: Drawing, edit?: (items: TunnelItem[]) => TunnelItem[]) {
    d.items = edit ? edit(d.items) : d.items.map((i) => (i.label === 'Short Brush' ? { ...i, x_ft: Number(i.x_ft) + 2 } : i))
    touch(d, 'Dana Director')
  }

  // ---- Tables read straight from the client ---------------------------------------------
  // Only one is within reach of this page: mi_areas, a site's zones, which the machine form
  // offers as suggestions (lib/queries/maintenanceInventory.ts: areas, addArea). Made from the
  // zones the sample machines stand in. Any other table is turned away by name.
  const areas = new Map<string, { id: string; site_id: string; name: string; sort_order: number }>()
  for (const m of machines.values()) {
    if (m.area_name && ![...areas.values()].some((x) => x.site_id === m.site && x.name === m.area_name)) {
      const id = uid('ae', areas.size + 1)
      areas.set(id, { id, site_id: m.site, name: m.area_name, sort_order: areas.size })
    }
  }
  // Just enough of supabase-js's query builder for those two calls: eq filters, rows by
  // sort_order then name, insert, single. Any other method chains and is ignored; any other
  // write is turned away. Awaiting it answers the way PostgREST does, after the same lag.
  function table(name: string): unknown {
    const eq: Array<[string, unknown]> = []
    let write: { how: string; row: Record<string, unknown> } | null = null
    let one = false
    const run = (): Answer => {
      if (name !== 'mi_areas') return refuse(`The dev page has no table ${name}.`)
      if (write) {
        if (write.how !== 'insert') return refuse(`The dev page can't ${write.how} zones.`)
        need(2, 'add zones')
        const id = uid('ae', areas.size + 1)
        const area = { id, site_id: String(write.row.site_id), name: String(write.row.name ?? '').trim(), sort_order: areas.size }
        if (!area.name) return refuse('Give the zone a name.')
        areas.set(id, area)
        return { data: wire(one ? area : [area]), error: null }
      }
      const rows = [...areas.values()].filter((x) => eq.every(([k, v]) => (x as Record<string, unknown>)[k] === v))
        .sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name))
      return { data: wire(one ? rows[0] ?? null : rows), error: null }
    }
    const answer = () => new Promise<Answer>((resolve) => window.setTimeout(() => {
      let out: Answer
      try {
        out = run()
      } catch (e) {
        if (!(e instanceof Refused)) throw e
        out = { data: null, error: { message: e.message } }
      }
      calls.push({ name: `from:${name}`, args: { eq: Object.fromEntries(eq), write }, error: out.error?.message ?? null })
      resolve(out)
    }, opts.lag))
    const q: object = new Proxy({}, {
      get: (_, key) => {
        if (key === 'then') return (ok?: (v: Answer) => unknown, fail?: (e: unknown) => unknown) => answer().then(ok, fail)
        if (key === 'eq') return (k: string, v: unknown) => { eq.push([k, v]); return q }
        if (key === 'single' || key === 'maybeSingle') return () => { one = true; return q }
        if (key === 'insert' || key === 'update' || key === 'upsert' || key === 'delete') {
          return (row?: Record<string, unknown>) => { write = { how: key, row: row ?? {} }; return q }
        }
        return () => q
      },
    })
    return q
  }

  // ---- Wrapping the client ------------------------------------------------------------
  const client = supabase as unknown as { rpc: Rpc; from: (name: string) => unknown }
  client.from = table
  const real = client.rpc.bind(supabase)
  let onAnswer: (name: string) => void = () => {}
  client.rpc = (name, args = {}) => {
    const answer = answers[name]
    if (!name.startsWith('mi_')) return real(name, args)
    return new Promise<Answer>((resolve) => {
      window.setTimeout(() => {
        let out: Answer
        try {
          if (name === 'mi_tunnel_save' && failNext) {
            const message = failNext
            failNext = null
            refuse(message)
          }
          if (name === 'mi_tunnel_get' && failLoad) {
            const message = failLoad
            failLoad = null
            refuse(message)
          }
          if (!answer) refuse(`The dev page has no answer for ${name}.`)
          out = { data: wire(answer(wire(args))) ?? null, error: null }
        } catch (e) {
          if (!(e instanceof Refused)) throw e
          out = { data: null, error: { message: e.message } }
        }
        calls.push({ name, args: wire(args), error: out.error?.message ?? null })
        resolve(out)
        onAnswer(name)
      }, opts.lag)
    })
  }

  return {
    sites: SITES,
    me, refs,
    // Every call answered so far, with what was sent.
    calls,
    // The drawing the server holds for a site, as it is right now.
    drawing: (site = SITES[0].id, tunnel = 1) => wire(drawingFor(site, tunnel)),
    machine: (id: string) => wire(machines.get(id) ?? null),
    // Change a site's drawing as a second person would (bumps its version).
    someoneElse: (edit?: (items: TunnelItem[]) => TunnelItem[], site = SITES[0].id) => {
      const d = drawingFor(site)
      if (d) someoneElse(d, edit)
    },
    armConflict: () => { conflictArmed = true },
    // The next save is turned away with this message, whatever it sends.
    failNextSave: (message: string) => { failNext = message },
    // The next load of a drawing is turned away (a reload that fails after a save went through).
    failNextLoad: (message: string) => { failLoad = message },
    setStatus: (assetId: string, status: EquipmentStatus) => { const m = machines.get(assetId); if (m) m.status = status },
    onAnswer: (fn: (name: string) => void) => { onAnswer = fn },
  }
}

export type FakeBackend = ReturnType<typeof installFakeBackend>
