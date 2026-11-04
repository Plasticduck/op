import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { CircleCheck, Loader2, LogOut, Truck, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { vehicleScan, type VehicleScan } from '@/lib/queries/fleet'

// /v/<code>: where a vehicle's dash sticker goes when scanned with a phone
// camera. A signed-in driver taps "I'm driving this" and is put on the vehicle in
// Verizon Connect (fleet-self-assign), or taps "I'm done" to come off it. The
// first time, someone whose login email isn't on a Verizon driver picks which
// driver they are, or is added as a new one. Signed out, it links to sign-in and
// comes back here.

const NEW_DRIVER = '__new__'

export default function VehicleScanPage() {
  const { code = '' } = useParams()
  const { profile, loading } = useAuth()
  const navigate = useNavigate()

  return (
    <div className="min-h-dvh bg-content px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <div className="mb-6 flex justify-center"><Logo /></div>
        {loading ? (
          <Spinner />
        ) : !profile ? (
          <Card>
            <Truck className="mx-auto mb-3 size-10 text-accent" />
            <h1 className="text-center text-lg font-semibold text-ink">Sign in to drive this vehicle</h1>
            <p className="mt-1 text-center text-sm text-ink-muted">Use your Operator login. You'll come right back here.</p>
            <Button className="mt-5 w-full" size="lg" onClick={() => navigate('/login', { state: { from: `/v/${code}` } })}>Sign in</Button>
          </Card>
        ) : (
          <Scan code={code} />
        )}
      </div>
    </div>
  )
}

function Scan({ code }: { code: string }) {
  const [info, setInfo] = useState<VehicleScan | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<{ kind: 'on' | 'off'; vehicle: string; replaced?: string | null } | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      setInfo(await vehicleScan.lookup(code))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [code])
  useEffect(() => { void load() }, [load])

  const claim = async () => {
    if (!info) return
    setBusy(true)
    setError(null)
    try {
      const r = await vehicleScan.claim(code, info.me.driver ? {} : who === NEW_DRIVER ? { create: true } : { driver: who })
      setDone({ kind: 'on', vehicle: r.vehicle, replaced: r.replaced })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const release = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await vehicleScan.release(code)
      setDone({ kind: 'off', vehicle: r.vehicle })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <Card>
        <CircleCheck className="mx-auto mb-3 size-12 text-ok" />
        <h1 className="text-center text-lg font-semibold text-ink">
          {done.kind === 'on' ? `You're driving ${done.vehicle}` : `You're off ${done.vehicle}`}
        </h1>
        <p className="mt-1 text-center text-sm text-ink-muted">
          {done.kind === 'on'
            ? `Your trips in it are under your name from now on.${done.replaced ? ` ${done.replaced} was taken off it.` : ''}`
            : 'It has no driver until someone scans in.'}
        </p>
        <Button className="mt-5 w-full" variant="secondary" onClick={() => { setDone(null); setInfo(null); void load() }}>Done</Button>
      </Card>
    )
  }
  if (!info) {
    return error ? (
      <Card>
        <TriangleAlert className="mx-auto mb-3 size-10 text-warn" />
        <p className="text-center text-sm text-ink">{error}</p>
        <Button className="mt-5 w-full" variant="secondary" onClick={() => void load()}>Try again</Button>
      </Card>
    ) : <Spinner />
  }

  const { vehicle, current, me, candidates } = info
  const needsWho = !me.driver && !current?.is_me
  return (
    <Card>
      <div className="flex items-center gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Truck className="size-6" /></span>
        <div className="min-w-0">
          <h1 className="truncate text-lg font-semibold text-ink">{vehicle.name}</h1>
          <p className="truncate text-sm text-ink-muted">{[vehicle.description, vehicle.plate].filter(Boolean).join(' · ') || 'Vehicle'}</p>
        </div>
      </div>

      <div className="mt-4 rounded-md border border-border bg-content px-3 py-2.5 text-sm">
        {current ? (
          <>
            <span className="text-ink-muted">Driver: </span>
            <span className="font-medium text-ink">{current.is_me ? 'You' : current.name}</span>
            {current.since && <span className="text-ink-muted"> since {format(new Date(current.since), 'MMM d, h:mm a')}</span>}
          </>
        ) : (
          <span className="text-ink-muted">No one is assigned to this vehicle.</span>
        )}
      </div>

      {current?.is_me ? (
        <>
          <p className="mt-4 text-center text-sm text-ink">You're this vehicle's driver.</p>
          <Button className="mt-3 w-full" size="lg" variant="secondary" onClick={() => void release()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <LogOut className="size-4" />} I'm done with this vehicle
          </Button>
        </>
      ) : (
        <>
          {needsWho && (
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-ink" htmlFor="who">Which driver are you?</label>
              <p className="mb-2 text-xs text-ink-muted">Pick yourself once. Operator remembers it for next time.</p>
              <Select id="who" value={who} onChange={(e) => setWho(e.target.value)}>
                <option value="">Choose your name</option>
                {candidates.map((c) => <option key={c.number} value={c.number}>{c.name}</option>)}
                <option value={NEW_DRIVER}>I'm not on this list: add me as {me.name}</option>
              </Select>
            </div>
          )}
          {current && (
            <p className="mt-3 text-sm text-warn">{current.name} will be taken off this vehicle.</p>
          )}
          <Button className="mt-4 w-full" size="lg" onClick={() => void claim()} disabled={busy || (needsWho && !who)}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Truck className="size-4" />} I'm driving this
          </Button>
          {me.driver && <p className="mt-2 text-center text-xs text-ink-subtle">As driver {me.driver.name}</p>}
        </>
      )}
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </Card>
  )
}

function Card({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-card p-6">{children}</div>
}

function Spinner() {
  return <div className="grid place-items-center py-10 text-ink-muted"><Loader2 className="size-6 animate-spin" /></div>
}
