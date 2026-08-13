import { useEffect, useMemo, useRef, useState } from 'react'
import { Cctv, Video, Loader2, WifiOff, Volume2, RefreshCw, Maximize2, Expand, LayoutGrid, Grid3x3 } from 'lucide-react'
import { cameras, type SpotSite, type SpotCamera } from '@/lib/queries/cameras'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'

// Audio can't autoplay unmuted (browser policy), so wall feeds start muted; the
// embed player's own controls (or the expanded view) provide audio where the
// camera has it.
const IFRAME_ALLOW = 'autoplay; fullscreen; microphone; picture-in-picture'

// Make an element (the camera iframe) fill the screen via the Fullscreen API.
function goFullscreen(el: HTMLElement | null) {
  if (!el) return
  const anyEl = el as HTMLElement & { webkitRequestFullscreen?: () => void }
  if (el.requestFullscreen) void el.requestFullscreen().catch(() => {})
  else if (anyEl.webkitRequestFullscreen) anyEl.webkitRequestFullscreen()
}

type View = 'wall' | 'tiles'

export default function CamerasPage() {
  const [sites, setSites] = useState<SpotSite[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeSite, setActiveSite] = useState<string>('')
  const [view, setView] = useState<View>('wall')
  const [open, setOpen] = useState<SpotCamera | null>(null)

  const load = async () => {
    setError(null)
    setSites(null)
    try {
      const s = await cameras.list()
      setSites(s)
      setActiveSite((prev) => (s.some((x) => x.site === prev) ? prev : (s[0]?.site ?? '')))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load cameras.')
      setSites([])
    }
  }

  useEffect(() => { void load() }, [])

  const site = useMemo(() => sites?.find((s) => s.site === activeSite) ?? null, [sites, activeSite])
  const onlineCams = useMemo(() => site?.cameras.filter((c) => c.status === 'online') ?? [], [site])

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight text-ink">
            <Cctv className="size-5 text-accent" /> Cameras
          </h1>
          <p className="mt-1 text-sm text-ink-muted">Live camera feeds from Spot AI, grouped by site.</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Wall / Tiles toggle */}
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            <button
              type="button"
              onClick={() => setView('wall')}
              className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition',
                view === 'wall' ? 'bg-accent text-white' : 'bg-card text-ink-muted hover:bg-content hover:text-ink')}
            >
              <LayoutGrid className="size-4" /> Wall
            </button>
            <button
              type="button"
              onClick={() => setView('tiles')}
              className={cn('inline-flex items-center gap-1.5 px-3 py-2 text-sm font-medium transition',
                view === 'tiles' ? 'bg-accent text-white' : 'bg-card text-ink-muted hover:bg-content hover:text-ink')}
            >
              <Grid3x3 className="size-4" /> Tiles
            </button>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-ink-muted transition hover:bg-content hover:text-ink"
          >
            <RefreshCw className="size-4" /> Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger">{error}</div>
      )}

      {sites === null && (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-10 text-sm text-ink-muted">
          <Loader2 className="size-4 animate-spin" /> Loading cameras…
        </div>
      )}

      {sites !== null && sites.length === 0 && !error && (
        <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-ink-muted">
          No cameras are available for your sites.
        </div>
      )}

      {sites !== null && sites.length > 0 && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <div className="w-full max-w-xs">
              <Select value={activeSite} onChange={(e) => setActiveSite(e.target.value)}>
                {sites.map((s) => (
                  <option key={s.site} value={s.site}>{s.site} ({s.cameras.length})</option>
                ))}
              </Select>
            </div>
            {site && (
              <span className="text-sm text-ink-muted">{onlineCams.length} of {site.cameras.length} online</span>
            )}
          </div>

          {view === 'wall'
            ? <WallView key={activeSite} cameras={onlineCams} onExpand={setOpen} />
            : <TilesView cameras={site?.cameras ?? []} onOpen={setOpen} />}
        </>
      )}

      {open && <LiveModal camera={open} onClose={() => setOpen(null)} />}
    </div>
  )
}

// All of a site's live feeds at once.
function WallView({ cameras: cams, onExpand }: { cameras: SpotCamera[]; onExpand: (c: SpotCamera) => void }) {
  const [urls, setUrls] = useState<Map<number, string> | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setUrls(null)
    setErr(null)
    if (cams.length === 0) { setUrls(new Map()); return }
    cameras.embedMany(cams.map((c) => c.id))
      .then((list) => { if (active) setUrls(new Map(list.map((x) => [x.id, x.url]))) })
      .catch((e) => { if (active) setErr(e instanceof Error ? e.message : 'Could not open the wall.') })
    return () => { active = false }
  }, [cams])

  if (cams.length === 0) {
    return <div className="rounded-lg border border-border bg-card px-4 py-10 text-center text-sm text-ink-muted">No cameras are online at this site right now.</div>
  }
  if (err) return <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</div>
  if (!urls) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-border bg-card px-4 py-10 text-sm text-ink-muted">
        <Loader2 className="size-4 animate-spin" /> Starting {cams.length} live feeds…
      </div>
    )
  }

  return (
    <>
      <p className="text-xs text-ink-subtle">
        Feeds start muted. <span className="font-medium">Hover a feed</span> to show its controls; a volume button appears on cameras that have a microphone. Click <Maximize2 className="inline size-3" /> to expand.
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {cams.map((c) => <WallTile key={c.id} camera={c} url={urls.get(c.id)} onExpand={() => onExpand(c)} />)}
      </div>
    </>
  )
}

function WallTile({ camera: c, url, onExpand }: { camera: SpotCamera; url: string | undefined; onExpand: () => void }) {
  const ref = useRef<HTMLIFrameElement>(null)
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between gap-2 border-b border-border px-2.5 py-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="size-1.5 shrink-0 rounded-full bg-ok" />
          <span className="truncate text-xs font-medium text-ink" title={c.name}>{c.name}</span>
          {c.has_speakers && <Volume2 className="size-3 shrink-0 text-ink-subtle" />}
        </span>
        <span className="flex shrink-0 items-center gap-0.5">
          <button type="button" onClick={() => goFullscreen(ref.current)} className="rounded p-1 text-ink-muted hover:bg-content hover:text-ink" title="Full screen">
            <Expand className="size-3.5" />
          </button>
          <button type="button" onClick={onExpand} className="rounded p-1 text-ink-muted hover:bg-content hover:text-ink" title="Expand">
            <Maximize2 className="size-3.5" />
          </button>
        </span>
      </div>
      {url ? (
        <iframe ref={ref} src={url} title={c.name} className="aspect-video w-full bg-black" allow={IFRAME_ALLOW} allowFullScreen />
      ) : (
        <div className="flex aspect-video items-center justify-center bg-shell/80 text-xs text-white/60">Feed unavailable</div>
      )}
    </div>
  )
}

// Compact cards; click one to open the live view.
function TilesView({ cameras: cams, onOpen }: { cameras: SpotCamera[]; onOpen: (c: SpotCamera) => void }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
      {cams.map((c) => {
        const online = c.status === 'online'
        return (
          <button
            key={c.id}
            type="button"
            disabled={!online}
            onClick={() => onOpen(c)}
            className={cn('group flex flex-col gap-2 rounded-lg border border-border bg-card p-3 text-left transition',
              online ? 'cursor-pointer hover:border-accent hover:bg-content' : 'cursor-not-allowed opacity-60')}
          >
            <div className={cn('grid aspect-video place-items-center rounded-md',
              online ? 'bg-shell/80 text-white/70 group-hover:text-white' : 'bg-content text-ink-subtle')}>
              {online ? <Video className="size-6" /> : <WifiOff className="size-6" />}
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink" title={c.name}>{c.name}</span>
              {c.has_speakers && <Volume2 className="size-3.5 shrink-0 text-ink-subtle" />}
            </div>
            <span className={cn('inline-flex w-fit items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold',
              online ? 'bg-ok-soft text-ok' : 'bg-ink/10 text-ink-muted')}>
              <span className={cn('size-1.5 rounded-full', online ? 'bg-ok' : 'bg-ink-subtle')} />
              {online ? 'Live' : 'Offline'}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function LiveModal({ camera, onClose }: { camera: SpotCamera; onClose: () => void }) {
  const [url, setUrl] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    let active = true
    cameras.embed(camera.id)
      .then((u) => { if (active) setUrl(u) })
      .catch((e) => { if (active) setErr(e instanceof Error ? e.message : 'Could not open this feed.') })
    return () => { active = false }
  }, [camera.id])

  return (
    <Modal open onClose={onClose} title={camera.name} size="lg" className="max-w-4xl">
      {err ? (
        <div className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2.5 text-sm text-danger">{err}</div>
      ) : !url ? (
        <div className="flex aspect-video items-center justify-center gap-2 rounded-md bg-shell/80 text-sm text-white/70">
          <Loader2 className="size-4 animate-spin" /> Connecting to live feed…
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <div className="relative">
            <iframe ref={iframeRef} src={url} title={camera.name} className="aspect-video w-full rounded-md border border-border bg-black" allow={IFRAME_ALLOW} allowFullScreen />
            <button
              type="button"
              onClick={() => goFullscreen(iframeRef.current)}
              className="absolute right-2 top-2 inline-flex items-center gap-1.5 rounded-md bg-black/50 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-black/70"
              title="Full screen"
            >
              <Expand className="size-3.5" /> Full screen
            </button>
          </div>
          <p className="text-xs text-ink-subtle">Hover the video for player controls. A volume button appears only on cameras that have a microphone.</p>
        </div>
      )}
    </Modal>
  )
}
