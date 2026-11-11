import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { BarChart3, CheckCircle2, ScanLine, Settings, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAuth } from '@/lib/auth'
import { mi, MI_ROLE_LABEL, type MiMe, type MiRefs } from '@/lib/queries/maintenanceInventory'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { MiContext, type MiCtx, type ScanContext } from './context'
import { errText } from './format'
import { SectionNav } from './SectionNav'
import { SyncBar } from './SyncBar'
import { ErrorNote, Loading } from './ui'

// Maintenance Inventory (docs/maintenance-inventory). Laid out like IT Inventory: one
// title, a segmented control for the screens (Overview, Equipment, Parts, Tools, Stock,
// Work orders), tools in the header, and a Scan button one thumb away on every screen.
// A machine's page is full screen, without the header.

const ScanSheet = lazy(() => import('./ScanSheet').then((m) => ({ default: m.ScanSheet })))
const OverviewPage = lazy(() => import('./OverviewPage'))
const EquipmentList = lazy(() => import('./equipment/EquipmentList').then((m) => ({ default: m.EquipmentList })))
const EquipmentDetailPage = lazy(() => import('./equipment/EquipmentDetail').then((m) => ({ default: m.EquipmentDetailPage })))
const TunnelPage = lazy(() => import('./tunnel/TunnelPage'))
const TemplateEditorPage = lazy(() => import('./tunnel/TemplateEditorPage'))
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
// Full-screen pages: no title or section bar.
const BARE = /^\/app\/maintenance-inventory\/equipment\/[0-9a-f]{8}-/i

let noteTimer = 0

export default function MaintenanceInventoryPage() {
  const { profile } = useAuth()
  const { pathname } = useLocation()
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

  if (error && !me) return <ErrorNote>{error}</ErrorNote>
  if (!me) return <Loading />
  if (!me.member) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title="Maintenance Inventory" />
        <p className="text-sm text-ink-muted">You don't have a role in Maintenance Inventory yet. An admin can add you under its Settings.</p>
      </div>
    )
  }
  if (!ctx) return <Loading />

  const bare = BARE.test(pathname)
  const routes = (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route index element={<OverviewPage />} />
        <Route path="scan" element={<OverviewPage />} />
        <Route path="equipment" element={<EquipmentList />} />
        <Route path="equipment/:id" element={<EquipmentRoute />} />
        <Route path="tunnel" element={<TunnelPage />} />
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

  return (
    <MiContext.Provider value={ctx}>
      {bare ? routes : (
        <div className="flex flex-col gap-4">
          <PageHeader
            title="Maintenance Inventory"
            subtitle={`${MI_ROLE_LABEL[ctx.me.role]}${ctx.me.has_sample_data ? '. Sample data is loaded: Settings can remove it.' : ''}`}
            actions={ctx.me.rank >= 2 ? (
              <>
                <ToolLink to={`${BASE}/reports`} icon={BarChart3} label="Reports" active={pathname.startsWith(`${BASE}/reports`)} />
                <ToolLink to={`${BASE}/settings`} icon={Settings} label="Settings" active={pathname.startsWith(`${BASE}/settings`)} />
              </>
            ) : undefined}
          />
          <SyncBar />
          <SectionNav rank={ctx.me.rank} />
          {routes}
        </div>
      )}

      {/* Always one thumb away, above the phone's bottom bar. */}
      <button type="button" aria-label="Scan" onClick={() => { primeScanSound(); setScan({}) }}
        className={cn('fixed right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg transition hover:bg-accent-hover active:scale-95 lg:bottom-6 lg:right-6',
          bare ? 'bottom-[calc(1rem+env(safe-area-inset-bottom))]' : 'bottom-24')}>
        <ScanLine className="size-6" />
      </button>

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

function EquipmentRoute() {
  const { id } = useParams()
  return id ? <EquipmentDetailPage key={id} id={id} /> : null
}

function AssetRedirect() {
  const { id } = useParams()
  return <Navigate to={`${BASE}/equipment/${id ?? ''}`} replace />
}

function ToolLink({ to, icon: Icon, label, active }: { to: string; icon: typeof Settings; label: string; active: boolean }) {
  return (
    <Link to={to} className={cn('inline-flex h-10 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition',
      active ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink hover:bg-content')}>
      <Icon className="size-4" /> <span className="hidden sm:inline">{label}</span>
    </Link>
  )
}
