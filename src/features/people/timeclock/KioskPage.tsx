import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowLeft,
  Camera,
  Delete,
  LogIn,
  LogOut,
  MapPin,
  ShieldAlert,
  ShieldCheck,
  X,
  Loader2,
} from 'lucide-react'
import { LocationGate } from '@/components/layout/LocationGate'
import { Logo } from '@/components/ui/Logo'
import { Button } from '@/components/ui/Button'
import { useLocations } from '@/lib/locations'
import { timeEntries } from '@/lib/queries/people'
import {
  captureFrame,
  checkLocationFence,
  detectFaceInVideo,
  isFaceDetectorSupported,
  openFrontCamera,
  type FenceCheck,
} from '@/lib/punch'
import { cn } from '@/lib/utils'

type Resolved = {
  employee_id: string
  account_id: string
  name: string
  next_action: 'in' | 'out'
}

type FinalResult = { action: 'in' | 'out'; name: string }

function Inner({ locationId }: { locationId: string }) {
  const { activeLocation } = useLocations()
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [resolved, setResolved] = useState<(Resolved & { pin: string }) | null>(null)
  const [result, setResult] = useState<FinalResult | null>(null)
  const [error, setError] = useState<string | null>(null)

  const requireGeo = activeLocation?.require_geofence ?? false
  const requirePhoto = activeLocation?.require_punch_photo ?? false
  const fenceRadius = activeLocation?.geofence_radius_m ?? 200
  const fenceCenter =
    activeLocation?.latitude != null && activeLocation?.longitude != null
      ? { lat: Number(activeLocation.latitude), lng: Number(activeLocation.longitude) }
      : null

  const submit = async (fullPin: string) => {
    setBusy(true)
    setError(null)
    const { data, error: err } = await timeEntries.resolveKioskPin(locationId, fullPin)
    setBusy(false)
    setPin('')
    if (err) {
      setError('Incorrect PIN — try again')
      return
    }
    setResolved({ ...(data as unknown as Resolved), pin: fullPin })
  }

  const press = (digit: string) => {
    if (busy) return
    setError(null)
    const next = (pin + digit).slice(0, 4)
    setPin(next)
    if (next.length === 4) void submit(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (busy || result || resolved) return
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault()
        press(e.key)
      } else if (e.key === 'Backspace') {
        e.preventDefault()
        setPin((p) => p.slice(0, -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pin, busy, result, resolved])

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-shell text-ink-invert">
      <div className="flex items-center justify-between px-6 py-4">
        <div className="flex items-center gap-2">
          <Logo invert />
          <span className="text-ink-invert-muted">. Time Clock . {activeLocation?.name}</span>
        </div>
        <Link to="/app/timeclock" className="inline-flex items-center gap-1 text-sm text-ink-invert-muted hover:text-white">
          <ArrowLeft className="size-4" /> Exit kiosk
        </Link>
      </div>

      <div className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-xs text-center">
          {result ? (
            <div className="flex flex-col items-center gap-3 py-8">
              <div className={cn('grid size-16 place-items-center rounded-full', result.action === 'in' ? 'bg-ok/20 text-ok' : 'bg-accent/20 text-accent')}>
                {result.action === 'in' ? <LogIn className="size-8" /> : <LogOut className="size-8" />}
              </div>
              <p className="text-xl font-semibold text-white">{result.name}</p>
              <p className="text-sm text-ink-invert-muted">
                Clocked {result.action} . {new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', hour12: true })}
              </p>
            </div>
          ) : resolved ? null : (
            <>
              <p className="mb-2 text-lg font-medium text-white">Enter your PIN</p>
              <p className="mb-5 text-sm text-ink-invert-muted">to clock in or out</p>
              <div className="mb-5 flex justify-center gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className={cn('size-4 rounded-full transition', i < pin.length ? 'bg-accent' : 'bg-white/20')} />
                ))}
              </div>
              {error && <p className="mb-3 text-sm text-danger">{error}</p>}
              <div className="grid grid-cols-3 gap-3">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
                  <button
                    key={d}
                    onClick={() => press(d)}
                    disabled={busy}
                    className="rounded-lg bg-shell-elevated py-5 text-2xl font-medium hover:bg-white/10 disabled:opacity-50"
                  >
                    {d}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => press('0')}
                  disabled={busy}
                  className="rounded-lg bg-shell-elevated py-5 text-2xl font-medium hover:bg-white/10 disabled:opacity-50"
                >
                  0
                </button>
                <button
                  onClick={() => setPin((p) => p.slice(0, -1))}
                  disabled={busy || pin.length === 0}
                  className="rounded-lg py-5 hover:bg-white/10 disabled:opacity-30"
                  aria-label="Delete"
                >
                  <Delete className="mx-auto size-6" />
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {resolved && (
        <VerifyAndPunch
          resolved={resolved}
          locationId={locationId}
          fenceCenter={fenceCenter}
          fenceRadius={fenceRadius}
          requireGeo={requireGeo}
          requirePhoto={requirePhoto}
          onCancel={() => setResolved(null)}
          onPunched={(r) => {
            setResolved(null)
            setResult(r)
            setTimeout(() => setResult(null), 3500)
          }}
        />
      )}
    </div>
  )
}

// Verification step: opens the camera, gets GPS, runs face detection, and
// commits the punch with all the metadata in one RPC call. Designed to be
// fast on a tablet camera (everything runs in parallel where possible).
function VerifyAndPunch({
  resolved, locationId, fenceCenter, fenceRadius, requireGeo, requirePhoto, onCancel, onPunched,
}: {
  resolved: Resolved & { pin: string }
  locationId: string
  fenceCenter: { lat: number; lng: number } | null
  fenceRadius: number
  requireGeo: boolean
  requirePhoto: boolean
  onCancel: () => void
  onPunched: (r: FinalResult) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [cameraReady, setCameraReady] = useState(false)
  const [cameraError, setCameraError] = useState<string | null>(null)
  const [fence, setFence] = useState<FenceCheck | null>(null)
  const [faceDetected, setFaceDetected] = useState<boolean | null>(null)
  const [punching, setPunching] = useState(false)
  const [punchError, setPunchError] = useState<string | null>(null)

  // Tear-down camera on close so the green dot goes away.
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // Open camera + start GPS check in parallel.
  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const stream = await openFrontCamera()
        if (!alive) { stream.getTracks().forEach((t) => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) {
          videoRef.current.srcObject = stream
          await videoRef.current.play()
          setCameraReady(true)
        }
      } catch (e) {
        setCameraError((e as Error).message)
      }
    })()
    void (async () => {
      const f = await checkLocationFence(fenceCenter, fenceRadius)
      if (!alive) return
      setFence(f)
    })()
    return () => { alive = false }
  }, [fenceCenter, fenceRadius])

  // Run face detection on a slow tick while the camera is live so the user
  // sees a green check vs a "no face" prompt before they tap Punch.
  useEffect(() => {
    if (!cameraReady) return
    if (!isFaceDetectorSupported()) return
    let alive = true
    const tick = async () => {
      if (!alive || !videoRef.current) return
      const f = await detectFaceInVideo(videoRef.current)
      if (alive && f != null) setFaceDetected(f)
    }
    const interval = window.setInterval(() => { void tick() }, 800)
    void tick()
    return () => { alive = false; window.clearInterval(interval) }
  }, [cameraReady])

  const fenceUnknown = fence == null
  const fenceBlocked = requireGeo && fence && (fence.unavailable || fence.outside)
  const photoBlocked = requirePhoto && (cameraError != null || (isFaceDetectorSupported() && faceDetected === false))
  const canPunch = cameraReady && fence != null && !fenceBlocked && !photoBlocked && !punching

  const submit = async () => {
    if (!videoRef.current) return
    setPunching(true)
    setPunchError(null)
    try {
      // 1) Capture the still frame.
      const blob = await captureFrame(videoRef.current)
      // 2) Upload to the punch-photos bucket scoped to the account+employee.
      const { error: upErr, path } = await timeEntries.uploadPunchPhoto(
        resolved.account_id,
        resolved.employee_id,
        blob,
      )
      if (upErr) throw new Error(upErr.message)

      // 3) Commit the punch with all metadata in one RPC call.
      const { data, error } = await timeEntries.kioskPunchByPin(locationId, resolved.pin, {
        lat: fence?.coords?.lat ?? null,
        lng: fence?.coords?.lng ?? null,
        distance_m: fence?.distanceM ?? null,
        outside_fence: fence ? fence.outside : null,
        face_detected: faceDetected,
        photo_path: path,
      })
      if (error) throw new Error(error.message)
      const r = data as unknown as { action: 'in' | 'out'; name: string }
      onPunched(r)
    } catch (e) {
      setPunchError((e as Error).message)
      setPunching(false)
    }
  }

  return (
    <div className="absolute inset-0 z-10 flex flex-col bg-shell">
      <div className="flex items-center justify-between px-6 py-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-ink-invert-muted">{resolved.next_action === 'in' ? 'Clocking in' : 'Clocking out'}</div>
          <div className="text-xl font-semibold text-white">{resolved.name}</div>
        </div>
        <button onClick={onCancel} className="text-ink-invert-muted hover:text-white" aria-label="Cancel"><X className="size-6" /></button>
      </div>

      <div className="flex flex-1 items-center justify-center px-6 pb-6">
        <div className="flex w-full max-w-md flex-col gap-4">
          {/* Camera preview */}
          <div className="relative aspect-square overflow-hidden rounded-2xl bg-black ring-2 ring-white/10">
            <video ref={videoRef} playsInline muted className="size-full object-cover" />
            {!cameraReady && !cameraError && (
              <div className="absolute inset-0 grid place-items-center text-white/70 text-sm">
                <div className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Starting camera…</div>
              </div>
            )}
            {cameraError && (
              <div className="absolute inset-0 grid place-items-center bg-shell/80 p-4 text-center text-sm text-white/80">
                <div>
                  <Camera className="mx-auto size-6 text-white/50" />
                  <p className="mt-2">{cameraError}</p>
                  <p className="mt-1 text-xs text-white/50">Allow camera access in your browser settings.</p>
                </div>
              </div>
            )}
            {cameraReady && isFaceDetectorSupported() && (
              <div className="absolute bottom-3 left-3 flex items-center gap-1 rounded-full bg-shell/70 px-2 py-1 text-xs">
                {faceDetected === true && <><ShieldCheck className="size-3.5 text-ok" /><span className="text-white">Face detected</span></>}
                {faceDetected === false && <><ShieldAlert className="size-3.5 text-warn" /><span className="text-white">Look at the camera</span></>}
                {faceDetected === null && <><Loader2 className="size-3.5 animate-spin text-white/60" /><span className="text-white/80">Looking for face…</span></>}
              </div>
            )}
          </div>

          {/* Location row */}
          <div className={cn(
            'flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm',
            fenceUnknown ? 'border-white/10 bg-white/[0.04] text-white/70' :
            fence?.outside ? 'border-warn/40 bg-warn/15 text-white' :
            'border-ok/40 bg-ok/10 text-white',
          )}>
            <MapPin className="size-4 shrink-0" />
            {fenceUnknown && <span>Checking your location…</span>}
            {fence?.unavailable && <span>Location unavailable {fence.errorMessage ? `(${fence.errorMessage})` : ''}</span>}
            {fence && !fence.unavailable && fence.distanceM != null && (
              <span>
                {fence.outside
                  ? `${fence.distanceM} m from the site - outside the ${fenceRadius} m fence`
                  : `${fence.distanceM} m from the site - inside the fence`}
              </span>
            )}
          </div>

          {/* Block reasons */}
          {fenceBlocked && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              Geofence enforcement is on. Get within {fenceRadius} m of the site to punch.
            </p>
          )}
          {photoBlocked && faceDetected === false && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">
              No face detected. Center your face in the camera, then punch.
            </p>
          )}
          {punchError && (
            <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger">{punchError}</p>
          )}

          {/* Submit */}
          <Button
            onClick={() => void submit()}
            disabled={!canPunch}
            size="lg"
            className="w-full text-base"
          >
            {punching ? <Loader2 className="size-4 animate-spin" /> : (resolved.next_action === 'in' ? <LogIn className="size-5" /> : <LogOut className="size-5" />)}
            {resolved.next_action === 'in' ? 'Clock in' : 'Clock out'}
          </Button>
        </div>
      </div>
    </div>
  )
}

export default function KioskPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
