import type { ReactNode } from 'react'
import { MapPin } from 'lucide-react'
import { useLocations } from '@/lib/locations'
import { EmptyState } from '@/components/ui/EmptyState'

// Renders children with the active location id, or a prompt if none is set.
export function LocationGate({
  children,
}: {
  children: (locationId: string) => ReactNode
}) {
  const { activeLocation, loading } = useLocations()
  if (loading) return null
  if (!activeLocation) {
    return (
      <EmptyState
        icon={MapPin}
        title="No location selected"
        description="Pick a location from the top bar, or add one in Settings → Locations."
      />
    )
  }
  return <>{children(activeLocation.id)}</>
}
