import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Settings } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { checklistReview, type ChecklistRun } from '@/lib/queries/checklistReview'
import { TodayView } from './TodayView'
import { ReviewList, type ReviewTab } from './ReviewList'
import { useChecklistRms } from './useChecklistRms'

type TabKey = 'today' | ReviewTab
const TABS: { key: TabKey; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'rm_audit', label: 'RM Audit' },
  { key: 'archive', label: 'Archive' },
]
const isTab = (v: string | null): v is TabKey => TABS.some((t) => t.key === v)

// Checklists: the site fills out today's checklists and submits each one (Today);
// it waits for the site's Regional Manager (RM Audit), who acknowledges anything
// flagged and marks it complete (Archive). Employees only see Today.
export default function ChecklistsPage() {
  const { profile } = useAuth()
  const isManagerPlus = !!profile && profile.role !== 'employee'
  const [params, setParams] = useSearchParams()
  const tab: TabKey = isManagerPlus && isTab(params.get('tab')) ? (params.get('tab') as TabKey) : 'today'
  const setTab = (t: TabKey) => setParams((p) => { p.set('tab', t); return p }, { replace: true })

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Checklists"
        subtitle={
          tab === 'today'
            ? undefined
            : tab === 'rm_audit'
              ? 'Submitted checklists waiting on the site’s Regional Manager to acknowledge anything flagged and mark them complete.'
              : 'Checklists the Regional Manager has marked complete.'
        }
        actions={
          isManagerPlus ? (
            <Link to="/app/checklists/templates">
              <Button variant="secondary"><Settings className="size-4" /> Manage templates</Button>
            </Link>
          ) : undefined
        }
      />
      {isManagerPlus ? <ManagerTabs tab={tab} setTab={setTab} /> : <Today />}
    </div>
  )
}

function Today() {
  const { locations } = useLocations()
  return (
    <LocationGate>
      {(locationId) => (
        <TodayView key={locationId} locationId={locationId} locationName={locations.find((l) => l.id === locationId)?.name ?? 'this site'} />
      )}
    </LocationGate>
  )
}

function ManagerTabs({ tab, setTab }: { tab: TabKey; setTab: (t: TabKey) => void }) {
  const { profile } = useAuth()
  const rms = useChecklistRms()
  const [rmAudit, setRmAudit] = useState<ChecklistRun[]>([])
  const [archive, setArchive] = useState<ChecklistRun[]>([])
  const [archiveDays, setArchiveDays] = useState(90)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [siteChoice, setSiteChoice] = useState<string | null>(null)

  const load = useCallback(async () => {
    const since = new Date(Date.now() - archiveDays * 86_400_000).toISOString()
    const [a, b] = await Promise.all([checklistReview.listRmAudit(), checklistReview.listArchive(since)])
    setLoadError(a.error?.message ?? b.error?.message ?? null)
    setRmAudit(a.data)
    setArchive(b.data)
    setLoading(false)
  }, [archiveDays])
  useEffect(() => { void load() }, [load])

  // RMs start on their own sites.
  const mine = useMemo(() => {
    if (!rms || !profile) return false
    for (const r of rms.values()) if (r.user_id === profile.id) return true
    return false
  }, [rms, profile])
  const siteFilter = siteChoice ?? (mine ? 'mine' : 'all')
  const mySites = useMemo(() => new Set(rms && profile ? [...rms.values()].filter((r) => r.user_id === profile.id).map((r) => r.location_id) : []), [rms, profile])
  const countIn = (rows: ChecklistRun[]) =>
    siteFilter === 'mine' ? rows.filter((r) => mySites.has(r.location_id)).length
      : siteFilter === 'all' ? rows.length
        : rows.filter((r) => r.location_id === siteFilter).length
  const counts: Record<ReviewTab, number> = { rm_audit: countIn(rmAudit), archive: countIn(archive) }

  return (
    <>
      <div role="tablist" aria-label="Checklist stage" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border sm:gap-x-6">
        {TABS.map((t) => {
          const active = t.key === tab
          const count = t.key === 'today' ? null : counts[t.key]
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={count == null ? t.label : `${t.label} (${count})`}
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 pb-2 pt-1 text-sm font-medium transition',
                active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t.label}
              {count != null && (
                <span
                  className={cn(
                    'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                    t.key === 'rm_audit' && count > 0 ? 'bg-warn text-white'
                      : active ? 'bg-accent text-white' : 'bg-ink/10 text-ink-muted',
                  )}
                >
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {tab === 'today' ? (
        <Today />
      ) : (
        <ReviewList
          key={tab}
          tab={tab}
          rows={tab === 'rm_audit' ? rmAudit : archive}
          loading={loading}
          loadError={loadError}
          rms={rms}
          archiveDays={archiveDays}
          onMoreArchive={() => setArchiveDays(365)}
          onChanged={() => void load()}
          siteFilter={siteFilter}
          onSiteFilter={setSiteChoice}
        />
      )}
    </>
  )
}
