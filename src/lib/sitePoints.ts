import type { LocationAddress } from '@/lib/queries/locationAddresses'

// Every place on a map that belongs to a site: its main address plus its other
// addresses (location_addresses). A site with three car washes is three points and
// still one site, so anything counting sites groups by locationId.
export type SitePoint = {
  locationId: string
  name: string
  address: string | null
  lat: number
  lng: number
  main: boolean
}

type SiteLike = { id: string; name: string; address: string | null; latitude: number | null; longitude: number | null }

export function buildSitePoints(sites: SiteLike[], extras: LocationAddress[]): SitePoint[] {
  const out: SitePoint[] = []
  const byId = new Map(sites.map((s) => [s.id, s]))
  for (const s of sites) {
    if (s.latitude == null || s.longitude == null) continue
    out.push({ locationId: s.id, name: s.name, address: s.address, lat: Number(s.latitude), lng: Number(s.longitude), main: true })
  }
  for (const a of extras) {
    const s = byId.get(a.location_id)
    if (!s || a.latitude == null || a.longitude == null) continue
    out.push({ locationId: s.id, name: s.name, address: a.address, lat: Number(a.latitude), lng: Number(a.longitude), main: false })
  }
  return out
}

// Map popup for a site's pin. A site with more than one address names the address,
// so its pins can be told apart.
export function sitePinHtml(p: SitePoint, points: SitePoint[], escape: (s: string) => string, extra = ''): string {
  const several = points.filter((q) => q.locationId === p.locationId).length > 1
  return (
    `<div style="font-size:15px;font-weight:700;margin-bottom:2px">${escape(p.name)}</div>` +
    (several && p.address ? `<div style="font-size:12px;color:#475569">${escape(p.address)}</div>` : '') +
    extra
  )
}
