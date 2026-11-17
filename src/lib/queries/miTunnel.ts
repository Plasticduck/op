import { miRpc } from '@/lib/queries/maintenanceInventory'
import type { EquipmentStatus, UsageBasis, UsageState } from '@/lib/queries/miEquipment'
import { supabase } from '@/lib/supabase'

// Tunnel diagrams (docs/maintenance-inventory/TUNNEL.md): a top-down drawing of each
// site's tunnel whose shapes link to real machines. Feet throughout: x along the tunnel
// from the entrance, y across it from the centerline (driver's side negative), x/y the
// shape's center, w along x, h along y.

export type TunnelSide = 'ds' | 'ps' | 'center' | 'both' | 'outside'
export type TunnelItem = {
  id: string
  kind: string
  label: string
  x_ft: number
  y_ft: number
  w_ft: number
  h_ft: number
  rotation: 0 | 90 | 180 | 270
  side: TunnelSide
  zone: string | null
  match_type: string | null
  asset_id: string | null
  sort_order: number
  props: Record<string, unknown>
}
export type TunnelZone = { name: string; x_from: number; x_to: number }
export type TunnelLayout = {
  id: string
  location_id: string | null
  tunnel_no: number
  name: string
  is_template: boolean
  length_ft: number
  width_ft: number
  zones: TunnelZone[]
  based_on: string | null
  version: number
  updated_at: string
  updated_by: string | null
}
export type TunnelAsset = {
  id: string
  name: string
  type?: string
  status: EquipmentStatus
  crit_class?: 'A' | 'B' | 'C'
  parent_id?: string
  area_name?: string
  tag?: string
  tag_printed?: boolean
  open_wos: number
  children: number
  last_serviced_at?: string
  usage_since?: string
  cars_since?: number
  usage_state?: UsageState
  usage_basis?: UsageBasis
}
export type TunnelData = {
  layout: TunnelLayout | null
  items: TunnelItem[]
  assets: Record<string, TunnelAsset>
  site: { id: string; name: string; site_number: number | null; cars_today: number | null; cars_30d: number | null; data_through: string | null }
  tunnels: Array<{ tunnel_no: number; name: string }>
  unplaced: Array<{ id: string; name: string; type: string | null; status: EquipmentStatus; area_name: string | null }>
  templates: Array<{ id: string; name: string; items: number }>
  can_edit: boolean
  can_edit_templates: boolean
}
export type TemplateList = {
  templates: Array<TunnelLayout & { items: number; sites_using: number }>
  site_layouts: Array<{ location_id: string; tunnel_no: number; name: string; based_on: string | null; updated_at: string; items: number; linked: number }>
  can_edit_templates: boolean
}
export type ApplyReport = {
  committed: boolean
  sites: Array<{ site_id: string; site_name: string; result: 'created' | 'replaced' | 'skipped'; items?: number; linked?: number; unmatched?: string[]; ambiguous?: string[]; zones_created?: number; areas_set?: number }>
}

// What the editor sends: the whole drawing. New shapes carry a temporary id.
export type TunnelSave = Partial<Pick<TunnelLayout, 'id' | 'location_id' | 'tunnel_no' | 'name' | 'is_template' | 'length_ft' | 'width_ft' | 'zones' | 'based_on' | 'version'>> & {
  items?: Array<Omit<TunnelItem, 'id'> & { id?: string }>
}

// A drawing from photos (edge function tunnel-from-photos): the person sends photos of the
// real tunnel, Claude works out every machine and where it stands in the drawing's own
// feet, and the page shows that as a proposal to accept. Before a site has a drawing it
// proposes one; after, it proposes corrections to it, naming each existing shape by id.
// The photos are only passed through: nothing keeps them. The function keeps its own copy
// of these types (supabase/functions/tunnel-from-photos), and the two must match.
export type PhotoView = 'entrance' | 'exit' | 'driver_side' | 'passenger_side' | 'middle' | 'equipment_room' | 'other'
export type PhotosRequest = {
  site_id: string
  tunnel_no: number
  // media_type is always JPEG: the page turns every photo into one before sending it.
  photos: Array<{ media_type: 'image/jpeg'; data: string; view: PhotoView | null; note?: string }>
  known?: { length_ft?: number | null; conveyor_ft?: number | null }
  // The shape kinds the drawing can use (shapes.tsx SHAPES), scenery too.
  catalog: Array<{ kind: string; label: string; group: string; w: number; h: number; side: TunnelSide; scenery: boolean }>
  // A typical tunnel to start from, used only when the site has no drawing and the account
  // has no template.
  prior?: {
    length_ft: number; width_ft: number; zones: TunnelZone[]
    items: Array<{ kind: string; label: string; x_ft: number; y_ft: number; w_ft: number; h_ft: number; side: string; zone: string | null; match_type: string | null; props?: Record<string, unknown> }>
  }
}
export type PhotoProposalItem = {
  // An existing shape's id when this is that shape (update), else null.
  ref: string | null
  kind: string
  label: string
  x_ft: number
  y_ft: number
  w_ft: number
  h_ft: number
  side: TunnelSide
  zone: string | null
  // One of this site's machines (the function checks it), else null.
  asset_id: string | null
  match_type: string | null
  conveyor_type: 'chain' | 'belt' | null
  confidence: 'high' | 'medium' | 'low'
  // The photos it is seen in, numbered from 1. None: placed from the starting drawing.
  photos: number[]
}
// The function's Proposal.
export type PhotoProposal = {
  mode: 'create' | 'update'
  length_ft: number
  width_ft: number
  zones: TunnelZone[]
  items: PhotoProposalItem[]
  // Existing shapes the photos show are gone (update).
  removed: Array<{ ref: string; reason: string }>
  notes: string[]
}
export type PhotoErrorCode = 'no_key' | 'forbidden' | 'bad_request' | 'ai_failed' | 'refused' | 'too_long' | 'unreadable'
export type PhotosResponse =
  | { proposal: PhotoProposal; model: string; usage?: { input_tokens: number; output_tokens: number } }
  | { error: PhotoErrorCode; message: string }

// What the function accepts. It checks these too and has the last word.
export const PHOTO_LIMITS = { photos: 12, chars: 1_600_000, body: 14_000_000, minFt: 20, maxFt: 400 } as const

const PHOTO_ERRORS: Record<PhotoErrorCode, string> = {
  no_key: "Photo reading isn't set up yet.",
  forbidden: "You can't change this site's drawing.",
  bad_request: "The photos couldn't be sent as they are. Try fewer photos.",
  ai_failed: "The photos couldn't be read just now. Try again in a minute.",
  refused: 'These photos were turned down. Try photos that show the tunnel and its machines.',
  too_long: 'There was too much in these photos to finish. Try again with fewer photos.',
  unreadable: "A drawing couldn't be made from these photos. Try clearer photos, taken from the entrance, the exit and along each side.",
}

// What fromPhotos throws: a sentence for the person, and the function's code when it gave
// one, so the page can tell a failure worth trying again from one that will only repeat
// (no_key, forbidden).
export class FromPhotosError extends Error {
  code: PhotoErrorCode | null
  constructor(message: string, code: PhotoErrorCode | null = null) {
    super(message)
    this.code = code
  }
}

// The function's error code and message, from a non-2xx answer or an answer that is one.
async function photoError(error: unknown, data: unknown): Promise<{ code: string | null; message: string | null }> {
  const read = (v: unknown) => {
    const o = (v && typeof v === 'object' ? v : {}) as { error?: unknown; message?: unknown }
    return { code: typeof o.error === 'string' ? o.error : null, message: typeof o.message === 'string' ? o.message : null }
  }
  const ctx = (error as { context?: unknown } | null)?.context
  if (ctx instanceof Response) {
    try { return read(await ctx.clone().json()) } catch { /* not JSON: a gateway's page */ }
    return { code: ctx.status === 504 || ctx.status === 546 ? 'too_long' : null, message: null }
  }
  return read(data)
}

// The answer can come as text: the function sends spaces while Claude works, so the
// connection isn't dropped, and may not label it JSON.
function parseAnswer(data: unknown): unknown {
  if (typeof data !== 'string') return data
  try { return JSON.parse(data) } catch { return null }
}

export const miTunnel = {
  get: (site: string, tunnel = 1) => miRpc<TunnelData>('mi_tunnel_get', { p_site: site, p_tunnel: tunnel }),
  // Throws with a plain sentence for the person; signal cancels it.
  fromPhotos: async (body: PhotosRequest, signal?: AbortSignal): Promise<PhotoProposal> => {
    const { data, error } = await supabase.functions.invoke('tunnel-from-photos', { body, signal })
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError')
    const answer = parseAnswer(data)
    if (error || !answer || typeof answer !== 'object' || 'error' in answer) {
      const { code, message } = await photoError(error, answer)
      if (code && code in PHOTO_ERRORS) {
        // Its own explanation of what was wrong with the request says more than ours.
        throw new FromPhotosError(code === 'bad_request' && message ? message : PHOTO_ERRORS[code as PhotoErrorCode], code as PhotoErrorCode)
      }
      const name = (error as { name?: string } | null)?.name
      // A 200 whose body stopped before the answer came: the platform's time limit ended
      // the request, or the connection dropped, while Claude was still working.
      if (name === 'SyntaxError' || name === 'TypeError') throw new FromPhotosError('The answer was cut off before it finished. Try again, with fewer photos if it happens again.')
      throw new FromPhotosError(name === 'FunctionsFetchError' ? "The photos couldn't be sent. Check the connection and try again." : PHOTO_ERRORS.ai_failed)
    }
    const proposal = (answer as { proposal?: PhotoProposal }).proposal
    if (!proposal || !Array.isArray(proposal.items)) throw new FromPhotosError(PHOTO_ERRORS.unreadable, 'unreadable')
    return proposal
  },
  templates: () => miRpc<TemplateList>('mi_tunnel_templates'),
  template: (id: string) => miRpc<{ layout: TunnelLayout; items: TunnelItem[]; can_edit: boolean }>('mi_tunnel_template', { p_layout: id }),
  save: (p: TunnelSave) => miRpc<{ id: string; version: number }>('mi_tunnel_save', { p }),
  linkItem: (item: string, asset: string | null) => miRpc<{ version: number }>('mi_tunnel_link_item', { p_item: item, p_asset: asset }),
  apply: (source: string, sites: string[], opts: { mode?: 'skip_existing' | 'replace'; tunnel_no?: number; set_zones?: boolean }, commit: boolean) =>
    miRpc<ApplyReport>('mi_tunnel_apply', { p_source: source, p_sites: sites, p_opts: opts, p_commit: commit }),
  remove: (id: string) => miRpc<void>('mi_tunnel_delete', { p_layout: id }),
}
