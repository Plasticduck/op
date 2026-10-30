import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ClipboardCheck, Loader2, Play } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { itInventory, type AuditSummary, type ItAuditRun, type ItOverview, type ItPerson } from '@/lib/queries/itInventory'
import { daysUntil, fmtDay, friendlyError } from './format'
import { SectionNav } from './SectionNav'
import { useItRefs } from './useItRefs'

// Audits (spec E): walk a site with a phone and scan every sticker. This
// screen lists each site with when its equipment is due, any audit in
// progress, and past audits. Anyone who can see a site can audit it.

export function AuditsPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations } = useLocations()
  const { refs } = useItRefs()
  const today = format(new Date(), 'yyyy-MM-dd')
  const [overview, setOverview] = useState<ItOverview | null>(null)
  const [runs, setRuns] = useState<ItAuditRun[] | null>(null)
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void Promise.all([itInventory.overview(null, today), itInventory.auditRuns(), itInventory.people()]).then(([o, r, p]) => {
      if (!alive) return
      setOverview(o.data)
      setRuns(r.data ?? [])
      setPeople(new Map(((p.data as ItPerson[] | null) ?? []).map((x) => [x.id, x.name])))
      setError(o.error ?? r.error?.message ?? null)
    })
    return () => { alive = false }
  }, [today])

  const open = useMemo(() => new Map((runs ?? []).filter((r) => r.status === 'in_progress').map((r) => [r.location_id, r])), [runs])
  const past = (runs ?? []).filter((r) => r.status === 'completed')
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])
  // Sites with equipment, most urgent first: overdue, then by next due date.
  const sites = useMemo(() => [...(overview?.by_site ?? [])].sort((a, b) =>
    (b.audits_overdue > 0 ? 1 : 0) - (a.audits_overdue > 0 ? 1 : 0)
    || (a.next_audit ?? '9999').localeCompare(b.next_audit ?? '9999') || a.name.localeCompare(b.name)), [overview])
  const warn = refs?.settings.audit_warning_days ?? 7

  const start = async (locationId: string) => {
    setStarting(locationId)
    setError(null)
    const { data, error: err } = await itInventory.startAudit(locationId)
    setStarting(null)
    if (err || !data) { setError(friendlyError(err?.message ?? "Couldn't start the audit.")); return }
    navigate(`/app/it-inventory/audits/${data}`)
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader title="IT Inventory" subtitle="Walk a site with your phone and scan every sticker, to find what's missing or in the wrong place." />
      <SectionNav className="mt-4" />
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {!overview || !runs ? (
        !error && <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : sites.length === 0 ? (
        <EmptyState className="mt-6" icon={ClipboardCheck} title="Nothing to audit yet"
          description="Once a site has equipment in IT Inventory, you can audit it here." />
      ) : (
        <>
          <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Sites</h2>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {sites.map((s) => {
              const run = open.get(s.id)
              const days = s.next_audit ? daysUntil(s.next_audit) : null
              const badge = s.audits_overdue > 0
                ? { tone: 'danger' as const, label: `${s.audits_overdue} overdue` }
                : days !== null && days <= warn ? { tone: 'warn' as const, label: days === 0 ? 'Due today' : `Due in ${days}d` } : null
              return (
                <li key={s.id} className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{s.name}</span>
                      {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
                      {run && <Badge tone="accent">In progress</Badge>}
                    </div>
                    <div className="mt-0.5 text-xs text-ink-muted">
                      {s.total} {s.total === 1 ? 'item' : 'items'}
                      {' · '}{s.last_audit ? `last audited ${format(new Date(s.last_audit), 'MMM d, yyyy')}` : 'never audited'}
                      {s.next_audit && s.audits_overdue === 0 && ` · next due ${fmtDay(s.next_audit)}`}
                      {run && ` · started ${format(new Date(run.started_at), 'MMM d, h:mm a')}${run.started_by && people.get(run.started_by) ? ` by ${people.get(run.started_by)}` : ''}`}
                    </div>
                  </div>
                  <Button size="sm" variant={run || badge ? 'primary' : 'secondary'} disabled={starting !== null}
                    onClick={() => (run ? navigate(`/app/it-inventory/audits/${run.id}`) : void start(s.id))}>
                    {starting === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}
                    {run ? 'Continue' : 'Start audit'}
                  </Button>
                </li>
              )
            })}
          </ul>

          <h2 className="mb-2 mt-6 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Past audits</h2>
          {past.length === 0 ? (
            <p className="rounded-md border border-border bg-card p-4 text-sm text-ink-muted">No audits finished yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border bg-card">
              {past.map((r) => {
                const sum = r.summary as Partial<AuditSummary>
                return (
                  <li key={r.id}>
                    <button type="button" onClick={() => navigate(`/app/it-inventory/audits/${r.id}`)}
                      className="flex w-full flex-col gap-1 px-3 py-3 text-left hover:bg-content sm:flex-row sm:items-center">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-ink">{siteName.get(r.location_id) ?? 'Another site'}</div>
                        <div className="text-xs text-ink-muted">
                          {r.completed_at ? format(new Date(r.completed_at), 'MMM d, yyyy') : ''}
                          {r.completed_by && people.get(r.completed_by) ? ` · ${people.get(r.completed_by)}` : ''}
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        <Badge tone="ok">{sum.found ?? 0} found</Badge>
                        {!!sum.missing && <Badge tone="danger">{sum.missing} missing</Badge>}
                        {!!sum.damaged && <Badge tone="warn">{sum.damaged} damaged</Badge>}
                        {!!sum.wrong_location && <Badge tone="warn">{sum.wrong_location} wrong place</Badge>}
                        {!!sum.stickers && <Badge tone="neutral">{sum.stickers} stickers to reprint</Badge>}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
          {profile?.role === 'owner' && (
            <p className="mt-3 text-xs text-ink-muted">
              Equipment is due every {refs?.settings.audit_interval_months ?? 6} months after its last audit (some kinds of gear more often). Change it in Settings.
            </p>
          )}
        </>
      )}
    </div>
  )
}
