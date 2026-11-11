import { lazy, Suspense, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ArrowLeft, BarChart3, CheckCircle2, EllipsisVertical, Plus, ScanLine, Settings, Sticker, Upload, X, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { mi, type MiMe, type MiRefs } from '@/lib/queries/maintenanceInventory'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { MiContext, useMi, type MiCtx, type ScanContext } from './context'
import { errText } from './format'
import { refreshSnapshot } from './offline'
import { SectionNav } from './SectionNav'
import { SyncBar } from './SyncBar'
import { ErrorNote, Loading } from './ui'

// Maintenance Inventory (docs/maintenance-inventory), laid out like IT Inventory: the
// title with a line about the current screen, that screen's buttons beside it, then the
// section bar. Tools (Stickers, Import, Reports, Settings) are their own pages with a way
// back. A machine's page is full screen. Scan is a button on the Equipment screen; on
// phones it floats on every screen, as in IT Inventory.

const ScanSheet = lazy(() => import('./ScanSheet').then((m) => ({ default: m.ScanSheet })))
const OverviewPage = lazy(() => import('./OverviewPage'))
const EquipmentList = lazy(() => import('./equipment/EquipmentList').then((m) => ({ default: m.EquipmentList })))
const EquipmentDetailPage = lazy(() => import('./equipment/EquipmentDetail').then((m) => ({ default: m.EquipmentDetailPage })))
const TunnelPage = lazy(() => import('./tunnel/TunnelPage'))
const TemplateEditorPage = lazy(() => import('./tunnel/TemplateEditorPage'))
const StickersPage = lazy(() => import('./stickers/StickersPage'))
const AuditsPage = lazy(() => import('./audits/AuditsPage'))
const ImportPage = lazy(() => import('./import/ImportPage'))
const AuditRunPage = lazy(() => import('./audits/AuditRunPage'))
const PartsTab = lazy(() => import('./PartsTab'))
const PartDetailPage = lazy(() => import('./PartDetailPage'))
const ToolsTab = lazy(() => import('./ToolsTab'))
const WorkOrdersTab = lazy(() => import('./WorkOrdersTab'))
const ReorderTab = lazy(() => import('./ReorderTab'))
const PosTab = lazy(() => import('./PosTab'))
const TransfersTab = lazy(() => import('./TransfersTab'))
const CountsTab = lazy(() => import('./CountsTab'))
const ReportsTab = lazy(() => import('./ReportsTab'))
const SettingsTab = lazy(() => import('./SettingsTab'))

const BASE = '/app/maintenance-inventory'
const PAGE = 'mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8'

type Section = 'overview' | 'equipment' | 'tunnel' | 'audits' | 'parts' | 'tools' | 'stock' | 'work-orders'
type Screen =
  | { kind: 'bare' }
  | { kind: 'tool'; back?: { to: string; label: string }; title?: string; subtitle?: string }
  | { kind: 'section'; section: Section }

const HOME = { to: BASE, label: 'Maintenance Inventory' }

const SUBTITLE: Record<Exclude<Section, 'overview'>, string> = {
  equipment: 'Every machine at your sites, its sticker, its use count and its history.',
  tunnel: "Each site's tunnel from above. Point at a machine to find it, click it to open it.",
  audits: "Walk a site with your phone and scan every machine's sticker, to find what's missing or in the wrong zone.",
  parts: "Every part, where it's stocked, and what's running low.",
  tools: "Who has each tool, where it lives, and when it's due back.",
  stock: 'Moving parts between sites, counting them, and buying more.',
  'work-orders': 'Maintenance work orders at your sites and the parts they use.',
}

function screenFor(pathname: string, rank: number): Screen {
  const [first = '', second] = pathname.slice(BASE.length).split('/').filter(Boolean)
  if (first === 'equipment' && second) return { kind: 'bare' }
  // An audit run and the template editor carry their own title and way out.
  if ((first === 'audits' || first === 'settings') && second) return { kind: 'tool' }
  switch (first) {
    case 'stickers':
      return { kind: 'tool', back: HOME, title: 'Stickers', subtitle: 'Print stickers for machines, keep blank ones ready, and replace worn ones.' }
    case 'import':
      return { kind: 'tool', back: { to: `${BASE}/equipment`, label: 'Equipment' }, title: 'Import equipment', subtitle: 'Add or update machines and components from a spreadsheet.' }
    case 'reports':
      return { kind: 'tool', back: HOME, title: 'Reports', subtitle: 'Stock value, parts used per car washed, fill rate and dead stock.' }
    case 'settings':
      return {
        kind: 'tool', back: HOME, title: 'Maintenance Inventory settings',
        subtitle: rank >= 5 ? 'Text alerts, rules, people and roles, stock locations and tunnel templates.' : 'Stock locations and tunnel templates. An admin sets the rest.',
      }
    case 'equipment': case 'tunnel': case 'audits': case 'parts': case 'tools': case 'work-orders':
      return { kind: 'section', section: first }
    case 'transfers': case 'counts': case 'reorder': case 'pos': case 'stock':
      return { kind: 'section', section: 'stock' }
    default:
      return { kind: 'section', section: 'overview' }
  }
}

let noteTimer = 0

export default function MaintenanceInventoryPage() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [me, setMe] = useState<MiMe | null>(null)
  const [refs, setRefs] = useState<MiRefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scan, setScan] = useState<ScanContext | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' | 'danger' } | null>(null)
  const [params, setParams] = useSearchParams()

  const reload = useCallback(async () => {
    try {
      const m = await mi.me()
      setMe(m)
      if (m.member) setRefs(await mi.refs())
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => { void reload() }, [reload])

  // Keep the phone's offline copy fresh, so scans still work without signal.
  const member = !!me?.member
  useEffect(() => { if (member) void refreshSnapshot() }, [member])

  // A sticker's QR lands here as ?tag=MF-B-00012 and opens straight on it.
  const tagParam = params.get('tag')
  useEffect(() => {
    if (!tagParam) return
    setScan({ code: tagParam })
    setParams((p) => { p.delete('tag'); return p }, { replace: true })
  }, [tagParam, setParams])

  // A checklist's "Parts used": scan parts onto that asset, marked as coming from the checklist.
  const sourceParam = params.get('source')
  const assetParam = params.get('asset')
  useEffect(() => {
    if (sourceParam !== 'checklist') return
    setParams((p) => { p.delete('asset'); p.delete('source'); return p }, { replace: true })
    if (!assetParam) {
      setScan({ source: 'checklist' })
      return
    }
    void mi.assetDetail(assetParam)
      .then((d) => setScan(d.hidden ? { source: 'checklist' } : { asset: { id: d.asset.id, name: d.asset.name, site_id: d.asset.location_id }, source: 'checklist' }))
      .catch(() => setScan({ source: 'checklist' }))
  }, [sourceParam, assetParam, setParams])

  // Load the scanner's code once the page is idle, so tapping Scan opens it at once.
  useEffect(() => {
    const id = window.setTimeout(() => { void import('./ScanSheet') }, 800)
    return () => window.clearTimeout(id)
  }, [])

  const notify = useCallback((text: string, tone: 'ok' | 'warn' | 'danger' = 'ok') => {
    setNote({ text, tone })
    window.clearTimeout(noteTimer)
    noteTimer = window.setTimeout(() => setNote(null), 5000)
  }, [])

  const ctx = useMemo<MiCtx | null>(() => {
    if (!me || !me.member || !refs || !profile) return null
    return { me, refs, accountId: profile.account_id, userId: profile.id, reload, openScan: (c) => setScan(c ?? {}), notify }
  }, [me, refs, profile, reload, notify])

  const closeScan = useCallback((changed: boolean) => {
    setScan(null)
    if (changed) window.dispatchEvent(new Event('mi-changed'))
  }, [])
  const scanNow = () => { primeScanSound(); setScan({}) }

  if (error && !me) return <ErrorNote>{error}</ErrorNote>
  if (!me) return <Loading />
  if (!me.member) {
    return (
      <div className={PAGE}>
        <PageHeader title="Maintenance Inventory" />
        <p className="mt-3 text-sm text-ink-muted">You don't have a role in Maintenance Inventory yet. An admin can add you under its Settings.</p>
      </div>
    )
  }
  if (!ctx) return <Loading />

  const rank = ctx.me.rank
  const screen = screenFor(pathname, rank)
  const routes = (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route index element={<OverviewPage />} />
        <Route path="scan" element={<ScanRoute />} />
        <Route path="equipment" element={<EquipmentList />} />
        <Route path="equipment/:id" element={<EquipmentRoute />} />
        <Route path="tunnel" element={<TunnelPage />} />
        <Route path="stickers" element={<StickersPage />} />
        <Route path="audits" element={<AuditsPage />} />
        <Route path="audits/:runId" element={<AuditRunPage />} />
        <Route path="import" element={<ImportPage />} />
        {/* Older links (the Maintenance Log, stickers' history links) still work. */}
        <Route path="assets" element={<Navigate to={`${BASE}/equipment`} replace />} />
        <Route path="assets/:id" element={<AssetRedirect />} />
        <Route path="parts" element={<PartsTab />} />
        <Route path="parts/:id" element={<PartDetailPage />} />
        <Route path="tools" element={<ToolsTab />} />
        <Route path="tools/:id" element={<ToolsTab />} />
        <Route path="work-orders" element={<WorkOrdersTab />} />
        <Route path="work-orders/:id" element={<WorkOrdersTab />} />
        <Route path="stock" element={<Navigate to={`${BASE}/transfers`} replace />} />
        <Route path="transfers" element={<TransfersTab />} />
        <Route path="counts" element={<CountsTab />} />
        <Route path="counts/:id" element={<CountsTab />} />
        <Route path="reorder" element={<ReorderTab />} />
        <Route path="pos" element={<PosTab />} />
        <Route path="pos/:id" element={<PosTab />} />
        <Route path="reports" element={<ReportsTab />} />
        <Route path="settings" element={<SettingsTab />} />
        <Route path="settings/tunnels/:id" element={<TemplateEditorPage />} />
        <Route path="*" element={<OverviewPage />} />
      </Routes>
    </Suspense>
  )

  const more: MenuItem[] = [
    ...(screen.kind === 'section' && screen.section !== 'equipment' ? [{ to: `${BASE}/stickers`, icon: Sticker, label: 'Stickers' }] : []),
    ...(screen.kind === 'section' && screen.section === 'equipment' && rank >= 4 ? [{ to: `${BASE}/import`, icon: Upload, label: 'Import from a spreadsheet' }] : []),
    ...(rank >= 2 ? [{ to: `${BASE}/reports`, icon: BarChart3, label: 'Reports' }, { to: `${BASE}/settings`, icon: Settings, label: 'Settings' }] : []),
  ]

  let body: ReactNode
  if (screen.kind === 'bare') {
    body = routes
  } else if (screen.kind === 'tool') {
    body = (
      <div className={PAGE}>
        {screen.back && (
          <Link to={screen.back.to} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
            <ArrowLeft className="size-4" /> {screen.back.label}
          </Link>
        )}
        {screen.title && <div className="mt-3"><PageHeader title={screen.title} subtitle={screen.subtitle} /></div>}
        <div className={screen.title ? 'mt-5' : undefined}>{routes}</div>
      </div>
    )
  } else {
    const site = screen.section === 'overview' ? ctx.refs.sites.find((s) => s.id === params.get('site')) : undefined
    const subtitle = screen.section === 'overview'
      ? site ? `What needs attention at ${site.name}.` : 'What needs attention across your sites.'
      : SUBTITLE[screen.section]
    const actions = screen.section === 'equipment' ? (
      <>
        <Button variant="secondary" onClick={() => navigate(`${BASE}/stickers`)}><Sticker className="size-4" /> Stickers</Button>
        {/* Phones get the floating Scan button instead. */}
        <Button variant="secondary" onClick={scanNow} className="hidden lg:inline-flex"><ScanLine className="size-4" /> Scan</Button>
        {rank >= 2 && (
          <Button onClick={() => setParams((p) => { const next = new URLSearchParams(p); next.set('add', '1'); return next }, { replace: true })}>
            <Plus className="size-4" /> Add
          </Button>
        )}
        <MoreMenu items={more} />
      </>
    ) : <MoreMenu items={more} />
    const sitePicker = screen.section === 'overview' && ctx.refs.sites.length > 1 ? (
      <Select value={site?.id ?? 'all'} aria-label="Site" className="sm:w-60"
        onChange={(e) => setParams(e.target.value === 'all' ? {} : { site: e.target.value }, { replace: true })}>
        <option value="all">All sites</option>
        {ctx.refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </Select>
    ) : undefined
    body = (
      <div className={PAGE}>
        <PageHeader title="Maintenance Inventory" subtitle={subtitle} actions={actions} />
        <div className="mt-3 empty:hidden"><SyncBar /></div>
        <SectionNav className="mt-4" rank={rank} aside={sitePicker} />
        <div className="mt-5">{routes}</div>
      </div>
    )
  }

  return (
    <MiContext.Provider value={ctx}>
      {body}

      {/* Phones: one thumb away, above the bottom bar. An audit has its own scanner. */}
      {!(screen.kind === 'tool' && /\/audits\/[^/]+/.test(pathname)) && (
        <button type="button" aria-label="Scan" onClick={scanNow}
          className={cn('fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg transition hover:bg-accent-hover active:scale-95 lg:hidden',
            screen.kind === 'bare' ? 'bottom-[calc(1rem+env(safe-area-inset-bottom))]' : 'bottom-[calc(5rem+env(safe-area-inset-bottom))]')}>
          <ScanLine className="size-6" />
        </button>
      )}

      {note && (
        <div role="status" className={cn('fixed inset-x-4 bottom-40 z-[80] mx-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg lg:bottom-24',
          note.tone === 'ok' ? 'bg-ok text-white' : note.tone === 'warn' ? 'bg-warn text-white' : 'bg-danger text-white')}>
          <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{note.text}</span>
          <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}><X className="size-4" /></button>
        </div>
      )}

      {scan && (
        <Suspense fallback={<div className="fixed inset-0 z-[70] bg-content"><Loading /></div>}>
          <ScanSheet initial={scan} onClose={closeScan} />
        </Suspense>
      )}
    </MiContext.Provider>
  )
}

// /scan (the Maintenance Log's Scan button) opens the scanner over the Overview.
function ScanRoute() {
  const { openScan } = useMi()
  const navigate = useNavigate()
  useEffect(() => {
    openScan()
    navigate(BASE, { replace: true })
  }, [openScan, navigate])
  return null
}

function EquipmentRoute() {
  const { id } = useParams()
  return id ? <EquipmentDetailPage key={id} id={id} /> : null
}

function AssetRedirect() {
  const { id } = useParams()
  return <Navigate to={`${BASE}/equipment/${id ?? ''}`} replace />
}

type MenuItem = { to: string; icon: LucideIcon; label: string }

function MoreMenu({ items }: { items: MenuItem[] }) {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  if (!items.length) return null
  return (
    <div className="relative">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-label="More" aria-expanded={open}
        className="grid size-10 place-items-center rounded-md text-ink-muted hover:bg-border/40 hover:text-ink">
        <EllipsisVertical className="size-4" />
      </button>
      {open && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-20 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-30 mt-1 w-60 rounded-md border border-border bg-card py-1 shadow-md">
            {items.map(({ to, icon: Icon, label }) => (
              <button key={to} type="button" onClick={() => { setOpen(false); navigate(to) }}
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-content">
                <Icon className="size-4 text-ink-muted" /> {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
