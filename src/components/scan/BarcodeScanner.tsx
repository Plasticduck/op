import { useEffect, useRef, useState } from 'react'
import { CameraOff, Flashlight, FlashlightOff, Loader2 } from 'lucide-react'
import { getDetector } from '@/lib/scan/detector'
import { scanFeedback } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'

// Camera barcode scanner (QR and Code 128) for phones: rear camera,
// continuous autofocus where supported, a torch toggle, and a beep / buzz on
// each read. A code fires once while it stays in view; it fires again only
// after it has been out of view for a moment, so continuous mode (audits,
// bulk check-out) doesn't repeat the same sticker. Works in iOS Safari,
// Android Chrome and the iOS app (which grants the camera to our site).

type State = 'starting' | 'scanning' | 'denied' | 'nocamera' | 'error'

// Pull text out of a few common camera constraint shapes TypeScript lacks.
type ExtraCaps = MediaTrackCapabilities & { torch?: boolean; focusMode?: string[] }

const SEEN_GAP_MS = 1500

export function BarcodeScanner({
  onDetect,
  continuous = false,
  className,
}: {
  onDetect: (text: string) => void | Promise<void>
  // Keep scanning after a read (audits, bulk). Otherwise stop after the first.
  continuous?: boolean
  className?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const track = useRef<MediaStreamTrack | null>(null)
  const handler = useRef(onDetect)
  const [state, setState] = useState<State>('starting')
  const [torch, setTorch] = useState<boolean | null>(null) // null = no torch on this camera

  useEffect(() => {
    handler.current = onDetect
  }, [onDetect])

  useEffect(() => {
    let alive = true
    let timer = 0
    let stream: MediaStream | null = null
    const last = { text: '', seenAt: 0 }

    void (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
        })
        if (!alive) return
        const t = stream.getVideoTracks()[0]
        track.current = t
        const caps = (t.getCapabilities?.() ?? {}) as ExtraCaps
        if (caps.focusMode?.includes('continuous')) {
          t.applyConstraints({ advanced: [{ focusMode: 'continuous' } as MediaTrackConstraintSet] }).catch(() => {})
        }
        setTorch(caps.torch ? false : null)
        const v = video.current
        if (!v) return
        v.srcObject = stream
        await v.play()
        const detector = await getDetector()
        if (!alive) return
        setState('scanning')

        const tick = async () => {
          if (!alive) return
          if (v.readyState >= 2 && v.videoWidth > 0) {
            try {
              const text = (await detector.detect(v))[0]?.rawValue?.trim()
              const now = Date.now()
              if (text) {
                const repeat = text === last.text && now - last.seenAt < SEEN_GAP_MS
                last.text = text
                last.seenAt = now
                if (!repeat) {
                  scanFeedback()
                  await handler.current(text)
                  if (!continuous) return
                }
              }
            } catch {
              // a frame that couldn't be read; try the next one
            }
          }
          timer = window.setTimeout(() => void tick(), 120)
        }
        void tick()
      } catch (e) {
        if (!alive) return
        const name = (e as { name?: string })?.name
        setState(
          name === 'NotAllowedError' || name === 'SecurityError' ? 'denied'
            : name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'NotReadableError' ? 'nocamera'
              : 'error',
        )
      }
    })()

    return () => {
      alive = false
      window.clearTimeout(timer)
      stream?.getTracks().forEach((t) => t.stop())
      track.current = null
    }
  }, [continuous])

  const toggleTorch = () => {
    const t = track.current
    if (!t || torch === null) return
    const next = !torch
    t.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      .then(() => setTorch(next))
      .catch(() => setTorch(null))
  }

  const problem =
    state === 'denied' ? 'Camera access is off. Allow it for this site in your browser or phone settings, or type the tag below.'
      : state === 'nocamera' ? "We couldn't find a camera on this device. Type the tag below instead."
        : state === 'error' ? "The camera didn't start. Type the tag below, or close and try again."
          : null

  return (
    <div className={cn('relative overflow-hidden bg-shell', className)}>
      <video ref={video} playsInline muted autoPlay className="absolute inset-0 size-full object-cover" />
      {problem ? (
        <div className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-ink-invert">
          <div>
            <CameraOff className="mx-auto mb-3 size-8 text-ink-invert-muted" />
            {problem}
          </div>
        </div>
      ) : (
        <>
          {/* Viewfinder: the clear square is where the sticker goes. */}
          <div className="pointer-events-none absolute inset-0 grid place-items-center">
            <div className="relative aspect-square w-[68%] max-w-[300px] rounded-xl shadow-[0_0_0_100vmax_color-mix(in_srgb,var(--color-shell)_55%,transparent)]">
              {['left-0 top-0 border-l-4 border-t-4 rounded-tl-xl', 'right-0 top-0 border-r-4 border-t-4 rounded-tr-xl',
                'left-0 bottom-0 border-l-4 border-b-4 rounded-bl-xl', 'right-0 bottom-0 border-r-4 border-b-4 rounded-br-xl'].map((c) => (
                <span key={c} className={cn('absolute size-8 border-ink-invert', c)} />
              ))}
            </div>
          </div>
          {state === 'starting' && (
            <div className="absolute inset-0 grid place-items-center text-ink-invert"><Loader2 className="size-6 animate-spin" /></div>
          )}
          {state === 'scanning' && (
            <p className="pointer-events-none absolute inset-x-0 bottom-4 text-center text-sm text-ink-invert">
              Point at the sticker. Hold steady; it focuses on its own.
            </p>
          )}
          {torch !== null && (
            <button type="button" onClick={toggleTorch} aria-label={torch ? 'Turn the light off' : 'Turn the light on'}
              className={cn('absolute right-3 top-3 grid size-11 place-items-center rounded-full',
                torch ? 'bg-ink-invert text-shell' : 'bg-shell/60 text-ink-invert')}>
              {torch ? <FlashlightOff className="size-5" /> : <Flashlight className="size-5" />}
            </button>
          )}
        </>
      )}
    </div>
  )
}
