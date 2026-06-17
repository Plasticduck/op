// Time clock punch helpers: geolocation, distance math, camera capture, and
// optional in-browser face detection. All client-side; server-side validation
// is enforced in RLS + the time_entries insert path.

export type Coords = { lat: number; lng: number; accuracyM: number }
export type FenceCheck = {
  coords: Coords | null
  distanceM: number | null
  outside: boolean
  unavailable: boolean
  errorMessage?: string
}

// Wraps navigator.geolocation in a promise with a friendly timeout. Defaults
// chosen to balance accuracy (need it indoors with concrete walls) against the
// "user is waiting at the punch screen" UX.
export function getCurrentPosition(opts?: { timeoutMs?: number; highAccuracy?: boolean }): Promise<Coords> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      reject(new Error('Geolocation not supported in this browser.'))
      return
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracyM: pos.coords.accuracy }),
      (err) => reject(new Error(err.message || 'Could not read your location.')),
      {
        enableHighAccuracy: opts?.highAccuracy ?? true,
        timeout: opts?.timeoutMs ?? 12_000,
        maximumAge: 5_000,
      },
    )
  })
}

// Haversine — great-circle distance in meters between two lat/lng coords.
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371e3
  const phi1 = (a.lat * Math.PI) / 180
  const phi2 = (b.lat * Math.PI) / 180
  const dPhi = ((b.lat - a.lat) * Math.PI) / 180
  const dLam = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLam / 2) ** 2
  return Math.round(2 * R * Math.asin(Math.sqrt(s)))
}

export async function checkLocationFence(
  fenceCenter: { lat: number; lng: number } | null,
  fenceRadiusM: number,
): Promise<FenceCheck> {
  if (!fenceCenter) {
    return { coords: null, distanceM: null, outside: false, unavailable: true, errorMessage: 'No site coordinates set' }
  }
  try {
    const coords = await getCurrentPosition()
    const d = distanceMeters(coords, fenceCenter)
    return { coords, distanceM: d, outside: d > fenceRadiusM, unavailable: false }
  } catch (e) {
    return { coords: null, distanceM: null, outside: false, unavailable: true, errorMessage: (e as Error).message }
  }
}

// ---- Camera + face detection ---------------------------------------------

// Open the front camera. Returns the MediaStream so the caller can attach to a
// <video> for preview; the caller is responsible for stopping the stream.
export async function openFrontCamera(): Promise<MediaStream> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices) {
    throw new Error('Camera not available.')
  }
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      facingMode: 'user',
      width: { ideal: 720 },
      height: { ideal: 720 },
    },
  })
}

// Snap a still frame from the active <video> stream and return it as a JPEG
// blob. We render to a square canvas and downsize a bit; punch photos don't
// need to be high-res, smaller files = faster uploads on a parking-lot LTE.
export async function captureFrame(video: HTMLVideoElement, maxSize = 512): Promise<Blob> {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) throw new Error('Camera not ready yet.')
  const side = Math.min(w, h)
  const sx = (w - side) / 2
  const sy = (h - side) / 2
  const scale = Math.min(1, maxSize / side)
  const out = Math.round(side * scale)
  const canvas = document.createElement('canvas')
  canvas.width = out
  canvas.height = out
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not available.')
  ctx.drawImage(video, sx, sy, side, side, 0, 0, out, out)
  return await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((b) => b ? resolve(b) : reject(new Error('Could not encode photo.')), 'image/jpeg', 0.82)
  })
}

// Browser-native face detection (Shape Detection API). Available on iOS Safari
// 17+ and Chrome on Android. Returns `null` when the API isn't supported so
// callers can choose to accept the photo anyway (capture-for-accountability
// path, no detection guarantee).
type FaceDetectorCtor = new (opts?: { fastMode?: boolean; maxDetectedFaces?: number }) => {
  detect(image: ImageBitmapSource): Promise<Array<unknown>>
}
type WithFaceDetector = Window & { FaceDetector?: FaceDetectorCtor }

export function isFaceDetectorSupported(): boolean {
  return typeof window !== 'undefined' && typeof (window as WithFaceDetector).FaceDetector === 'function'
}

export async function detectFaceInVideo(video: HTMLVideoElement): Promise<boolean | null> {
  const Ctor = (window as WithFaceDetector).FaceDetector
  if (typeof Ctor !== 'function') return null
  try {
    const detector = new Ctor({ fastMode: true, maxDetectedFaces: 1 })
    const bitmap = await createImageBitmap(video)
    const faces = await detector.detect(bitmap)
    bitmap.close?.()
    return faces.length > 0
  } catch {
    return null
  }
}
