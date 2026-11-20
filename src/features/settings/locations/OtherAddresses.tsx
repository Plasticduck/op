import { useEffect, useState } from 'react'
import { Loader2, MapPin, Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { AddressAutocomplete } from '@/components/forms/AddressAutocomplete'
import { useLocations } from '@/lib/locations'
import { geocodeAddress } from '@/lib/weather'
import { locationAddresses, type LocationAddress } from '@/lib/queries/locationAddresses'

// A site's other addresses: more car washes that make up the same site (MW34 is
// three in Hereford). Each gets a map pin and counts for Site Visits and the time
// clock geofence; everywhere else it's still one site. Adds and removes save right
// away, apart from the form's Save.
export function OtherAddresses({ accountId, locationId }: { accountId: string; locationId: string }) {
  const { reload } = useLocations()
  const [rows, setRows] = useState<LocationAddress[] | null>(null)
  const [address, setAddress] = useState('')
  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void locationAddresses.listFor(locationId).then(({ data, error: err }) => {
      if (!alive) return
      if (err) setError(err.message)
      setRows((data as LocationAddress[] | null) ?? [])
    })
    return () => {
      alive = false
    }
  }, [locationId])

  const add = async () => {
    const addr = address.trim()
    if (!addr) return
    setBusy(true)
    setError(null)
    // A pin needs coordinates: a picked suggestion has them, a typed address is looked up.
    const geo = picked ?? (await geocodeAddress(addr))
    if (!geo) {
      setBusy(false)
      return setError("Couldn't find that address on the map. Pick a suggestion as you type.")
    }
    const { data, error: err } = await locationAddresses.add({
      account_id: accountId,
      location_id: locationId,
      address: addr,
      latitude: geo.lat,
      longitude: geo.lon,
    })
    setBusy(false)
    if (err) return setError(err.message)
    setRows((r) => [...(r ?? []), data as LocationAddress])
    setAddress('')
    setPicked(null)
    void reload()
  }

  const remove = async (row: LocationAddress) => {
    setError(null)
    const { data, error: err } = await locationAddresses.remove(row.id)
    if (err || !data?.length) return setError(err?.message ?? 'Only Admins can remove an address.')
    setRows((r) => (r ?? []).filter((x) => x.id !== row.id))
    void reload()
  }

  return (
    <div className="rounded-md border border-border bg-content p-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">Other addresses</h3>
      <p className="mt-1 text-xs text-ink-muted">
        More car washes that make up this site. Each gets a pin on the maps and counts for Site Visits and the
        time clock, but it stays one site everywhere else. Changes here save right away.
      </p>

      {rows == null ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-ink-muted">
          <Loader2 className="size-3.5 animate-spin" /> Loading
        </p>
      ) : rows.length > 0 ? (
        <ul className="mt-2 flex flex-col gap-1.5">
          {rows.map((r) => (
            <li key={r.id} className="flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5 text-sm text-ink">
              <MapPin className="size-3.5 shrink-0 text-ink-subtle" />
              <span className="min-w-0 flex-1 truncate">{r.address}</span>
              {r.latitude == null && <span className="text-xs text-warn">No map pin</span>}
              <button
                type="button"
                onClick={() => void remove(r)}
                className="rounded p-0.5 text-ink-subtle hover:bg-danger-soft hover:text-danger"
                aria-label={`Remove ${r.address}`}
              >
                <X className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-2 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <AddressAutocomplete
            value={address}
            placeholder="Add another address"
            onChange={(v) => {
              setAddress(v)
              setPicked(null)
            }}
            onSelect={(p) => {
              setAddress(p.address)
              setPicked({ lat: p.lat, lon: p.lon })
            }}
          />
        </div>
        <Button type="button" variant="secondary" size="sm" onClick={() => void add()} disabled={busy || !address.trim()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Plus className="size-4" />} Add
        </Button>
      </div>
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  )
}
