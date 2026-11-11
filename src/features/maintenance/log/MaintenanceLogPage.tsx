import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { NavLink, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Plus, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { useAuth } from '@/lib/auth'
import { mi, MI_ROLE_LABEL, type MiMe, type MiRefs } from '@/lib/queries/maintenanceInventory'
import { ml, type LogCounts } from '@/lib/queries/maintenanceLog'
import { cn } from '@/lib/utils'
import { MiContext, type MiCtx } from '../inventory/context'
import { errText } from '../inventory/format'
import { SyncBar } from '../inventory/SyncBar'
import { ErrorNote, Loading } from '../inventory/ui'
import { LOG_CHANGED, LogContext, logChanged, type LogCtx, type LogFormInit, type ScheduleFormInit } from './context'
import LogTab from './LogTab'

const EntryPage = lazy(() => import('./EntryPage'))
const DueTab = lazy(() => import('./DueTab'))
const SchedulesTab = lazy(() => import('./SchedulesTab'))
const ForecastTab = lazy(() => import('./ForecastTab'))
const LogReportsTab = lazy(() => import('./LogReportsTab'))
const LogForm = lazy(() => import('./LogForm'))
const ScheduleForm = lazy(() => import('./ScheduleForm'))

const BASE = '/app/maintenance-log'

let noteTimer = 0

// Maintenance Log: every job done on the equipment, the schedules that say what's due,
// and the parts those schedules will need. Built on Maintenance Inventory's data and
// access (docs/maintenance-inventory/MAINTENANCE_LOG.md).
export default function MaintenanceLogPage() {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [me, setMe] = useState<MiMe | null>(null)
  const [refs, setRefs] = useState<MiRefs | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [counts, setCounts] = useState<LogCounts | null>(null)
  const [note, setNote] = useState<{ text: string; tone: 'ok' | 'warn' | 'danger' } | null>(null)
  const [logInit, setLogInit] = useState<LogFormInit | null>(null)
  const [schedInit, setSchedInit] = useState<ScheduleFormInit | null>(null)
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

  const loadCounts = useCallback(() => { void ml.counts().then(setCounts).catch(() => {}) }, [])
  useEffect(() => {
    if (!me?.member) return
    loadCounts()
    window.addEventListener(LOG_CHANGED, loadCounts)
    return () => window.removeEventListener(LOG_CHANGED, loadCounts)
  }, [me, loadCounts])

  // Links in: ?new=1 (with &asset= or &site=) opens the form; ?schedule=ID&done=1 opens
  // it on that scheduled task.
  const newParam = params.get('new')
  const doneParam = params.get('done')
  const scheduleParam = params.get('schedule')
  const assetParam = params.get('asset')
  const siteParam = params.get('site')
  useEffect(() => {
    if (!me?.member) return
    if (newParam === '1') {
      setParams((p) => { p.delete('new'); p.delete('site'); if (assetParam) p.delete('asset'); return p }, { replace: true })
      if (assetParam) {
        void mi.assetDetail(assetParam)
          .then((d) => setLogInit(d.hidden ? {} : { asset: { id: d.asset.id, name: d.asset.name, site_id: d.asset.location_id } }))
          .catch(() => setLogInit({}))
      } else setLogInit({ site_id: siteParam })
    } else if (doneParam === '1' && scheduleParam) {
      setParams((p) => { p.delete('done'); p.delete('schedule'); return p }, { replace: true })
      void ml.schedule(scheduleParam).then((d) => setLogInit({ schedule: d.schedule })).catch((e) => setError(errText(e)))
    }
  }, [me, newParam, doneParam, scheduleParam, assetParam, siteParam, setParams])

  const notify = useCallback((text: string, tone: 'ok' | 'warn' | 'danger' = 'ok') => {
    setNote({ text, tone })
    window.clearTimeout(noteTimer)
    noteTimer = window.setTimeout(() => setNote(null), 6000)
  }, [])

  const ctx = useMemo<MiCtx | null>(() => {
    if (!me || !me.member || !refs || !profile) return null
    return { me, refs, accountId: profile.account_id, userId: profile.id, reload, openScan: () => navigate('/app/maintenance-inventory/scan'), notify }
  }, [me, refs, profile, reload, notify, navigate])

  const logCtx = useMemo<LogCtx>(() => ({
    openLog: (init) => setLogInit(init ?? {}),
    openSchedule: (init) => setSchedInit(init ?? {}),
    counts,
  }), [counts])

  if (error && !me) return <ErrorNote>{error}</ErrorNote>
  if (!me) return <Loading />
  if (!me.member) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title="Maintenance Log" />
        <p className="text-sm text-ink-muted">You don't have a role in Maintenance Inventory yet, and the log uses the same one. An admin can add you under Maintenance Inventory &gt; Settings.</p>
      </div>
    )
  }
  if (!ctx) return <Loading />

  const attention = counts ? counts.overdue + counts.due : 0
  const tabs: Array<{ to: string; label: string; end?: boolean; minRank: number; badge?: number }> = [
    { to: BASE, label: 'Log', end: true, minRank: 1 },
    { to: `${BASE}/due`, label: 'Due', minRank: 1, badge: attention },
    { to: `${BASE}/schedules`, label: 'Schedules', minRank: 1 },
    { to: `${BASE}/forecast`, label: 'Parts forecast', minRank: 1 },
    { to: `${BASE}/reports`, label: 'Reports', minRank: 2 },
  ]

  return (
    <MiContext.Provider value={ctx}>
      <LogContext.Provider value={logCtx}>
        <div className="flex flex-col gap-4">
          <PageHeader title="Maintenance Log" subtitle={`${MI_ROLE_LABEL[ctx.me.role]}. Every job, what's due, and the parts it takes.`} />
          <SyncBar />
          {error && <ErrorNote>{error}</ErrorNote>}
          <nav aria-label="Maintenance Log" className="flex w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-card p-0.5 [scrollbar-width:none] sm:w-fit">
            {tabs.filter((t) => ctx.me.rank >= t.minRank).map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}
                className={({ isActive }) => cn('flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm font-medium transition', isActive ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
                {t.label}
                {!!t.badge && <span className={cn('rounded-full px-1.5 text-xs font-semibold text-white', counts && counts.overdue > 0 ? 'bg-danger' : 'bg-warn')}>{t.badge}</span>}
              </NavLink>
            ))}
          </nav>

          <Suspense fallback={<Loading />}>
            <Routes>
              <Route index element={<LogTab />} />
              <Route path="entries/:id" element={<EntryPage />} />
              <Route path="due" element={<DueTab />} />
              <Route path="schedules" element={<SchedulesTab />} />
              <Route path="schedules/:id" element={<SchedulesTab />} />
              <Route path="forecast" element={<ForecastTab />} />
              <Route path="reports" element={<LogReportsTab />} />
              <Route path="*" element={<LogTab />} />
            </Routes>
          </Suspense>

          {/* Log a job from anywhere on the page, above the phone's bottom bar. */}
          <button type="button" aria-label="Log work" onClick={() => setLogInit({})}
            className="fixed bottom-24 right-4 z-40 grid size-14 place-items-center rounded-full bg-accent text-white shadow-lg transition hover:bg-accent-hover active:scale-95 lg:bottom-6 lg:right-6">
            <Plus className="size-7" />
          </button>

          {note && (
            <div role="status" className={cn('fixed inset-x-4 bottom-40 z-[80] mx-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg lg:bottom-24',
              note.tone === 'ok' ? 'bg-ok text-white' : note.tone === 'warn' ? 'bg-warn text-white' : 'bg-danger text-white')}>
              <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
              <span className="min-w-0 flex-1">{note.text}</span>
              <button type="button" aria-label="Dismiss" onClick={() => setNote(null)}><X className="size-4" /></button>
            </div>
          )}

          {logInit && (
            <Suspense fallback={null}>
              <LogForm init={logInit} onClose={() => setLogInit(null)} onSaved={() => { setLogInit(null); logChanged() }} />
            </Suspense>
          )}
          {schedInit && (
            <Suspense fallback={null}>
              <ScheduleForm init={schedInit} onClose={() => setSchedInit(null)} onSaved={() => { setSchedInit(null); logChanged() }} />
            </Suspense>
          )}
        </div>
      </LogContext.Provider>
    </MiContext.Provider>
  )
}
