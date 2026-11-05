import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useSearchParams } from 'react-router-dom'
import { CheckCircle2, ScanLine, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAuth } from '@/lib/auth'
import { mi, MI_ROLE_LABEL, type MiMe, type MiRefs } from '@/lib/queries/maintenanceInventory'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { MiContext, type MiCtx, type ScanContext } from './context'
import { errText } from './format'
import { SyncBar } from './SyncBar'
import { ErrorNote, Loading } from './ui'
import HomeTab from './HomeTab'

const ScanSheet = lazy(() => import('./ScanSheet').then((m) => ({ default: m.ScanSheet })))
const PartsTab = lazy(() => import('./PartsTab'))
const PartDetailPage = lazy(() => import('./PartDetailPage'))
const ToolsTab = lazy(() => import('./ToolsTab'))
const AssetsTab = lazy(() => import('./AssetsTab'))
const WorkOrdersTab = lazy(() => import('./WorkOrdersTab'))
const ReorderTab = lazy(() => import('./ReorderTab'))
const PosTab = lazy(() => import('./PosTab'))
const TransfersTab = lazy(() => import('./TransfersTab'))
const CountsTab = lazy(() => import('./CountsTab'))
const ReportsTab = lazy(() => import('./ReportsTab'))
const SettingsTab = lazy(() => import('./SettingsTab'))

const BASE = '/app/maintenance-inventory'
const TABS: Array<{ to: string; label: string; end?: boolean; minRank: number }> = [
  { to: BASE, label: 'Home', end: true, minRank: 1 },
  { to: `${BASE}/parts`, label: 'Parts', minRank: 1 },
  { to: `${BASE}/tools`, label: 'Tools', minRank: 1 },
  { to: `${BASE}/assets`, label: 'Assets', minRank: 1 },
  { to: `${BASE}/work-orders`, label: 'Work orders', minRank: 1 },
  { to: `${BASE}/transfers`, label: 'Transfers', minRank: 1 },
  { to: `${BASE}/counts`, label: 'Counts', minRank: 1 },
  { to: `${BASE}/reorder`, label: 'Reorder', minRank: 2 },
  { to: `${BASE}/pos`, label: 'POs', minRank: 2 },
  { to: `${BASE}/reports`, label: 'Reports', minRank: 2 },
  { to: `${BASE}/settings`, label: 'Settings', minRank: 2 },
]

let noteTimer = 0

export default function MaintenanceInventoryPage() {
  const { profile } = useAuth()
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

  return (
    <MiContext.Provider value={ctx}>
      <div className="flex flex-col gap-4">
        <PageHeader title="Maintenance Inventory" subtitle={`${MI_ROLE_LABEL[ctx.me.role]}${ctx.me.has_sample_data ? '. Sample data is loaded: Settings can remove it.' : ''}`} />
        <SyncBar />
        <nav aria-label="Maintenance Inventory" className="flex w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-card p-0.5 [scrollbar-width:none] sm:w-fit">
          {TABS.filter((t) => ctx.me.rank >= t.minRank).map((t) => (
            <NavLink key={t.to} to={t.to} end={t.end}
              className={({ isActive }) => cn('shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm font-medium transition', isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
              {t.label}
            </NavLink>
          ))}
        </nav>

        <Suspense fallback={<Loading />}>
          <Routes>
            <Route index element={<HomeTab />} />
            <Route path="scan" element={<HomeTab />} />
            <Route path="parts" element={<PartsTab />} />
            <Route path="parts/:id" element={<PartDetailPage />} />
            <Route path="tools" element={<ToolsTab />} />
            <Route path="tools/:id" element={<ToolsTab />} />
            <Route path="assets" element={<AssetsTab />} />
            <Route path="assets/:id" element={<AssetsTab />} />
            <Route path="work-orders" element={<WorkOrdersTab />} />
            <Route path="work-orders/:id" element={<WorkOrdersTab />} />
            <Route path="transfers" element={<TransfersTab />} />
            <Route path="counts" element={<CountsTab />} />
            <Route path="counts/:id" element={<CountsTab />} />
            <Route path="reorder" element={<ReorderTab />} />
            <Route path="pos" element={<PosTab />} />
            <Route path="pos/:id" element={<PosTab />} />
            <Route path="reports" element={<ReportsTab />} />
            <Route path="settings" element={<SettingsTab />} />
            <Route path="*" element={<HomeTab />} />
          </Routes>
        </Suspense>

        {/* Always one thumb away, above the phone's bottom bar. */}
        <button type="button" aria-label="Scan" onClick={() => { primeScanSound(); setScan({}) }}
          className="fixed bottom-24 right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg transition hover:bg-accent-hover active:scale-95 lg:bottom-6 lg:right-6">
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
      </div>
    </MiContext.Provider>
  )
}

