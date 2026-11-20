import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, ClipboardCheck, FileText, MapPin, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { compareLocationName } from '@/lib/utils'
import { JsonView } from '@/components/data/JsonView'
import { AttachmentViewer } from '@/components/data/AttachmentViewer'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { siteAudits, siteAuditPhotos, customForms, attachments, type SiteAudit } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { buildAuditPdfInput, buildSiteAuditPdf, openPdfInNewTab, type AuditAttachment } from '@/lib/reports/siteAuditPdf'
import { loadPdfLogo } from '@/lib/pdfLogo'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'
import { answerPhotoPaths, reconstructAuditAnswers } from './siteAuditColumns'
import { DEFAULT_SITE_AUDIT_SCHEMA, type SiteAuditSchema } from './siteAuditSchema'

type Row = SiteAudit & { location: { name: string } | null }

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Initial observations', value: (r) => r.initial_observations },
  { header: 'Explanation', value: (r) => r.explanation },
  { header: 'Submitted by', value: (r) => r.submitted_by_name },
  { header: 'Date', value: (r) => shortDate(r.created_at) },
]

// Older audits (/app/site-audits/older): the audits taken on the earlier Site
// Audits form, Mar 9 to Nov 18, 2026. Read only since the graded audit replaced
// that form on 2026-11-20: they can be viewed and exported, not started,
// resumed, re-opened or edited. Their questions don't map onto the graded
// sections, so they stay as they were.
export default function OlderSiteAuditsPage() {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Row | null>(null)
  const [schema, setSchema] = useState<SiteAuditSchema>(DEFAULT_SITE_AUDIT_SCHEMA)
  const [siteFilter, setSiteFilter] = useState('all')
  const [search, setSearch] = useState('')

  useEffect(() => {
    void siteAudits.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
    void customForms.get('site_audit').then(({ data }) => {
      if (data?.schema) setSchema(data.schema as SiteAuditSchema)
    })
  }, [])

  // Admins (owners) can pick any site; everyone else sees their active site.
  const isAdmin = profile?.role === 'owner'
  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => compareLocationName(a.name, b.name)),
    [locations],
  )
  const effectiveSite = isAdmin ? siteFilter : (activeLocation?.id ?? 'all')

  const visibleRows = useMemo(() => {
    let r = rows
    if (effectiveSite !== 'all') r = r.filter((x) => x.location_id === effectiveSite)
    const q = search.trim().toLowerCase()
    if (q) {
      r = r.filter(
        (x) =>
          (x.location?.name ?? '').toLowerCase().includes(q) ||
          (x.submitted_by_name ?? '').toLowerCase().includes(q),
      )
    }
    return r
  }, [rows, effectiveSite, search])

  const table = useOpsTable(visibleRows, (r) => r.created_at)

  // PDF export per audit: photos are embedded below each line item, with the
  // Mighty Wash logo top-right (their brand, so only on their account).
  const isMightyWash = profile?.account_id === '54f3e299-1f61-4ed2-9921-3d02160b72e6'
  const [pdfBusyId, setPdfBusyId] = useState<string | null>(null)
  const openPdf = async (a: Row) => {
    setPdfBusyId(a.id)
    try {
      const { data: atts } = await attachments.allForEntity('audit', a.id)
      const logo = isMightyWash ? await loadPdfLogo('/mw-logo.png') : null
      const input = await buildAuditPdfInput(a, schema, (atts as AuditAttachment[] | null) ?? [], logo)
      openPdfInNewTab(await buildSiteAuditPdf(input))
    } catch (e) {
      window.alert('Could not build the PDF: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setPdfBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/app/site-audits" className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Site Audits
      </Link>
      <PageHeader
        title="Older audits"
        subtitle="Audits taken on the earlier form, before graded audits replaced it on Nov 20, 2026. Read only: view or export them here, and start new audits on Site Audits."
      />
      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" /> Site</span>
          {isAdmin ? (
            <Select
              value={siteFilter}
              onChange={(e) => setSiteFilter(e.target.value)}
              className="h-9 w-56"
              aria-label="Filter by site"
            >
              <option value="all">All sites</option>
              {sortedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          ) : (
            <Select value="locked" disabled className="h-9 w-56" aria-label="Site">
              <option value="locked">{activeLocation?.name ?? 'Current site'}</option>
            </Select>
          )}
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          <span className="inline-flex items-center gap-1"><Search className="size-3.5" /> Search</span>
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Site or submitter"
            className="h-9 w-56"
            aria-label="Search audits"
          />
        </label>
      </div>
      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf('Older Site Audits', EXPORT_COLUMNS, table.rows, { logoUrl: isMightyWash ? '/mw-logo.png' : null })}
        onExportExcel={() => exportExcel('older-site-audits', EXPORT_COLUMNS, table.rows)}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No older audits" description="Audits on the earlier form in this timeframe will appear here." />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden overflow-x-auto rounded-md border border-border bg-card sm:block">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Site</th>
                  <th className="px-3 py-2.5 font-medium">Submitted by</th>
                  <th className="px-3 py-2.5 font-medium">Date</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {table.rows.map((a) => (
                  <tr key={a.id} className="border-t border-border hover:bg-content">
                    <td className="px-3 py-2.5 font-medium text-ink">{a.location?.name ?? '—'}</td>
                    <td className="px-3 py-2.5 text-ink-muted">
                      {a.submitted_by_name ?? '—'}
                      <EditedNote audit={a} />
                    </td>
                    <td className="px-3 py-2.5 text-ink-muted">{shortDate(a.created_at)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setOpen(a)}>View</Button>
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

          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {table.rows.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card p-3">
                <button type="button" onClick={() => setOpen(a)} className="min-w-0 flex-1 text-left">
                  <p className="truncate font-medium text-ink">{a.location?.name ?? '—'}</p>
                  <p className="text-xs text-ink-muted">
                    {a.submitted_by_name ?? '—'} · {shortDate(a.created_at)}
                  </p>
                  <EditedNote audit={a} />
                </button>
                <Button variant="ghost" size="sm" disabled={pdfBusyId === a.id} onClick={() => void openPdf(a)}>
                  <FileText className="size-4" /> {pdfBusyId === a.id ? 'PDF…' : 'PDF'}
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <Modal open onClose={() => setOpen(null)} title={`Audit · ${open.location?.name ?? 'Site'}`} size="lg">
          <div className="flex flex-col gap-4">
            <EditedNote audit={open} />
            {open.initial_observations && <Section title="Initial observations"><p className="text-sm text-ink whitespace-pre-wrap">{open.initial_observations}</p></Section>}
            <Section title="Primary"><JsonView value={stripPhotos(open.primary_section)} /></Section>
            <Section title="Secondary"><JsonView value={stripPhotos(open.secondary_section)} /></Section>
            <Section title="Priority"><JsonView value={stripPhotos(open.priority_section)} /></Section>
            <Section title="Section comments"><JsonView value={stripPhotos(open.section_comments)} /></Section>
            <Section title="Final thoughts"><JsonView value={stripPhotos(open.final_thoughts)} /></Section>
            {open.explanation && <Section title="Explanation"><p className="text-sm text-ink whitespace-pre-wrap">{open.explanation}</p></Section>}
            <AuditPhotoStrip paths={auditPhotoPaths(schema, open)} />
            {/* Legacy audits kept photos as base64 in ops_attachments. */}
            <AttachmentViewer entityType="audit" entityId={open.id} />
          </div>
        </Modal>
      )}
    </div>
  )
}

function EditedNote({ audit }: { audit: Row }) {
  if (!audit.edited_at) return null
  return <p className="text-xs text-ink-muted">Edited by {audit.edited_by_name ?? 'an admin'} · {shortDate(audit.edited_at)}</p>
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">{title}</h3>
      {children}
    </section>
  )
}

// Strip photo storage paths from a section object so JsonView shows only the
// answer values, not raw file paths.
function stripPhotos(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripPhotos)
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'photos') continue
      out[k] = stripPhotos(val)
    }
    return out
  }
  return v
}

// Every storage photo path attached to an audit's items (storage-based audits).
function auditPhotoPaths(schema: SiteAuditSchema, audit: Row): string[] {
  return answerPhotoPaths(reconstructAuditAnswers(schema, audit))
}

function AuditPhotoStrip({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = paths.join('|')
  useEffect(() => {
    let alive = true
    for (const p of paths) siteAuditPhotos.signedUrl(p).then((u) => { if (alive && u) setUrls((prev) => ({ ...prev, [p]: u })) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  if (!paths.length) return null
  return (
    <Section title="Photos">
      <div className="flex flex-wrap gap-2">
        {paths.map((p) =>
          urls[p] ? (
            <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className="block size-20 overflow-hidden rounded-md border border-border">
              <img src={urls[p]} alt="Audit photo" className="size-full object-cover" />
            </a>
          ) : (
            <div key={p} className="size-20 animate-pulse rounded-md border border-border bg-content" />
          ),
        )}
      </div>
    </Section>
  )
}
