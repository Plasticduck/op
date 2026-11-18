import { useEffect, useState } from 'react'
import { siteAuditsV2, type SiteRm } from '@/lib/queries/siteAuditsV2'

// Each site's Regional Manager this quarter, by location id. Null while loading;
// a site missing from the map is in no region.
export function useSiteRms(): Map<string, SiteRm> | null {
  const [map, setMap] = useState<Map<string, SiteRm> | null>(null)
  useEffect(() => {
    let alive = true
    void siteAuditsV2.rms().then(({ data }) => {
      if (alive) setMap(new Map(data.map((r) => [r.location_id, r])))
    })
    return () => { alive = false }
  }, [])
  return map
}
