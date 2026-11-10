import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// CoreNav Map (Operations - Admin), drawn on Operator's own map. The corenav-map
// function reads CoreNav through the person's own CoreNav connection (Operator
// AI > Connections) and returns CoreNav's map setup, its points and one site's
// sidebar, all as CoreNav's own map defines them.

/* eslint-disable @typescript-eslint/no-explicit-any */
export type CnColorGroup = { id: string; label: string; color: string[]; values?: string[]; contains?: string[]; prefix?: string[] }
export type CnPointsConfig = {
  id: string
  sql: string
  title?: string
  entity?: string
  subtitle?: string[]
  hide?: { label: string; column: string; values: string[] }
  mark?: { label: string; column: string }
  size?: { column: string }
  tiers?: { rank?: string; label: string; column: string; values: string[] }
  rating?: { count?: string; column: string }
  color?: { column: string; groups: CnColorGroup[]; other?: { label: string; color: string[] }; words?: Record<string, string> }
}
export type CnMapConfig = {
  title?: string
  accent?: string
  accent2?: string
  view?: { zoom?: number; center?: [number, number] } // center is [lng, lat]
  points?: CnPointsConfig
  headings?: Record<string, string>
  [k: string]: any
}
export type CnUniverse = { universe: string; label: string; default: boolean; saved: boolean }
export type CnSetup = { universes: CnUniverse[]; universe: string; config: CnMapConfig | null; labels: Record<string, string> }
export type CnPoints = { columns: string[]; rows: any[][]; truncated: boolean }

export type CnSection =
  | { kind: 'fields'; title: string | null; table: string; values: Record<string, unknown> }
  | { kind: 'scorecard'; title: string | null; score: number | null; max: number | null; raw: number | null; factors: { id: string; pts: number | null; basis: string | null }[] }
  | { kind: 'table'; title: string | null; columns: string[]; rows: unknown[][] }
  | { kind: 'series'; title: string | null; x: string; bars: string | null; line: string | null; columns: string[]; rows: unknown[][] }
  | { kind: 'week'; title: string | null; rows: [string, number, number][] }
  | { kind: 'timeline'; title: string | null; rows: { date: unknown; headline: unknown; detail: unknown; url: unknown }[] }
  | { kind: 'empty'; title: string | null }
  | { kind: 'unsupported'; title: string | null; view: string | null }
  | { kind: 'error'; title: string | null; message: string }
export type CnTab = { tab: string; sections: CnSection[] }

// An error from corenav-map with its code: not_connected, reconnect, ...
export class CoreNavMapError extends Error {
  readonly code?: string
  constructor(message: string, code?: string) {
    super(message)
    this.code = code
  }
}

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<T> {
  const { data, error } = await supabase.functions.invoke('corenav-map', { body })
  const code = (data as { error?: string } | null)?.error
  if (error || code) {
    let ctxCode: string | undefined
    const ctx = error && typeof error === 'object' && 'context' in error ? (error as { context?: unknown }).context : null
    if (ctx instanceof Response) {
      try { ctxCode = ((await ctx.clone().json()) as { error?: string })?.error } catch { /* not JSON */ }
    }
    const message = await fnErrorMessage(error, data as { message?: string; error?: string } | null, fallback)
    // Never show a raw web page (a host's error page) as the message.
    throw new CoreNavMapError(/<(!doctype|html|head|body)\b/i.test(message) ? fallback : message.slice(0, 400), code ?? ctxCode)
  }
  return data as T
}

export type CnArea = { kind: 'drive_time' | 'radius_ring' | string; minutes: number | null; miles: number | null; geometry: any }
export type CnBox = { w: number; s: number; e: number; n: number }
export type CnLayerRows = { columns: string[]; rows: any[][]; truncated: boolean }
// map_config.heat / shapes / overlays / lenses / areas entries.
export type CnHeat = { id: string; kind: 'density' | 'value' | string; label: string; column?: string; weights?: Record<string, number>; min?: { value: number; column: string } }
export type CnShape = { id: string; sql: string; label: string; value: string; format?: string }
export type CnOverlay = { id: string; sql: string; kind: 'line' | 'signs' | 'points' | 'markers' | string; label: string; value?: string; min_zoom?: number; title?: string; colors?: Record<string, string>; color_by?: string }
export type CnLens = { id: string; label: string; quiet?: boolean; rings?: boolean; shape?: string; heat?: string; overlays?: string[] }

export const corenavMap = {
  setup: (universe?: string) => call<CnSetup>({ action: 'setup', ...(universe ? { universe } : {}) }, "Couldn't load CoreNav's map."),
  points: (universe: string) => call<CnPoints>({ action: 'points', universe }, "Couldn't load CoreNav's sites."),
  site: (universe: string, siteId: string, entityId: string | null) =>
    call<{ tabs: CnTab[] }>({ action: 'site', universe, site_id: siteId, entity_id: entityId ?? '' }, "Couldn't load that site from CoreNav."),
  areas: (universe: string, siteId: string) =>
    call<{ areas: CnArea[] }>({ action: 'areas', universe, site_id: siteId }, "Couldn't load that site's drive times."),
  layer: (universe: string, kind: 'shape' | 'overlay', id: string, bbox?: CnBox) =>
    call<CnLayerRows>({ action: 'layer', universe, kind, id, ...(bbox ? { bbox } : {}) }, "Couldn't load that CoreNav layer."),
}

// Which colour group a point falls in, the way CoreNav's map decides it.
export function groupFor(color: CnPointsConfig['color'], value: unknown): string {
  if (!color) return 'other'
  const v = String(value ?? '')
  for (const g of color.groups) {
    if (g.values?.includes(v)) return g.id
    if (g.contains?.some((c) => v.includes(c))) return g.id
    if (g.prefix?.some((p) => v.startsWith(p))) return g.id
  }
  return 'other'
}
