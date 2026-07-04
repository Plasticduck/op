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
import { useCompany } from '@/lib/company'
import { billing, type AddSiteQuote } from '@/lib/queries/billing'
import { setSitePlan } from '@/lib/queries/companySettings'
import { compareLocationName } from '@/lib/utils'
import { currency, timeOfDay } from '@/lib/format'
import { geocodeAddress } from '@/lib/weather'
import {
  createLocation,
  deleteLocation,
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

type AddConfirm = {
  mode: 'upgrade' | 'add'
  amount: number | null
  interval: 'month' | 'year'
  hasSub: boolean
}

function describeAdd(c: AddConfirm): string {
  const p =
    c.amount == null
      ? 'the per-site rate'
      : `${currency(c.amount / 100)} per site / ${c.interval === 'year' ? 'year' : 'month'}`
  if (c.mode === 'upgrade') {
    return c.hasSub
      ? `Adding another location moves you to the Multi-Site plan. You agree to be billed ${p} for each active location.`
      : `Adding another location moves you to the Multi-Site plan. When your subscription starts, you'll be billed ${p} per location.`
  }
  return c.hasSub
    ? `This adds one more site. You agree to an additional ${p} (prorated on your next invoice).`
    : `This adds one more site. It will be billed ${p} once your subscription starts.`
}

export function LocationsPage() {
  const [rows, setRows] = useState<LocationFull[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<LocationFull | null>(null)
  const [creating, setCreating] = useState(false)
  const [archiveTarget, setArchiveTarget] = useState<LocationFull | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<LocationFull | null>(null)
  const [busy, setBusy] = useState(false)
  const { reload: reloadActiveLocations } = useLocations()
  const { sitePlan, reload: reloadCompany } = useCompany()
  const { profile } = useAuth()
  const [confirmAdd, setConfirmAdd] = useState<AddConfirm | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [upgradeAdding, setUpgradeAdding] = useState(false)
  const [upgradeNotice, setUpgradeNotice] = useState<string | null>(null)

  // Single-site accounts can keep one active location; adding another moves them
  // to Multi-Site (billed per site) as part of adding the second site.
  const activeCount = rows.filter((r) => !r.archived).length
  const singleLocked = sitePlan === 'single' && activeCount >= 1

  // Show a priced confirmation before any add that incurs a per-site charge
  // (single -> multi upgrade, or a new site on an existing multi account).
  const startAdd = async () => {
    if (!singleLocked && sitePlan !== 'multi') {
      setCreating(true)
      return
    }
    setQuoting(true)
    const { data } = await billing.addSiteQuote()
    setQuoting(false)
    const q = data as AddSiteQuote | null
    const interval: 'month' | 'year' = q?.interval ?? 'month'
    const amount = interval === 'year' ? (q?.perSiteYearly ?? null) : (q?.perSiteMonthly ?? null)
    setConfirmAdd({
      mode: singleLocked ? 'upgrade' : 'add',
      amount,
      interval,
      hasSub: !!q?.hasSubscription,
    })
  }

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
    // Keep a per-site subscription's quantity in sync with the location count
    // (best effort; the function no-ops unless the account is on the multi plan).
    void billing.syncQuantity()
  }

  const toggleArchive = async () => {
    if (!archiveTarget) return
    setBusy(true)
    await updateLocation(archiveTarget.id, { archived: !archiveTarget.archived })
    setBusy(false)
    setArchiveTarget(null)
    void refresh()
  }

  const doDelete = async () => {
    if (!deleteTarget) return
    setBusy(true)
    const { error } = await deleteLocation(deleteTarget.id)
    setBusy(false)
    const name = deleteTarget.name
    setDeleteTarget(null)
    if (error) {
      setUpgradeNotice(`Could not delete ${name}: ${error.message}. Try archiving it instead.`)
      return
    }
    void refresh()
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading locations…</p>

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">
          Locations ({activeCount} active)
        </h2>
        <Button onClick={startAdd} disabled={quoting}>
          <Plus className="size-4" />
          Add location
        </Button>
      </div>

      {upgradeNotice && (
        <div className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink">
          {upgradeNotice}
        </div>
      )}

      {singleLocked && (
        <div className="rounded-md border border-border bg-content px-3 py-2 text-sm text-ink-muted">
          You're on the Single-Site plan. Adding another location moves you to Multi-Site,
          billed per site.
        </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          icon={MapPin}
          title="No locations yet"
          description="Add your first site to start tracking operations."
          action={<Button onClick={startAdd} disabled={quoting}>Add location</Button>}
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
                <Button
                  variant="ghost"
                  size="sm"
                  className="ml-auto text-danger hover:text-danger"
                  onClick={() => setDeleteTarget(l)}
                >
                  Delete
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
          onSaved={async () => {
            setCreating(false)
            setEditing(null)
            const doUpgrade = upgradeAdding
            setUpgradeAdding(false)
            await refresh()
            if (doUpgrade) {
              // The new site now exists (2+ locations). Move to Multi-Site.
              const { data, error } = await billing.upgradeMulti()
              const res = data as { error?: string } | null
              if (!error && !res?.error) {
                setUpgradeNotice('Moved to Multi-Site. Billing is now per site.')
              } else if (res?.error === 'no_subscription') {
                // Trial account: no charge yet — just switch the plan.
                if (profile) await setSitePlan(profile.account_id, 'multi')
                setUpgradeNotice('Switched to Multi-Site.')
              } else {
                setUpgradeNotice(
                  'Site added, but the Multi-Site upgrade did not complete. Please retry from Billing.',
                )
              }
              await reloadCompany()
              await load()
            }
          }}
        />
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        title={`Delete ${deleteTarget?.name}?`}
        description="This permanently deletes the location and all of its data (work orders, equipment, checklists, closeouts, and more). This cannot be undone. To keep the data, archive it instead."
        confirmLabel="Delete permanently"
        destructive
        loading={busy}
        onConfirm={doDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <ConfirmDialog
        open={!!confirmAdd}
        title={confirmAdd?.mode === 'upgrade' ? 'Move to Multi-Site?' : 'Add another site?'}
        description={confirmAdd ? describeAdd(confirmAdd) : ''}
        confirmLabel={confirmAdd?.mode === 'upgrade' ? 'Agree & add site' : 'Agree & add site'}
        onConfirm={() => {
          const mode = confirmAdd?.mode
          setConfirmAdd(null)
          setUpgradeAdding(mode === 'upgrade')
          setCreating(true)
        }}
        onCancel={() => setConfirmAdd(null)}
      />

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
