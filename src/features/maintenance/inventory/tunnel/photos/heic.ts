// iPhone photos (HEIC) where the browser can't open them: Chrome, Edge and Firefox on
// Windows and Android, where iPhone photos often end up. Safari opens them itself, so this is
// only asked once the browser has tried (preparePhoto's decode). The reading happens in
// workers (heicWorker.ts), started on the first HEIC and ended when the dialog closes
// (releaseHeic) or after a while with nothing to do, since each one holds hundreds of MB
// once it has opened a phone photo. Nothing leaves the device.
import type { HeicAsk, HeicReply } from './heicWorker'
// The worker's own address (its built file, hashed), so a failed start can be told apart:
// offline, or a deploy since the page loaded.
import WORKER_URL from './heicWorker.ts?worker&url'

// bad: not a HEIC libheif can read (damaged, cut short). load: the reader didn't start
// (offline when it was fetched). stale: its file is gone, since Operator was updated after
// the page loaded. slow: no answer in time. closed: the dialog closed.
export type HeicFailure = 'bad' | 'load' | 'stale' | 'slow' | 'closed'
export class HeicError extends Error {
  readonly kind: HeicFailure
  constructor(kind: HeicFailure) {
    super(`heic: ${kind}`)
    this.kind = kind
  }
}

// The ISO-BMFF brands HEIC and HEIF files start with (their 'ftyp' box). Files copied from a
// phone through Windows or a cloud drive often have no type and sometimes no .heic, so the
// file's first bytes decide. mif1 and msf1 are also listed by AVIF files, so only a file's
// main brand counts for those.
const MAIN = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'msf1', 'heif'])
const ALSO = new Set(['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx'])

export async function isHeic(file: File): Promise<boolean> {
  if (/\.(heic|heif|hif)$/i.test(file.name) || /^image\/hei[cf]/i.test(file.type)) return true
  let head: Uint8Array
  try {
    head = new Uint8Array(await file.slice(0, 64).arrayBuffer())
  } catch {
    return false
  }
  const at = (o: number) => String.fromCharCode(head[o], head[o + 1], head[o + 2], head[o + 3])
  if (head.length < 16 || at(4) !== 'ftyp') return false
  if (MAIN.has(at(8))) return true
  const end = Math.min(head.length, ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0)
  // 12 to 16 is the minor version; the compatible brands follow.
  for (let o = 16; o + 4 <= end; o += 4) if (ALSO.has(at(o))) return true
  return false
}

// A 12 MP photo takes about a second on a desktop and several on a phone; this is only for a
// worker that stopped answering, so the tile says so instead of spinning for ever.
const TIMEOUT = 120_000
// Once no worker has had anything to do for this long they are all ended, giving their
// memory back while the photos are looked over. The next HEIC starts one again. It is for
// the pool, not each worker: on a slow phone the page itself is the bottleneck, so one of two
// workers can sit unused for a while in the middle of a pick, and ending it there only meant
// starting it again from cold a few photos later.
const IDLE = 20_000

type Job = { resolve: (b: ImageBitmap) => void; reject: (e: HeicError) => void; timer: number }
// last: when it was last given a photo, so a tie goes to the one that waited longest and both
// stay in use.
type Slot = { worker: Worker; jobs: Map<number, Job>; last: number }
const pool: Slot[] = []
let seq = 0
let idle = 0

// Two workers where there is plenty of memory, matching the two photos the dialog opens at
// once (twice as fast); one elsewhere, since each holds about 300 MB once it has opened a
// 12 MP photo (600 MB after a 48 MP one). deviceMemory is Chrome's, the browser that needs
// this most; it says 8 for 8 GB or more. Firefox doesn't say, and is mostly on desktops.
function room(): number {
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8
  return mem >= 8 && (navigator.hardwareConcurrency ?? 2) >= 4 ? 2 : 1
}

function stop(slot: Slot, why: HeicFailure) {
  const k = pool.indexOf(slot)
  if (k < 0) return
  pool.splice(k, 1)
  slot.worker.terminate()
  for (const job of slot.jobs.values()) {
    window.clearTimeout(job.timer)
    job.reject(new HeicError(why))
  }
  slot.jobs.clear()
}

// Why the worker's script didn't start. Offline it can't be fetched at all. Online, a deploy
// since the page loaded is the likely cause: the old hashed file is gone, and the host
// answers its address with the app's HTML page, which can't start as a worker. Trying again
// can't help then until the page is reloaded, so the message says that instead.
async function whyNoStart(): Promise<HeicFailure> {
  if (!navigator.onLine) return 'load'
  try {
    const r = await fetch(WORKER_URL, { method: 'HEAD', cache: 'no-store' })
    return !r.ok || /html/i.test(r.headers.get('content-type') ?? '') ? 'stale' : 'load'
  } catch {
    return 'load'
  }
}

function start(): Slot {
  const worker = new Worker(WORKER_URL, { type: 'module', name: 'heic' })
  const slot: Slot = { worker, jobs: new Map(), last: 0 }
  worker.onmessage = (e: MessageEvent<HeicReply>) => {
    const r = e.data
    const job = slot.jobs.get(r.id)
    if (!job) {
      if ('bitmap' in r) r.bitmap.close()
      return
    }
    slot.jobs.delete(r.id)
    window.clearTimeout(job.timer)
    if ('bitmap' in r) job.resolve(r.bitmap)
    else job.reject(new HeicError(r.error))
    // heic-to's own libheif worker didn't start (a CSP without blob: workers). heic-to keeps
    // that dead worker, so every later photo here would wait out the timeout: this one is
    // ended, and the next HEIC starts a fresh one.
    if (!('bitmap' in r) && r.error === 'load') stop(slot, 'load')
    if (pool.every((s) => !s.jobs.size)) {
      window.clearTimeout(idle)
      idle = window.setTimeout(releaseHeic, IDLE)
    }
  }
  // The worker's script didn't load (offline, blocked, gone since a deploy) or it failed
  // outside a photo: every photo waiting on it is told, and the next one starts a new worker.
  worker.onerror = (e) => {
    e.preventDefault()
    void whyNoStart().then((why) => stop(slot, why))
  }
  worker.onmessageerror = () => stop(slot, 'bad')
  pool.push(slot)
  return slot
}

// The photo, upright, as a bitmap the caller closes. A signal already aborted (the dialog
// closed while this photo was on its way here) starts nothing, so no worker is left holding
// its memory after the dialog has gone.
export function decodeHeic(file: File, signal?: AbortSignal): Promise<ImageBitmap> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new HeicError('closed'))
    let slot = pool.reduce<Slot | undefined>(
      (a, s) => (!a || s.jobs.size < a.jobs.size || (s.jobs.size === a.jobs.size && s.last < a.last) ? s : a),
      undefined,
    )
    try {
      if (!slot || (slot.jobs.size && pool.length < room())) slot = start()
    } catch {
      // A Content Security Policy that forbids workers.
      return reject(new HeicError('load'))
    }
    const s = slot
    const id = ++seq
    window.clearTimeout(idle)
    s.last = performance.now()
    s.jobs.set(id, { resolve, reject, timer: window.setTimeout(() => stop(s, 'slow'), TIMEOUT) })
    s.worker.postMessage({ id, file } satisfies HeicAsk)
  })
}

// The dialog closed (or nothing has been read for a while): every worker ends, and anything
// still being read is dropped.
export function releaseHeic() {
  window.clearTimeout(idle)
  for (const slot of [...pool]) stop(slot, 'closed')
}
