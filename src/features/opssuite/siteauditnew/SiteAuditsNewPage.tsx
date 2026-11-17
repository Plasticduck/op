import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ClipboardCheck, FileText, MapPin, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { compareLocationName } from '@/lib/utils'
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
import { AUDIT_SECTIONS, ITEM_COUNT, SECTION_POINTS, fmtPoints, gradeAudit, normalizeAnswers } from './form'
import { GradePill } from './parts'
import { AuditEditor } from './AuditEditor'
import { AuditReport } from './AuditReport'

const LIST = '/app/site-audits-new'

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

// Site Audit NEW: graded site audits (pre-launch, Kevan only). /app/site-audits-new
// lists them; /app/site-audits-new/:id is one audit, taken while it's a draft and
// read once it's submitted.
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
        action={<Link to={LIST} className="text-sm font-medium text-accent hover:underline">Back to Site Audit NEW</Link>}
      />
    )
  }
  if (audit.status === 'draft' && audit.auditor_id === profile?.id) {
    return <AuditEditor audit={audit} onSubmitted={() => void load()} />
  }
  return <AuditReport audit={audit} />
}

function AuditList() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations } = useLocations()
  const logoUrl = useBrandLogoUrl()
  const [rows, setRows] = useState<SiteAuditV2[]>([])
  const [drafts, setDrafts] = useState<SiteAuditV2[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [siteFilter, setSiteFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null)

  const sortedLocations = useMemo(() => [...locations].sort((a, b) => compareLocationName(a.name, b.name)), [locations])

  const uid = profile?.id
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

  const visible = useMemo(() => {
    let r = rows
    if (siteFilter !== 'all') r = r.filter((x) => x.location_id === siteFilter)
    const q = search.trim().toLowerCase()
    if (q) r = r.filter((x) => (x.location?.name ?? '').toLowerCase().includes(q) || (x.auditor_name ?? '').toLowerCase().includes(q))
    return r
  }, [rows, siteFilter, search])
  const table = useOpsTable(visible, (r) => r.submitted_at)

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
        title="Site Audit NEW"
        subtitle={`Graded audits: ${AUDIT_SECTIONS.length} sections worth ${fmtPoints(SECTION_POINTS)} points each. A red item fails its section, and a red Safety item fails the whole audit.`}
        actions={<Button onClick={() => setStarting(true)}><Plus className="size-4" /> Start audit</Button>}
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
            {sortedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><Search className="size-3.5" /> Search</span>
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Site or auditor" className="h-9 w-56" aria-label="Search audits" />
        </label>
      </div>
      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf('Site Audits', EXPORT_COLUMNS, table.rows, { logoUrl })}
        onExportExcel={() => exportExcel('site-audits', EXPORT_COLUMNS, table.rows)}
      />

      {loadError && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Could not load audits: {loadError}</p>}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No audits yet" description="Submitted audits show here with their score and grade." />
      ) : (
        <>
          <div className="hidden overflow-x-auto rounded-md border border-border bg-card sm:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5 font-medium">Auditor</th>
                  <th className="px-3 py-2.5 font-medium">Score</th>
                  <th className="px-3 py-2.5 font-medium">Grade</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((a) => (
                  <tr key={a.id} className="cursor-pointer border-t border-border hover:bg-content" onClick={() => navigate(`${LIST}/${a.id}`)}>
                    <td className="px-3 py-2.5 font-medium text-ink">{a.location?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{shortDate(a.submitted_at)}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{a.auditor_name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-ink">{scoreText(a)}</td>
                    <td className="px-3 py-2.5"><GradePill grade={a.grade} safetyFailed={a.safety_failed} /></td>
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
                    <span className="block truncate font-medium text-ink">{a.location?.name ?? '—'}</span>
                    <span className="block text-xs text-ink-muted">{scoreText(a)} · {shortDate(a.submitted_at)} · {a.auditor_name ?? '—'}</span>
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
