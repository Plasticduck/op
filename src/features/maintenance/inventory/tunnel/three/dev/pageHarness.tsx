/* eslint-disable react-refresh/only-export-components -- an entry point: nothing imports it, and a change to it reloads the page */
import { StrictMode, useCallback, useMemo, useRef, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { createBrowserRouter, Outlet, RouterProvider, useLocation, useNavigate, useParams } from 'react-router-dom'
import '@/index.css'
import { PageHeader } from '@/components/layout/PageHeader'
import { cn } from '@/lib/utils'
import { MiContext, type MiCtx } from '../../../context'
import { EquipmentDetailPage } from '../../../equipment/EquipmentDetail'
import { SectionNav } from '../../../SectionNav'
import { TemplatesCard } from '../../TemplatesCard'
import TunnelPage from '../../TunnelPage'
import type { Tunnel3DProps } from '../../view3d'
import { installFakeBackend, type FakeBackend } from './fakeBackend'

// The real Tunnel page without signing in: http://localhost:5199/dev/tunnel3d-page.html
// (npx vite --port 5199 --strictPort). The page, its side panel and a machine's page are
// the app's own; dev/fakeBackend.ts stands in for the server with sample data in memory,
// so everything can be clicked through and saved. Screenshot or script it with
//   node scripts/tunnel3d-shot.mjs --noready --url "http://localhost:5199/dev/tunnel3d-page.html?<query>" --out shot.png [--script steps.mjs]
//
// Query parameters (the page's own work too: site, tunnel, item, view, asset, edit):
//   empty=1        the first site has no drawing yet (the 3D showroom over the empty state)
//   templates=0    the account has no template either (the showroom is the standard tunnel)
//   canEdit=0      a site tech: no moving, no editing, no linking. rank=2: a site manager
//   user=<id>      who is signed in (default dev-user): unsaved moves are kept per person,
//                  so another id on the same tab stands for the next person to sign in
//   conflict=1     someone else changes the drawing just before the next save, once
//   unplaced=<n>   each site also has n machines that are on no drawing
//   theme=dark
//   lag=<ms>       how long the pretend server takes to answer (default 80)
//   photos=fail|no_key|refused   the photo reader (From photos, Build from photos) answers
//                  with that error instead of a drawing. Otherwise it answers after 1.5 s
//                  (plus lag) with a made-up drawing: see fakeBackend.ts
//
// window.__page = { ready, backend, host(), notes, path(), go(to, state?) }: ready turns
// true once the first drawing has been answered and drawn; backend is the pretend server
// (its calls, drawing(), someoneElse(), failNextSave(), failNextLoad()); host() returns
// the props the page is giving the 3D view right now, so a script can call onMove,
// onSelect, onOpen, onDetails or onFail as the view would; notes lists what the page
// said through notify(); go() navigates inside the app, with router state if given (a
// machine's page opened from the equipment list, say). The tunnel lives at this page's
// own address and at /app/maintenance-inventory/tunnel; a machine's page at
// .../equipment/<id>; Settings' tunnel templates card at .../settings. Vite answers a
// reload at one of those app addresses with the real app, so reload from this page's own.

// Every import above has run by now, the supabase client's among them: the page's HTML
// can stop hiding its warning about the missing .env.local.
;(window as unknown as { __restoreConsole?: () => void }).__restoreConsole?.()

const q = new URLSearchParams(location.search)
const rank = q.get('canEdit') === '0' ? 1 : Number(q.get('rank')) || 4
const userId = q.get('user') || 'dev-user'
const backend = installFakeBackend({
  empty: q.get('empty') === '1',
  templates: q.get('templates') !== '0',
  conflict: q.get('conflict') === '1',
  rank,
  lag: q.get('lag') == null ? 80 : Number(q.get('lag')) || 0,
  unplaced: Number(q.get('unplaced')) || 0,
  photos: (['fail', 'no_key', 'refused'] as const).find((v) => v === q.get('photos')) ?? null,
})
document.documentElement.classList.toggle('dark', q.get('theme') === 'dark')

type Note = { text: string; tone: 'ok' | 'warn' | 'danger' }
type Probe = { ready: boolean; backend: FakeBackend; host: () => Tunnel3DProps | null; notes: Note[]; path: () => string; go: (to: string, state?: unknown) => void }

// React keeps the tree on the root element; this walks it for the 3D view's props, so a
// check can speak for the view (report a move, a failure) whichever host is mounted.
type Fiber = { child: Fiber | null; sibling: Fiber | null; memoizedProps: unknown; stateNode: { current?: Fiber } | null }
function hostProps(): Tunnel3DProps | null {
  const el = document.getElementById('root') as (HTMLElement & Record<string, unknown>) | null
  const key = el ? Object.keys(el).find((k) => k.startsWith('__reactContainer$')) : undefined
  const top = (key && el ? (el[key] as Fiber) : null)?.stateNode?.current ?? null
  const stack: Fiber[] = top ? [top] : []
  while (stack.length) {
    const f = stack.pop()!
    const p = f.memoizedProps as Partial<Tunnel3DProps> | null
    if (p && typeof p === 'object' && typeof p.onMove === 'function' && typeof p.memoryKey === 'string') return p as Tunnel3DProps
    if (f.sibling) stack.push(f.sibling)
    if (f.child) stack.push(f.child)
  }
  return null
}

const probe: Probe = { ready: false, backend, host: hostProps, notes: [], path: () => location.pathname + location.search, go: () => {} }
;(window as unknown as { __page: Probe }).__page = probe
backend.onAnswer((name) => {
  if (name === 'mi_tunnel_get') requestAnimationFrame(() => requestAnimationFrame(() => { probe.ready = true }))
})

const BASE = '/app/maintenance-inventory'
// As MaintenanceInventoryPage lays a section out.
const PAGE = 'mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8'

function Frame() {
  const [note, setNote] = useState<Note | null>(null)
  const timer = useRef(0)
  const notify = useCallback((text: string, tone: Note['tone'] = 'ok') => {
    probe.notes.push({ text, tone })
    setNote({ text, tone })
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setNote(null), 5000)
  }, [])
  const ctx = useMemo<MiCtx>(() => ({
    me: backend.me() as MiCtx['me'], refs: backend.refs(), accountId: 'dev-account', userId,
    reload: async () => {}, openScan: () => notify('The scanner would open here.'), notify,
  }), [notify])
  return (
    <MiContext.Provider value={ctx}>
      <Outlet />
      {note && (
        <div role="status" className={cn('fixed inset-x-4 bottom-24 z-[80] mx-auto max-w-md rounded-lg px-4 py-3 text-sm text-white shadow-lg',
          note.tone === 'ok' ? 'bg-ok' : note.tone === 'warn' ? 'bg-warn' : 'bg-danger')}>
          {note.text}
        </div>
      )}
    </MiContext.Provider>
  )
}

function TunnelSection() {
  return (
    <div className={PAGE}>
      <PageHeader title="Maintenance Inventory" subtitle="The Tunnel tab with sample data (dev page, nothing here is saved anywhere)." />
      <SectionNav className="mt-4" rank={rank} />
      <div className="mt-5"><TunnelPage /></div>
    </div>
  )
}

// Settings > Tunnel diagrams: the other place sites are set up from a template.
function Settings() {
  return <div className={PAGE}><TemplatesCard /></div>
}

function Machine() {
  const { id } = useParams()
  return id ? <div className="h-dvh"><EquipmentDetailPage key={id} id={id} /></div> : null
}

// Everywhere else in the app: enough to see that the page let go (or didn't).
function Elsewhere() {
  const { pathname, search } = useLocation()
  const navigate = useNavigate()
  return (
    <div className={PAGE}>
      <p className="text-sm text-ink-muted">The app would open <span className="font-mono text-ink">{pathname + search}</span> here.</p>
      <button type="button" className="mt-3 text-sm text-accent hover:underline" onClick={() => navigate(-1)}>Go back</button>
    </div>
  )
}

const router = createBrowserRouter([{
  element: <Frame />,
  children: [
    // The page under its own address (so a reload comes back here) and under the app's
    // (so links from a machine's page land on it).
    { path: location.pathname, element: <TunnelSection /> },
    { path: `${BASE}/tunnel`, element: <TunnelSection /> },
    { path: `${BASE}/equipment/:id`, element: <Machine /> },
    { path: `${BASE}/settings`, element: <Settings /> },
    { path: '*', element: <Elsewhere /> },
  ],
}])
probe.go = (to, state) => { void router.navigate(to, { state }) }

// An edit to a file this page imports can run this module again just before Vite reloads
// the page: draw into the root that is already there rather than make a second one.
const root: Root = import.meta.hot?.data.root ?? createRoot(document.getElementById('root')!)
if (import.meta.hot) import.meta.hot.data.root = root
root.render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
