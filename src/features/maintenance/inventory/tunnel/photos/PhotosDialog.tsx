import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type CSSProperties, type ReactNode, type RefCallback } from 'react'
import { ArrowLeft, Camera, ImagePlus, Link2, Loader2, Move, Plus, Repeat, Ruler, Scaling, Sparkles, X, type LucideIcon } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { FromPhotosError, miTunnel, PHOTO_LIMITS, type PhotoErrorCode, type PhotoProposal, type PhotosRequest, type PhotoView, type TunnelAsset, type TunnelData, type TunnelItem, type TunnelLayout } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { shortName } from '../../equipment/format'
import { errText } from '../../format'
import { ErrorNote, WarnNote } from '../../ui'
import { expressTemplate } from '../expressTemplate'
import { SHAPES } from '../shapes'
import { TunnelDiagram } from '../TunnelDiagram'
import type { Draft } from '../useEditorState'
import { planCreate, planUpdate, type Catalog, type Change, type ChangeKind, type CreatePlan, type Seen, type UpdateCounts, type UpdatePlan } from './mergeProposal'
import { encodePhoto, PhotoError, readPhoto, type EncodedPhoto, type Share } from './preparePhoto'

// Photos of the real tunnel in, a drawing out. The person picks photos (and says where each
// was taken from, if they like), Claude reads them in the tunnel-from-photos function, and
// what it found is drawn here to accept. With no drawing yet that is the whole drawing; with
// one, it is the corrections (mergeProposal.ts), and nothing on the drawing changes until
// they save. The photos only pass through: they are made small here, sent once, and dropped
// when this closes.

type Props = {
  siteId: string
  siteName: string
  tunnelNo: number
  tunnelName?: string
  // The drawing on screen, unsaved moves included. null: the site has none yet.
  layout: TunnelLayout | null
  items: TunnelItem[]
  // Where each shape with an unsaved move is saved (the function only reads the saved drawing).
  saved?: Record<string, { x_ft: number; y_ft: number }>
  assets: Record<string, TunnelAsset>
  unplaced: TunnelData['unplaced']
  // Whether the editor can be offered (it is for wide screens only).
  canReview: boolean
  onClose: () => void
  // The drawing was saved: the page loads it again.
  onSaved: () => void
  // Load the drawing again: someone else's save got in first, or the drawing appeared or
  // went while this was open. Resolves once the page has it.
  onReload: () => Promise<void>
  // Open the editor on what the photos found, unsaved.
  onReview: (draft: Draft) => void
}

// Where a photo was taken from: short, to fit two to a row on a phone. The instructions
// above say which way each one looks.
const VIEWS: Array<{ value: PhotoView; label: string }> = [
  { value: 'entrance', label: 'Entrance' },
  { value: 'exit', label: 'Exit' },
  { value: 'driver_side', label: "Driver's side" },
  { value: 'passenger_side', label: 'Passenger side' },
  { value: 'middle', label: 'Middle' },
  { value: 'equipment_room', label: 'Equipment room' },
  { value: 'other', label: 'Somewhere else' },
]

// Every kind of shape the drawing can use, for the model to pick from.
const CATALOG: Catalog = Object.entries(SHAPES).map(([kind, s]) => ({ kind, label: s.label, group: s.group, w: s.w, h: s.h, side: s.side, scenery: !!s.scenery }))

// A typical tunnel to start from, for a site with no drawing whose account has no template
// (the function uses the template when there is one).
function prior(): NonNullable<PhotosRequest['prior']> {
  const t = expressTemplate()
  return {
    length_ft: t.length_ft ?? 134, width_ft: t.width_ft ?? 16, zones: t.zones ?? [],
    items: (t.items ?? []).map((i) => ({ kind: i.kind, label: i.label, x_ft: i.x_ft, y_ft: i.y_ft, w_ft: i.w_ft, h_ft: i.h_ft, side: i.side, zone: i.zone, match_type: i.match_type, ...(Object.keys(i.props).length ? { props: i.props } : {}) })),
  }
}

// A picked photo. All a pick keeps of it is the file and a small copy for the tile (thumb, an
// object URL): hundreds of photos at full size would fill a phone's memory. The JPEG that is
// sent is kept apart (Made), so making one doesn't draw the tiles again.
type Pic = {
  key: string
  file: File
  view: PhotoView | ''
  status: 'reading' | 'ready' | 'failed'
  thumb?: string
  error?: string
}
// The JPEG made of a photo and the share it was made for.
type Made = { photo: EncodedPhoto; share: Share }
type Step = 'photos' | 'reading' | 'result' | 'failed'
// What the answer comes to on the drawing as the page has it now. A proposal is for the
// mode it was asked in, and the drawing can appear (someone else saves one) or go while
// the photos are read or looked over: taken is a whole drawing for a tunnel that has one
// now, none is corrections for a tunnel that has none (or not yet: a reload brings it).
type Plan = ({ mode: 'create' } & CreatePlan) | ({ mode: 'update' } & UpdatePlan) | { mode: 'taken' } | { mode: 'none' }
// Errors that would only come back the same however often it is tried.
const FINAL: ReadonlySet<PhotoErrorCode> = new Set(['no_key', 'forbidden'])
// Photos opened at once on a pick: enough that the tiles fill in steadily, few enough that
// a phone opening camera photos doesn't run out of memory.
const OPENING = 2
const UNREADABLE = "This file couldn't be opened as a photo."
// A JPEG made for a share up to this much smaller than the one it would get now is used as it
// is: a few photos removed (or one left out) would give one that looks about the same, for
// all the time making it again takes.
const GROW = 1.1
// The rest of a request at its longest: every photo with the longest view, and (below) both
// lengths as long as a number gets in JSON and the starting drawing a new one sends.
const LONGEST_VIEW = VIEWS.reduce((a, v) => (v.value.length > a.length ? v.value : a), VIEWS[0].value)
const PHOTO_JSON = JSON.stringify({ media_type: 'image/jpeg', data: '', view: LONGEST_VIEW }).length
const LONGEST_FT = -Number.MAX_VALUE

let seq = 0
const nothing = () => {}
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const list = (names: string[]) => (names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`)

// A length typed in: empty is fine, anything else must be a tunnel's.
function feetIn(v: string): { value: number | null; bad: boolean } {
  if (!v.trim()) return { value: null, bad: false }
  const n = Number(v)
  return Number.isFinite(n) && n >= PHOTO_LIMITS.minFt && n <= PHOTO_LIMITS.maxFt ? { value: n, bad: false } : { value: null, bad: true }
}

const ICON: Record<ChangeKind, LucideIcon> = { added: Plus, moved: Move, resized: Scaling, linked: Link2, conveyor: Repeat, removed: X, tunnel: Ruler }

// Each photo's even share of a request with this many photos, given what the rest of it
// comes to with no photos (rest, in UTF-8 bytes, as it goes out). Of its length: what is
// left once the rest and each photo's JSON are counted, split evenly. The rest is counted at
// its longest, so setting a view, typing a length or the drawing appearing changes no
// photo's share, and the JPEGs already made for it still do. Of the visual tokens: an even
// split, which is more than a full-size photo needs until there are many.
function shareOf(rest: number, n: number): Share {
  const count = Math.max(1, n)
  const overhead = rest + count * PHOTO_JSON + (count - 1)
  return {
    chars: Math.min(PHOTO_LIMITS.chars, Math.floor((PHOTO_LIMITS.body - overhead) / count)),
    tokens: Math.floor(PHOTO_LIMITS.visualTokens / count),
  }
}

// Whether a JPEG made earlier does for this share: it fits, and either nothing had to give
// for it or the share now isn't much larger than the one it was made for.
function fits({ photo, share: was }: Made, share: Share): boolean {
  if (photo.data.length > share.chars || photo.tokens > share.tokens) return false
  return photo.full || (share.chars <= was.chars * GROW && share.tokens <= was.tokens * GROW)
}

export function PhotosDialog({ siteId, siteName, tunnelNo, tunnelName, layout, items, saved, assets, unplaced, canReview, onClose, onSaved, onReload, onReview }: Props) {
  // What a new Analyze asks for: it follows the page, so a drawing someone else saves (or
  // deletes) while this is open is what the next one works on.
  const mode: 'create' | 'update' = layout ? 'update' : 'create'
  const [pics, setPics] = useState<Pic[]>([])
  const [skipped, setSkipped] = useState(0)
  const [length, setLength] = useState('')
  const [conveyor, setConveyor] = useState('')
  const [step, setStep] = useState<Step>('photos')
  const [error, setError] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<PhotoErrorCode | null>(null)
  const [proposal, setProposal] = useState<PhotoProposal | null>(null)
  // The saved drawing the function read for this proposal (update only), so a reload after
  // a clash keeps what others saved since (mergeProposal's Seen).
  const [seen, setSeen] = useState<Seen | null>(null)
  // Removals the person unticked, by shape id.
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set())
  const [picked, setPicked] = useState<string | null>(null)
  const [started, setStarted] = useState(0)
  const [now, setNow] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)
  const [reloading, setReloading] = useState(false)
  // Analyze making the photos ready to send, before it sends them: how far it has got.
  const [prep, setPrep] = useState<{ done: number; total: number } | null>(null)
  // The photos the last Analyze couldn't make ready, by their numbers, and so left out.
  const [leftOut, setLeftOut] = useState<number[]>([])
  // The photos whose JPEG had to give something up for its share (made smaller, or saved at
  // a lower quality).
  const [small, setSmall] = useState<ReadonlySet<string>>(new Set())
  // Asking whether to close and lose the photos (Escape, the backdrop or the X).
  const [leaving, setLeaving] = useState(false)
  // The footer's height, so a control the keyboard moves to is scrolled clear of it.
  const [foot, setFoot] = useState(0)
  const asked = useRef(0)
  const abort = useRef<AbortController | null>(null)
  const alive = useRef(true)
  // Each photo still in the dialog, with its tile's object URL once it has one.
  const thumbs = useRef(new Map<string, string | null>())
  // Photos picked and not opened yet, and how many are being opened.
  const queue = useRef<Pic[]>([])
  const opening = useRef(0)
  // Each photo's JPEG, and the ones being made again just now (so a second ask waits for that
  // one instead of making it twice).
  const made = useRef(new Map<string, Made>())
  const making = useRef(new Map<string, Promise<unknown>>())
  const top = useRef<HTMLDivElement>(null)
  const failNote = useRef<HTMLDivElement>(null)
  const stayButton = useRef<HTMLButtonElement>(null)
  // Where focus was when the question came up, to go back to if they stay.
  const before = useRef<HTMLElement | null>(null)
  const ids = useId()

  // Closing drops the photos and any answer still on its way.
  useEffect(() => {
    alive.current = true
    const held = thumbs.current
    const waiting = queue.current
    const jpegs = made.current
    return () => {
      alive.current = false
      abort.current?.abort()
      for (const u of held.values()) if (u) URL.revokeObjectURL(u)
      held.clear()
      waiting.length = 0
      jpegs.clear()
    }
  }, [])

  useEffect(() => {
    if (step !== 'reading') return
    const t = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(t)
  }, [step])

  const patch = useCallback((key: string, p: Partial<Pic>) => setPics((ps) => ps.map((x) => (x.key === key ? { ...x, ...p } : x))), [])
  // A photo that can't be used: its tile says why, and it isn't sent.
  const fail = useCallback((key: string, e: unknown) => patch(key, { status: 'failed', error: e instanceof PhotoError ? e.message : UNREADABLE }), [patch])

  // What the rest of a request comes to with no photos, at its longest (shareOf).
  const rest = useMemo(() => new TextEncoder().encode(JSON.stringify({
    site_id: siteId, tunnel_no: tunnelNo, catalog: CATALOG, known: { length_ft: LONGEST_FT, conveyor_ft: LONGEST_FT }, prior: prior(), photos: [],
  } satisfies PhotosRequest)).length, [siteId, tunnelNo])

  // A photo's JPEG, kept with the share it was made for, while the photo is still here.
  const keep = useCallback((key: string, photo: EncodedPhoto, share: Share) => {
    if (!thumbs.current.has(key)) return
    made.current.set(key, { photo, share })
    setSmall((s) => {
      if (s.has(key) === !photo.full) return s
      const next = new Set(s)
      if (photo.full) next.delete(key)
      else next.add(key)
      return next
    })
  }, [])

  // A photo's JPEG for this share: the one made already if it still does, else a new one from
  // its file (after waiting for one being made now, which may do). When a better copy can't
  // be made (the file went since the pick), the one made already is sent if it fits.
  const jpeg = useCallback(async (p: Pic, share: Share): Promise<EncodedPhoto> => {
    const now = making.current.get(p.key)
    if (now) await now.catch(() => {})
    const have = made.current.get(p.key)
    if (have && fits(have, share)) return have.photo
    const job = encodePhoto(p.file, share)
    making.current.set(p.key, job)
    try {
      const photo = await job
      keep(p.key, photo, share)
      return photo
    } catch (e) {
      if (have && have.photo.data.length <= share.chars && have.photo.tokens <= share.tokens) return have.photo
      throw e
    } finally {
      if (making.current.get(p.key) === job) making.current.delete(p.key)
    }
  }, [keep])

  // Picked photos are opened a couple at a time, in the order picked, however many picks
  // they came in, and each one's JPEG is made then, for its share with every photo picked so
  // far: most often that is the share it is sent with, so Analyze has nothing left to make.
  // A photo removed before its turn is skipped, and one removed while it was being opened
  // lets its tile's copy go.
  const open = useCallback(() => {
    while (opening.current < OPENING && queue.current.length) {
      opening.current++
      void (async () => {
        try {
          for (let p = queue.current.shift(); p && alive.current; p = queue.current.shift()) {
            if (!thumbs.current.has(p.key)) continue
            try {
              const share = shareOf(rest, thumbs.current.size)
              const r = await readPhoto(p.file, share)
              if (!alive.current || !thumbs.current.has(p.key)) { URL.revokeObjectURL(r.thumb); continue }
              thumbs.current.set(p.key, r.thumb)
              keep(p.key, r.photo, share)
              patch(p.key, { status: 'ready', thumb: r.thumb })
            } catch (e) {
              if (alive.current) fail(p.key, e)
            }
          }
        } finally {
          opening.current--
        }
      })()
    }
  }, [patch, fail, keep, rest])

  const add = (files: FileList | null) => {
    const all = Array.from(files ?? [])
    if (!all.length) return
    // thumbs counts the photos as they are picked, so a second pick before the first is in
    // can't go over the limit.
    const take = all.slice(0, Math.max(0, PHOTO_LIMITS.photos - thumbs.current.size))
    setSkipped(all.length - take.length)
    const fresh: Pic[] = take.map((file) => ({ key: `p${++seq}`, file, status: 'reading', view: '' }))
    for (const p of fresh) thumbs.current.set(p.key, null)
    queue.current.push(...fresh)
    setPics((ps) => [...ps, ...fresh])
    open()
  }
  // The tiles' own handlers, the same on every render, so a tile only draws again when its
  // photo changes: with hundreds, every photo opened would otherwise draw them all.
  const remove = useCallback((key: string) => {
    const u = thumbs.current.get(key)
    if (u) URL.revokeObjectURL(u)
    thumbs.current.delete(key)
    made.current.delete(key)
    setPics((ps) => ps.filter((x) => x.key !== key))
    setSmall((s) => {
      if (!s.has(key)) return s
      const next = new Set(s)
      next.delete(key)
      return next
    })
    setSkipped(0)
  }, [])
  const setView = useCallback((key: string, view: PhotoView | '') => patch(key, { view }), [patch])

  const ready = pics.filter((p) => p.status === 'ready')
  const opened = pics.length - pics.filter((p) => p.status === 'reading').length
  const busy = opened < pics.length
  // Whether there are enough photos that some are sent smaller: one or more had to give
  // something up, and the share is under the most one photo may have. (Below that, a very
  // detailed photo made smaller is that photo's doing, not the count's.)
  const shrunk = useMemo(() => pics.filter((p) => p.status === 'ready' && small.has(p.key)).length, [pics, small])
  const smaller = shrunk > 0 && shareOf(rest, ready.length).chars < PHOTO_LIMITS.chars
  const len = feetIn(length)
  const conv = feetIn(conveyor)
  const canAnalyze = ready.length > 0 && !busy && !len.bad && !conv.bad
  // Anything that closing would lose: a photo that isn't one turned away.
  const worth = pics.some((p) => p.status !== 'failed')

  // Once the photos are in, any whose JPEG no longer does (more were added after it was made,
  // or enough were removed that a better one is worth making) is made again in the
  // background, one at a time, so Analyze finds it ready. A change to the photos starts it
  // over; the photo it was on is kept, and nothing done is made twice.
  useEffect(() => {
    if (step !== 'photos' || busy) return
    const going = pics.filter((p) => p.status === 'ready')
    if (!going.length) return
    const share = shareOf(rest, going.length)
    let stop = false
    const t = window.setTimeout(() => void (async () => {
      for (const p of going) {
        if (stop || !alive.current) return
        try {
          await jpeg(p, share)
        } catch (e) {
          if (alive.current && thumbs.current.has(p.key)) fail(p.key, e)
        }
      }
    })(), 500)
    return () => {
      stop = true
      window.clearTimeout(t)
    }
  }, [step, busy, pics, rest, jpeg, fail])

  // The page loads the drawing again; Save waits for it, since until then it would send
  // the version that was just turned away.
  const reload = useCallback(async () => {
    setReloading(true)
    try {
      await onReload()
    } finally {
      if (alive.current) setReloading(false)
    }
  }, [onReload])

  const analyze = async () => {
    if (!canAnalyze) return
    const mine = ++asked.current
    abort.current?.abort()
    const ctl = new AbortController()
    abort.current = ctl
    const asking = mode
    // The saved drawing as the function will read it: the page's, each unsaved move put back.
    const reading: Seen | null = layout
      ? { length_ft: Number(layout.length_ft), width_ft: Number(layout.width_ft), items: items.map((i) => (saved?.[i.id] ? { ...i, ...saved[i.id] } : i)) }
      : null
    const going = ready
    const number = new Map(pics.map((p, k) => [p.key, k + 1]))
    setError(null)
    setErrorCode(null)
    setLeftOut([])
    setPrep({ done: 0, total: going.length })
    setStep('reading')
    try {
      const request: Omit<PhotosRequest, 'photos'> = {
        site_id: siteId, tunnel_no: tunnelNo, catalog: CATALOG,
        ...(len.value != null || conv.value != null ? { known: { length_ft: len.value, conveyor_ft: conv.value } } : {}),
        ...(asking === 'create' ? { prior: prior() } : {}),
      }
      const share = shareOf(rest, going.length)
      // One photo at a time, so a phone holds one camera photo open at once. Most were made
      // for this share when they were picked, or since, and are only counted here.
      const photos: PhotosRequest['photos'] = []
      const lost: number[] = []
      for (const p of going) {
        let photo: EncodedPhoto
        try {
          photo = await jpeg(p, share)
        } catch (e) {
          if (mine !== asked.current) return
          // The file can go between the pick and now (a photo on a cloud drive), or come out
          // too detailed even small: the rest go without it, and its tile says why.
          lost.push(number.get(p.key) ?? 0)
          fail(p.key, e)
          setPrep({ done: photos.length + lost.length, total: going.length })
          continue
        }
        // Cancelled (or closed) while it was being made: nothing more is made or sent.
        if (mine !== asked.current) return
        photos.push({ media_type: 'image/jpeg', data: photo.data, view: p.view || null })
        setPrep({ done: photos.length + lost.length, total: going.length })
      }
      if (mine !== asked.current) return
      setPrep(null)
      if (!photos.length) {
        setError("None of the photos could be sent. Each one's tile says why.")
        setStep('failed')
        return
      }
      setLeftOut(lost)
      setStarted(Date.now())
      setNow(Date.now())
      const proposal = await miTunnel.fromPhotos({ ...request, photos }, ctl.signal)
      if (mine !== asked.current) return
      // The function found a drawing the page doesn't have, or none where the page has one:
      // the page loads it, and the plan below works out what the answer is good for then.
      if (proposal.mode !== asking) void reload()
      setProposal(proposal)
      setSeen(proposal.mode === 'update' && asking === 'update' ? reading : null)
      setKept(new Set())
      setPicked(null)
      setSaveError(null)
      setConflict(false)
      setStep('result')
    } catch (e) {
      if (mine !== asked.current || ctl.signal.aborted) return
      setPrep(null)
      setError(errText(e))
      setErrorCode(e instanceof FromPhotosError ? e.code : null)
      setStep('failed')
    }
  }

  // Closing while it reads: whatever comes back is ignored.
  const close = useCallback(() => {
    asked.current++
    abort.current?.abort()
    onClose()
  }, [onClose])

  // Also Cancel while it gets the photos ready or reads them: that stops, and the photos stay
  // to change or send again. Adding hundreds can take minutes.
  const backToPhotos = () => {
    asked.current++
    abort.current?.abort()
    setPrep(null)
    setStep('photos')
    setSaveError(null)
    setConflict(false)
  }

  // They stay: focus goes back where it was, if that was in the dialog.
  const stay = useCallback(() => {
    setLeaving(false)
    const el = before.current
    before.current = null
    if (el?.isConnected && top.current?.closest('[role="dialog"]')?.contains(el)) el.focus({ preventScroll: true })
    else top.current?.focus({ preventScroll: true })
  }, [])

  // Escape, the backdrop or the dialog's X. Once photos are added these ask first instead of
  // dropping them: on a phone a tap just past the dialog is easy to make, and adding the
  // photos again can take minutes. With the question up, they put it away.
  const dismiss = useCallback(() => {
    if (saving) return
    if (leaving) return stay()
    if (!worth) return close()
    before.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setLeaving(true)
  }, [saving, leaving, worth, stay, close])
  useEffect(() => { if (leaving) stayButton.current?.focus() }, [leaving])

  // The footer's height, measured while one is shown. A callback ref, since the footer
  // changes with the step.
  const measure = useCallback<RefCallback<HTMLDivElement>>((el) => {
    if (!el) return
    const ro = new ResizeObserver(() => setFoot(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // The shapes with unsaved moves: saving here saves them too.
  const moved = useMemo(() => new Set(Object.keys(saved ?? {})), [saved])

  // What saving would do, worked out again whenever the drawing on screen changes under it
  // (a reload, someone linking a machine), so what is shown is what is saved.
  const plan = useMemo((): Plan | null => {
    if (!proposal) return null
    if (proposal.mode === 'create') {
      return layout ? { mode: 'taken' } : { mode: 'create', ...planCreate(proposal, { site_id: siteId, tunnel_no: tunnelNo, name: tunnelName }, CATALOG) }
    }
    if (!layout) return { mode: 'none' }
    const current: Draft = { length_ft: Number(layout.length_ft), width_ft: Number(layout.width_ft), zones: layout.zones ?? [], items }
    return { mode: 'update', ...planUpdate(proposal, current, kept, CATALOG, { seen, moved }) }
  }, [proposal, siteId, tunnelNo, tunnelName, layout, items, seen, moved, kept])

  // Each step starts at its top, read from there, and so does a result that turns into
  // another (the drawing appeared or went, or a reload brought it).
  const screen = step === 'result' ? `result-${reloading && plan && (plan.mode === 'taken' || plan.mode === 'none') ? 'loading' : plan?.mode}` : step
  useEffect(() => { top.current?.focus() }, [screen])
  // A failed save disabled the button that had focus: the reason takes it, so it is read
  // out and the next Tab stays in the dialog.
  useEffect(() => { if (saveError) failNote.current?.focus() }, [saveError])

  // Names for the machines a shape is newly linked to: the site's machines on no drawing yet.
  const allAssets = useMemo(() => {
    const out: Record<string, TunnelAsset> = {}
    for (const u of unplaced) out[u.id] = { id: u.id, name: u.name, type: u.type ?? undefined, status: u.status, open_wos: 0, children: 0 }
    return { ...out, ...assets }
  }, [assets, unplaced])
  const notes = Array.isArray(proposal?.notes) ? proposal.notes.filter((n) => typeof n === 'string' && n.trim()) : []
  const machine = (id: string | undefined) => (id && allAssets[id] ? shortName(allAssets[id].name) : 'a machine')

  const save = async () => {
    if (!plan || saving || reloading) return
    if (plan.mode !== 'create' && plan.mode !== 'update') return
    setSaving(true)
    setSaveError(null)
    setConflict(false)
    try {
      if (plan.mode === 'create') await miTunnel.save(plan.save)
      else if (layout) {
        await miTunnel.save({
          id: layout.id, version: layout.version, name: layout.name,
          length_ft: plan.draft.length_ft, width_ft: plan.draft.width_ft, zones: plan.draft.zones, items: plan.items,
        })
      }
      if (alive.current) onSaved()
    } catch (e) {
      if (!alive.current) return
      const m = errText(e)
      const clash = /Someone else changed/.test(m)
      setConflict(clash)
      setSaveError(clash ? 'Someone else saved this drawing after it was loaded. Reload to bring in their changes, then check the list and save again.' : m)
      // A new drawing turned away is most often one that someone else saved first: the page
      // loads it, and this offers to read the photos again as corrections to it.
      if (plan.mode === 'create') void reload()
    } finally {
      if (alive.current) setSaving(false)
    }
  }

  const title = mode === 'create' ? 'Build the drawing from photos' : 'Update the drawing from photos'
  const elapsed = Math.max(0, Math.round((now - started) / 1000))
  const final = !!errorCode && FINAL.has(errorCode)
  const lostLine = leftOut.length
    ? `${leftOut.length === 1 ? `Photo ${leftOut[0]}` : `Photos ${list(leftOut.map(String))}`} couldn't be sent, so ${leftOut.length === 1 ? 'it was' : 'they were'} left out. ${leftOut.length === 1 ? 'Its tile says' : 'Their tiles say'} why.`
    : null
  const usable = pics.filter((p) => p.status !== 'failed').length
  const leaveLine = step === 'result' && (plan?.mode === 'create' || plan?.mode === 'update')
    ? 'Close without saving? What the photos found is lost.'
    : `Close and lose the ${usable === 1 ? 'photo' : `${usable} photos`} you added?`

  return (
    <Modal open onClose={dismiss} title={title} size="lg"
      description={`${siteName}${tunnelName && tunnelName !== 'Tunnel' ? `, ${tunnelName}` : ''}. The photos are only used to read the tunnel. They aren't saved.`}>
      {/* Every control's scroll margin is the footer's height, so one the keyboard moves to
          is scrolled clear of the footer rather than left under it. */}
      <div ref={top} tabIndex={-1} style={{ '--foot': `${foot}px` } as CSSProperties}
        className="flex flex-col gap-4 focus:outline-none [&_*]:scroll-mb-[calc(var(--foot)+0.5rem)]">
        {leaving && (
          // At the top of what is in sight, however far down the photos it was asked.
          <div className="sticky -top-4 z-20 -mx-5 -mt-4 flex flex-wrap items-center gap-2 border-b border-border bg-card px-5 py-3">
            <p role="alert" className="min-w-0 flex-1 basis-56 text-sm font-medium text-ink">{leaveLine}</p>
            <div className="ml-auto flex gap-2">
              <Button ref={stayButton} size="sm" variant="secondary" onClick={stay}>Stay</Button>
              <Button size="sm" variant="danger" onClick={close}>Close</Button>
            </div>
          </div>
        )}
        {step === 'photos' && (
          <>
            <div className="flex flex-col gap-1.5 text-sm text-ink-muted">
              <p>
                Take photos from the entrance looking in, from the exit looking back, and along each side, and of the equipment room if it&apos;s on the drawing.
                More photos, and the tunnel&apos;s length if you know it, give a truer scale.
              </p>
              <p>
                {mode === 'create'
                  ? 'Every machine the photos show is placed where it stands. You see the drawing before anything is saved.'
                  : 'Machines the photos show somewhere else are moved, and ones missing from the drawing are added. Everything else stays as it is, and nothing changes until you save.'}
              </p>
            </div>

            <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-label="Photos">
              {pics.map((p, k) => <PhotoTile key={p.key} pic={p} n={k + 1} onRemove={remove} onView={setView} />)}
              {pics.length < PHOTO_LIMITS.photos && (
                <li>
                  {/* The input itself takes focus (it is only hidden from sight), so a keyboard
                      opens the picker. No capture attribute: a phone offers its camera and its library.
                      It covers the tile, unseen, so focus on it scrolls the whole tile into sight
                      (a hidden 1 px input left half the tile under the footer, or, placed outside
                      the tile, none of it). */}
                  <label className="relative flex aspect-[4/3] cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-border text-center text-xs text-ink-muted hover:bg-content focus-within:ring-2 focus-within:ring-accent">
                    {pics.length ? <ImagePlus className="size-5" /> : <Camera className="size-5" />}
                    <span className="font-medium text-ink">{pics.length ? 'Add more' : 'Add photos'}</span>
                    {!pics.length && <span>Pick several at once</span>}
                    <input type="file" accept="image/*" multiple className="absolute inset-0 size-full cursor-pointer opacity-0" onChange={(e) => { add(e.target.files); e.target.value = '' }} />
                  </label>
                </li>
              )}
            </ul>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Tunnel length (ft)" hint={len.bad ? undefined : 'Optional. Entrance to exit, if you know it.'} error={len.bad ? `Between ${PHOTO_LIMITS.minFt} and ${PHOTO_LIMITS.maxFt} ft.` : undefined}>
                {(id) => <Input id={id} type="number" inputMode="decimal" min={PHOTO_LIMITS.minFt} max={PHOTO_LIMITS.maxFt} value={length} onChange={(e) => setLength(e.target.value)} invalid={len.bad} />}
              </Field>
              <Field label="Conveyor length (ft)" hint={conv.bad ? undefined : 'Optional.'} error={conv.bad ? `Between ${PHOTO_LIMITS.minFt} and ${PHOTO_LIMITS.maxFt} ft.` : undefined}>
                {(id) => <Input id={id} type="number" inputMode="decimal" min={PHOTO_LIMITS.minFt} max={PHOTO_LIMITS.maxFt} value={conveyor} onChange={(e) => setConveyor(e.target.value)} invalid={conv.bad} />}
              </Field>
            </div>

            {/* In the footer, which stays in sight: with many photos the end of the list is a
                long way down. */}
            <Footer measure={measure}>
              {skipped > 0 && (
                <div role="status">
                  <WarnNote>{PHOTO_LIMITS.photos} photos is the most one reading can take, so {plural(skipped, 'was', 'were')} left out.</WarnNote>
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                {busy
                  ? <span className="mr-auto text-xs tabular-nums text-ink-muted">Adding photos: {opened} of {pics.length}</span>
                  : smaller && <span className="mr-auto min-w-0 flex-1 basis-56 text-xs text-ink-muted">With this many photos, {shrunk === ready.length ? 'each one is' : 'some are'} sent smaller and reading takes longer.</span>}
                <Button variant="secondary" onClick={close}>Cancel</Button>
                <Button onClick={() => void analyze()} disabled={!canAnalyze}>
                  <Sparkles className="size-4" /> Analyze {ready.length > 0 ? plural(ready.length, 'photo') : 'photos'}
                </Button>
              </div>
            </Footer>
          </>
        )}

        {step === 'reading' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Loader2 className="size-6 animate-spin text-accent" aria-hidden />
            {/* One live region for both stages, so the move from one to the other is read out,
                but not every photo's tick: the bar carries the count. */}
            <div role="status">
              {prep ? (
                <>
                  <p className="text-sm font-medium text-ink">Getting photos ready<span aria-hidden className="tabular-nums">: {prep.done} of {prep.total}</span></p>
                  <p className="mt-1 text-sm text-ink-muted">Nothing is sent until they all are. Keep this open, with the screen on.</p>
                </>
              ) : (
                <>
                  <p className="text-sm font-medium text-ink">Reading {plural(ready.length, 'photo')}</p>
                  <p className="mt-1 text-sm text-ink-muted">{smaller ? 'This can take a few minutes.' : 'This can take a minute or two.'} Keep this open, with the screen on.</p>
                </>
              )}
            </div>
            {prep ? (
              <div role="progressbar" aria-label="Photos ready" aria-valuemin={0} aria-valuemax={prep.total} aria-valuenow={prep.done}
                className="h-1.5 w-full max-w-xs overflow-hidden rounded-full bg-border">
                <div className="h-full rounded-full bg-accent" style={{ width: `${(100 * prep.done) / Math.max(1, prep.total)}%` }} />
              </div>
            ) : <p className="text-xs tabular-nums text-ink-subtle">{elapsed} s</p>}
            {lostLine && <WarnNote>{lostLine}</WarnNote>}
            <Button variant="secondary" onClick={backToPhotos}>Cancel</Button>
          </div>
        )}

        {step === 'failed' && (
          <>
            <div role="alert"><ErrorNote>{error}</ErrorNote></div>
            {lostLine && <WarnNote>{lostLine}</WarnNote>}
            <div className="flex flex-wrap justify-end gap-2">
              <Button variant="secondary" onClick={backToPhotos}><ArrowLeft className="size-4" /> Back to photos</Button>
              {final
                ? <Button variant="secondary" onClick={close}>Close</Button>
                : <Button onClick={() => void analyze()} disabled={!canAnalyze}>Try again</Button>}
            </div>
          </>
        )}

        {step === 'result' && plan && (plan.mode === 'taken' || plan.mode === 'none') && (
          reloading ? (
            <div role="status" className="flex items-center justify-center gap-2 py-8 text-sm text-ink-muted">
              <Loader2 className="size-4 animate-spin" aria-hidden /> Loading this tunnel&apos;s drawing
            </div>
          ) : (
            <>
              <WarnNote>
                {plan.mode === 'taken'
                  ? "Someone else saved a drawing for this tunnel after you started, so this one can't be saved. Analyze the same photos again to correct their drawing instead."
                  : "This tunnel's drawing was deleted after you started, so there is nothing to correct. Analyze the same photos again to build a new one."}
              </WarnNote>
              <Footer measure={measure}>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <Button variant="secondary" className="mr-auto" onClick={backToPhotos}><ArrowLeft className="size-4" /> Back to photos</Button>
                  <Button onClick={() => void analyze()} disabled={!canAnalyze}>
                    <Sparkles className="size-4" /> Analyze again
                  </Button>
                </div>
              </Footer>
            </>
          )
        )}

        {step === 'result' && plan && (plan.mode === 'create' || plan.mode === 'update') && (
          <>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-medium text-ink">
                {plan.mode === 'create'
                  ? `Found ${plural(plan.machines, 'machine')}, ${plan.linked} linked to this site's machines.`
                  : updateLine(plan.counts, plan.changed)}
              </p>
              {plan.mode === 'update' && plan.changed && plan.counts.unsaved > 0 && (
                <p className="text-xs text-ink-muted">
                  {plan.counts.unsaved === 1 ? 'Your unsaved move is' : `Your ${plan.counts.unsaved} unsaved moves are`} saved with this too.
                </p>
              )}
            </div>
            {lostLine && <WarnNote>{lostLine}</WarnNote>}
            {/* A picture of the result, not a second drawing to work in: every shape in it
                would be a stop for the keyboard on the way to the buttons. The rows below
                point shapes out on it. */}
            <div role="img" aria-label={plan.mode === 'create' ? 'The drawing the photos make' : 'The drawing with these changes'}
              className="min-w-0 rounded-md border border-border bg-card p-1.5 sm:p-2">
              <div inert>
                <TunnelDiagram layout={plan.draft} items={plan.draft.items} assets={allAssets} orientation="h" colorBy="status"
                  selectedId={picked} onSelect={nothing} />
              </div>
            </div>

            {plan.mode === 'update' && plan.changes.some((c) => c.what !== 'removed') && (
              <section aria-labelledby={`${ids}-changes`} className="flex flex-col gap-1.5">
                <h3 id={`${ids}-changes`} className="text-xs font-semibold text-ink">What changes</h3>
                <ul className="flex max-h-52 flex-col gap-0.5 overflow-y-auto rounded-md border border-border p-1">
                  {plan.changes.filter((c) => c.what !== 'removed').map((c, k) => (
                    <li key={`${c.what}-${c.id ?? c.name}-${k}`}>
                      <ChangeRow change={c} machine={machine} picked={!!c.id && c.id === picked} onPick={() => setPicked(c.id && c.id !== picked ? c.id : null)} />
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {plan.mode === 'update' && plan.removals.length > 0 && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1.5 text-xs font-semibold text-ink">Not in the photos: take {plan.removals.length === 1 ? 'it' : 'them'} off the drawing?</legend>
                {plan.removals.map((r) => (
                  <label key={r.ref} className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1 text-sm hover:bg-content">
                    <input type="checkbox" checked={r.removed} className="mt-0.5 size-4 shrink-0 rounded border-border text-accent focus:ring-accent"
                      onChange={(e) => setKept((s) => { const n = new Set(s); if (e.target.checked) n.delete(r.ref); else n.add(r.ref); return n })} />
                    <span className="min-w-0">
                      <span className="text-ink">Remove {r.name}</span>
                      {r.reason && <span className="block text-xs text-ink-muted">{r.reason}</span>}
                    </span>
                  </label>
                ))}
              </fieldset>
            )}

            {plan.mode === 'update' && plan.deleted.length > 0 && (
              <p className="text-xs text-ink-muted">
                {list(plan.deleted)} {plan.deleted.length === 1 ? 'was' : 'were'} taken off the drawing after the photos were read, so {plan.deleted.length === 1 ? 'it stays' : 'they stay'} off.
              </p>
            )}
            {plan.unsure.length > 0 && <WarnNote>Not sure about {list(plan.unsure)}. Check {plan.unsure.length === 1 ? 'it' : 'them'} against the tunnel.</WarnNote>}
            {plan.mode === 'create' && plan.unseen > 0 && (
              <p className="text-xs text-ink-muted">{plural(plan.unseen, "shape wasn't", "shapes weren't")} in the photos, so {plan.unseen === 1 ? "it's" : "they're"} placed where a typical tunnel has {plan.unseen === 1 ? 'it' : 'them'}.</p>
            )}
            {notes.length > 0 && (
              <section aria-labelledby={`${ids}-notes`} className="flex flex-col gap-1">
                <h3 id={`${ids}-notes`} className="text-xs font-semibold text-ink">From the photos</h3>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-muted">
                  {notes.map((n, k) => <li key={k}>{n}</li>)}
                </ul>
              </section>
            )}

            <Footer measure={measure}>
              {saveError && (
                <div ref={failNote} tabIndex={-1} role="alert" className="flex flex-wrap items-center gap-2 focus:outline-none">
                  <ErrorNote>{saveError}</ErrorNote>
                  {conflict && (
                    <Button size="sm" variant="secondary" onClick={() => {
                      setSaveError(null)
                      setConflict(false)
                      // The button goes with the message: the result's top takes focus.
                      top.current?.focus()
                      void reload()
                    }}>Reload</Button>
                  )}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="secondary" className="mr-auto" onClick={backToPhotos} disabled={saving}><ArrowLeft className="size-4" /> Back to photos</Button>
                {plan.mode === 'update' && canReview && (
                  <Button variant="secondary" disabled={saving || reloading || !plan.changed} onClick={() => onReview(plan.draft)}>Review in the editor</Button>
                )}
                <Button onClick={() => void save()} disabled={saving || reloading || (plan.mode === 'update' && !plan.changed)}>
                  {(saving || reloading) && <Loader2 className="size-4 animate-spin" />} {plan.mode === 'create' ? 'Save drawing' : 'Save changes'}
                </Button>
              </div>
            </Footer>
          </>
        )}
      </div>
    </Modal>
  )
}

// One picked photo: its small copy (or why it can't be used), its number, Remove, and where
// it was taken from. Drawn again only when its own photo or number changes. Its picture loads
// as it scrolls into sight. A photo that opened when it was picked and failed later keeps its
// picture, faded, so it can be found again, with the reason on a solid band below the
// buttons.
const PhotoTile = memo(function PhotoTile({ pic: p, n, onRemove, onView }: { pic: Pic; n: number; onRemove: (key: string) => void; onView: (key: string, view: PhotoView | '') => void }) {
  const failed = p.status === 'failed'
  return (
    <li className="flex min-w-0 flex-col gap-1.5">
      <div className={cn('relative aspect-[4/3] overflow-hidden rounded-md border', failed ? 'border-danger/40 bg-danger-soft' : 'border-border bg-content')}>
        {p.thumb && <img src={p.thumb} alt={`Photo ${n}`} loading="lazy" decoding="async" className={cn('size-full object-cover', failed && 'opacity-30')} />}
        {p.status === 'reading' && <div className="absolute inset-0 grid place-items-center text-ink-muted"><Loader2 className="size-5 animate-spin" aria-label="Getting it ready" /></div>}
        {failed && (
          <p className={cn('absolute overflow-y-auto px-2 text-xs text-danger', p.thumb ? 'inset-x-0 bottom-0 max-h-[calc(100%-2.25rem)] bg-danger-soft py-1.5' : 'inset-0 pb-2 pt-9')}>{p.error}</p>
        )}
        <span className="absolute left-1.5 top-1.5 rounded bg-shell/70 px-1.5 text-[11px] font-semibold tabular-nums text-white" aria-hidden>{n}</span>
        <button type="button" onClick={() => onRemove(p.key)} aria-label={`Remove photo ${n}`}
          className="absolute right-1 top-1 grid size-7 place-items-center rounded-full bg-shell/70 text-white hover:bg-shell focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent">
          <X className="size-4" />
        </button>
      </div>
      {!failed && (
        <Select value={p.view} onChange={(e) => onView(p.key, e.target.value as PhotoView | '')} aria-label={`Photo ${n} taken from`}
          className="h-8 pl-2 pr-7 text-xs">
          <option value="">Taken from?</option>
          {VIEWS.map((v) => <option key={v.value} value={v.value}>{v.label}</option>)}
        </Select>
      )}
    </li>
  )
})

// The step's buttons (and why a save failed), kept in sight at the bottom of the dialog
// however far its body scrolls. The negative margins reach over the dialog's padding.
function Footer({ children, measure }: { children: ReactNode; measure: RefCallback<HTMLDivElement> }) {
  return <div ref={measure} className="sticky -bottom-4 z-10 -mx-5 -mb-4 flex flex-col gap-2 border-t border-border bg-card px-5 py-3">{children}</div>
}

function updateLine(c: UpdateCounts, changed: boolean): string {
  if (!changed) return 'The photos match the drawing. Nothing to change.'
  const parts = [
    c.moved && `${c.moved} moved`,
    c.resized && `${c.resized} resized`,
    c.added && `${c.added} added`,
    c.linked && `${c.linked} linked`,
    c.removed && `${c.removed} removed`,
  ].filter(Boolean) as string[]
  const what = parts.length ? `${parts.join(', ')}, ` : ''
  return `${what}${c.untouched} left as ${c.untouched === 1 ? 'it is' : 'they are'}.`.replace(/^./, (s) => s.toUpperCase())
}

// One change, as a button that points the shape out on the drawing above.
function ChangeRow({ change: c, machine, picked, onPick }: { change: Change; machine: (id: string | undefined) => string; picked: boolean; onPick: () => void }) {
  const Icon = ICON[c.what]
  const text = c.what === 'added' ? `Added ${c.name}${c.asset_id ? `, linked to ${machine(c.asset_id)}` : ''}`
    : c.what === 'moved' ? `Moved ${c.name} ${c.detail ?? ''}`
      : c.what === 'resized' ? `Resized ${c.name}, ${c.detail ?? ''}`
        : c.what === 'linked' ? `Linked ${c.name} to ${machine(c.asset_id)}`
          : `${c.name}: ${c.detail ?? ''}`
  const body = (
    <>
      <Icon className={cn('mt-0.5 size-3.5 shrink-0', picked ? 'text-accent' : 'text-ink-subtle')} aria-hidden />
      <span className="min-w-0">{text}</span>
    </>
  )
  if (!c.id) return <div className="flex items-start gap-2 px-2 py-1 text-xs text-ink">{body}</div>
  return (
    <button type="button" onClick={onPick} aria-pressed={picked}
      className={cn('flex w-full items-start gap-2 rounded px-2 py-1 text-left text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent', picked ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-content')}>
      {body}
    </button>
  )
}
