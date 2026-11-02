import { useMemo } from 'react'
import { useLocations } from '@/lib/locations'
import { useItRefs } from './useItRefs'

// The places IT Inventory can keep equipment: Corporate and All Sites, then every
// real site. Those two are hidden locations (migration 0204), so nothing outside
// this module lists them. A site filter's own "All sites" means show everything,
// so filters label the place with filterName to keep the two apart.

export type ItSite = { id: string; name: string; filterName?: string }

export function useItSites() {
  const { locations: real, activeLocation } = useLocations()
  const { refs } = useItRefs()
  const shared = refs?.sharedSites
  const locations = useMemo<ItSite[]>(() => [
    ...(shared ?? []).map((s) => ({ id: s.id, name: s.name, filterName: s.it_scope === 'all_sites' ? `${s.name} (shared)` : undefined })),
    ...real,
  ], [shared, real])
  return { locations, activeLocation }
}
