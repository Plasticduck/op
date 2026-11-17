import type { PhotoProposal, PhotoProposalItem, PhotosRequest, TunnelItem, TunnelSave, TunnelSide, TunnelZone } from '@/lib/queries/miTunnel'
import { acrossLocked, conveyorPatch, conveyorType, tidyBelts, type ConveyorType } from '../conveyorType'
import { zoneAt, type Draft } from '../useEditorState'

// What a drawing read from photos (miTunnel.fromPhotos) becomes once accepted. No React
// here, so it can be checked on its own.
//
// Create: the proposal is the drawing. Update: the drawing as it is on screen (unsaved
// moves included) is the start, and the proposal only corrects it. A shape it names keeps
// everything that makes it that shape (its id, so its history and links survive; its
// kind, name, machine and props) and takes where the photos put it and how big. A shape
// it doesn't name stays exactly as it is. A shape it says is gone goes only if the person
// leaves that ticked. The zone bands are the drawing's own.

export type Catalog = PhotosRequest['catalog']

// Within half a foot (the editor's snap) is the same reading: the shape stays exactly as
// it was, so a drawing the photos agree with comes back unchanged and "untouched" is true.
const NEAR = 0.5

const SIDES: TunnelSide[] = ['ds', 'ps', 'center', 'both', 'outside']
const round = (v: number) => Math.round(v * 10) / 10
const feet = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? round(v) : null)
const text = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)
const clamp = (v: unknown, lo: number, hi: number, fallback: number) => {
  const n = feet(v)
  return n == null ? fallback : Math.min(hi, Math.max(lo, n))
}
const turned = (i: Pick<TunnelItem, 'rotation'>) => i.rotation === 90 || i.rotation === 270

type Clean = Omit<PhotoProposalItem, 'x_ft' | 'y_ft' | 'w_ft' | 'h_ft'> & { x_ft: number | null; y_ft: number | null; w_ft: number; h_ft: number }

// An item as the model wrote it, made safe to draw: a kind the drawing knows (else plain
// equipment), a real side, sizes above zero. A position it didn't give stays null.
function clean(raw: PhotoProposalItem, kinds: Map<string, Catalog[number]>): Clean {
  const def = kinds.get(raw.kind)
  const kind = def ? raw.kind : 'equipment'
  const d = def ?? kinds.get('equipment') ?? { w: 8, h: 6, side: 'outside' as TunnelSide }
  const size = (v: unknown, fallback: number) => { const n = feet(v); return n != null && n > 0 ? n : fallback }
  return {
    ref: text(raw.ref),
    kind,
    label: text(raw.label) ?? '',
    x_ft: feet(raw.x_ft),
    y_ft: feet(raw.y_ft),
    w_ft: size(raw.w_ft, d.w),
    h_ft: size(raw.h_ft, d.h),
    side: SIDES.includes(raw.side) ? raw.side : d.side,
    zone: text(raw.zone),
    asset_id: text(raw.asset_id),
    match_type: text(raw.match_type),
    conveyor_type: raw.conveyor_type === 'belt' || raw.conveyor_type === 'chain' ? raw.conveyor_type : null,
    confidence: raw.confidence === 'low' || raw.confidence === 'medium' ? raw.confidence : 'high',
    photos: Array.isArray(raw.photos) ? raw.photos.filter((n) => Number.isInteger(n) && n > 0) : [],
  }
}

function cleanZones(zones: unknown): TunnelZone[] {
  if (!Array.isArray(zones)) return []
  return zones.flatMap((z: Partial<TunnelZone> | null) => {
    const name = text(z?.name)
    const from = feet(z?.x_from)
    const to = feet(z?.x_to)
    return name && from != null && to != null && to > from ? [{ name, x_from: from, x_to: to }] : []
  })
}

// A shape in the tunnel takes the zone band it stands in, as one dropped in the editor
// does. Beside the tunnel it keeps the zone it has.
const zoneFor = (zones: TunnelZone[], side: TunnelSide, x: number, had: string | null) => (side === 'outside' ? had : zoneAt(zones, x) ?? had)

// A conveyor the photos show as a belt gets the belt's footprint, centered on the car's
// line, so the 2D drawing lies over the 3D belts. No chain_at: where the model would put
// a chain is no place a chain stood.
function asConveyor(item: TunnelItem, type: ConveyorType | null): TunnelItem {
  if (item.kind !== 'conveyor' || !type) return item
  const typed = { ...item, props: { ...item.props, conveyor_type: type } }
  return type === 'belt' ? { ...typed, ...conveyorPatch(typed, 'belt') } : typed
}

// The save payload's shapes, as the editor sends them: a new shape has no id, and the
// order on the drawing is the saved order.
export function saveItems(items: TunnelItem[]): NonNullable<TunnelSave['items']> {
  return items.map(({ id, ...rest }, k) => ({ ...(id.startsWith('new-') ? {} : { id }), ...rest, sort_order: k }))
}

const nameOf = (i: Pick<TunnelItem, 'label' | 'kind'>, kinds: Map<string, Catalog[number]>) => i.label || kinds.get(i.kind)?.label || i.kind

// A new shape's id until it is saved: new- tells the save it is new (as the editor's
// tempId does), and the proposal's own numbering keeps it the same shape each time the
// plan is worked out again (a removal ticked or unticked), so it can stay picked.
const newId = (k: number) => `new-photo-${k}`

// ---- Create -------------------------------------------------------------------------

export type CreatePlan = {
  draft: Draft
  save: TunnelSave
  // Shapes that stand for a machine, and how many of them were linked to one.
  machines: number
  linked: number
  // Shapes the photos didn't show, placed where a typical tunnel has them.
  unseen: number
  // Names of the shapes it wasn't sure of.
  unsure: string[]
}

export function planCreate(p: PhotoProposal, at: { site_id: string; tunnel_no: number; name?: string }, catalog: Catalog): CreatePlan {
  const kinds = new Map(catalog.map((c) => [c.kind, c]))
  const zones = cleanZones(p.zones)
  const length_ft = clamp(p.length_ft, 20, 400, 134)
  const width_ft = clamp(p.width_ft, 8, 60, 16)
  const unsure: string[] = []
  let unseen = 0
  const items: TunnelItem[] = []
  for (const [k, raw] of (p.items ?? []).entries()) {
    const i = clean(raw, kinds)
    if (i.x_ft == null || i.y_ft == null) continue
    // The zone it gives is kept, none included: a conveyor the length of the tunnel is in
    // no one band, as in the templates.
    const item: TunnelItem = {
      id: newId(k), kind: i.kind, label: i.label, x_ft: i.x_ft, y_ft: i.y_ft, w_ft: i.w_ft, h_ft: i.h_ft, rotation: 0, side: i.side,
      zone: i.zone, match_type: i.match_type, asset_id: i.asset_id, sort_order: items.length, props: {},
    }
    items.push(asConveyor(item, i.conveyor_type))
    if (i.confidence === 'low') unsure.push(nameOf(item, kinds))
    if (i.photos.length === 0) unseen++
  }
  const draft: Draft = { length_ft, width_ft, zones, items: tidyBelts(items) }
  const machines = draft.items.filter((i) => !kinds.get(i.kind)?.scenery)
  return {
    draft,
    save: { location_id: at.site_id, tunnel_no: at.tunnel_no, name: at.name ?? 'Tunnel', length_ft, width_ft, zones, items: saveItems(draft.items) },
    machines: machines.length,
    linked: machines.filter((i) => i.asset_id).length,
    unseen,
    unsure,
  }
}

// ---- Update -------------------------------------------------------------------------

export type ChangeKind = 'added' | 'moved' | 'resized' | 'linked' | 'conveyor' | 'removed' | 'tunnel'
// One line of what would change. id is the shape's (a new one's temporary id), for
// pointing it out on the drawing; asset_id is the machine a link is to.
export type Change = { id: string | null; what: ChangeKind; name: string; detail?: string; asset_id?: string }
export type Removal = { ref: string; name: string; reason: string; removed: boolean }
// unsaved: shapes the person moved and hasn't saved, left where they put them, so saved
// with the rest. untouched leaves those out: they don't stay as saved.
export type UpdateCounts = { added: number; moved: number; resized: number; linked: number; removed: number; untouched: number; unsaved: number }

// The saved drawing the function read when the photos were analyzed. The answer repeats
// most of it (the function copies what the photos agree with, to within about a foot), and
// a repeat says nothing new about a shape. So whatever has happened to the shape since
// stands: this person's unsaved move, or someone else's save brought in by a reload after
// a clash. Without it the drawing as it is now is taken as what was read.
export type Seen = Pick<Draft, 'length_ft' | 'width_ft' | 'items'>
export type UpdateOptions = {
  seen?: Seen | null
  // Shapes with a move the person hasn't saved (current has them where they put them).
  moved?: ReadonlySet<string>
}

export type UpdatePlan = {
  draft: Draft
  items: NonNullable<TunnelSave['items']>
  counts: UpdateCounts
  changes: Change[]
  removals: Removal[]
  unsure: string[]
  // Shapes the photos placed that have been taken off the drawing since they were read.
  // They stay off: putting them back would undo whoever deleted them.
  deleted: string[]
  // Whether saving would change anything.
  changed: boolean
}

const ft = (v: number) => `${round(Math.abs(v))} ft`
// Which way a shape moved, as the person standing in the tunnel would say it.
function moveText(dx: number, dy: number): string {
  const along = Math.abs(dx) > NEAR ? `${ft(dx)} toward the ${dx > 0 ? 'exit' : 'entrance'}` : ''
  const across = Math.abs(dy) > NEAR ? `${ft(dy)} toward the ${dy > 0 ? 'passenger side' : "driver's side"}` : ''
  return [along, across].filter(Boolean).join(', ')
}

// A turned shape's own w and h run the other way: these are along and across the tunnel.
const along = (i: Pick<TunnelItem, 'rotation' | 'w_ft' | 'h_ft'>) => Number(turned(i) ? i.h_ft : i.w_ft)
const across = (i: Pick<TunnelItem, 'rotation' | 'w_ft' | 'h_ft'>) => Number(turned(i) ? i.w_ft : i.h_ft)

// kept: the removals the person unticked, by ref. Every other removal of a shape on the
// drawing goes ahead.
export function planUpdate(p: PhotoProposal, current: Draft, kept: ReadonlySet<string>, catalog: Catalog, opts: UpdateOptions = {}): UpdatePlan {
  const kinds = new Map(catalog.map((c) => [c.kind, c]))
  const zones = current.zones
  const byId = new Map(current.items.map((i) => [i.id, i]))
  const read = new Map((opts.seen?.items ?? []).map((i) => [i.id, i]))
  const moved = opts.moved ?? new Set<string>()
  const changes: Change[] = []
  const unsure: string[] = []
  const deleted: string[] = []
  // Shapes this plan puts somewhere else, so an unsaved move on one is replaced, not saved.
  const placed = new Set<string>()

  const removals: Removal[] = []
  for (const r of p.removed ?? []) {
    const cur = byId.get(r?.ref)
    if (!cur || removals.some((x) => x.ref === cur.id)) continue
    removals.push({ ref: cur.id, name: nameOf(cur, kinds), reason: text(r.reason) ?? '', removed: !kept.has(cur.id) })
  }
  const gone = new Set(removals.filter((r) => r.removed).map((r) => r.ref))

  // A machine is linked to one shape here. One already on the drawing isn't linked again.
  const linkedTo = new Set(current.items.filter((i) => i.asset_id && !gone.has(i.id)).map((i) => i.asset_id as string))
  const link = (asset: string | null) => {
    if (!asset || linkedTo.has(asset)) return null
    linkedTo.add(asset)
    return asset
  }

  const updated = new Map<string, TunnelItem>()
  const added: TunnelItem[] = []
  const counts: UpdateCounts = { added: 0, moved: 0, resized: 0, linked: 0, removed: gone.size, untouched: 0, unsaved: 0 }

  for (const [k, raw] of (p.items ?? []).entries()) {
    const i = clean(raw, kinds)
    const cur = i.ref ? byId.get(i.ref) : undefined
    // A shape named twice keeps the first reading. One the person is removing isn't changed.
    if (cur && (updated.has(cur.id) || gone.has(cur.id))) continue

    if (!cur) {
      // A shape the function read that has been deleted since stays deleted, and is named.
      const was = i.ref ? read.get(i.ref) : undefined
      if (was) {
        const name = nameOf(was, kinds)
        if (!deleted.includes(name)) deleted.push(name)
        continue
      }
      // Not on the drawing: a new shape, where the photos put it.
      if (i.x_ft == null || i.y_ft == null) continue
      const item = asConveyor({
        id: newId(k), kind: i.kind, label: i.label, x_ft: i.x_ft, y_ft: i.y_ft, w_ft: i.w_ft, h_ft: i.h_ft, rotation: 0, side: i.side,
        zone: zoneFor(zones, i.side, i.x_ft, i.zone), match_type: i.match_type, asset_id: link(i.asset_id), sort_order: 0, props: {},
      }, i.conveyor_type)
      added.push(item)
      counts.added++
      changes.push({ id: item.id, what: 'added', name: nameOf(item, kinds), ...(item.asset_id ? { asset_id: item.asset_id } : {}) })
      if (i.confidence === 'low') unsure.push(nameOf(item, kinds))
      continue
    }

    const name = nameOf(cur, kinds)
    // The shape as the function read it. Each reading is checked against that first: one
    // that repeats it (within NEAR) leaves the shape as it is now, and only one that differs
    // is the photos' word. With nothing changed since, that is the same as checking against
    // the drawing as it is.
    const base = read.get(cur.id) ?? cur
    const news = (v: number, was: number, now: number) => Math.abs(v - was) > NEAR && Math.abs(v - now) > NEAR
    let next: TunnelItem = cur
    // A conveyor the photos show as the other type changes the way the editor's Conveyor
    // type does: the footprint across the tunnel comes with the type (and a chain goes back
    // where it stood before it was a belt). Along the tunnel the photos still decide.
    const want = cur.kind === 'conveyor' ? i.conveyor_type : null
    if (want && want !== conveyorType(base.props) && want !== conveyorType(cur.props)) {
      next = { ...next, ...conveyorPatch(next, want) }
      changes.push({ id: cur.id, what: 'conveyor', name, detail: want === 'belt' ? 'Now a belt conveyor' : 'Now a chain conveyor' })
    }
    // A belt in the tunnel never moves across it (acrossLocked): only along.
    const locked = acrossLocked(next)
    const x = i.x_ft != null && news(i.x_ft, Number(base.x_ft), Number(next.x_ft)) ? i.x_ft : Number(next.x_ft)
    const y = !locked && i.y_ft != null && news(i.y_ft, Number(base.y_ft), Number(next.y_ft)) ? i.y_ft : Number(next.y_ft)
    const dx = x - Number(next.x_ft)
    const dy = y - Number(next.y_ft)
    if (dx !== 0 || dy !== 0) {
      const side = locked || i.side === base.side ? next.side : i.side
      next = { ...next, x_ft: x, y_ft: y, side, zone: zoneFor(zones, side, x, next.zone) }
      placed.add(cur.id)
      counts.moved++
      changes.push({ id: cur.id, what: 'moved', name, detail: moveText(dx, dy) })
    }
    // The proposal's sizes run along and across the tunnel.
    const newAlong = news(i.w_ft, along(base), along(next)) ? i.w_ft : along(next)
    const newAcross = !locked && news(i.h_ft, across(base), across(next)) ? i.h_ft : across(next)
    if (newAlong !== along(next) || newAcross !== across(next)) {
      changes.push({ id: cur.id, what: 'resized', name, detail: `${round(along(next))} by ${round(across(next))} ft to ${round(newAlong)} by ${round(newAcross)} ft` })
      next = turned(next) ? { ...next, w_ft: newAcross, h_ft: newAlong } : { ...next, w_ft: newAlong, h_ft: newAcross }
      counts.resized++
    }
    // Only a shape with no machine is linked: a link someone made stays theirs.
    if (!cur.asset_id && !kinds.get(cur.kind)?.scenery) {
      const asset = link(i.asset_id)
      if (asset) {
        next = { ...next, asset_id: asset }
        counts.linked++
        changes.push({ id: cur.id, what: 'linked', name, asset_id: asset })
      }
    }
    if (next !== cur) {
      updated.set(cur.id, next)
      if (i.confidence === 'low') unsure.push(name)
    }
  }

  for (const r of removals) if (r.removed) changes.push({ id: r.ref, what: 'removed', name: r.name, detail: r.reason || undefined })

  // The tunnel's own size changes only when the photos say clearly otherwise (more than a
  // foot off both what was read and what it is now).
  const size = (v: unknown, lo: number, hi: number, was: number, now: number) => {
    const n = clamp(v, lo, hi, now)
    return Math.abs(n - was) > 1 && Math.abs(n - now) > 1 ? n : now
  }
  const length_ft = size(p.length_ft, 20, 400, opts.seen?.length_ft ?? current.length_ft, current.length_ft)
  const width_ft = size(p.width_ft, 8, 60, opts.seen?.width_ft ?? current.width_ft, current.width_ft)
  if (length_ft !== current.length_ft) changes.push({ id: null, what: 'tunnel', name: 'Tunnel length', detail: `${round(current.length_ft)} ft to ${length_ft} ft` })
  if (width_ft !== current.width_ft) changes.push({ id: null, what: 'tunnel', name: 'Tunnel width', detail: `${round(current.width_ft)} ft to ${width_ft} ft` })

  const staying = current.items.filter((i) => !gone.has(i.id)).map((i) => updated.get(i.id) ?? i)
  counts.untouched = staying.filter((i) => byId.get(i.id) === i && !moved.has(i.id)).length
  counts.unsaved = staying.filter((i) => moved.has(i.id) && !placed.has(i.id)).length
  const items = tidyBelts([...staying, ...added])
  const draft: Draft = { length_ft, width_ft, zones, items }
  return {
    draft,
    items: saveItems(items),
    counts,
    changes,
    removals,
    unsure,
    deleted,
    changed: changes.length > 0,
  }
}
