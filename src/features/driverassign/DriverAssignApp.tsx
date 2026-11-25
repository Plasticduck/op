import { useCallback, useState, type FormEvent } from 'react'
import { CheckCircle2, KeyRound, Keyboard, Loader2, LogOut, QrCode, RotateCcw, Truck } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { driverAssign, type Assigned, type DriverSession } from '@/lib/queries/driverAssign'

// The Driver Assignment phone app (driverassignment.html, served at
// /driverassignment). A driver opens it, enters their 4-digit PIN (set in Fleet
// Management), and scans the QR sticker on a vehicle's dash; that puts them on the
// vehicle in Verizon Connect. No Operator login: the PIN is the whole sign-in, and it
// lives only in this page's memory, so closing the app signs out. Built like the
// Secret Shopper app: phone first, big touch targets, one column. Size overrides
// use `!` because index.css bumps fields to 16px on touch screens and cn() doesn't
// merge Tailwind classes.

// A sticker's QR is https://operator.washlyfe.com/v/<code>; the code is also printed
// under it. Same rule as the driver-assign function, so a wrong scan is caught here.
const CODE_RE = /^[2-9A-HJ-NP-Z]{6}$/
function stickerCode(scanned: string): string | null {
  const raw = scanned.trim()
  const fromLink = raw.match(/\/v\/([A-Za-z0-9]{6})(?:[/?#]|$)/)
  const code = (fromLink ? fromLink[1] : raw).toUpperCase()
  return CODE_RE.test(code) ? code : null
}

type Done = Assigned & { at: Date }

export default function DriverAssignApp() {
  const [session, setSession] = useState<DriverSession | null>(null)
  const [done, setDone] = useState<Done | null>(null)

  const signOut = () => {
    setSession(null)
    setDone(null)
    window.scrollTo(0, 0)
  }

  return (
    <div className="flex min-h-dvh flex-col bg-content">
      <header className="sticky top-0 z-10 bg-[#0B0F14] pt-[env(safe-area-inset-top)] text-white shadow-sm">
        <div className="mx-auto flex h-14 w-full max-w-xl items-center gap-3 px-4">
          <img src="/ss-mark.png" alt="" className="h-8 w-auto" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold leading-tight">Driver Assignment</div>
            {session && <div className="truncate text-xs text-white/60">Signed in as {session.name}</div>}
          </div>
          {session && (
            <button
              type="button"
              onClick={signOut}
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-sm text-white/80 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
            >
              <LogOut className="size-4" /> Sign out
            </button>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-[calc(env(safe-area-inset-bottom)+2rem)] pt-5">
        {!session ? (
          <PinGate onSignedIn={(s) => { setSession(s); setDone(null) }} />
        ) : done ? (
          <DoneCard
            done={done}
            name={session.name}
            onAnother={() => { setSession({ ...session, vehicle: done.vehicle.name }); setDone(null) }}
            onSignOut={signOut}
          />
        ) : (
          <ScanStep
            session={session}
            onAssigned={(a) => { setDone({ ...a, at: new Date() }); window.scrollTo(0, 0) }}
          />
        )}
      </main>
    </div>
  )
}

// ---- PIN ---------------------------------------------------------------------

function PinGate({ onSignedIn }: { onSignedIn: (s: DriverSession) => void }) {
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!pin || busy) return
    if (pin.length !== 4) {
      setError('Your PIN is 4 digits.')
      return
    }
    setBusy(true)
    setError(null)
    const { data, error: err } = await driverAssign.signIn(pin)
    setBusy(false)
    if (!data) { setError(err); setPin(''); return }
    onSignedIn(data)
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="mx-auto mt-6 max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
      <img src="/ss-logo.png" alt="Mighty Wash" className="mx-auto h-auto w-60 max-w-full" />
      <h1 className="mt-5 text-xl font-semibold text-ink">Enter your driver PIN</h1>
      <p className="mt-1 text-sm text-ink-muted">Then scan the QR code on the vehicle's dash.</p>
      <Input
        type="password"
        inputMode="numeric"
        pattern="[0-9]*"
        autoComplete="one-time-code"
        autoFocus
        maxLength={4}
        aria-label="PIN"
        value={pin}
        onChange={(e) => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setError(null) }}
        className="mt-5 h-14! text-center text-2xl! tracking-[0.5em]"
      />
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Button type="submit" size="lg" className="mt-4 h-12! w-full" disabled={busy}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />} Continue
      </Button>
      <p className="mt-5 text-xs text-ink-subtle">Don't know your PIN? Ask your manager or an Admin.</p>
    </form>
  )
}

// ---- Scan ----------------------------------------------------------------------

function ScanStep({ session, onAssigned }: { session: DriverSession; onAssigned: (a: Assigned) => void }) {
  const [scanning, setScanning] = useState(false)
  // Each scan session gets a fresh camera, so a misread can simply be rescanned.
  const [scanKey, setScanKey] = useState(0)
  const [typing, setTyping] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const assign = useCallback(async (scanned: string) => {
    const code = stickerCode(scanned)
    if (!code) {
      setError('That isn\'t a Mighty Wash vehicle sticker. Scan the QR code on the dash.')
      setScanKey((k) => k + 1)
      return
    }
    setScanning(false)
    setBusy(true)
    setError(null)
    const { data, error: err } = await driverAssign.assign(session.pin, code)
    setBusy(false)
    if (!data) { setError(err); return }
    onAssigned(data)
  }, [session.pin, onAssigned])

  const submitTyped = (e: FormEvent) => {
    e.preventDefault()
    if (typed.trim()) void assign(typed)
  }

  return (
    <div className="mx-auto mt-2 flex max-w-sm flex-col gap-4">
      <div className="rounded-2xl border border-border bg-card p-5 shadow-sm">
        <h1 className="text-xl font-semibold text-ink">Hi, {session.name.split(' ')[0]}</h1>
        <p className="mt-1 flex items-center gap-2 text-sm text-ink-muted">
          <Truck className="size-4 shrink-0" />
          {session.vehicle ? <span>You're on <span className="font-medium text-ink">{session.vehicle}</span> right now.</span> : 'You aren\'t on a vehicle right now.'}
        </p>
      </div>

      {busy ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <Loader2 className="size-8 animate-spin text-accent" />
          <p className="text-sm text-ink-muted">Putting you on the vehicle in Verizon Connect...</p>
        </div>
      ) : scanning ? (
        <div className="flex flex-col gap-3">
          <BarcodeScanner key={scanKey} onDetect={(t) => void assign(t)} className="aspect-[3/4] w-full overflow-hidden rounded-2xl bg-black" />
          <p className="text-center text-sm text-ink-muted">Point your camera at the QR code on the dash.</p>
          <Button variant="secondary" size="lg" className="h-12! w-full" onClick={() => setScanning(false)}>Cancel</Button>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <Button size="lg" className="h-14! w-full text-base!" onClick={() => { setError(null); setScanning(true); setScanKey((k) => k + 1) }}>
            <QrCode className="size-5" /> Scan vehicle QR code
          </Button>
          {typing ? (
            <form onSubmit={submitTyped} className="flex gap-2">
              <Input
                value={typed}
                onChange={(e) => setTyped(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6))}
                placeholder="6-character code"
                aria-label="Sticker code"
                autoCapitalize="characters"
                autoComplete="off"
                className="h-12! text-center font-mono tracking-widest"
              />
              <Button type="submit" size="lg" className="h-12! shrink-0" disabled={typed.length !== 6}>Go</Button>
            </form>
          ) : (
            <button type="button" onClick={() => setTyping(true)} className="inline-flex items-center justify-center gap-1.5 text-sm text-ink-muted hover:text-ink">
              <Keyboard className="size-4" /> Camera not working? Type the code under the QR
            </button>
          )}
        </div>
      )}

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </div>
  )
}

// ---- Done ------------------------------------------------------------------------

function DoneCard({ done, name, onAnother, onSignOut }: { done: Done; name: string; onAnother: () => void; onSignOut: () => void }) {
  return (
    <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-border bg-card p-6 text-center shadow-sm">
      <CheckCircle2 className="mx-auto size-14 text-ok" />
      <h1 className="mt-4 text-xl font-semibold text-ink">{done.already ? 'You\'re already on it' : 'You\'re all set'}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        <span className="font-medium text-ink">{name}</span> is driving{' '}
        <span className="font-medium text-ink">{done.vehicle.name}</span>
        {done.vehicle.description ? ` (${done.vehicle.description})` : ''}.
      </p>
      {done.replaced && <p className="mt-2 text-xs text-ink-subtle">{done.replaced} was taken off this vehicle.</p>}
      <p className="mt-1 text-xs text-ink-subtle">
        {done.at.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </p>
      <div className="mt-6 flex flex-col gap-2">
        <Button size="lg" className="h-12! w-full" onClick={onSignOut}>
          <LogOut className="size-4" /> Done
        </Button>
        <Button variant="secondary" size="lg" className="h-12! w-full" onClick={onAnother}>
          <RotateCcw className="size-4" /> Scan a different vehicle
        </Button>
      </div>
    </div>
  )
}
