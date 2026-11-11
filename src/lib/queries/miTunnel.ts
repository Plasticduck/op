import { miRpc } from '@/lib/queries/maintenanceInventory'
import type { EquipmentStatus, UsageBasis, UsageState } from '@/lib/queries/miEquipment'

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

export const miTunnel = {
  get: (site: string, tunnel = 1) => miRpc<TunnelData>('mi_tunnel_get', { p_site: site, p_tunnel: tunnel }),
  templates: () => miRpc<TemplateList>('mi_tunnel_templates'),
  template: (id: string) => miRpc<{ layout: TunnelLayout; items: TunnelItem[]; can_edit: boolean }>('mi_tunnel_template', { p_layout: id }),
  save: (p: TunnelSave) => miRpc<{ id: string; version: number }>('mi_tunnel_save', { p }),
  linkItem: (item: string, asset: string | null) => miRpc<{ version: number }>('mi_tunnel_link_item', { p_item: item, p_asset: asset }),
  apply: (source: string, sites: string[], opts: { mode?: 'skip_existing' | 'replace'; tunnel_no?: number; set_zones?: boolean }, commit: boolean) =>
    miRpc<ApplyReport>('mi_tunnel_apply', { p_source: source, p_sites: sites, p_opts: opts, p_commit: commit }),
  remove: (id: string) => miRpc<void>('mi_tunnel_delete', { p_layout: id }),
}
