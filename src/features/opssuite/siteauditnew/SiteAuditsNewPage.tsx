import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Archive, CheckCircle2, ClipboardCheck, FileText, MapPin, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn, compareLocationName } from '@/lib/utils'
import { dateTime, shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { useBrandLogoUrl } from '@/lib/brandLogo'
import { loadPdfLogo } from '@/lib/pdfLogo'
import { siteAuditsV2, type SiteAuditV2 } from '@/lib/queries/siteAuditsV2'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { openPdfInNewTab } from '@/lib/reports/siteReviewPdf'
import { OpsToolbar } from '../OpsToolbar'
import { useOpsTable } from '../useOpsTable'
import { AUDIT_SECTIONS, ITEM_COUNT, SECTION_POINTS, fmtPoints, gradeAudit, normalizeAnswers, redItems, rmShort } from './form'
import { GradePill, ReviewPill } from './parts'
import { AuditEditor } from './AuditEditor'
import { AuditReport } from './AuditReport'
import { useSiteRms } from './useSiteRms'

const LIST = '/app/site-audits'

const scoreText = (a: SiteAuditV2) =>
  a.safety_failed ? 'Failed (Safety)' : a.score != null ? `${fmtPoints(Number(a.score))} / 100` : '—'

const EXPORT_COLUMNS: ExportColumn<SiteAuditV2>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Date', value: (r) => shortDate(r.submitted_at) },
  { header: 'Auditor', value: (r) => r.auditor_name },
  { header: 'Score', value: (r) => scoreText(r) },
  { header: 'Grade', value: (r) => r.grade },
  { header: 'Failed sections', value: (r) => (r.failed_sections ?? []).join(', ') },
]

// Site Audits: graded site audits. /app/site-audits lists them; /app/site-audits/:id
// is one audit, taken while it's a draft and read once it's submitted. Every
// submitted audit waits in Needs Attention until the site's Regional Manager (or an
// Admin) acknowledges it, then moves to Complete. It replaced the earlier form on
// 2026-11-20; those audits are read only at /app/site-audits/older.
export default function SiteAuditsNewPage() {
  const { id } = useParams<{ id?: string }>()
  return id ? <AuditDetail key={id} id={id} /> : <AuditList />
}

function AuditDetail({ id }: { id: string }) {
  const { profile } = useAuth()
  const [audit, setAudit] = useState<SiteAuditV2 | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')

  const load = useCallback(async () => {
    const { data, error } = await siteAuditsV2.get(id)
    if (error || !data) {
      setState('missing')
      return
    }
    setAudit(data)
    setState('ready')
  }, [id])
  useEffect(() => { void load() }, [load])

  if (state === 'loading') return <p className="text-sm text-ink-muted">Loading…</p>
  if (state === 'missing' || !audit) {
    return (
      <EmptyState
        icon={ClipboardCheck}
        title="This audit isn't available"
        description="It may have been deleted, or it's another person's draft."
        action={<Link to={LIST} className="text-sm font-medium text-accent hover:underline">Back to Site Audits</Link>}
      />
    )
  }
  if (audit.status === 'draft' && audit.auditor_id === profile?.id) {
    return <AuditEditor audit={audit} onSubmitted={() => void load()} />
  }
  return <AuditReport audit={audit} onChanged={() => void load()} />
}

type TabKey = 'history' | 'needs_attention' | 'complete'
// `short` keeps the three tabs on one line on a phone.
const TABS: { key: TabKey; label: string; short?: string }[] = [
  { key: 'history', label: 'Audit History', short: 'History' },
  { key: 'needs_attention', label: 'Needs Attention' },
  { key: 'complete', label: 'Complete' },
]
const isTab = (v: string | null): v is TabKey => TABS.some((t) => t.key === v)
const EMPTY: Record<TabKey, { title: string; description: string }> = {
  history: { title: 'No audits yet', description: 'Every submitted audit shows here with its score, grade and where it is.' },
  needs_attention: { title: 'Nothing needs attention', description: "Every submitted audit waits here until the site's Regional Manager acknowledges it, answering each red item if there are any." },
  complete: { title: 'No completed audits yet', description: 'Audits land here once the Regional Manager (or an Admin, for a site without one) marks them complete.' },
}
type Col = { header: string; cell: (a: SiteAuditV2) => ReactNode; className?: string }

const redCount = (a: SiteAuditV2) => redItems(normalizeAnswers(a.answers)).length
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)) : 0)
const daysText = (n: number) => (n === 0 ? 'Today' : `${n} day${n === 1 ? '' : 's'}`)
const completedText = (a: SiteAuditV2) =>
  a.completed_by_name ? `${a.completed_by_name} (${a.completed_role === 'admin' ? 'Admin' : 'RM'})` : 'No red items'

function AuditList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations } = useLocations()
  const logoUrl = useBrandLogoUrl()
  const rms = useSiteRms()
  const [params, setParams] = useSearchParams()
  // A Regional Manager opens on Needs Attention at their own sites.
  const uid = profile?.id
  const mySites = useMemo(
    () => new Set(rms ? [...rms].filter(([, r]) => !!r.user_id && r.user_id === uid).map(([loc]) => loc) : []),
    [rms, uid],
  )
  const isRm = mySites.size > 0
  const tab: TabKey = isTab(params.get('tab')) ? (params.get('tab') as TabKey) : isRm ? 'needs_attention' : 'history'
  const setTab = (t: TabKey) => setParams((p) => { p.set('tab', t); return p }, { replace: true })
  const [rows, setRows] = useState<SiteAuditV2[]>([])
  const [drafts, setDrafts] = useState<SiteAuditV2[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [siteChoice, setSiteFilter] = useState<string | null>(null)
  const siteFilter = siteChoice ?? (isRm ? 'mine' : 'all')
  const [search, setSearch] = useState('')
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null)

  const sortedLocations = useMemo(() => [...locations].sort((a, b) => compareLocationName(a.name, b.name)), [locations])

  const load = useCallback(async () => {
    const [done, mine] = await Promise.all([
      siteAuditsV2.listSubmitted(),
      uid ? siteAuditsV2.listMyDrafts(uid) : Promise.resolve({ data: [], error: null }),
    ])
    setLoadError(done.error?.message ?? mine.error?.message ?? null)
    setRows(done.data ?? [])
    setDrafts(mine.data ?? [])
    setLoading(false)
  }, [uid])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    let r = rows
    if (siteFilter === 'mine') r = r.filter((x) => mySites.has(x.location_id))
    else if (siteFilter !== 'all') r = r.filter((x) => x.location_id === siteFilter)
    const q = search.trim().toLowerCase()
    if (q) {
      r = r.filter((x) =>
        (x.location?.name ?? '').toLowerCase().includes(q)
        || (x.auditor_name ?? '').toLowerCase().includes(q)
        || (rms?.get(x.location_id)?.name ?? '').toLowerCase().includes(q))
    }
    return r
  }, [rows, siteFilter, search, rms, mySites])
  const counts: Record<TabKey, number> = useMemo(() => ({
    history: filtered.length,
    needs_attention: filtered.filter((a) => a.review_status === 'needs_attention').length,
    complete: filtered.filter((a) => a.review_status === 'complete').length,
  }), [filtered])
  const visible = useMemo(() => (tab === 'history' ? filtered : filtered.filter((a) => a.review_status === tab)), [filtered, tab])
  const table = useOpsTable(visible, (r) => (tab === 'complete' ? r.completed_at ?? r.submitted_at : r.submitted_at))

  const rmName = (a: SiteAuditV2) => (rms ? rmShort(rms.get(a.location_id)) : '…')
  const exportColumns: ExportColumn<SiteAuditV2>[] = [
    ...EXPORT_COLUMNS,
    { header: 'Status', value: (r) => (r.review_status === 'needs_attention' ? 'Needs attention' : 'Complete') },
    { header: 'Red items', value: (r) => redCount(r) },
    { header: tab === 'complete' ? 'Completed by' : 'Regional Manager', value: (r) => (r.review_status === 'complete' ? completedText(r) : rmName(r)) },
    { header: 'Completed', value: (r) => (r.completed_at ? shortDate(r.completed_at) : '') },
  ]
  const tabTitle = TABS.find((t) => t.key === tab)?.label ?? 'Site Audits'

  const site: Col = { header: 'Site', cell: (a) => a.location?.name ?? '—', className: 'font-medium text-ink' }
  const submitted: Col = { header: 'Submitted', cell: (a) => shortDate(a.submitted_at) }
  const grade: Col = { header: 'Grade', cell: (a) => <GradePill grade={a.grade} safetyFailed={a.safety_failed} />, className: '' }
  const columns: Col[] = tab === 'needs_attention'
    ? [
        site, submitted, grade,
        { header: 'Red items', cell: (a) => <span className={redCount(a) ? 'font-semibold text-danger' : 'text-ink-muted'}>{redCount(a)}</span>, className: '' },
        { header: 'Waiting on', cell: rmName, className: 'text-ink' },
        { header: 'Open', cell: (a) => daysText(daysSince(a.submitted_at)) },
      ]
    : tab === 'complete'
      ? [
          site, submitted, grade,
          { header: 'Completed by', cell: completedText, className: 'text-ink' },
          { header: 'Completed', cell: (a) => shortDate(a.completed_at ?? a.submitted_at) },
        ]
      : [
          site,
          { header: 'Date', cell: (a) => shortDate(a.submitted_at) },
          { header: 'Auditor', cell: (a) => a.auditor_name ?? '—' },
          { header: 'Score', cell: scoreText, className: 'text-ink' },
          grade,
          { header: 'Status', cell: (a) => <ReviewPill status={a.review_status} />, className: '' },
        ]
  const mobileLine = (a: SiteAuditV2) =>
    tab === 'needs_attention'
      ? `${redCount(a) ? `${redCount(a)} red` : 'No red'} · ${rms?.get(a.location_id)?.name ? 'Waiting on ' : ''}${rmName(a)} · ${daysText(daysSince(a.submitted_at))}`
      : tab === 'complete'
        ? `${completedText(a)} · ${shortDate(a.completed_at ?? a.submitted_at)}`
        : `${scoreText(a)} · ${shortDate(a.submitted_at)} · ${a.auditor_name ?? '—'}`

  const discard = async (d: SiteAuditV2) => {
    if (!window.confirm('Discard this audit? Its answers and photos will be deleted.')) return
    const { error } = await siteAuditsV2.remove(d.id)
    if (error) {
      window.alert('Could not discard the audit: ' + error.message)
      return
    }
    void siteAuditsV2.removePhotos(Object.values(normalizeAnswers(d.answers)).flatMap((a) => a.photos))
    void load()
  }

  const openPdf = async (a: SiteAuditV2) => {
    setPdfBusyId(a.id)
    try {
      const { buildSiteAuditNewPdf } = await import('@/lib/reports/siteAuditNewPdf')
      const logo = logoUrl ? await loadPdfLogo(logoUrl, { maxPx: 400 }) : null
      openPdfInNewTab(await buildSiteAuditNewPdf(a, logo))
    } catch (e) {
      window.alert('Could not build the PDF: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setPdfBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Site Audits"
        subtitle={`Graded audits: ${AUDIT_SECTIONS.length} sections worth ${fmtPoints(SECTION_POINTS)} points each. A red item fails its section, and a red Safety item fails the whole audit. Each one waits for the site's Regional Manager to acknowledge it.`}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Link to={`${LIST}/older`} className="inline-flex h-9 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-ink hover:bg-content">
              <Archive className="size-4" /> Older audits
            </Link>
            <Button onClick={() => setStarting(true)}><Plus className="size-4" /> Start audit</Button>
          </div>
        }
      />

      {drafts.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn-soft/50 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warn">
            <ClipboardCheck className="size-3.5" /> In progress
          </h3>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => {
              const r = gradeAudit(normalizeAnswers(d.answers))
              return (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">{d.location?.name ?? 'Site'}</p>
                    <p className="text-xs text-ink-muted">{r.rated} of {ITEM_COUNT} rated · Saved {dateTime(d.updated_at)}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button size="sm" onClick={() => navigate(`${LIST}/${d.id}`)}>Resume</Button>
                    <Button variant="ghost" size="sm" onClick={() => void discard(d)}>Discard</Button>
                  </div>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> Site</span>
          <Select value={siteFilter} onChange={(e) => setSiteFilter(e.target.value)} className="h-9 w-56" aria-label="Filter by site">
            <option value="all">All sites</option>
            {isRm && <option value="mine">My sites</option>}
            {sortedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><Search className="size-3.5" /> Search</span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Site, auditor or RM" className="h-9 w-56" aria-label="Search audits" />
        </label>
      </div>

      <div role="tablist" aria-label="Audit status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border sm:gap-x-6">
        {TABS.map((t) => {
          const active = t.key === tab
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              aria-label={`${t.label} (${counts[t.key]})`}
              onClick={() => setTab(t.key)}
              className={cn(
                '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 pb-2 pt-1 text-sm font-medium transition',
                active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {t.short ? <><span className="sm:hidden">{t.short}</span><span className="hidden sm:inline">{t.label}</span></> : t.label}
              <span
                className={cn(
                  'inline-flex min-w-5 items-center justify-center rounded-full px-1.5 text-xs font-semibold',
                  t.key === 'needs_attention' && counts[t.key] > 0 ? 'bg-danger text-white'
                    : active ? 'bg-accent text-white' : 'bg-ink/10 text-ink-muted',
                )}
              >
                {counts[t.key]}
              </span>
            </button>
          )
        })}
      </div>

      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf(`Site Audits: ${tabTitle}`, exportColumns, table.rows, { logoUrl })}
        onExportExcel={() => exportExcel(`site-audits-${tab.replace('_', '-')}`, exportColumns, table.rows)}
      />

      {loadError && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Could not load audits: {loadError}</p>}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={tab === 'complete' ? CheckCircle2 : ClipboardCheck} title={EMPTY[tab].title} description={EMPTY[tab].description} />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-md border border-border bg-card sm:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  {columns.map((c) => <th key={c.header} className="px-3 py-2.5 font-medium">{c.header}</th>)}
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((a) => (
                  <tr key={a.id} className="cursor-pointer border-t border-border hover:bg-content" onClick={() => navigate(`${LIST}/${a.id}`)}>
                    {columns.map((c) => <td key={c.header} className={cn('px-3 py-2.5', c.className ?? 'text-ink-muted')}>{c.cell(a)}</td>)}
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                        <Button variant="ghost" size="sm" onClick={() => navigate(`${LIST}/${a.id}`)}>View</Button>
                        <Button variant="ghost" size="sm" disabled={pdfBusyId === a.id} onClick={() => void openPdf(a)}>
                          <FileText className="size-4" /> {pdfBusyId === a.id ? 'PDF…' : 'PDF'}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-2 sm:hidden">
            {table.rows.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
                <button type="button" onClick={() => navigate(`${LIST}/${a.id}`)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                  <GradePill grade={a.grade} safetyFailed={a.safety_failed} />
                  <span className="min-w-0">
                    <span className="flex items-center gap-2">
                      <span className="truncate font-medium text-ink">{a.location?.name ?? '—'}</span>
                      {tab === 'history' && <ReviewPill status={a.review_status} />}
                    </span>
                    <span className="block text-xs text-ink-muted">{mobileLine(a)}</span>
                  </span>
                </button>
                <Button variant="ghost" size="sm" disabled={pdfBusyId === a.id} onClick={() => void openPdf(a)} aria-label="PDF">
                  <FileText className="size-4" />
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {starting && <StartAudit onClose={() => setStarting(false)} />}
    </div>
  )
}

// Pick the site, and the audit is saved as a draft from then on.
function StartAudit({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const sorted = useMemo(() => [...locations].sort((a, b) => compareLocationName(a.name, b.name)), [locations])
  const [locationId, setLocationId] = useState(activeLocation?.id ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const start = async () => {
    if (!profile || !locationId) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await siteAuditsV2.start({
      account_id: profile.account_id,
      location_id: locationId,
      auditor_id: profile.id,
      auditor_name: profile.name,
    })
    if (err || !data) {
      setBusy(false)
      setError('Could not start the audit: ' + (err?.message ?? 'unknown error'))
      return
    }
    navigate(`${LIST}/${data.id}`)
  }

  return (
    <Modal open onClose={onClose} title="Start a site audit" size="sm">
      <div className="flex flex-col gap-4">
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Select…</option>
              {sorted.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <p className="text-xs text-ink-muted">The audit saves as you go, photos included. If you leave, finish it from In progress.</p>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!locationId || busy} onClick={() => void start()}>{busy ? 'Starting…' : 'Start audit'}</Button>
        </div>
      </div>
    </Modal>
  )
}
