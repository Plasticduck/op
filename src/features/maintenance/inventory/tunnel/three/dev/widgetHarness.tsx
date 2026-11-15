import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ScanLine, X } from 'lucide-react'
import '@/index.css'
import { Button } from '@/components/ui/Button'
import type { TunnelItem } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { Tunnel3DHost } from '../../Tunnel3DHost'
import type { ColorBy } from '../../TunnelDiagram'
import type { Tunnel3DFail } from '../../view3d'
import { sampleTunnel } from './fixtures'

// The 3D tunnel as the Tunnel page mounts it: http://localhost:5199/dev/tunnel3d-widget.html
// Tunnel3DHost and everything it draws over the canvas, on a plain page that plays the
// Tunnel page's part (it holds the selection, the unsaved moves, move mode and color-by),
// with the sample tunnel from fixtures.ts. No sign-in. Screenshot it with
//   node scripts/tunnel3d-shot.mjs --url "http://localhost:5199/dev/tunnel3d-widget.html?<query>" --out shot.png
//
// Query parameters:
//   theme=light|dark      sets the .dark class on <html> (default: the system's)
//   mode=preview          the showroom
//   colorBy=status|usage|wos|sticker
//   select=<label>        start with that shape selected, e.g. select=Wrap%20DS1
//   move=1                start in move mode
//   canMove=0             the person can't arrange or link
//   details=0             no onDetails (the card has no Details / Link button)
//   linked=0              no machines linked
//   play=0|1              write the remembered play / pause choice before mounting
//   footer=1              always show the unsaved bar
//   panel=1               show the page's 400 px side panel beside the canvas while a
//                         shape is selected, as the Tunnel page does on a desktop
//   fill=0                no tall content above and below (it is there so the wheel
//                         passing through to the page can be seen)
//   shell=1               inside a copy of the app's frame (components/layout/AppShell):
//                         a sidebar, a sticky top bar, <main> as the box that scrolls, and
//                         on phones the bottom bar and the Scan button, with their z-index
//   strict=0              no React StrictMode (on by default: mounts twice, as in dev)
//   mem=<key>             the camera memory key (default: dev)
//
// window.__t3dw = { ready, events, state(), set(patch), mount(on), rafs() }
//   ready     true once the first frame is on screen (window.__t3d.ready too, which is
//             what scripts/tunnel3d-shot.mjs waits for)
//   events    what the widget asked of the page: { type, detail }
//   state()   the page-side state and a few counts from the DOM
//   set()     change page-side state: { select: label | null, move, colorBy, mode, canMove }
//   mount()   mount(false) takes the widget off the page, mount(true) puts it back
//   rafs()    animation frames asked for so far by anything on the page: it must stand
//             still while nothing moves

type Patch = { select?: string | null; move?: boolean; colorBy?: ColorBy; mode?: 'site' | 'preview'; canMove?: boolean }
type Probe = {
  ready: boolean
  events: Array<{ type: string; detail: unknown }>
  state: () => Record<string, unknown>
  set: (p: Patch) => void
  mount: (on: boolean) => void
  rafs: () => number
}

const q = new URLSearchParams(location.search)
const themeParam = q.get('theme')
const dark = themeParam === 'dark' || (themeParam !== 'light' && matchMedia('(prefers-color-scheme: dark)').matches)
document.documentElement.classList.toggle('dark', dark)
if (q.get('play') === '0' || q.get('play') === '1') {
  try { localStorage.setItem('mi.tunnel.play', q.get('play')!) } catch { /* private mode */ }
}

let rafCount = 0
const nativeRaf = window.requestAnimationFrame.bind(window)
window.requestAnimationFrame = (cb) => {
  rafCount++
  return nativeRaf(cb)
}

const probe: Probe = { ready: false, events: [], state: () => ({}), set: () => {}, mount: () => {}, rafs: () => rafCount }
const globals = window as unknown as { __t3dw: Probe; __t3d: { ready: boolean } }
globals.__t3dw = probe
globals.__t3d = { ready: false }
const log = (type: string, detail: unknown) => {
  probe.events.push({ type, detail })
  if (probe.events.length > 300) probe.events.shift()
}

// The widget marks its box data-ready once the scene has drawn its first frame.
const readyWatch = new MutationObserver(() => {
  const on = !!document.querySelector('[data-ready="true"]')
  probe.ready = on
  globals.__t3d.ready = on
})
readyWatch.observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-ready'], childList: true })

const FILL = [
  'This page stands in for the Tunnel page. The blocks of text are here so the page is taller than the window: a plain mouse wheel over the canvas should scroll the page until the canvas has been clicked.',
  'After a click inside the canvas the wheel zooms while the pointer stays over it. Ctrl or Cmd and the wheel, or a pinch, always zoom. When the view fills the screen the wheel always zooms.',
  'Keys work while the pointer is over the canvas or focus is inside it: 1, 2, 3 for the camera presets, R for the ride, Space to play or pause, M for move mode, Escape to back out.',
]

// Exported only so the file counts as a component module for fast refresh.
export function Harness() {
  const fixture = useMemo(() => sampleTunnel({ linked: q.get('linked') !== '0' }), [])
  const byLabel = (label: string | null) => fixture.items.find((i) => i.label.toLowerCase() === (label ?? '').toLowerCase())?.id ?? null

  const [items, setItems] = useState<TunnelItem[]>(fixture.items)
  const [undo, setUndo] = useState<TunnelItem[][]>([])
  const [selectedId, setSelectedId] = useState<string | null>(() => byLabel(q.get('select')))
  const [moveMode, setMoveMode] = useState(q.get('move') === '1')
  const [colorBy, setColorBy] = useState<ColorBy>((q.get('colorBy') as ColorBy | null) ?? 'status')
  const [mode, setMode] = useState<'site' | 'preview'>(q.get('mode') === 'preview' ? 'preview' : 'site')
  const [canMove, setCanMove] = useState(q.get('canMove') !== '0')
  const [mounted, setMounted] = useState(true)
  const [failed, setFailed] = useState<Tunnel3DFail | null>(null)
  const [detailsFor, setDetailsFor] = useState<string | null>(null)
  const [typed, setTyped] = useState('')

  // Where each moved shape is saved: what the scene leaves an outline at.
  const saved = useMemo(() => {
    const out: Record<string, { x_ft: number; y_ft: number }> = {}
    for (const i of items) {
      const was = fixture.items.find((b) => b.id === i.id)
      if (was && (was.x_ft !== i.x_ft || was.y_ft !== i.y_ft)) out[i.id] = { x_ft: was.x_ft, y_ft: was.y_ft }
    }
    return out
  }, [items, fixture])
  const moved = Object.keys(saved).length

  const onMove = (id: string, x_ft: number, y_ft: number) => {
    log('move', { id, x_ft, y_ft })
    setUndo((u) => [...u, items])
    setItems((list) => list.map((i) => (i.id === id ? { ...i, x_ft, y_ft } : i)))
  }

  useEffect(() => {
    probe.state = () => ({
      selectedId,
      selected: fixture.items.find((i) => i.id === selectedId)?.label ?? null,
      moveMode, colorBy, mode, canMove, mounted, failed, moved, detailsFor,
      items: items.map((i) => ({ id: i.id, label: i.label, x_ft: i.x_ft, y_ft: i.y_ft })),
      canvases: document.querySelectorAll('canvas').length,
      bodyOverflow: document.body.style.overflow,
      mainOverflow: document.querySelector('main')?.style.overflow ?? null,
      mainScroll: document.querySelector('main')?.scrollTop ?? null,
      inert: document.querySelectorAll('[inert]').length,
    })
    probe.set = (p) => {
      if ('select' in p) setSelectedId(byLabel(p.select ?? null))
      if (p.move != null) setMoveMode(p.move)
      if (p.colorBy) setColorBy(p.colorBy)
      if (p.mode) setMode(p.mode)
      if (p.canMove != null) setCanMove(p.canMove)
    }
    probe.mount = (on) => setMounted(on)
  })

  const footer = moved > 0 || q.get('footer') === '1' ? (
    <div className="flex max-w-full items-center gap-1 rounded-lg border border-border bg-card py-1.5 pl-3 pr-1.5 text-sm shadow-lg">
      <span className="mr-1 truncate font-medium text-ink">{moved} machine{moved === 1 ? '' : 's'} moved</span>
      <Button size="sm" variant="ghost" className="px-2" disabled={!undo.length} onClick={() => { setItems(undo[undo.length - 1]); setUndo((u) => u.slice(0, -1)) }}>Undo</Button>
      <Button size="sm" variant="ghost" className="px-2" onClick={() => { setItems(fixture.items); setUndo([]) }}>Reset</Button>
      <Button size="sm" onClick={() => log('save', moved)}>Save</Button>
    </div>
  ) : undefined

  const panelItem = q.get('panel') === '1' ? items.find((i) => i.id === (detailsFor ?? selectedId)) ?? null : null
  const fill = q.get('fill') !== '0'
  const shell = q.get('shell') === '1'

  const page = (
    <div className={cn('mx-auto flex max-w-7xl flex-col gap-3 px-4 lg:px-8', shell ? 'pb-28 pt-6 sm:px-6 lg:pb-8' : 'py-4')}>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="mr-auto text-lg font-semibold">Tunnel</h1>
        <select value={colorBy} onChange={(e) => setColorBy(e.target.value as ColorBy)} aria-label="Color by" className="h-9 rounded-md border border-border bg-card px-2 text-sm">
          <option value="status">Color by status</option>
          <option value="usage">Color by use count</option>
          <option value="wos">Color by open work orders</option>
          <option value="sticker">Color by sticker</option>
        </select>
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type here: keys stay yours" aria-label="Typing test" className="h-9 w-52 rounded-md border border-border bg-card px-2 text-sm" />
        <Button size="sm" variant="secondary" onClick={() => document.documentElement.classList.toggle('dark')}>Theme</Button>
      </div>
      {fill && <p className="max-w-3xl text-sm text-ink-muted">{FILL[0]}</p>}
      {failed && <p className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">The 3D view reported: {failed}. The page would show the diagram here.</p>}

      <div className={cn('grid grid-cols-1 gap-4', panelItem && 'lg:grid-cols-[minmax(0,1fr)_400px]')}>
        <div className="min-w-0">
          {mounted && !failed && (
            <Tunnel3DHost
              layout={fixture.layout} items={items} assets={fixture.assets} saved={saved}
              mode={mode} memoryKey={q.get('mem') ?? (mode === 'preview' ? 'preview' : 'dev')} colorBy={colorBy}
              selectedId={selectedId}
              onSelect={(id) => { log('select', id); setSelectedId(id); if (!id) setDetailsFor(null) }}
              onOpen={(item) => log('open', { id: item.id, label: item.label, asset_id: item.asset_id })}
              onDetails={q.get('details') === '0' ? undefined : (id) => { log('details', id); setDetailsFor(id) }}
              canMove={canMove && mode === 'site'} moveMode={moveMode}
              onMoveMode={(on) => { log('moveMode', on); setMoveMode(on) }}
              onMove={onMove} footer={footer}
              onFail={(reason) => { log('fail', reason); setFailed(reason) }} />
          )}
        </div>
        {panelItem && (
          <aside className="rounded-md border border-border bg-card p-3 text-sm">
            <div className="flex items-start justify-between">
              <h2 className="text-[17px] font-semibold">{panelItem.label}</h2>
              <button type="button" aria-label="Close panel" onClick={() => { setSelectedId(null); setDetailsFor(null) }} className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content"><X className="size-5" /></button>
            </div>
            <p className="mt-2 text-ink-muted">The page's side panel for this shape would be here.</p>
          </aside>
        )}
      </div>

      {fill && FILL.slice(1).map((t) => <p key={t} className="max-w-3xl text-sm text-ink-muted">{t}</p>)}
      {fill && <div className="h-[70vh] rounded-md border border-dashed border-border" />}
    </div>
  )

  // The Maintenance Inventory page's floating Scan button on phones, where the page puts
  // it (above the app's bottom bar): the widget has to leave this corner alone.
  const scan = (
    <button type="button" aria-label="Scan" className="fixed bottom-[calc(5rem+env(safe-area-inset-bottom))] right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg lg:hidden">
      <ScanLine className="size-6" />
    </button>
  )

  if (!shell) {
    return (
      <div className="min-h-dvh bg-content text-ink">
        {page}
        {scan}
      </div>
    )
  }
  // As AppShell lays the app out: the page scrolls inside <main>, not the window.
  return (
    <div className="flex h-dvh w-full bg-content text-ink">
      <aside className="relative hidden h-dvh w-64 shrink-0 flex-col bg-shell p-5 text-sm text-ink-invert lg:flex">
        <span className="font-semibold">Operator</span>
        {['Dashboard', 'Work orders', 'Maintenance Inventory', 'Schedule'].map((l) => <a key={l} href="#nav" className="mt-3 text-ink-invert/80">{l}</a>)}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4">
          <span className="text-sm font-semibold">Top bar</span>
          <button type="button" className="ml-auto rounded-md border border-border px-2 py-1 text-sm">Search</button>
        </header>
        <main className="min-h-0 flex-1 overflow-y-auto">{page}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-16 items-center justify-around border-t border-border bg-card pb-[env(safe-area-inset-bottom)] text-xs text-ink-muted lg:hidden">
        {['Home', 'Work', 'Inventory', 'More'].map((l) => <a key={l} href="#nav">{l}</a>)}
      </nav>
      {scan}
    </div>
  )
}

const tree = q.get('strict') === '0' ? <Harness /> : <StrictMode><Harness /></StrictMode>
createRoot(document.getElementById('root')!).render(tree)
