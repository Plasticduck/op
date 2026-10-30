import { useEffect, useState } from 'react'
import type { LabelContent, LabelLayoutSpec, LabelSpec } from '@/lib/labels/layout'
import type { PrintTemplate, StickerLogo } from '@/lib/labels/labelPdf'
import { readStickerLogo } from '@/lib/labels/stickerLogo'
import { itInventory, type ItAssetRow, type ItLabelTemplate } from '@/lib/queries/itInventory'
import type { ItRefs } from './useItRefs'
import { tagUrl } from './format'

// Glue between IT Inventory rows and the shared label code (src/lib/labels).

export function toPrintTemplate(t: ItLabelTemplate): PrintTemplate {
  return {
    name: t.name,
    page_spec: t.page_spec as unknown as LabelSpec,
    layout: t.layout as unknown as LabelLayoutSpec,
    offset_x_mm: Number(t.offset_x_mm),
    offset_y_mm: Number(t.offset_y_mm),
    scale: Number(t.scale),
  }
}

// The order you'd meet the gear walking the site: site, then area (by its walk
// order), then tag. Stickers print in this order so they peel off in sequence.
export function walkOrder(assets: ItAssetRow[], refs: ItRefs, siteName: Map<string, string>): ItAssetRow[] {
  const areaOrder = (a: ItAssetRow) => (a.area_id ? refs.area.get(a.area_id)?.sort_order ?? 9999 : 10000)
  return [...assets].sort((a, b) =>
    (siteName.get(a.location_id) ?? '').localeCompare(siteName.get(b.location_id) ?? '', undefined, { numeric: true })
    || areaOrder(a) - areaOrder(b)
    || a.asset_tag.localeCompare(b.asset_tag, undefined, { numeric: true }))
}

export function assetLabel(a: ItAssetRow, refs: ItRefs, siteName: Map<string, string>): LabelContent {
  return {
    tag: a.asset_tag,
    url: tagUrl(refs.settings.short_code, a.asset_tag),
    name: a.name,
    site: siteName.get(a.location_id) ?? null,
    phone: refs.settings.support_phone,
  }
}

export const blankLabel = (tag: string, refs: ItRefs): LabelContent => ({ tag, url: tagUrl(refs.settings.short_code, tag) })

export function accountDefaultTemplate(refs: ItRefs): ItLabelTemplate | undefined {
  return refs.templates.find((t) => t.is_default) ?? refs.templates[0]
}

// The category's sticker (outdoor stock for pay stations and cameras) when the
// assets all agree, otherwise the account default.
export function defaultTemplateFor(assets: ItAssetRow[], refs: ItRefs): ItLabelTemplate | undefined {
  const ids = new Set(assets.map((a) => refs.category.get(a.category_id)?.label_template_id ?? null))
  if (ids.size === 1) {
    const only = [...ids][0]
    const t = only ? refs.templates.find((x) => x.id === only) : undefined
    if (t) return t
  }
  return accountDefaultTemplate(refs)
}

export function isOutdoorAsset(a: ItAssetRow, refs: ItRefs): boolean {
  const tid = refs.category.get(a.category_id)?.label_template_id
  return !!tid && !!refs.templates.find((t) => t.id === tid)?.is_outdoor
}

// The account's sticker logo, ready to print, or null (none, turned off, or
// still loading). Fetched once per file for the session.
const logoCache = new Map<string, Promise<StickerLogo | null>>()
export function useStickerLogo(refs: ItRefs | null): StickerLogo | null {
  const path = refs?.settings.label_show_logo ? refs.settings.label_logo_path : null
  const [loaded, setLoaded] = useState<{ path: string; logo: StickerLogo | null } | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    let p = logoCache.get(path)
    if (!p) {
      p = itInventory.downloadFile(path).then((b) => (b ? readStickerLogo(b) : null)).catch(() => null)
      logoCache.set(path, p)
    }
    void p.then((logo) => { if (alive) setLoaded({ path, logo }) })
    return () => { alive = false }
  }, [path])
  return path && loaded?.path === path ? loaded.logo : null
}
