import { useCallback, useEffect, useState } from 'react'
import { fetchSiteWorkOrders, type SiteWorkOrders } from '@/lib/queries/siteWorkOrders'

export type WorkOrdersState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; data: SiteWorkOrders }

// The site's open MaintainX work orders, loaded once per site (again on refresh).
export function useSiteWorkOrders(locationId: string | null) {
  const [state, setState] = useState<WorkOrdersState>({ kind: 'loading' })
  const [nonce, setNonce] = useState(0)

  useEffect(() => {
    if (!locationId) return
    let alive = true
    setState({ kind: 'loading' })
    fetchSiteWorkOrders(locationId)
      .then((data) => { if (alive) setState({ kind: 'ready', data }) })
      .catch((e: unknown) => { if (alive) setState({ kind: 'error', message: e instanceof Error ? e.message : String(e) }) })
    return () => { alive = false }
  }, [locationId, nonce])

  const refresh = useCallback(() => setNonce((n) => n + 1), [])
  return { state, refresh }
}
