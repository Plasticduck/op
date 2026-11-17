// tunnel-from-photos: everything that doesn't need Deno, so it also runs (and is tested)
// under Node. The request and answer shapes, the checks on what the app sends, the prompt
// and the schema Claude answers in, and the tidy-up that turns Claude's answer into a
// proposal the Tunnel page can show. index.ts is only the HTTP side.
//
// The app keeps its own copy of the contract types below (the Tunnel page's photo flow).
// The two copies must match: change one, change the other.
//
// Coordinates are the drawing's own (docs/maintenance-inventory/TUNNEL.md): feet, x along
// the tunnel from the entrance (prep is negative), y across it from the centerline with
// the driver's side negative, x/y a shape's center, w along x, h across.

// ---- The contract ------------------------------------------------------------------

export type PhotoView = 'entrance' | 'exit' | 'driver_side' | 'passenger_side' | 'middle' | 'equipment_room' | 'other'
export type Side = 'ds' | 'ps' | 'center' | 'both' | 'outside'
export type Confidence = 'high' | 'medium' | 'low'
export type ConveyorType = 'chain' | 'belt'
export type Zone = { name: string; x_from: number; x_to: number }

export type CatalogEntry = { kind: string; label: string; group: string; w: number; h: number; side: Side; scenery: boolean }
export type PriorItem = {
  kind: string
  label: string
  x_ft: number
  y_ft: number
  w_ft: number
  h_ft: number
  side: string
  zone: string | null
  match_type: string | null
  props?: Record<string, unknown>
}
export type Prior = { length_ft: number; width_ft: number; zones: Zone[]; items: PriorItem[] }

// POST body (supabase.functions.invoke, with the user's JWT).
export type PhotosRequest = {
  site_id: string
  tunnel_no: number
  photos: Array<{ media_type: 'image/jpeg'; data: string; view: PhotoView | null; note?: string }>
  known?: { length_ft?: number | null; conveyor_ft?: number | null }
  // The shape kinds the drawing can use, from shapes.tsx SHAPES.
  catalog: CatalogEntry[]
  // A typical tunnel to start from, used only when the site has no drawing and the
  // account has no template (the app sends expressTemplate()).
  prior?: Prior
}

export type ProposalItem = {
  ref: string | null
  kind: string
  label: string
  x_ft: number
  y_ft: number
  w_ft: number
  h_ft: number
  side: Side
  zone: string | null
  asset_id: string | null
  match_type: string | null
  conveyor_type: ConveyorType | null
  confidence: Confidence
  photos: number[]
}
export type Proposal = {
  mode: 'create' | 'update'
  length_ft: number
  width_ft: number
  zones: Zone[]
  items: ProposalItem[]
  removed: Array<{ ref: string; reason: string }>
  notes: string[]
}
export type PhotosErrorCode = 'no_key' | 'forbidden' | 'bad_request' | 'ai_failed' | 'refused' | 'too_long' | 'unreadable'
export type PhotosResponse =
  | { proposal: Proposal; model: string; usage?: { input_tokens: number; output_tokens: number } }
  | { error: PhotosErrorCode; message: string }

// Both sides enforce these; this side is the authority. The body limit is in MiB, the
// larger reading of "14 MB", so an app that counts in either unit is never turned away.
export const LIMITS = {
  photos: 12,
  photoChars: 1_600_000,
  bodyBytes: 14 * 1024 * 1024,
  knownMinFt: 20,
  knownMaxFt: 400,
} as const

export const PHOTO_VIEWS: readonly PhotoView[] = ['entrance', 'exit', 'driver_side', 'passenger_side', 'middle', 'equipment_room', 'other']
export const SIDES: readonly Side[] = ['ds', 'ps', 'center', 'both', 'outside']
const CONFIDENCE: readonly Confidence[] = ['high', 'medium', 'low']

// mi_tunnel_save refuses a drawing of more than 400 shapes, and mi_tunnel_items holds a
// kind to this pattern, h_ft to 200 and w_ft to 400.
const MAX_SHAPES = 400
const KIND = /^[a-z_]{2,30}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/

// ---- Small helpers --------------------------------------------------------------------

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const tenth = (v: number) => Math.round(v * 10) / 10

// One line of text, trimmed and cut to max characters, or null when there's nothing left.
function line(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const t = v.replace(/\p{Cc}/gu, ' ').replace(/\s+/g, ' ').trim()
  return t ? t.slice(0, max).trimEnd() : null
}

// The app's copy never uses em dashes, and the model sometimes does anyway. A dash used
// as a pause becomes a comma; one between numbers ("10–12 ft") becomes a hyphen.
export function plain(s: string): string {
  return s
    .replace(/\s+[–—]\s+/g, ', ')
    .replace(/—/g, ', ')
    .replace(/–/g, '-')
    .replace(/\s+,/g, ',')
}

// A name the drawing keeps (a zone, which becomes one of the site's zones), plain and on
// one line.
const plainLine = (v: unknown, max: number) => (typeof v === 'string' ? line(plain(v), max) : null)

// ---- Checking the request -------------------------------------------------------------

export type Checked<T> = { ok: true; value: T } | { ok: false; message: string }

// Everything the request can carry, checked and cleaned. bytes is the raw body's size.
export function validateRequest(body: unknown, bytes: number): Checked<PhotosRequest> {
  const bad = (message: string): Checked<PhotosRequest> => ({ ok: false, message })
  if (bytes > LIMITS.bodyBytes) return bad('The photos add up to more than 14 MB. Use fewer photos or smaller ones.')
  if (!isObj(body)) return bad('Send the photos as JSON.')

  const site_id = typeof body.site_id === 'string' ? body.site_id.trim() : ''
  if (!UUID.test(site_id)) return bad('Pick a site.')
  const tunnel_no = body.tunnel_no == null ? 1 : body.tunnel_no
  if (typeof tunnel_no !== 'number' || !Number.isInteger(tunnel_no) || tunnel_no < 1 || tunnel_no > 9) return bad('The tunnel number has to be 1 to 9.')

  if (!Array.isArray(body.photos) || body.photos.length === 0) return bad('Add at least one photo.')
  if (body.photos.length > LIMITS.photos) return bad(`Use at most ${LIMITS.photos} photos.`)
  const photos: PhotosRequest['photos'] = []
  for (let i = 0; i < body.photos.length; i++) {
    const p: unknown = body.photos[i]
    const n = i + 1
    if (!isObj(p)) return bad(`Photo ${n} is missing.`)
    if (p.media_type !== 'image/jpeg') return bad(`Photo ${n} has to be a JPEG.`)
    const data = p.data
    if (typeof data !== 'string' || !data) return bad(`Photo ${n} is empty.`)
    if (data.length > LIMITS.photoChars) return bad(`Photo ${n} is too big. Make it smaller and try again.`)
    if (data.startsWith('data:')) return bad(`Photo ${n} has to be plain base64, without the data: prefix.`)
    if (data.length % 4 !== 0 || !BASE64.test(data)) return bad(`Photo ${n} isn't valid base64.`)
    // Every JPEG starts with the bytes FF D8 FF, "/9j/" in base64. Catching a PNG or an
    // iPhone HEIC here gives a plain message instead of an error from Claude.
    if (!data.startsWith('/9j/')) return bad(`Photo ${n} isn't a JPEG.`)
    // A view this side doesn't know (a newer app) is read as "not given" rather than
    // failing the whole request.
    const view = PHOTO_VIEWS.includes(p.view as PhotoView) ? (p.view as PhotoView) : null
    const note = line(p.note, 300)
    photos.push({ media_type: 'image/jpeg', data, view, ...(note ? { note } : {}) })
  }

  const known: { length_ft: number | null; conveyor_ft: number | null } = { length_ft: null, conveyor_ft: null }
  if (body.known != null) {
    if (!isObj(body.known)) return bad('Known lengths have to be numbers of feet.')
    const fields = [['length_ft', 'tunnel length'], ['conveyor_ft', 'conveyor length']] as const
    for (const [key, what] of fields) {
      const v = body.known[key]
      if (v == null) continue
      if (typeof v !== 'number' || !Number.isFinite(v) || v < LIMITS.knownMinFt || v > LIMITS.knownMaxFt) {
        return bad(`The ${what} has to be between ${LIMITS.knownMinFt} and ${LIMITS.knownMaxFt} feet.`)
      }
      known[key] = v
    }
  }

  const catalog = cleanCatalog(body.catalog)
  if (!catalog.length) return bad('The list of shapes is missing. Reload the page and try again.')

  const prior = body.prior == null ? null : sanitizePrior(body.prior)
  return { ok: true, value: { site_id, tunnel_no, photos, known, catalog, ...(prior ? { prior } : {}) } }
}

// The app builds the catalog from SHAPES. Entries that don't make sense are left out, so
// a newer app with a shape this side can't read still gets the rest.
function cleanCatalog(v: unknown): CatalogEntry[] {
  if (!Array.isArray(v)) return []
  const out: CatalogEntry[] = []
  const seen = new Set<string>()
  for (const c of v.slice(0, 60)) {
    if (!isObj(c) || typeof c.kind !== 'string' || !KIND.test(c.kind) || seen.has(c.kind)) continue
    const w = num(c.w)
    const h = num(c.h)
    if (w == null || h == null || w <= 0 || h <= 0) continue
    seen.add(c.kind)
    out.push({
      kind: c.kind,
      label: line(c.label, 80) ?? c.kind,
      group: line(c.group, 60) ?? 'Other',
      w: clamp(w, 0.3, 400),
      h: clamp(h, 0.3, 200),
      side: SIDES.includes(c.side as Side) ? (c.side as Side) : 'center',
      scenery: c.scenery === true,
    })
  }
  return out
}

function cleanZones(v: unknown, length: number): Zone[] {
  if (!Array.isArray(v)) return []
  const out: Zone[] = []
  const seen = new Set<string>()
  for (const z of v.slice(0, 30)) {
    if (!isObj(z)) continue
    const name = plainLine(z.name, 60)
    const a = num(z.x_from)
    const b = num(z.x_to)
    if (!name || a == null || b == null || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    const lo = tenth(clamp(Math.min(a, b), -80, length + 80))
    const hi = tenth(clamp(Math.max(a, b), -80, length + 80))
    out.push({ name, x_from: lo, x_to: hi })
  }
  return out
}

// A starting drawing, from the app (expressTemplate()) or the account's template. Only
// what the prompt uses is kept; of props, only the conveyor's type. A turned shape (90 or
// 270) runs its w_ft across the tunnel, so its sizes are swapped here: Claude sees every
// footprint as drawn, along the tunnel and then across it, the way it sees current shapes.
export function sanitizePrior(v: unknown): Prior | null {
  if (!isObj(v) || !Array.isArray(v.items)) return null
  const length_ft = clamp(num(v.length_ft) ?? 140, 20, 400)
  const width_ft = clamp(num(v.width_ft) ?? 16, 8, 60)
  const items: PriorItem[] = []
  for (const it of v.items.slice(0, MAX_SHAPES)) {
    if (!isObj(it) || typeof it.kind !== 'string' || !KIND.test(it.kind)) continue
    const x = num(it.x_ft)
    const y = num(it.y_ft)
    const w = num(it.w_ft)
    const h = num(it.h_ft)
    if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) continue
    const ct = isObj(it.props) ? it.props.conveyor_type : undefined
    const turned = Number(it.rotation) === 90 || Number(it.rotation) === 270
    items.push({
      kind: it.kind,
      label: line(it.label, 80) ?? '',
      x_ft: x,
      y_ft: y,
      w_ft: turned ? h : w,
      h_ft: turned ? w : h,
      side: SIDES.includes(it.side as Side) ? (it.side as string) : 'center',
      zone: line(it.zone, 60),
      match_type: line(it.match_type, 120),
      ...(ct === 'belt' || ct === 'chain' ? { props: { conveyor_type: ct } } : {}),
    })
  }
  return items.length ? { length_ft, width_ft, zones: cleanZones(v.zones, length_ft), items } : null
}

// ---- The site, as mi_tunnel_get returns it ----------------------------------------------

// Only the parts this function reads. Numbers come from numeric columns through jsonb, so
// they arrive as numbers, but are read through Number() anyway.
export type SiteShape = {
  id: string
  kind: string
  label: string
  x_ft: number
  y_ft: number
  w_ft: number
  h_ft: number
  rotation?: number
  side: string
  zone: string | null
  match_type: string | null
  asset_id: string | null
  props?: Record<string, unknown> | null
}
export type SiteMachine = { id: string; name: string; type?: string | null; status?: string | null; area_name?: string | null; parent_id?: string | null }
export type SiteDrawing = {
  layout: { length_ft: number; width_ft: number; zones: Zone[] } | null
  items: SiteShape[]
  // Machines linked on the drawing (components too), and the site's other machines.
  assets: Record<string, SiteMachine>
  unplaced: SiteMachine[]
  templates?: Array<{ id: string; name: string; items: number }>
  can_edit: boolean
}

// ---- The plan: prompt, content and schema ------------------------------------------------

type TextBlock = { type: 'text'; text: string }
type ImageBlock = { type: 'image'; source: { type: 'base64'; media_type: 'image/jpeg'; data: string } }
export type ContentBlock = TextBlock | ImageBlock

// What normalizeProposal needs to know about the site to check Claude's answer.
export type NormalizeCtx = {
  mode: 'create' | 'update'
  kinds: string[]
  defaults: Record<string, { label: string; w: number; h: number; side: Side; scenery: boolean }>
  // Short handles Claude sees ("S3", "M7") and the ids they stand for.
  shapes: Record<string, string>
  machines: Record<string, string>
  // The current drawing's shapes by id: what a corrected shape keeps when Claude leaves
  // a field empty, and where it was shown to Claude (x, y, and the footprint w along the
  // tunnel and h across it, as in the context).
  current: Record<string, {
    kind: string
    label: string
    zone: string | null
    match_type: string | null
    asset_id: string | null
    conveyor_type: ConveyorType | null
    x: number
    y: number
    w: number
    h: number
  }>
  photos: number
  known_length: number | null
  known_conveyor: number | null
  fallback: { length_ft: number; width_ft: number; zones: Zone[] }
}

export type Plan = {
  mode: 'create' | 'update'
  system: string
  content: ContentBlock[]
  schema: Record<string, unknown>
  ctx: NormalizeCtx
}

const VIEW_TEXT: Record<PhotoView, string> = {
  entrance: 'the entrance, looking in',
  exit: 'the exit, looking back in',
  driver_side: "the driver's side",
  passenger_side: 'the passenger side',
  middle: 'inside the tunnel, partway along',
  equipment_room: 'the equipment room',
  other: 'somewhere else',
}

export function photoLabel(n: number, total: number, view: PhotoView | null, note?: string): string {
  const from = view ? VIEW_TEXT[view] : 'not given'
  return `Photo ${n} of ${total}, taken from: ${from}.${note ? ` Note from the person who took it: "${note.replace(/"/g, "'")}"` : ''}`
}

// Stable across every call, so it never varies by site; everything about the site is in
// the user turn.
export const SYSTEM_PROMPT = `You rebuild the top-down drawing of a car wash tunnel from photos of the real tunnel. Site managers use the drawing to find and track every machine, so it has to be at true scale, in feet, with each machine where it really stands. The site manager reviews what you propose before anything is saved.

The drawing
- Units are feet. x runs along the tunnel from the entrance doorway (x = 0). Cars travel toward +x and leave through the exit doorway at x = length_ft. The prep lane before the entrance has negative x.
- y runs across the tunnel from its centerline. The driver's side (the car's left) is negative y and the passenger side positive y. The inside walls are at about y = -width_ft/2 and y = +width_ft/2.
- Every shape is a rectangle seen from above. x_ft and y_ft are its center; w_ft is its size along the tunnel and h_ft its size across it. So an arch that spans the tunnel is thin in w_ft and about the tunnel's width in h_ft.
- side: "ds" on the driver's side, "ps" on the passenger side, "center" over the middle (top brushes, short brushes), "both" spanning the tunnel (arches, blasters, photo eyes, sensors, dryers), "outside" beside the tunnel (equipment room, vacuums, prep stations).
- kind picks how the shape is drawn. Use only kinds from the catalog in the context. Each catalog entry gives the typical size along the tunnel (w) and across it (h), and the usual side. "equipment" is any machine beside the tunnel that has no kind of its own. "room" outlines an area beside the tunnel (the equipment room, the vacuum area) and "label" is text; neither is a machine.
- zones are bands along the tunnel, named for what happens there (such as Prep, Entrance, Wash, Rinse and protect, Dryers, Exit), each from x_from to x_to. An item's zone is the band it stands in or, for things beside the tunnel, the area they are in, such as "Equipment room" or "Vacuums".

How an express tunnel is usually laid out, entrance to exit
Most tunnels follow this order, but every site differs: the photos decide what is there and in what order.
- Prep lane (negative x): pay stations, and prep gun and bug prep stations beside the lane where staff spray the car before it goes in.
- Entrance: the conveyor starts a few feet before the doorway. A chain conveyor starts with the roller up on the driver's side, where a roller rises behind the front tire to push the car. Just inside the doorway are the photo eyes, a truck bed sensor and the first arches (presoak).
- Wash: high pressure blasters, wheel brushes low on each side, wraps (tall brushes on swinging arms that wrap the front, sides and back of the car), top brushes hanging across the middle, side brushes (often called gloss boss or rocker brushes), a short or mitter brush, high side brushes for vans, then often a second pair of wraps and a second top brush.
- Rinse and protect: protectant and wax arches, tire shine applicators low on each side, rinse arches, and the spot free (R.O.) rinse as the last arch.
- Dryers: blowers along the last stretch before the exit, standing on both sides and hanging overhead. One "blower" shape covers the whole dryer section, from the first blower to the last.
- Exit: on a chain conveyor, the roller down on the driver's side, where the rollers drop away at the end.
- Beside the tunnel: the equipment room (pump stations, chemical dispensers, water softener, R.O. unit, air compressors, controls) and the vacuum area with its turbines.
- The conveyor is one shape, from its start before the entrance to its end near the exit. A chain conveyor is a narrow track, about 1.6 ft wide, under the driver's side wheels at about y = -3. A belt conveyor is two flat belts, one under each side's tires, with no rollers, pushers or guide rail; its shape is about 8.5 ft wide, centered at y = -0.35, and it has no roller up or roller down.

Reading the photos
Each photo comes with where it was taken from. Use that to orient it, but trust the photo when they disagree: the way cars face, the conveyor, doorways and signs show which way it looks.
- From the entrance, looking in: cars move away from the camera. The driver's side is on the LEFT of the picture and the passenger side on the right. Farther away means larger x.
- From the exit, looking back in: cars move toward the camera. The driver's side is on the RIGHT of the picture. Farther away means smaller x.
- The driver's side: from the driver's side looking across the tunnel, the entrance is on the right of the picture and the exit on the left. Looking at the driver's side from across the tunnel, the entrance is on the left.
- The passenger side: from the passenger side looking across the tunnel, the entrance is on the left. Looking at the passenger side from across the tunnel, the entrance is on the right.
- Inside the tunnel, partway along: work out which way it faces from the conveyor and the machines you know.
- The equipment room: its machines go inside one "room" outline beside the tunnel, on the side and at the place the photos show, or where the starting or current drawing has it if they don't.
- A note from the person who took the photo outranks where it says it was taken from.
The same machine often shows in several photos. Match machines between photos by their order along the tunnel and what stands next to them, so each machine is counted once. Count repeated machines (two wraps a side, two top brushes) carefully.

Getting the scale right
Measure from things of known size, and name the ones you used in notes.
- Lengths the person gave (known.length_ft for the tunnel, doorway to doorway; known.conveyor_ft for the conveyor) are exact and outrank everything else.
- A car is about 15.6 ft long and 6.3 ft wide, with 9.4 ft between its front and rear axles; a wheel is about 2.4 ft across.
- The catalog's typical sizes: an arch is about 1.5 ft deep, a wrap brush about 5 ft across, a top brush about 13 ft wide.
- Doorways are usually 10 to 12 ft wide. Inside, a tunnel is usually 14 to 18 ft wide, wall to wall.
- Things that repeat at a steady pitch (wall panels, ceiling lights, floor drains, the conveyor's rollers) don't give a size by themselves: count them to divide a length you do know, such as the doorway to doorway length.
Perspective shrinks depth fast: machines that look close together far down the tunnel can be many feet apart. Use an anchor near the machines you are measuring. Make the distances add up: the machines, in order, have to fit between the doorways. Where you can't tell a distance, use the starting or current drawing's spacing, scaled to this tunnel's length when the two differ (a machine 40% of the way along the starting drawing goes 40% of the way along this tunnel), and lower the confidence.

How to work
First decide, for each photo, where it was taken and which way it looks. Then list the machines in order along the tunnel, each with the photos it shows in. Then fix the scale from your anchors, place each machine, and check that the whole drawing fits the tunnel's length and width.

What to return
- One item for every machine you see, even one that is partly hidden. Never merge two machines into one item or split one machine into two.
- kind from the catalog; the catalog's typical size unless the photos show the machine is clearly bigger or smaller.
- label: the machine's name the way the site would say it, like "Wrap DS1", "Top Brush 2" or "Tire Shine PS". Use the names on the starting or current drawing for the same machines.
- match_type: the machine type the shape stands for, as the starting or current drawing gives it (for example "Top Brush 1" or "Wheel Boss DS"), or the type of the machine you linked; null if there is none.
- asset_id: the id of one of the site's machines (like "M4", from machines in the context) only when it is clearly the same machine, by its type or name and its place in the tunnel. Otherwise null. Use only ids from that list. Link each machine to at most one item. room and label items never take an asset_id. Machines marked component are parts of another machine: don't link a shape to one unless the current drawing already does.
- conveyor_type: for the conveyor, "belt" for a dual flat-belt conveyor with no rollers or pushers, "chain" for a chain conveyor. When correcting a drawing, keep the conveyor's current type unless the photos clearly show the other one. null for every other kind.
- confidence: "high" when the photos show the machine and where it stands clearly; "medium" when it is seen but its distance is estimated; "low" when it is mostly hidden, or placed from the starting drawing without being seen.
- photos: the numbers of the photos the machine shows in (numbered from 1 in the order given). Empty if it is in none.
- length_ft: the tunnel from the entrance doorway to the exit doorway. width_ft: inside, wall to wall.
- notes: short plain sentences for the site manager: which scale anchors you used, what you could not see or had to assume, and anything worth checking on site. At most 8. Do not use em dashes.

Making a new drawing (mode "create")
The site has no drawing yet. The context's start is a starting drawing (the company's template or a typical express tunnel), or null. Take names, match types, typical sizes and spacing from it, but follow the photos for which machines are there and in what order. Leave out machines of the starting drawing that the photos show are not there. A machine in a part of the tunnel no photo covers may be kept from the starting drawing, with low confidence and no photos. ref is always null, and removed is empty.

Correcting a drawing (mode "update")
The site has a drawing, given as current, where each shape has a ref (like "S7"). Correct it to match the photos:
- List every shape you recognize in the photos, with its ref. Where the photos agree with the drawing to within about a foot, copy its current x_ft, y_ft, w_ft and h_ft exactly. Change a number only when the photos show it is off by more than that, and name what you measured it against in notes. Keep its label, match_type and asset_id unless the photos show they are wrong.
- An item with a ref is that shape: give it the shape's kind.
- A machine in the photos that is not on the drawing is a new item with ref null.
- Put a shape in removed only when the photos clearly show it is not there: the place it should be is in plain view and empty, or something else stands there. Give the reason in a few words. A shape in a part of the tunnel the photos don't show is not removed: leave it out of both lists and it stays as it is.
- Use only refs from current, each at most once.
- Keep length_ft, width_ft and zones as current has them unless the photos show they are wrong.`

// The answer's shape, for output_config.format. Structured outputs take only part of JSON
// Schema: no minimum/maximum, string lengths or array sizes, and every object closed with
// additionalProperties false. Ranges are enforced in normalizeProposal instead. kind is an
// enum of the kinds this request can use.
export function buildSchema(kinds: string[]): Record<string, unknown> {
  const nullable = (s: Record<string, unknown>) => ({ anyOf: [s, { type: 'null' }] })
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    properties,
    required: Object.keys(properties),
    additionalProperties: false,
  })
  const n = { type: 'number' }
  const s = { type: 'string' }
  return object({
    mode: { type: 'string', enum: ['create', 'update'] },
    length_ft: n,
    width_ft: n,
    zones: { type: 'array', items: object({ name: s, x_from: n, x_to: n }) },
    items: {
      type: 'array',
      items: object({
        ref: nullable(s),
        kind: { type: 'string', enum: kinds },
        label: s,
        x_ft: n,
        y_ft: n,
        w_ft: n,
        h_ft: n,
        side: { type: 'string', enum: [...SIDES] },
        zone: nullable(s),
        asset_id: nullable(s),
        match_type: nullable(s),
        conveyor_type: nullable({ type: 'string', enum: ['chain', 'belt'] }),
        confidence: { type: 'string', enum: [...CONFIDENCE] },
        photos: { type: 'array', items: { type: 'integer' } },
      }),
    },
    removed: { type: 'array', items: object({ ref: s, reason: s }) },
    notes: { type: 'array', items: s },
  })
}

// Rotated shapes (90 or 270) run their w_ft across the tunnel. Claude sees and answers
// with the footprint as drawn: along the tunnel, then across it.
const footprint = (s: SiteShape) => {
  const turned = Number(s.rotation) === 90 || Number(s.rotation) === 270
  return turned ? { w: Number(s.h_ft), h: Number(s.w_ft) } : { w: Number(s.w_ft), h: Number(s.h_ft) }
}

// Everything for one call: the content (each photo after its label, then the site as
// compact JSON), the schema, and what the answer is checked against.
//
// Claude refers to shapes and machines by short handles ("S3", "M7") rather than their
// uuids: copying 36-character ids is where a model slips, and a slipped id would quietly
// unlink a machine. normalizeProposal maps the handles back.
export function buildPlan(req: PhotosRequest, site: SiteDrawing, start: { prior: Prior; source: string } | null): Plan {
  const mode = site.layout ? 'update' : 'create'
  const total = req.photos.length

  const all = [...Object.values(site.assets ?? {}), ...(site.unplaced ?? [])]
  const machineList: SiteMachine[] = []
  const seen = new Set<string>()
  for (const m of all) {
    if (!m || typeof m.id !== 'string' || seen.has(m.id) || m.status === 'retired') continue
    seen.add(m.id)
    machineList.push(m)
  }
  machineList.sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
  const listed = machineList.slice(0, 300)
  const machines: Record<string, string> = {}
  const machineHandle = new Map<string, string>()
  listed.forEach((m, i) => {
    machines[`M${i + 1}`] = m.id
    machineHandle.set(m.id, `M${i + 1}`)
  })

  const shapesList = mode === 'update' ? (site.items ?? []).slice(0, MAX_SHAPES) : []
  const shapes: Record<string, string> = {}
  const current: NormalizeCtx['current'] = {}
  const conveyorOf = (s: SiteShape): ConveyorType | null => (s.kind === 'conveyor' ? (s.props?.conveyor_type === 'belt' ? 'belt' : 'chain') : null)
  shapesList.forEach((s, i) => {
    shapes[`S${i + 1}`] = s.id
    const f = footprint(s)
    current[s.id] = {
      kind: s.kind,
      label: s.label ?? '',
      zone: s.zone ?? null,
      match_type: s.match_type ?? null,
      asset_id: s.asset_id ?? null,
      conveyor_type: conveyorOf(s),
      x: tenth(Number(s.x_ft)),
      y: tenth(Number(s.y_ft)),
      w: tenth(f.w),
      h: tenth(f.h),
    }
  })

  const known = { length_ft: req.known?.length_ft ?? null, conveyor_ft: req.known?.conveyor_ft ?? null }
  const context: Record<string, unknown> = {
    mode,
    photos: total,
    known,
    catalog: req.catalog.map((c) => ({ kind: c.kind, label: c.label, group: c.group, w: c.w, h: c.h, side: c.side, scenery: c.scenery })),
    machines: listed.map((m) => ({
      id: machineHandle.get(m.id),
      name: m.name,
      ...(m.type ? { type: m.type } : {}),
      ...(m.area_name ? { area: m.area_name } : {}),
      ...(m.parent_id ? { component: true } : {}),
    })),
  }
  if (mode === 'update' && site.layout) {
    context.current = {
      length_ft: tenth(Number(site.layout.length_ft)),
      width_ft: tenth(Number(site.layout.width_ft)),
      zones: site.layout.zones ?? [],
      shapes: shapesList.map((s, i) => {
        const was = current[s.id]
        return {
          ref: `S${i + 1}`,
          kind: s.kind,
          label: s.label ?? '',
          x_ft: was.x,
          y_ft: was.y,
          w_ft: was.w,
          h_ft: was.h,
          side: s.side,
          zone: s.zone ?? null,
          match_type: s.match_type ?? null,
          // A link to a machine that isn't listed (retired) shows as null; the shape keeps
          // it anyway (see normalizeProposal).
          asset_id: s.asset_id ? machineHandle.get(s.asset_id) ?? null : null,
          ...(was.conveyor_type ? { conveyor_type: was.conveyor_type } : {}),
        }
      }),
    }
  } else {
    context.start = start
      ? {
          from: start.source,
          length_ft: tenth(start.prior.length_ft),
          width_ft: tenth(start.prior.width_ft),
          zones: start.prior.zones,
          shapes: start.prior.items.map((it) => ({
            kind: it.kind,
            label: it.label,
            x_ft: tenth(it.x_ft),
            y_ft: tenth(it.y_ft),
            w_ft: tenth(it.w_ft),
            h_ft: tenth(it.h_ft),
            side: it.side,
            zone: it.zone,
            match_type: it.match_type,
            ...(it.kind === 'conveyor' ? { conveyor_type: it.props?.conveyor_type === 'belt' ? 'belt' : 'chain' } : {}),
          })),
        }
      : null
  }

  const content: ContentBlock[] = []
  req.photos.forEach((p, i) => {
    content.push({ type: 'text', text: photoLabel(i + 1, total, p.view, p.note) })
    content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: p.data } })
  })
  content.push({
    type: 'text',
    text: `Site context (JSON):\n${JSON.stringify(context)}\n\n${
      mode === 'create'
        ? `Make the drawing of this tunnel from the ${total === 1 ? 'photo' : `${total} photos`}.`
        : `Correct the current drawing to match the ${total === 1 ? 'photo' : `${total} photos`}.`
    }`,
  })

  const kinds = [...new Set([...req.catalog.map((c) => c.kind), ...shapesList.map((s) => s.kind).filter((k) => KIND.test(k))])]
  const defaults: NormalizeCtx['defaults'] = {}
  for (const c of req.catalog) defaults[c.kind] = { label: c.label, w: c.w, h: c.h, side: c.side, scenery: c.scenery }

  const fallback =
    mode === 'update' && site.layout
      ? { length_ft: Number(site.layout.length_ft), width_ft: Number(site.layout.width_ft), zones: cleanZones(site.layout.zones, Number(site.layout.length_ft)) }
      : start
        ? { length_ft: start.prior.length_ft, width_ft: start.prior.width_ft, zones: start.prior.zones }
        : { length_ft: known.length_ft ?? 140, width_ft: 16, zones: [] }

  return {
    mode,
    system: SYSTEM_PROMPT,
    content,
    schema: buildSchema(kinds),
    ctx: { mode, kinds, defaults, shapes, machines, current, photos: total, known_length: known.length_ft, known_conveyor: known.conveyor_ft, fallback },
  }
}

// ---- Reading the answer -------------------------------------------------------------------

// The answer's text. With the server-side fallback, a 'fallback' block marks where one
// model declined and the next took over. A decline before the answer began leaves the
// whole answer after the last block. A decline partway through it leaves the start before
// the block, and the next model carries on from there, so the answer is all of the text
// together. Whichever reads as JSON is the answer.
export function finalText(content: ReadonlyArray<{ type: string; text?: unknown }>): string {
  const texts = (blocks: ReadonlyArray<{ type: string; text?: unknown }>) =>
    blocks
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text as string)
      .join('')
  let from = 0
  content.forEach((b, i) => {
    if (b.type === 'fallback') from = i + 1
  })
  const after = texts(content.slice(from))
  if (from === 0) return after
  try {
    JSON.parse(after)
    return after
  } catch {
    return texts(content)
  }
}

// A handle Claude used, as an id: "S3" (any case) or, failing that, the id itself.
function resolve(v: unknown, handles: Record<string, string>): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  const byHandle = handles[t.toUpperCase()]
  if (byHandle) return byHandle
  return Object.values(handles).includes(t) ? t : null
}

// One machine stands in one place, but nothing after this keeps a new drawing from
// linking it to two shapes (mi_tunnel_save only checks the machine is at the site). So
// each machine goes to one item. The drawing's shapes the answer neither corrects nor
// removes keep their links as they are, so those machines are taken first. (A removed
// shape's machine is free: if the person keeps that shape after all, the app's own
// linking skips a machine already on the drawing.) Then a corrected shape keeps the
// machine it already has, then the surest reading wins, the earlier one on a tie. An item
// that loses gets its shape's own machine back if that is still free, else none.
const SURE: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }
function linkOnce(items: ProposalItem[], ctx: NormalizeCtx, corrected: ReadonlyMap<string, unknown>, removed: ReadonlySet<string>): void {
  const taken = new Set<string>()
  for (const [id, cur] of Object.entries(ctx.current)) {
    if (cur.asset_id && !corrected.has(id) && !removed.has(id)) taken.add(cur.asset_id)
  }
  const own = (i: ProposalItem) => (i.ref ? ctx.current[i.ref]?.asset_id ?? null : null)
  const rank = (i: ProposalItem) => (i.asset_id && i.asset_id === own(i) ? 0 : 3) + SURE[i.confidence]
  const order = items.map((_, k) => k).sort((a, b) => rank(items[a]) - rank(items[b]) || a - b)
  for (const k of order) {
    const it = items[k]
    if (it.asset_id && taken.has(it.asset_id)) {
      const mine = own(it)
      it.asset_id = mine && !taken.has(mine) ? mine : null
    }
    if (it.asset_id) taken.add(it.asset_id)
  }
}

// Claude's JSON as a Proposal: kinds checked, numbers kept to what the drawing can hold,
// handles back to ids, and anything that doesn't fit the site dropped. It never throws:
// odd output becomes a smaller proposal, and output that can't be read is 'unreadable'.
export function normalizeProposal(text: string, ctx: NormalizeCtx): { proposal: Proposal } | { error: 'unreadable'; message: string } {
  const unreadable = (message: string) => ({ error: 'unreadable' as const, message })
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return unreadable("Claude's answer couldn't be read. Try again.")
  }
  if (!isObj(raw) || !Array.isArray(raw.items)) return unreadable("Claude's answer couldn't be read. Try again.")

  const update = ctx.mode === 'update'
  const length_ft = tenth(ctx.known_length ?? clamp(num(raw.length_ft) ?? ctx.fallback.length_ft, 20, 400))
  const width_ft = tenth(clamp(num(raw.width_ft) ?? ctx.fallback.width_ft, 8, 60))
  let zones = cleanZones(raw.zones, length_ft)
  if (!zones.length) zones = ctx.fallback.zones
  const kinds = new Set(ctx.kinds)

  const items: ProposalItem[] = []
  // Where each corrected shape's first item stood, before any belt fitting.
  const byRef = new Map<string, { kind: string; x: number; y: number }>()
  for (const it of raw.items.slice(0, MAX_SHAPES)) {
    if (!isObj(it) || typeof it.kind !== 'string' || !kinds.has(it.kind)) continue
    const kind = it.kind
    const rx = num(it.x_ft)
    const ry = num(it.y_ft)
    if (rx == null || ry == null) continue
    const x = tenth(clamp(rx, -80, length_ft + 80))
    const y = tenth(clamp(ry, -120, 120))

    // An item of another kind than the shape it names is a different machine: the app
    // never changes a shape's kind, so keeping the ref would only move that shape onto
    // this machine. It becomes a new shape and the named one stays as it is.
    let ref = update ? resolve(it.ref, ctx.shapes) : null
    if (ref && ctx.current[ref] && ctx.current[ref].kind !== kind) ref = null
    // Two items for one shape: the first keeps it. A second at the same spot is the same
    // machine listed twice and is dropped; anywhere else it is a machine of its own that
    // was matched to the wrong shape, so it stays, as a new shape.
    const first = ref ? byRef.get(ref) : undefined
    if (first) {
      if (first.kind === kind && Math.abs(first.x - x) < 2 && Math.abs(first.y - y) < 2) continue
      ref = null
    }
    if (ref) byRef.set(ref, { kind, x, y })
    const was = ref ? ctx.current[ref] : undefined
    const def = ctx.defaults[kind]

    const item: ProposalItem = {
      ref,
      kind,
      label: plain(line(it.label, 80) ?? was?.label ?? def?.label ?? kind).slice(0, 80),
      x_ft: x,
      y_ft: y,
      w_ft: tenth(clamp(num(it.w_ft) ?? def?.w ?? 4, 0.3, 400)),
      h_ft: tenth(clamp(num(it.h_ft) ?? def?.h ?? 4, 0.3, 200)),
      side: SIDES.includes(it.side as Side) ? (it.side as Side) : def?.side ?? 'center',
      zone: plainLine(it.zone, 60) ?? was?.zone ?? null,
      // A photo shows where a machine stands, hardly ever that its record is the wrong
      // one, so a corrected shape that comes back with no machine keeps the one it had.
      // A room or a label is never a machine.
      asset_id: def?.scenery ? null : resolve(it.asset_id, ctx.machines) ?? was?.asset_id ?? null,
      match_type: line(it.match_type, 120) ?? was?.match_type ?? null,
      // A corrected conveyor Claude gave no type keeps its own; only a new one is a chain
      // until the photos say otherwise.
      conveyor_type: kind === 'conveyor' ? (it.conveyor_type === 'belt' || it.conveyor_type === 'chain' ? it.conveyor_type : was?.conveyor_type ?? 'chain') : null,
      confidence: CONFIDENCE.includes(it.confidence as Confidence) ? (it.confidence as Confidence) : 'low',
      photos: [...new Set(Array.isArray(it.photos) ? it.photos.filter((p): p is number => Number.isInteger(p) && p >= 1 && p <= ctx.photos) : [])].sort((a, b) => a - b),
    }

    // A distance read off a photo is seldom good to a foot, and the app lists every move
    // of more than half a foot as a change. So a corrected shape read with less than high
    // confidence that comes back within a foot of where it is drawn is the drawing
    // confirmed, not moved: each such number stays as it was.
    if (was && item.confidence !== 'high') {
      const keep = (v: number, cur: number) => (Math.abs(v - cur) < 1 ? cur : v)
      Object.assign(item, { x_ft: keep(item.x_ft, was.x), y_ft: keep(item.y_ft, was.y), w_ft: keep(item.w_ft, was.w), h_ft: keep(item.h_ft, was.h) })
    }

    // A belt in the tunnel always sits on the car's line, where the app's
    // conveyorFootprint('belt') puts it (and tidyBelts keeps it); a spare beside the
    // tunnel goes anywhere.
    if (item.conveyor_type === 'belt' && item.side !== 'outside') Object.assign(item, { y_ft: -0.35, h_ft: 8.5, side: 'center' })
    items.push(item)
  }

  const removed: Proposal['removed'] = []
  if (update && Array.isArray(raw.removed)) {
    const gone = new Set<string>()
    for (const r of raw.removed) {
      if (!isObj(r)) continue
      const ref = resolve(r.ref, ctx.shapes)
      // A shape can't be both corrected and removed; the item wins.
      if (!ref || byRef.has(ref) || gone.has(ref)) continue
      gone.add(ref)
      removed.push({ ref, reason: plain(line(r.reason, 200) ?? 'Not there in the photos.') })
    }
  }

  linkOnce(items, ctx, byRef, new Set(removed.map((r) => r.ref)))

  // A conveyor length the person gave is exact, like the tunnel's: the one conveyor in
  // the tunnel takes it, starting where Claude put its start. With two or none there is
  // no telling which it means.
  const inTunnel = items.filter((i) => i.kind === 'conveyor' && i.side !== 'outside')
  if (ctx.known_conveyor != null && inTunnel.length === 1) {
    const c = inTunnel[0]
    const start = c.x_ft - c.w_ft / 2
    c.w_ft = tenth(ctx.known_conveyor)
    c.x_ft = tenth(clamp(start + ctx.known_conveyor / 2, -80, length_ft + 80))
  }

  const notes = (Array.isArray(raw.notes) ? raw.notes : [])
    .map((n) => line(n, 300))
    .filter((n): n is string => !!n)
    .slice(0, 10)
    .map(plain)

  if (!update && !items.length) {
    return unreadable("Claude couldn't make out any machines in these photos. Try photos taken from the entrance and the exit, looking down the tunnel.")
  }

  return { proposal: { mode: ctx.mode, length_ft, width_ft, zones, items, removed, notes } }
}
