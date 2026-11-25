import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { CalendarDays, Landmark, Layers, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { isSuperAdmin } from '@/lib/pageAccessLogic'
import { dateTime } from '@/lib/format'
import { fpa, type FpaEntity, type FpaSite, type FpaVersion } from '@/lib/queries/fpa'
import { monthLabel, monthRange, toSeries, type Series } from './model'
import { Overview } from './Overview'
import { SitesTab } from './SitesTab'
import { BudgetTab } from './BudgetTab'
import { ForecastTab } from './ForecastTab'
import { LoadModal } from './LoadModal'
import { About } from './About'

type Tab = 'overview' | 'sites' | 'budget' | 'forecast'
const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: 'P&L & KPIs' },
  { key: 'sites', label: 'Sites' },
  { key: 'budget', label: 'Budget vs Actual' },
  { key: 'forecast', label: 'Forecast' },
]
const isTab = (v: string | null): v is Tab => TABS.some((t) => t.key === v)

// Finance > FP&A Model (Kevan only): Mighty Wash's FP&A workbook, loaded into
// Operator (migration 0253). The numbers are the workbook's own results.
export default function FpaPage() {
  const [params, setParams] = useSearchParams()
  const tab: Tab = isTab(params.get('tab')) ? (params.get('tab') as Tab) : 'overview'
  // Built from the address bar, not the last render, so two quick changes (a new
  // entity, then a tab) both stick.
  const setParam = (pairs: Record<string, string>) => setParams(() => {
    const p = new URLSearchParams(window.location.search)
    for (const [k, v] of Object.entries(pairs)) p.set(k, v)
    return p
  }, { replace: true })

  const [version, setVersion] = useState<FpaVersion | null | undefined>(undefined)
  const [entities, setEntities] = useState<FpaEntity[]>([])
  const [sites, setSites] = useState<FpaSite[]>([])
  const [error, setError] = useState<string | null>(null)

  const loadBase = useCallback(async () => {
    setError(null)
    try {
      const [v, e, s] = await Promise.all([fpa.version(), fpa.entities(), fpa.sites()])
      setVersion(v)
      setEntities(e)
      setSites(s)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setVersion(null)
    }
  }, [])
  useEffect(() => { void loadBase() }, [loadBase])

  const lastClosed = version?.last_closed_month ?? version?.info.months?.last ?? null
  const firstMonth = version?.info.months?.first ?? null
  const months = useMemo(() => (lastClosed && firstMonth ? monthRange(firstMonth, lastClosed).reverse() : []), [firstMonth, lastClosed])
  const entityKey = entities.some((e) => e.key === params.get('entity')) ? (params.get('entity') as string) : 'G_CONS'
  const month = params.get('month') && months.includes(params.get('month') as string) ? (params.get('month') as string) : lastClosed
  const entity = entities.find((e) => e.key === entityKey) ?? null

  // Every line and KPI for the chosen entity, all months, kept with the entity it
  // belongs to so a switch never shows the previous entity's numbers.
  const [loaded, setLoaded] = useState<{ key: string; version: string; series: Series } | null>(null)
  const versionId = version?.id
  useEffect(() => {
    if (!versionId) return
    let alive = true
    fpa.entityMetrics(entityKey)
      .then((rows) => { if (alive) setLoaded({ key: entityKey, version: versionId, series: toSeries(rows) }) })
      .catch((e) => { if (alive) setError(e instanceof Error ? e.message : String(e)) })
    return () => { alive = false }
  }, [entityKey, versionId])
  const series = loaded?.key === entityKey && loaded.version === versionId ? loaded.series : null
  const loading = !!versionId && !series

  const [loadOpen, setLoadOpen] = useState(false)
  // Loading a version is the super admin's (fpa_may_load refuses everyone else), so
  // the other readers get the page without the load buttons.
  const { profile } = useAuth()
  const canLoad = isSuperAdmin(profile?.email)
  const onLoaded = () => {
    setLoadOpen(false)
    void loadBase()
  }

  const groups = entities.filter((e) => e.kind === 'group')
  const siteEntities = entities.filter((e) => e.kind === 'site')
  const others = entities.filter((e) => e.kind === 'other')

  if (version === undefined) return <p className="text-sm text-ink-muted">Loading…</p>

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="FP&A Model"
        subtitle={version
          ? `${version.label} · QuickBooks P&L ${firstMonth ? monthLabel(firstMonth) : ''} to ${lastClosed ? monthLabel(lastClosed) : ''} · loaded ${dateTime(version.activated_at ?? version.loaded_at)}`
          : 'Mighty Wash’s FP&A workbook, inside Operator.'}
        actions={canLoad ? <Button variant="secondary" onClick={() => setLoadOpen(true)}><Upload className="size-4" /> Load a new version</Button> : undefined}
      />

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Could not load the model: {error}</p>}

      {!version ? (
        <EmptyState
          icon={Landmark}
          title="No model loaded yet"
          description={canLoad
            ? 'Load the FP&A workbook (Mighty_Wash_FPA_Model_*.xlsx) and its P&L, KPIs, budget and forecast show here.'
            : 'The FP&A workbook has not been loaded yet. Its P&L, KPIs, budget and forecast show here once it is.'}
          action={canLoad ? <Button onClick={() => setLoadOpen(true)}><Upload className="size-4" /> Load the workbook</Button> : undefined}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-3">
            <label className="flex min-w-0 flex-col gap-1 text-xs font-medium text-ink-muted">
              <span className="inline-flex items-center gap-1"><Layers className="size-3.5" /> Entity</span>
              <div className="w-72 max-w-full">
                <Select value={entityKey} onChange={(e) => setParam({ entity: e.target.value })} className="h-9" aria-label="Entity">
                  <optgroup label="Company, segments and regions">
                    {groups.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                  </optgroup>
                  <optgroup label="Sites">
                    {siteEntities.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                  </optgroup>
                  {others.length > 0 && (
                    <optgroup label="Other">
                      {others.map((e) => <option key={e.key} value={e.key}>{e.label}</option>)}
                    </optgroup>
                  )}
                </Select>
              </div>
            </label>
            <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
              <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" /> Month</span>
              <div className="w-60">
                <Select value={month ?? ''} onChange={(e) => setParam({ month: e.target.value })} className="h-9" aria-label="Month">
                  {months.map((m) => <option key={m} value={m}>{monthLabel(m, 'long')}{m === lastClosed ? ' (last closed)' : ''}</option>)}
                </Select>
              </div>
            </label>
            {loading && <span className="pb-2 text-xs text-ink-subtle">Loading {entity?.label ?? ''}…</span>}
          </div>

          <div role="tablist" aria-label="Model view" className="flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-border">
            {TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={t.key === tab}
                onClick={() => setParam({ tab: t.key })}
                className={cn(
                  '-mb-px whitespace-nowrap border-b-2 pb-2 pt-1 text-sm font-medium transition',
                  t.key === tab ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          {month && tab === 'overview' && <Overview key={`${entityKey}|${versionId}`} series={series} entity={entity} month={month} />}
          {month && tab === 'sites' && (
            <SitesTab
              key={versionId}
              month={month}
              entities={entities}
              sites={sites}
              onPick={(key) => setParam({ entity: key, tab: 'overview' })}
            />
          )}
          {tab === 'budget' && <BudgetTab key={versionId} version={version} />}
          {tab === 'forecast' && lastClosed && <ForecastTab key={versionId} entity={entity} series={series} version={version} lastClosed={lastClosed} />}

          <About version={version} />
        </>
      )}

      {loadOpen && canLoad && <LoadModal current={version ?? null} onClose={() => setLoadOpen(false)} onLoaded={onLoaded} />}
    </div>
  )
}
