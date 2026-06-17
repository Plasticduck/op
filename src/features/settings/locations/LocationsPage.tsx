import { useCallback, useEffect, useState } from 'react'
import { MapPin, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { TimeSelect } from '@/components/forms/TimeSelect'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { EmptyState } from '@/components/ui/EmptyState'
import { AddressAutocomplete } from '@/components/forms/AddressAutocomplete'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { compareLocationName } from '@/lib/utils'
import { timeOfDay } from '@/lib/format'
import { geocodeAddress } from '@/lib/weather'
import {
  createLocation,
  listAllLocations,
  updateLocation,
  type LocationFull,
} from '@/lib/queries/account'

const TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
]

const PAY_PERIODS = [
  { value: 'weekly', label: 'Weekly' },
  { value: 'biweekly', label: 'Bi-weekly' },
  { value: 'semimonthly', label: 'Semi-monthly' },
]

export function LocationsPage() {
  const [rows, setRows] = useState<LocationFull[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<LocationFull | null>(null)
  const [creating, setCreating] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<LocationFull | null>(null)
  const [busy, setBusy] = useState(false)
  const { reload: reloadActiveLocations } = useLocations()

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await listAllLocations()
    const sorted = ((data as LocationFull[] | null) ?? []).sort(
      (a, b) =>
        Number(a.archived) - Number(b.archived) || compareLocationName(a.name, b.name),
    )
    setRows(sorted)
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const refresh = async () => {
    await load()
    await reloadActiveLocations()
  }

  const toggleArchive = async () => {
    if (!archiveTarget) return
    setBusy(true)
    await updateLocation(archiveTarget.id, { archived: !archiveTarget.archived })
    setBusy(false)
    setArchiveTarget(null)
    void refresh()
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading locations…</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          Locations ({rows.filter((r) => !r.archived).length} active)
        </h2>
        <Button onClick={() => setCreating(true)}>
          <Plus className="size-4" />
          Add location
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No locations yet"
          description="Add your first site to start tracking operations."
          action={<Button onClick={() => setCreating(true)}>Add location</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {rows.map((l) => (
            <div
              key={l.id}
              className="rounded-md border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-ink">{l.name}</h3>
                    {l.archived && <Badge tone="neutral">Archived</Badge>}
                  </div>
                  <p className="mt-0.5 text-sm text-ink-muted">
                    {l.address ?? 'No address'}
                  </p>
                </div>
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-ink-muted">
                <div>
                  <dt className="text-ink-subtle">Timezone</dt>
                  <dd className="text-ink">{l.timezone}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Closeout</dt>
                  <dd className="text-ink">{timeOfDay(l.closeout_time)}</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Overtime after</dt>
                  <dd className="text-ink">{l.overtime_threshold_hours}h / wk</dd>
                </div>
                <div>
                  <dt className="text-ink-subtle">Pay period</dt>
                  <dd className="text-ink capitalize">{l.pay_period_type}</dd>
                </div>
              </dl>
              <div className="mt-3 flex gap-1 border-t border-border pt-3">
                <Button variant="ghost" size="sm" onClick={() => setEditing(l)}>
                  Edit
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={l.archived ? '' : 'text-danger hover:text-danger'}
                  onClick={() => setArchiveTarget(l)}
                >
                  {l.archived ? 'Restore' : 'Archive'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <LocationModal
          location={editing}
          onClose={() => {
            setCreating(false)
            setEditing(null)
          }}
          onSaved={() => {
            setCreating(false)
            setEditing(null)
            void refresh()
          }}
        />
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        title={
          archiveTarget?.archived
            ? `Restore ${archiveTarget?.name}?`
            : `Archive ${archiveTarget?.name}?`
        }
        description={
          archiveTarget?.archived
            ? 'The location becomes active again and billing resumes.'
            : 'Data is preserved and billing stops. You can restore it later.'
        }
        confirmLabel={archiveTarget?.archived ? 'Restore' : 'Archive'}
        destructive={!archiveTarget?.archived}
        loading={busy}
        onConfirm={toggleArchive}
        onCancel={() => setArchiveTarget(null)}
      />
    </div>
  )
}

function LocationModal({
  location,
  onClose,
  onSaved,
}: {
  location: LocationFull | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const isNew = !location
  const [name, setName] = useState(location?.name ?? '')
  const [address, setAddress] = useState(location?.address ?? '')
  // Coordinates from a picked autocomplete suggestion; null until one is chosen
  // (free-typed addresses fall back to geocoding on save).
  const [pickedCoords, setPickedCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [timezone, setTimezone] = useState(location?.timezone ?? 'America/New_York')
  const [closeout, setCloseout] = useState((location?.closeout_time ?? '21:00').slice(0, 5))
  const [overtime, setOvertime] = useState(String(location?.overtime_threshold_hours ?? 40))
  const [payPeriod, setPayPeriod] = useState(location?.pay_period_type ?? 'biweekly')
  const [geofenceRadius, setGeofenceRadius] = useState(String(location?.geofence_radius_m ?? 200))
  const [requireGeofence, setRequireGeofence] = useState(location?.require_geofence ?? false)
  const [requirePunchPhoto, setRequirePunchPhoto] = useState(location?.require_punch_photo ?? false)
  const [grabbingLocation, setGrabbingLocation] = useState(false)
  const [locationCoords, setLocationCoords] = useState<{ lat: number; lng: number } | null>(
    location?.latitude != null && location?.longitude != null
      ? { lat: Number(location.latitude), lng: Number(location.longitude) }
      : null,
  )
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const grabMyCurrentLocation = async () => {
    setGrabbingLocation(true)
    try {
      const pos = await new Promise<GeolocationPosition>((res, rej) =>
        navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 12000 }),
      )
      setLocationCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude })
    } catch (e) {
      setError('Could not read your location: ' + (e as Error).message)
    } finally {
      setGrabbingLocation(false)
    }
  }

  const save = async () => {
    setError(null)
    if (!name.trim()) return setError('Enter a location name')
    if (!profile) return
    setBusy(true)

    // Coordinates come from the picked autocomplete suggestion; if the address
    // was free-typed, fall back to geocoding it. Failure never blocks the save
    // (and on edit we keep existing coords).
    const addr = address.trim()
    const geo = pickedCoords ?? (addr ? await geocodeAddress(addr) : null)

    if (isNew) {
      // New sites use schema defaults for closeout/overtime/pay period; those
      // become editable once the location exists.
      const { error: err } = await createLocation({
        account_id: profile.account_id,
        name: name.trim(),
        address: addr || null,
        timezone,
        latitude: geo?.lat ?? null,
        longitude: geo?.lon ?? null,
      })
      if (err) {
        setBusy(false)
        return setError(err.message)
      }
    } else {
      // A "use current location" override always wins over geocoded coords.
      const finalCoords = locationCoords ?? (geo ? { lat: geo.lat, lng: geo.lon } : null)
      const { error: err } = await updateLocation(location.id, {
        name: name.trim(),
        address: addr || null,
        timezone,
        closeout_time: closeout,
        overtime_threshold_hours: Number(overtime),
        pay_period_type: payPeriod,
        geofence_radius_m: Math.max(25, Math.min(2000, Number(geofenceRadius) || 200)),
        require_geofence: requireGeofence,
        require_punch_photo: requirePunchPhoto,
        ...(finalCoords ? { latitude: finalCoords.lat, longitude: finalCoords.lng } : {}),
      })
      if (err) {
        setBusy(false)
        return setError(err.message)
      }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add location' : `Edit ${location?.name}`}>
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
        </Field>
        <Field label="Address" hint="Start typing and pick a suggestion">
          {(id) => (
            <AddressAutocomplete
              id={id}
              value={address}
              placeholder="123 Main St, City, ST"
              onChange={(v) => {
                setAddress(v)
                setPickedCoords(null) // typing invalidates a prior pick
              }}
              onSelect={(p) => {
                setAddress(p.address)
                setPickedCoords({ lat: p.lat, lon: p.lon })
              }}
            />
          )}
        </Field>
        <Field label="Timezone">
          {(id) => (
            <Select id={id} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {!isNew && (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Closeout time">
              {(id) => <TimeSelect id={id} value={closeout} onChange={setCloseout} />}
            </Field>
            <Field label="Overtime after (hrs/wk)">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  value={overtime}
                  onChange={(e) => setOvertime(e.target.value)}
                />
              )}
            </Field>
            <Field label="Pay period" className="col-span-2">
              {(id) => (
                <Select id={id} value={payPeriod} onChange={(e) => setPayPeriod(e.target.value)}>
                  {PAY_PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        )}
        <p className="text-xs text-ink-subtle">
          The weekly weather outlook is set automatically from the address.
        </p>

        {!isNew && (
          <div className="rounded-md border border-border bg-content p-3">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Time clock verification
            </h3>
            <div className="flex flex-col gap-3">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={requirePunchPhoto}
                  onChange={(e) => setRequirePunchPhoto(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Require a selfie</span>
                  <span className="text-ink-muted"> . Front camera captures every clock-in/out for manager review.</span>
                </span>
              </label>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={requireGeofence}
                  onChange={(e) => setRequireGeofence(e.target.checked)}
                />
                <span>
                  <span className="font-medium">Require punches at the site</span>
                  <span className="text-ink-muted"> . Block punches more than the radius below from the site coordinates.</span>
                </span>
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Geofence radius (meters)">
                  {(id) => (
                    <Input
                      id={id}
                      type="number"
                      min={25}
                      max={2000}
                      step={25}
                      value={geofenceRadius}
                      onChange={(e) => setGeofenceRadius(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Site coordinates">
                  {() => (
                    <div className="flex flex-col gap-1">
                      <div className="rounded-md border border-border bg-card px-3 py-2 text-xs text-ink">
                        {locationCoords
                          ? `${locationCoords.lat.toFixed(6)}, ${locationCoords.lng.toFixed(6)}`
                          : 'Not set'}
                      </div>
                      <button
                        type="button"
                        onClick={() => void grabMyCurrentLocation()}
                        disabled={grabbingLocation}
                        className="self-start text-xs font-medium text-accent hover:text-accent-hover disabled:opacity-60"
                      >
                        {grabbingLocation ? 'Reading location...' : 'Use my current location'}
                      </button>
                    </div>
                  )}
                </Field>
              </div>
            </div>
          </div>
        )}

        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            {isNew ? 'Add location' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
