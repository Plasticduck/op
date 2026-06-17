import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Clock, MapPin, Monitor, ShieldAlert, ShieldCheck, X } from 'lucide-react'
import { addDays } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { dateTime, durationHm } from '@/lib/format'
import { timeEntries } from '@/lib/queries/people'

type Entry = {
  id: string
  clock_in: string
  clock_out: string | null
  auto_closed: boolean
  edited_at: string | null
  employee: { first_name: string; last_name: string } | null
  punch_in_photo_path: string | null
  punch_in_distance_m: number | null
  punch_in_outside_fence: boolean | null
  punch_in_face_detected: boolean | null
  punch_out_photo_path: string | null
  punch_out_distance_m: number | null
  punch_out_outside_fence: boolean | null
  punch_out_face_detected: boolean | null
}

function Inner({ locationId }: { locationId: string }) {
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(true)
  const [photoModal, setPhotoModal] = useState<{ path: string; label: string } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const start = addDays(new Date(), -7).toISOString()
    const end = new Date().toISOString()
    const { data } = await timeEntries.forPeriod(locationId, start, end)
    setRows((data as unknown as Entry[]) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const clockedIn = rows.filter((r) => !r.clock_out)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Time clock"
        subtitle="Live punch status and recent entries (last 7 days)."
        actions={
          <Link to="/app/timeclock/kiosk">
            <Button><Monitor className="size-4" /> Open kiosk</Button>
          </Link>
        }
      />

      <StatCardRow
        items={[
          { label: 'Clocked in now', value: clockedIn.length },
          { label: 'Punches (7d)', value: rows.length },
          { label: 'Auto-closed (7d)', value: rows.filter((r) => r.auto_closed).length },
        ]}
      />

      <section className="rounded-md border border-border bg-card p-4">
        <h2 className="mb-3 text-sm font-semibold text-ink">Clocked in right now</h2>
        {clockedIn.length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody is currently clocked in.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {clockedIn.map((r) => (
              <li key={r.id} className="flex items-center justify-between py-2">
                <span className="text-ink">{r.employee?.first_name} {r.employee?.last_name}</span>
                <span className="tabular text-xs text-ink-muted">
                  since {dateTime(r.clock_in)} · {durationHm(r.clock_in, new Date())}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Clock} title="No punches yet" description="Use the kiosk to clock employees in and out." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Employee</th>
                <th className="px-3 py-2.5 font-medium">In</th>
                <th className="px-3 py-2.5 font-medium">Out</th>
                <th className="px-3 py-2.5 font-medium">Duration</th>
                <th className="px-3 py-2.5 font-medium">Flags</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const empName = `${r.employee?.first_name ?? ''} ${r.employee?.last_name ?? ''}`.trim()
                return (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{empName}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    <div className="flex items-center gap-2">
                      <PunchThumb
                        path={r.punch_in_photo_path}
                        onClick={(p) => setPhotoModal({ path: p, label: `${empName} . clock in` })}
                      />
                      <div>
                        <div>{dateTime(r.clock_in)}</div>
                        <PunchFlags
                          distance={r.punch_in_distance_m}
                          outside={r.punch_in_outside_fence}
                          face={r.punch_in_face_detected}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.clock_out ? (
                      <div className="flex items-center gap-2">
                        <PunchThumb
                          path={r.punch_out_photo_path}
                          onClick={(p) => setPhotoModal({ path: p, label: `${empName} . clock out` })}
                        />
                        <div>
                          <div>{dateTime(r.clock_out)}</div>
                          <PunchFlags
                            distance={r.punch_out_distance_m}
                            outside={r.punch_out_outside_fence}
                            face={r.punch_out_face_detected}
                          />
                        </div>
                      </div>
                    ) : (
                      <Badge tone="warn">open</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 tabular text-ink-muted">{r.clock_out ? durationHm(r.clock_in, r.clock_out) : '—'}</td>
                  <td className="px-3 py-2.5">
                    {r.auto_closed && <Badge tone="warn">auto</Badge>}
                    {r.edited_at && <Badge tone="neutral">edited</Badge>}
                  </td>
                </tr>
              )})}
            </tbody>
          </table>
        </div>
      )}

      {photoModal && (
        <Modal open onClose={() => setPhotoModal(null)} title={photoModal.label} size="md">
          <PunchPhotoView path={photoModal.path} onClose={() => setPhotoModal(null)} />
        </Modal>
      )}
    </div>
  )
}

function PunchPhotoView({ path, onClose }: { path: string; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    void (async () => {
      const { url: signed } = await timeEntries.punchPhotoSignedUrl(path, 3600)
      if (!alive) return
      setUrl(signed)
    })()
    return () => { alive = false }
  }, [path])
  return (
    <div className="flex flex-col items-center gap-3">
      {url ? (
        <img src={url} alt="Punch" className="max-h-[60vh] w-full rounded-md object-contain" />
      ) : (
        <div className="grid h-48 w-full place-items-center rounded-md bg-content text-sm text-ink-muted">Loading photo...</div>
      )}
      <Button variant="secondary" onClick={onClose}><X className="size-4" /> Close</Button>
    </div>
  )
}

// Small avatar-style thumbnail for the punch selfie. Loads a signed URL on
// mount (50-min cache) so we don't refetch on every re-render. Renders an
// empty placeholder dot when no photo is attached.
const PUNCH_URL_CACHE = new Map<string, { url: string; exp: number }>()

function PunchThumb({ path, onClick }: { path: string | null; onClick: (p: string) => void }) {
  const [url, setUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!path) return
    const cached = PUNCH_URL_CACHE.get(path)
    if (cached && cached.exp > Date.now()) { setUrl(cached.url); return }
    let alive = true
    void (async () => {
      const { url: signed } = await timeEntries.punchPhotoSignedUrl(path, 3600)
      if (!alive) return
      if (signed) {
        PUNCH_URL_CACHE.set(path, { url: signed, exp: Date.now() + 50 * 60 * 1000 })
        setUrl(signed)
      }
    })()
    return () => { alive = false }
  }, [path])

  if (!path) {
    return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-content text-[10px] text-ink-subtle">no pic</span>
  }
  if (!url) {
    return <span className="size-8 shrink-0 animate-pulse rounded-full bg-content" />
  }
  return (
    <button
      type="button"
      onClick={() => onClick(path)}
      className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full bg-content ring-1 ring-border hover:ring-accent"
      aria-label="View punch photo"
    >
      <img src={url} alt="Punch" className="size-full object-cover" />
    </button>
  )
}

function PunchFlags({ distance, outside, face }: { distance: number | null; outside: boolean | null; face: boolean | null }) {
  const items: React.ReactNode[] = []
  if (distance != null) {
    items.push(
      <span key="d" className={'inline-flex items-center gap-0.5 text-[10px] ' + (outside ? 'text-danger' : 'text-ok')}>
        <MapPin className="size-3" /> {distance} m
      </span>,
    )
  }
  if (outside === true) {
    items.push(<span key="o" className="text-[10px] font-medium text-danger">outside fence</span>)
  }
  if (face === false) {
    items.push(
      <span key="f" className="inline-flex items-center gap-0.5 text-[10px] font-medium text-warn">
        <ShieldAlert className="size-3" /> no face
      </span>,
    )
  } else if (face === true) {
    items.push(<ShieldCheck key="f" className="size-3 text-ok" aria-label="Face verified" />)
  }
  if (items.length === 0) return null
  return <div className="mt-0.5 flex flex-wrap items-center gap-1">{items}</div>
}

export default function TimeClockPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
