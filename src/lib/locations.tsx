import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { compareLocationName } from '@/lib/utils'
import { locationAddresses, type LocationAddress } from '@/lib/queries/locationAddresses'
import { buildSitePoints, type SitePoint } from '@/lib/sitePoints'

export type LocationRow = {
  id: string
  name: string
  timezone: string
  address: string | null
  latitude: number | null
  longitude: number | null
  geofence_radius_m: number | null
  require_geofence: boolean | null
  require_punch_photo: boolean | null
  tips_enabled: boolean | null
}

type LocationState = {
  locations: LocationRow[]
  // Every map point of those sites: main addresses plus other addresses
  // (MW34's three car washes are three points, one site).
  sitePoints: SitePoint[]
  activeId: string | null
  activeLocation: LocationRow | null
  setActiveId: (id: string) => void
  loading: boolean
  reload: () => Promise<void>
}

const LocationContext = createContext<LocationState | undefined>(undefined)
const STORAGE_KEY = 'tunnelsync.activeLocation'

export function LocationProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [locations, setLocations] = useState<LocationRow[]>([])
  const [extras, setExtras] = useState<LocationAddress[]>([])
  const [activeId, setActiveIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  )
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!profile) {
      setLocations([])
      setExtras([])
      setLoading(false)
      return
    }
    setLoading(true)
    const [{ data, error }, more] = await Promise.all([
      supabase
        .from('locations')
        .select('id, name, timezone, address, latitude, longitude, geofence_radius_m, require_geofence, require_punch_photo, tips_enabled')
        .eq('archived', false),
      locationAddresses.list(),
    ])
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[locations] load failed', error)
    }
    // Other addresses only add map points; a failure here leaves the sites intact.
    setExtras((more.data as LocationAddress[] | null) ?? [])
    const rows = ((data as LocationRow[] | null) ?? []).sort((a, b) =>
      compareLocationName(a.name, b.name),
    )
    setLocations(rows)
    setActiveIdState((prev) =>
      prev && rows.some((r) => r.id === prev) ? prev : (rows[0]?.id ?? null),
    )
    setLoading(false)
  }

  useEffect(() => {
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id])

  const setActiveId = (id: string) => {
    setActiveIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }

  const sitePoints = useMemo(() => buildSitePoints(locations, extras), [locations, extras])

  const value = useMemo<LocationState>(
    () => ({
      locations,
      sitePoints,
      activeId,
      activeLocation: locations.find((l) => l.id === activeId) ?? null,
      setActiveId,
      loading,
      reload: load,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locations, sitePoints, activeId, loading],
  )

  return (
    <LocationContext.Provider value={value}>
      {children}
    </LocationContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLocations(): LocationState {
  const ctx = useContext(LocationContext)
  if (!ctx) throw new Error('useLocations must be used within <LocationProvider>')
  return ctx
}
