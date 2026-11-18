import { useEffect, useState } from 'react'
import { checklistReview, type SiteRm } from '@/lib/queries/checklistReview'

// Each of the person's sites with its Regional Manager this quarter, by location
// id. Null while loading; a site missing from the map is in no region.
export function useChecklistRms(): Map<string, SiteRm> | null {
  const [map, setMap] = useState<Map<string, SiteRm> | null>(null)
  useEffect(() => {
    let alive = true
    void checklistReview.rms().then(({ data }) => {
      if (alive) setMap(new Map(data.map((r) => [r.location_id, r])))
    })
    return () => { alive = false }
  }, [])
  return map
}
