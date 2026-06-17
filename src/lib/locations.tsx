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
  const [activeId, setActiveIdState] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY),
  )
  const [loading, setLoading] = useState(true)

  const load = async () => {
    if (!profile) {
      setLocations([])
      setLoading(false)
      return
    }
    setLoading(true)
    const { data, error } = await supabase
      .from('locations')
      .select('id, name, timezone, address, latitude, longitude, geofence_radius_m, require_geofence, require_punch_photo, tips_enabled')
      .eq('archived', false)
    if (error) {
      // eslint-disable-next-line no-console
      console.error('[locations] load failed', error)
    }
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

  const value = useMemo<LocationState>(
    () => ({
      locations,
      activeId,
      activeLocation: locations.find((l) => l.id === activeId) ?? null,
      setActiveId,
      loading,
      reload: load,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locations, activeId, loading],
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
