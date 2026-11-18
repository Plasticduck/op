import { useMemo, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, ClipboardCheck, ListChecks, MapPin, Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn, compareLocationName } from '@/lib/utils'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { useBrandLogoUrl } from '@/lib/brandLogo'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { checklistReview, type ChecklistRun, type SiteRm } from '@/lib/queries/checklistReview'
import { OpsToolbar } from '@/features/opssuite/OpsToolbar'
import { useOpsTable } from '@/features/opssuite/useOpsTable'
import { LateTag } from './parts'
import { canReviewSite, clockTime, completedText, dayLabel, daysSince, daysText, friendlyError, isLate, rmShort, runName } from './review'

export type ReviewTab = 'rm_audit' | 'archive'

const EMPTY: Record<ReviewTab, { title: string; description: string }> = {
  rm_audit: {
    title: 'Nothing waiting for review',
    description: "Checklists land here when a site submits them, and wait until the site's Regional Manager marks them complete.",
  },
  archive: {
    title: 'Nothing archived yet',
    description: 'Checklists move here once the Regional Manager marks them complete.',
  },
}

type Col = { header: string; cell: (r: ChecklistRun) => ReactNode; className?: string }

// RM Audit and Archive: submitted checklists across the person's sites. RMs
// start on their own sites; anyone can switch to all of them.
export function ReviewList({ tab, rows, loading, loadError, rms, archiveDays, onMoreArchive, onChanged, siteFilter, onSiteFilter }: {
  tab: ReviewTab
  rows: ChecklistRun[]
  loading: boolean
  loadError: string | null
  rms: Map<string, SiteRm> | null
  archiveDays: number
  onMoreArchive: () => void
  onChanged: () => void
  siteFilter: string
  onSiteFilter: (v: string) => void
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const logoUrl = useBrandLogoUrl()
  const [checklistFilter, setChecklistFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [bulkOpen, setBulkOpen] = useState(false)

  const mySites = useMemo(() => {
    const s = new Set<string>()
    if (rms && profile) for (const r of rms.values()) if (r.user_id === profile.id) s.add(r.location_id)
    return s
  }, [rms, profile])

  const { locations } = useLocations()
  const sites = useMemo(() => [...locations].sort((x, y) => compareLocationName(x.name, y.name)), [locations])
  const names = useMemo(() => [...new Set(rows.map(runName))].sort(), [rows])

  const filtered = useMemo(() => {
    let r = rows
    if (siteFilter === 'mine') r = r.filter((x) => mySites.has(x.location_id))
    else if (siteFilter !== 'all') r = r.filter((x) => x.location_id === siteFilter)
    if (checklistFilter !== 'all') r = r.filter((x) => runName(x) === checklistFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      r = r.filter((x) =>
        (x.location?.name ?? '').toLowerCase().includes(q)
        || runName(x).toLowerCase().includes(q)
        || (x.submitted_by_name ?? '').toLowerCase().includes(q)
        || (x.completed_by_name ?? '').toLowerCase().includes(q)
        || (rms?.get(x.location_id)?.name ?? '').toLowerCase().includes(q))
    }
    return r
  }, [rows, siteFilter, mySites, checklistFilter, search, rms])

  const table = useOpsTable(filtered, (r) => (tab === 'archive' ? r.completed_at ?? r.submitted_at : r.submitted_at))
  const flagged = (r: ChecklistRun) => r.flagged_items?.length ?? 0
  const cleanMine = table.rows.filter((r) => flagged(r) === 0 && canReviewSite(rms?.get(r.location_id), profile?.id, profile?.role))

  const rmName = (r: ChecklistRun) => (rms ? rmShort(rms.get(r.location_id)) : '…')
  const doneText = (r: ChecklistRun) => `${r.items_done ?? 0} / ${r.items_total ?? 0}`

  const site: Col = { header: 'Site', cell: (r) => r.location?.name ?? '—', className: 'font-medium text-ink' }
  const checklist: Col = { header: 'Checklist', cell: runName, className: 'text-ink' }
  const day: Col = { header: 'Day', cell: (r) => dayLabel(r.instance_date) }
  const done: Col = { header: 'Done', cell: doneText }
  const flags: Col = {
    header: 'Flagged',
    cell: (r) => (flagged(r) > 0 ? <span className="font-semibold text-danger">{flagged(r)}</span> : <span className="text-ink-subtle">0</span>),
    className: '',
  }
  const columns: Col[] = tab === 'rm_audit'
    ? [
        site, checklist, day,
        {
          header: 'Submitted',
          cell: (r) => (
            <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
              {clockTime(r.submitted_at)} {isLate(r) && <LateTag />}
            </span>
          ),
        },
        { header: 'By', cell: (r) => r.submitted_by_name ?? '—' },
        done, flags,
        { header: 'Waiting on', cell: rmName, className: 'text-ink' },
        { header: 'Open', cell: (r) => daysText(daysSince(r.submitted_at)) },
      ]
    : [
        site, checklist, day,
        { header: 'By', cell: (r) => r.submitted_by_name ?? '—' },
        done, flags,
        { header: 'Completed by', cell: completedText, className: 'text-ink' },
        { header: 'Completed', cell: (r) => shortDate(r.completed_at) },
      ]

  const exportColumns: ExportColumn<ChecklistRun>[] = [
    { header: 'Site', value: (r) => r.location?.name },
    { header: 'Checklist', value: runName },
    { header: 'Day', value: (r) => r.instance_date },
    { header: 'Submitted', value: (r) => (r.submitted_at ? `${shortDate(r.submitted_at)} ${clockTime(r.submitted_at)}` : '') },
    { header: 'Late', value: (r) => (isLate(r) ? 'Yes' : '') },
    { header: 'Submitted by', value: (r) => r.submitted_by_name },
    { header: 'Done', value: doneText },
    { header: 'Flagged', value: flagged },
    ...(tab === 'rm_audit'
      ? [{ header: 'Waiting on', value: rmName }]
      : [
          { header: 'Completed by', value: completedText },
          { header: 'Completed', value: (r: ChecklistRun) => shortDate(r.completed_at) },
        ]),
  ]
  const title = tab === 'rm_audit' ? 'RM Audit' : 'Archive'
  const open = (r: ChecklistRun) => navigate(`/app/checklists/review/${r.id}`)

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> Site</span>
          <Select value={siteFilter} onChange={(e) => onSiteFilter(e.target.value)} className="h-9 w-56" aria-label="Filter by site">
            {mySites.size > 0 && <option value="mine">My sites ({mySites.size})</option>}
            <option value="all">All sites</option>
            {sites.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><ListChecks className="size-3.5" /> Checklist</span>
          <Select value={checklistFilter} onChange={(e) => setChecklistFilter(e.target.value)} className="h-9 w-64" aria-label="Filter by checklist">
            <option value="all">All checklists</option>
            {names.map((n) => <option key={n} value={n}>{n}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><Search className="size-3.5" /> Search</span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Site, checklist or person" className="h-9 w-56" aria-label="Search checklists" />
        </label>
        {tab === 'rm_audit' && cleanMine.length > 0 && (
          <Button variant="secondary" className="ml-auto h-9" onClick={() => setBulkOpen(true)}>
            <CheckCircle2 className="size-4" /> Complete {cleanMine.length} with nothing flagged
          </Button>
        )}
      </div>

      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf(`Checklists: ${title}`, exportColumns, table.rows, { logoUrl })}
        onExportExcel={() => exportExcel(`checklists-${tab.replace('_', '-')}`, exportColumns, table.rows)}
      />

      {loadError && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Could not load checklists: {loadError}</p>}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={tab === 'archive' ? CheckCircle2 : ClipboardCheck} title={EMPTY[tab].title} description={EMPTY[tab].description} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-md border border-border bg-card md:block">
            <table className="w-full min-w-[820px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>{columns.map((c) => <th key={c.header} className="px-3 py-2.5 font-medium">{c.header}</th>)}</tr>
              </thead>
              <tbody>
                {table.rows.map((r) => (
                  <tr key={r.id} className="cursor-pointer border-t border-border hover:bg-content" onClick={() => open(r)}>
                    {columns.map((c) => <td key={c.header} className={cn('px-3 py-2.5', c.className ?? 'text-ink-muted')}>{c.cell(r)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 md:hidden">
            {table.rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => open(r)} className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left">
                  <span className="min-w-0">
                    <span className="block text-sm text-ink">
                      <span className="font-semibold">{r.location?.name ?? '—'}</span> {runName(r)}
                    </span>
                    <span className="block text-xs text-ink-muted">
                      {dayLabel(r.instance_date)} · {doneText(r)} done
                      {tab === 'rm_audit'
                        ? ` · ${rms?.get(r.location_id)?.name ? 'Waiting on ' : ''}${rmName(r)}`
                        : ` · ${completedText(r)}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-1">
                    {flagged(r) > 0
                      ? <span className="rounded-md bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">{flagged(r)} flagged</span>
                      : <span className="text-xs text-ink-subtle">Nothing flagged</span>}
                    {isLate(r) && <LateTag />}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {tab === 'archive' && !loading && archiveDays < 365 && (
        <p className="text-xs text-ink-muted">
          Showing checklists completed in the last {archiveDays} days.{' '}
          <button type="button" className="font-medium text-accent hover:underline" onClick={onMoreArchive}>Show the last year</button>
        </p>
      )}

      {bulkOpen && (
        <BulkComplete
          rows={cleanMine}
          onClose={() => setBulkOpen(false)}
          onDone={() => {
            setBulkOpen(false)
            onChanged()
          }}
        />
      )}
    </div>
  )
}

function BulkComplete({ rows, onClose, onDone }: { rows: ChecklistRun[]; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const go = async () => {
    setBusy(true)
    setError(null)
    const { error: err } = await checklistReview.completeClean(rows.map((r) => r.id))
    setBusy(false)
    if (err) return setError(friendlyError(err.message))
    onDone()
  }
  return (
    <Modal open onClose={onClose} title={`Complete ${rows.length} checklist${rows.length === 1 ? '' : 's'}?`} size="sm">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink">
          These {rows.length === 1 ? 'one has' : `${rows.length} have`} nothing flagged: every item was checked off and nobody left a comment.
          They move to Archive with you as the reviewer.
        </p>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void go()} disabled={busy}>{busy ? 'Completing…' : 'Complete'}</Button>
        </div>
      </div>
    </Modal>
  )
}
