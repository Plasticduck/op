import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { Loader2, Pencil, Printer, QrCode, RefreshCw, Trash2, Truck, Unlink, UserMinus, UserPlus, UsersRound } from 'lucide-react'
import { PdfPagePreview } from '@/components/data/PdfPagePreview'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import {
  fleetAdminApi,
  FUEL_TYPES,
  VEHICLE_SIZES,
  type DriverInput,
  type FleetAdminDriver,
  type FleetAdminVehicle,
  type FleetChange,
  type FleetOverview,
  type VehicleInput,
} from '@/lib/queries/fleet'
import { buildVehicleStickersPdf, STICKER_STOCKS, vehicleSticker } from './fleetStickers'

// Fleet Management: Admins add, edit and remove drivers, edit vehicles, and put
// drivers on (or take them off) vehicles, all in Verizon Connect Reveal through
// the fleet-admin edge function. Reveal is the source of truth, so the page reloads
// from it after every change. Vehicles come from tracker installs and can't be
// added or removed here. Changes made here, and drivers putting themselves on a
// vehicle by scanning its dash sticker (/v/<code>), are listed on the Changes tab.

type Tab = 'vehicles' | 'drivers' | 'changes'
const DAY_MS = 86400_000

const fullName = (d: Pick<FleetAdminDriver, 'first' | 'last'>) => `${d.first} ${d.last}`.trim()
const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true })
const when = (iso: string) => format(new Date(iso), 'MMM d, h:mm a')
const vehicleDesc = (v: FleetAdminVehicle) => [v.year, v.make, v.model].filter(Boolean).join(' ')

// "Joshua Jowers" -> "JJOWERS", made unique against the numbers in use.
function suggestNumber(first: string, last: string, taken: Set<string>): string {
  const base = `${first.trim().charAt(0)}${last.trim()}`.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 16)
  if (!base) return ''
  if (!taken.has(base)) return base
  for (let i = 2; i < 100; i++) if (!taken.has(`${base}${i}`)) return `${base}${i}`
  return base
}

export default function FleetManagementPage() {
  const [tab, setTab] = useState<Tab>('vehicles')
  const [data, setData] = useState<FleetOverview | null>(null)
  const [changes, setChanges] = useState<FleetChange[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    try {
      const [o, c] = await Promise.all([fleetAdminApi.overview(), fleetAdminApi.changes()])
      setData(o)
      setChanges(c)
      setError(null)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])
  useEffect(() => { void load() }, [load])

  // After a change: say what happened, then reload from Verizon.
  const done = (message: string) => {
    setNotice(message)
    void load()
  }

  const vehicles = data?.vehicles ?? []
  const drivers = data?.drivers ?? []

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Fleet Management"
        subtitle="Drivers, vehicles and who is driving what, in Verizon Connect."
        actions={
          <Button variant="secondary" onClick={() => void load()} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} /> {refreshing ? 'Loading...' : 'Refresh'}
          </Button>
        }
      />
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && (
        <p className="flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{notice}</span>
          <button type="button" className="text-xs font-medium underline" onClick={() => setNotice(null)}>Dismiss</button>
        </p>
      )}

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-border">
        <TabButton active={tab === 'vehicles'} onClick={() => setTab('vehicles')} label="Vehicles" count={vehicles.length} />
        <TabButton active={tab === 'drivers'} onClick={() => setTab('drivers')} label="Drivers" count={drivers.length} />
        <TabButton active={tab === 'changes'} onClick={() => setTab('changes')} label="Changes" count={changes.length} />
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading from Verizon Connect...</p>
      ) : !data ? null : tab === 'vehicles' ? (
        <VehiclesTab vehicles={vehicles} drivers={drivers} unnumbered={data.unnumbered} onDone={done} />
      ) : tab === 'drivers' ? (
        <DriversTab vehicles={vehicles} drivers={drivers} onDone={done} />
      ) : (
        <ChangesTab changes={changes} />
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ Vehicles */

function VehiclesTab({ vehicles, drivers, unnumbered, onDone }: {
  vehicles: FleetAdminVehicle[]
  drivers: FleetAdminDriver[]
  unnumbered: string[]
  onDone: (message: string) => void
}) {
  const [assigning, setAssigning] = useState<FleetAdminVehicle | null>(null)
  const [unassigning, setUnassigning] = useState<FleetAdminVehicle | null>(null)
  const [editing, setEditing] = useState<FleetAdminVehicle | null>(null)
  const [printing, setPrinting] = useState(false)

  if (vehicles.length === 0) return <EmptyState icon={Truck} title="No vehicles" description="Verizon Connect has no vehicles with a vehicle number." />
  const unprinted = vehicles.filter((v) => !v.sticker_code).length
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-ink-muted">
          Drivers put themselves on a vehicle by scanning the QR sticker on its dash.
          {unprinted > 0 && ` ${unprinted} vehicle${unprinted === 1 ? ' has' : 's have'} no sticker yet.`}
        </p>
        <Button variant="secondary" onClick={() => setPrinting(true)}><QrCode className="size-4" /> Print QR stickers</Button>
      </div>
      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2.5 font-medium">Vehicle</th>
              <th className="px-3 py-2.5 font-medium">Plate</th>
              <th className="px-3 py-2.5 font-medium">Driver</th>
              <th className="px-3 py-2.5 font-medium">Last GPS</th>
              <th className="px-3 py-2.5 text-right font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {vehicles.map((v) => {
              const stale = !v.gps_at || Date.now() - Date.parse(v.gps_at) > 7 * DAY_MS
              return (
                <tr key={v.number} className="border-t border-border align-top hover:bg-content">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{v.name}</div>
                    <div className="text-xs text-ink-muted">{[vehicleDesc(v), `#${v.number}`].filter(Boolean).join(' · ')}</div>
                  </td>
                  <td className="px-3 py-2.5 text-ink">{v.plate ?? <span className="text-ink-subtle">-</span>}</td>
                  <td className="px-3 py-2.5">
                    {v.driver ? (
                      <>
                        <div className="text-ink">{v.driver.name}</div>
                        {v.driver.since && <div className="text-xs text-ink-muted">Since {format(new Date(v.driver.since), 'MMM d, yyyy')}</div>}
                      </>
                    ) : (
                      <Badge tone="warn">No driver</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    {v.gps_at ? (
                      <Badge tone={stale ? 'danger' : 'ok'} title={when(v.gps_at)}>{ago(v.gps_at)}</Badge>
                    ) : (
                      <Badge tone="danger">Never</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="secondary" onClick={() => setAssigning(v)}>
                        <UserPlus className="size-4" /> {v.driver ? 'Change driver' : 'Assign driver'}
                      </Button>
                      {v.driver && (
                        <Button size="sm" variant="ghost" onClick={() => setUnassigning(v)} title="Take the driver off">
                          <UserMinus className="size-4" />
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => setEditing(v)} title="Edit vehicle">
                        <Pencil className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-subtle">
        Last GPS turns red when a tracker hasn't reported in over 7 days, which usually means it's unplugged or offline.
        Vehicles are added when Verizon installs a tracker, so they can't be added or removed here.
        {unnumbered.length > 0 && ` Missing a vehicle number in Verizon (can't be managed until one is set there): ${unnumbered.join(', ')}.`}
      </p>

      {assigning && <AssignModal vehicle={assigning} vehicles={vehicles} drivers={drivers} onClose={() => setAssigning(null)} onDone={onDone} />}
      {unassigning?.driver && (
        <ConfirmModal
          title="Take the driver off?"
          confirmLabel="Take off"
          onClose={() => setUnassigning(null)}
          onConfirm={async () => {
            await fleetAdminApi.unassign(unassigning.number)
            onDone(`${unassigning.driver!.name} is no longer assigned to ${unassigning.name}.`)
          }}
        >
          {unassigning.driver.name} will no longer be assigned to <strong>{unassigning.name}</strong>. Trips in it after now won't
          have a driver until someone is assigned.
        </ConfirmModal>
      )}
      {editing && <VehicleModal vehicle={editing} onClose={() => setEditing(null)} onDone={onDone} />}
      {printing && <StickersModal vehicles={vehicles} onClose={() => setPrinting(false)} onDone={onDone} />}
    </div>
  )
}

// Pick vehicles, preview the first page, download the PDF. A vehicle's code is
// made the first time its sticker prints and kept after, so reprints match.
function StickersModal({ vehicles, onClose, onDone }: {
  vehicles: FleetAdminVehicle[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  // Default to the vehicles that don't have a sticker yet (all of them, the first time).
  const [picked, setPicked] = useState<Set<string>>(() => {
    const fresh = vehicles.filter((v) => !v.sticker_code)
    return new Set((fresh.length ? fresh : vehicles).map((v) => v.number))
  })
  const [stockId, setStockId] = useState(STICKER_STOCKS[0].id)
  const [preview, setPreview] = useState<ArrayBuffer | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const stock = STICKER_STOCKS.find((s) => s.id === stockId) ?? STICKER_STOCKS[0]
  const chosen = vehicles.filter((v) => picked.has(v.number))

  // The preview uses a placeholder code where a vehicle has none yet.
  useEffect(() => {
    if (!chosen.length) { setPreview(null); return }
    let alive = true
    const items = chosen.slice(0, 10).map((v) => vehicleSticker(v.sticker_code ?? 'NEW000', v.name))
    const id = window.setTimeout(() => {
      void buildVehicleStickersPdf(stock, stock.template.page_spec.page ? items : items.slice(0, 1)).then(({ doc }) => {
        if (alive) setPreview(doc.output('arraybuffer'))
      })
    }, 120)
    return () => { alive = false; window.clearTimeout(id) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stockId, picked])

  const toggle = (num: string) => setPicked((s) => {
    const next = new Set(s)
    if (next.has(num)) next.delete(num)
    else next.add(num)
    return next
  })

  const print = async () => {
    setBusy(true)
    setError(null)
    try {
      const { codes } = await fleetAdminApi.stickerCodes(chosen.map((v) => v.number))
      const { doc, labels } = await buildVehicleStickersPdf(stock, chosen.map((v) => vehicleSticker(codes[v.number], v.name)))
      doc.save(`vehicle-stickers-${format(new Date(), 'yyyy-MM-dd-HHmm')}.pdf`)
      onClose()
      onDone(`Your ${labels} vehicle sticker${labels === 1 ? '' : 's'} downloaded as a PDF. Print at 100% (Actual size) and put each on its vehicle's dash.`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Print QR stickers" description="One per vehicle. Drivers scan it with their phone camera.">
      <div className="grid gap-5 sm:grid-cols-[1fr_240px]">
        <div className="order-2 flex flex-col gap-3 sm:order-1">
          <Field label="Sticker stock">
            <Select value={stockId} onChange={(e) => setStockId(e.target.value)}>
              {STICKER_STOCKS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Field>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium text-ink-muted">Vehicles ({chosen.length})</span>
              <span className="flex gap-3 text-xs">
                <button type="button" className="text-accent hover:underline" onClick={() => setPicked(new Set(vehicles.map((v) => v.number)))}>All</button>
                <button type="button" className="text-accent hover:underline" onClick={() => setPicked(new Set())}>None</button>
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto rounded-md border border-border">
              {vehicles.map((v) => (
                <label key={v.number} className="flex cursor-pointer items-center gap-2 border-b border-border px-3 py-2 text-sm last:border-b-0 hover:bg-content">
                  <input type="checkbox" checked={picked.has(v.number)} onChange={() => toggle(v.number)} />
                  <span className="min-w-0 flex-1 truncate text-ink">{v.name}</span>
                  {v.sticker_code ? <span className="font-mono text-xs text-ink-subtle">{v.sticker_code}</span> : <Badge tone="warn">New</Badge>}
                </label>
              ))}
            </div>
          </div>
          <p className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">
            Print at 100% (Actual size) and turn off "Fit to page". A reprint keeps the vehicle's code, so an old sticker still works.
          </p>
          {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        </div>
        <div className="order-1 sm:order-2">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Preview</div>
          <PdfPagePreview data={preview} maxWidth={240} />
        </div>
      </div>
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void print()} disabled={busy || !chosen.length}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Print {chosen.length} sticker{chosen.length === 1 ? '' : 's'}
        </Button>
      </div>
    </Modal>
  )
}

function AssignModal({ vehicle, vehicles, drivers, onClose, onDone }: {
  vehicle: FleetAdminVehicle
  vehicles: FleetAdminVehicle[]
  drivers: FleetAdminDriver[]
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [driver, setDriver] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const vehicleName = useMemo(() => new Map(vehicles.map((v) => [v.number, v.name])), [vehicles])
  const picked = drivers.find((d) => d.number === driver)
  const pickedElsewhere = picked?.vehicle && picked.vehicle !== vehicle.number ? vehicleName.get(picked.vehicle) ?? picked.vehicle : null
  const replacing = vehicle.driver && vehicle.driver.number !== driver ? vehicle.driver.name : null

  const save = async () => {
    if (!picked) return
    setBusy(true)
    setError(null)
    try {
      await fleetAdminApi.assign(picked.number, vehicle.number)
      onClose()
      onDone(`${fullName(picked)} is now assigned to ${vehicle.name}.`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Driver for ${vehicle.name}`} size="sm">
      <div className="flex flex-col gap-3">
        <Select value={driver} onChange={(e) => setDriver(e.target.value)}>
          <option value="">Pick a driver</option>
          {drivers.map((d) => (
            <option key={d.number} value={d.number}>
              {fullName(d)}{d.vehicle && d.vehicle !== vehicle.number ? ` (in ${vehicleName.get(d.vehicle) ?? d.vehicle})` : ''}
            </option>
          ))}
        </Select>
        {(replacing || pickedElsewhere) && picked && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            {replacing && <>{replacing} will be taken off this vehicle. </>}
            {pickedElsewhere && <>{fullName(picked)} will be taken off {pickedElsewhere}. </>}
            A driver has one vehicle and a vehicle has one driver.
          </p>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={!picked || busy || picked.number === vehicle.driver?.number}>
            {busy ? 'Assigning...' : 'Assign'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function VehicleModal({ vehicle, onClose, onDone }: { vehicle: FleetAdminVehicle; onClose: () => void; onDone: (message: string) => void }) {
  const [f, setF] = useState<VehicleInput>({
    name: vehicle.name,
    plate: vehicle.plate ?? '',
    vin: vehicle.vin ?? '',
    year: vehicle.year ? String(vehicle.year) : '',
    make: vehicle.make ?? '',
    model: vehicle.model ?? '',
    fuel_type: vehicle.fuel_type,
    size: vehicle.size,
  })
  const [miles, setMiles] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof VehicleInput) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }))

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await fleetAdminApi.updateVehicle(vehicle.number, { ...f, fuel_type: Number(f.fuel_type), size: Number(f.size) })
      if (miles.trim()) await fleetAdminApi.setOdometer(vehicle.number, Number(miles.replace(/,/g, '')))
      onClose()
      onDone(
        r.not_saved.length
          ? `Saved ${f.name}, but Verizon didn't keep the ${r.not_saved.join(', ')}.`
          : `Saved ${f.name}${miles.trim() ? ' and its odometer' : ''}.`,
      )
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title="Edit vehicle" description={`Vehicle #${vehicle.number}`} size="md">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2"><Input value={f.name} onChange={set('name')} /></Field>
        <Field label="License plate"><Input value={f.plate} onChange={set('plate')} /></Field>
        <Field label="VIN"><Input value={f.vin} onChange={set('vin')} /></Field>
        <Field label="Year"><Input value={f.year} onChange={set('year')} inputMode="numeric" placeholder="2024" /></Field>
        <Field label="Make"><Input value={f.make} onChange={set('make')} placeholder="Nissan" /></Field>
        <Field label="Model"><Input value={f.model} onChange={set('model')} placeholder="Frontier" /></Field>
        <Field label="Fuel">
          <Select value={String(f.fuel_type)} onChange={set('fuel_type')}>
            {FUEL_TYPES.map((t, i) => <option key={t} value={i}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Size">
          <Select value={String(f.size)} onChange={set('size')}>
            {VEHICLE_SIZES.map((t, i) => <option key={t} value={i}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Odometer (miles)" hint="Leave blank to keep Verizon's reading.">
          <Input value={miles} onChange={(e) => setMiles(e.target.value)} inputMode="numeric" placeholder="Current reading" />
        </Field>
      </div>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void save()} disabled={busy || !f.name.trim()}>{busy ? 'Saving...' : 'Save'}</Button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------- Drivers */

function DriversTab({ vehicles, drivers, onDone }: {
  vehicles: FleetAdminVehicle[]
  drivers: FleetAdminDriver[]
  onDone: (message: string) => void
}) {
  const [editing, setEditing] = useState<FleetAdminDriver | 'new' | null>(null)
  const [removing, setRemoving] = useState<FleetAdminDriver | null>(null)
  const [unlinking, setUnlinking] = useState<FleetAdminDriver | null>(null)
  const [q, setQ] = useState('')
  const vehicleName = useMemo(() => new Map(vehicles.map((v) => [v.number, v.name])), [vehicles])
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase()
    return s ? drivers.filter((d) => `${fullName(d)} ${d.number} ${d.email ?? ''}`.toLowerCase().includes(s)) : drivers
  }, [drivers, q])

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search drivers" className="sm:w-64" />
        <Button onClick={() => setEditing('new')}><UserPlus className="size-4" /> Add driver</Button>
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={UsersRound} title="No drivers" description={q ? 'No drivers match that search.' : 'Add a driver to get started.'} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[880px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Driver</th>
                <th className="px-3 py-2.5 font-medium">Email</th>
                <th className="px-3 py-2.5 font-medium">Phone</th>
                <th className="px-3 py-2.5 font-medium">Vehicle</th>
                <th className="px-3 py-2.5 font-medium">Operator login</th>
                <th className="px-3 py-2.5 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.number} className="border-t border-border align-top hover:bg-content">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{fullName(d) || d.number}</div>
                    <div className="text-xs text-ink-muted">#{d.number}</div>
                  </td>
                  <td className="px-3 py-2.5 text-ink">{d.email ?? <span className="text-ink-subtle">-</span>}</td>
                  <td className="px-3 py-2.5 text-ink">{d.phone ?? <span className="text-ink-subtle">-</span>}</td>
                  <td className="px-3 py-2.5 text-ink">
                    {d.vehicle ? vehicleName.get(d.vehicle) ?? d.vehicle : <span className="text-ink-subtle">None</span>}
                  </td>
                  <td className="px-3 py-2.5">
                    {d.operator_user ? (
                      <div className="flex items-center gap-1.5">
                        <Badge tone="ok">{d.operator_user.name}</Badge>
                        {d.operator_user.linked !== 'email' && (
                          <button type="button" onClick={() => setUnlinking(d)} title="Linked when they scanned a sticker. Undo the link."
                            className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-danger">
                            <Unlink className="size-3.5" /> by scan
                          </button>
                        )}
                      </div>
                    ) : (
                      <Badge tone="neutral" title="No Operator login uses this email, and no one has linked it by scanning">Not linked</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <div className="flex justify-end gap-1.5">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(d)} title="Edit driver"><Pencil className="size-4" /></Button>
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(d)} title="Remove driver"><Trash2 className="size-4 text-danger" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-xs text-ink-subtle">
        A driver is linked to an Operator login when their email here matches the login's email, or when someone picks this driver as
        themselves the first time they scan a vehicle sticker ("by scan"). If someone picked the wrong driver, undo the link and they'll be asked again.
      </p>

      {editing && (
        <DriverModal
          driver={editing === 'new' ? null : editing}
          taken={new Set(drivers.map((d) => d.number.toUpperCase()))}
          onClose={() => setEditing(null)}
          onDone={onDone}
        />
      )}
      {removing && (
        <ConfirmModal
          title="Remove driver?"
          confirmLabel="Remove driver"
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await fleetAdminApi.deleteDriver(removing.number)
            onDone(`Removed ${fullName(removing)} from Verizon Connect.`)
          }}
        >
          This deletes <strong>{fullName(removing)}</strong> (#{removing.number}) from Verizon Connect.
          {removing.vehicle && <> They'll be taken off {vehicleName.get(removing.vehicle) ?? removing.vehicle} first.</>}{' '}
          Their past trips and site visits stay. To bring them back, add them again.
        </ConfirmModal>
      )}
      {unlinking?.operator_user && (
        <ConfirmModal
          title="Undo this link?"
          confirmLabel="Undo link"
          onClose={() => setUnlinking(null)}
          onConfirm={async () => {
            await fleetAdminApi.unlink(unlinking.number)
            onDone(`${unlinking.operator_user!.name} is no longer linked to driver ${fullName(unlinking)}.`)
          }}
        >
          <strong>{unlinking.operator_user.name}</strong> picked driver {fullName(unlinking)} (#{unlinking.number}) as themselves when they
          scanned a vehicle sticker. Undoing it doesn't change any assignment; next time they scan, they'll be asked who they are again.
        </ConfirmModal>
      )}
    </div>
  )
}

function DriverModal({ driver, taken, onClose, onDone }: {
  driver: FleetAdminDriver | null
  taken: Set<string>
  onClose: () => void
  onDone: (message: string) => void
}) {
  const isNew = !driver
  const [f, setF] = useState<DriverInput>({
    number: driver?.number ?? '',
    first: driver?.first ?? '',
    last: driver?.last ?? '',
    email: driver?.email ?? '',
    phone: driver?.phone ?? '',
  })
  // New drivers get a suggested number until someone types their own.
  const [numberTouched, setNumberTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const set = (k: keyof DriverInput) => (e: { target: { value: string } }) => {
    const value = e.target.value
    setF((x) => {
      const next = { ...x, [k]: value }
      if (isNew && !numberTouched && (k === 'first' || k === 'last')) next.number = suggestNumber(next.first, next.last, taken)
      return next
    })
  }
  const numberTaken = isNew && taken.has(f.number.trim().toUpperCase())

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const input = { ...f, number: f.number.trim(), first: f.first.trim(), last: f.last.trim(), email: f.email.trim(), phone: f.phone.trim() }
      if (isNew) await fleetAdminApi.createDriver(input)
      else await fleetAdminApi.updateDriver(input)
      onClose()
      onDone(isNew ? `Added ${input.first} ${input.last} as driver #${input.number}.` : `Saved ${input.first} ${input.last}.`)
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add driver' : 'Edit driver'} size="md">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="First name"><Input value={f.first} onChange={set('first')} autoFocus /></Field>
        <Field label="Last name"><Input value={f.last} onChange={set('last')} /></Field>
        <Field label="Email" hint="Use their Operator login email to link them." className="sm:col-span-2">
          <Input type="email" value={f.email} onChange={set('email')} placeholder="name@mighty-wash.com" />
        </Field>
        <Field label="Phone"><Input type="tel" value={f.phone} onChange={set('phone')} /></Field>
        <Field label="Driver number" hint={isNew ? 'Can\'t be changed later.' : 'Driver numbers can\'t be changed.'}>
          <Input
            value={f.number}
            onChange={(e) => { setNumberTouched(true); set('number')(e) }}
            disabled={!isNew}
            invalid={numberTaken}
          />
          {numberTaken && <p className="mt-1 text-xs text-danger">That number is already used.</p>}
        </Field>
      </div>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={() => void save()} disabled={busy || !f.first.trim() || !f.last.trim() || !f.number.trim() || numberTaken}>
          {busy ? 'Saving...' : isNew ? 'Add driver' : 'Save'}
        </Button>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------- Changes */

function describe(c: FleetChange): string {
  const d = c.driver_name ?? (c.driver_number ? `driver #${c.driver_number}` : 'a driver')
  const v = c.vehicle_name ?? (c.vehicle_number ? `vehicle #${c.vehicle_number}` : 'a vehicle')
  const details = (c.details ?? {}) as { miles?: number; not_saved?: string[]; self?: boolean; source?: string; vehicles?: number }
  const scanned = details.self || details.source === 'self'
  switch (c.action) {
    case 'driver_added': return scanned ? `Added themselves as driver ${d} (scanned a sticker)` : `Added driver ${d}`
    case 'driver_edited': return `Edited driver ${d}`
    case 'driver_removed': return `Removed driver ${d}`
    case 'vehicle_edited': return `Edited ${v}${details.not_saved?.length ? ` (Verizon didn't keep the ${details.not_saved.join(', ')})` : ''}`
    case 'odometer_set': return `Set ${v}'s odometer to ${details.miles?.toLocaleString() ?? '?'} miles`
    case 'assigned': return scanned ? `Scanned in to drive ${v}` : `Assigned ${d} to ${v}`
    case 'unassigned': return scanned ? `Scanned out of ${v}` : `Took ${d} off ${v}`
    case 'linked': return `Said they're driver ${d} (scanned a sticker)`
    case 'unlinked': return `Undid the link to driver ${d}`
    case 'stickers_printed': return `Printed QR stickers for ${details.vehicles ?? '?'} vehicle${details.vehicles === 1 ? '' : 's'}`
    default: return c.action
  }
}

function ChangesTab({ changes }: { changes: FleetChange[] }) {
  if (changes.length === 0) return <EmptyState icon={Truck} title="No changes yet" description="Changes made on this page show up here." />
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2.5 font-medium">When</th>
            <th className="px-3 py-2.5 font-medium">Who</th>
            <th className="px-3 py-2.5 font-medium">What</th>
          </tr>
        </thead>
        <tbody>
          {changes.map((c) => (
            <tr key={c.id} className="border-t border-border hover:bg-content">
              <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{when(c.created_at)}</td>
              <td className="whitespace-nowrap px-3 py-2 text-ink">{c.user_name ?? 'Someone'}</td>
              <td className="px-3 py-2 text-ink">{describe(c)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* -------------------------------------------------------------------- Shared */

function ConfirmModal({ title, confirmLabel, danger, children, onClose, onConfirm }: {
  title: string
  confirmLabel: string
  danger?: boolean
  children: ReactNode
  onClose: () => void
  onConfirm: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      await onConfirm()
      onClose()
    } catch (e) {
      setError((e as Error).message)
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={title} size="sm">
      <p className="text-sm text-ink">{children}</p>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => void go()} disabled={busy}>{busy ? 'Working...' : confirmLabel}</Button>
      </div>
    </Modal>
  )
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: ReactNode }) {
  return (
    <label className={cn('flex flex-col gap-1', className)}>
      <span className="text-xs font-medium text-ink-muted">{label}</span>
      {children}
      {hint && <span className="text-xs text-ink-subtle">{hint}</span>}
    </label>
  )
}

function TabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('-mb-px flex items-center gap-2 border-b-2 pb-2 pt-1 text-sm font-medium transition',
        active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink')}>
      {label}
      <span className={cn('inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
        active ? 'bg-accent text-white' : 'bg-ink/10 text-ink-muted')}>{count}</span>
    </button>
  )
}
