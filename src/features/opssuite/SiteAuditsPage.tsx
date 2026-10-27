import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardCheck, FileText, MapPin, Plus, Search } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { cn, compareLocationName } from '@/lib/utils'
import { JsonView } from '@/components/data/JsonView'
import { AttachmentViewer } from '@/components/data/AttachmentViewer'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { siteAudits, siteAuditPhotos, customForms, attachments, type SiteAudit } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { buildAuditPdfInput, buildSiteAuditPdf, openPdfInNewTab, reconstructAuditAnswers, type AuditAttachment } from '@/lib/reports/siteAuditPdf'
import { loadPdfLogo } from '@/lib/pdfLogo'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'
import SiteAuditForm from './SiteAuditForm'
import { SiteAuditBuilder } from './SiteAuditBuilder'
import {
  DEFAULT_SITE_AUDIT_SCHEMA,
  type SiteAuditAnswers,
  type SiteAuditSchema,
} from './siteAuditSchema'

type Row = SiteAudit & { location: { name: string } | null }

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Initial observations', value: (r) => r.initial_observations },
  { header: 'Explanation', value: (r) => r.explanation },
  { header: 'Submitted by', value: (r) => r.submitted_by_name },
  { header: 'Date', value: (r) => shortDate(r.created_at) },
]

export default function SiteAuditsPage() {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)
  const [drafts, setDrafts] = useState<Row[]>([])
  const [resuming, setResuming] = useState<Row | null>(null)
  const [schema, setSchema] = useState<SiteAuditSchema>(DEFAULT_SITE_AUDIT_SCHEMA)
  const [builderOpen, setBuilderOpen] = useState(false)
  const [siteFilter, setSiteFilter] = useState('all')
  const [search, setSearch] = useState('')

  const load = () =>
    siteAudits.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])

  // The current user's own in-progress drafts (resume later).
  const loadDrafts = () => {
    const uid = profile?.id
    if (!uid) { setDrafts([]); return }
    void siteAudits.listDrafts(uid).then(({ data }) => setDrafts((data as unknown as Row[]) ?? []))
  }
  useEffect(() => { loadDrafts() }, [profile?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const discardDraft = async (d: Row) => {
    if (!window.confirm('Discard this saved draft? This cannot be undone.')) return
    await siteAudits.removeDraft(d.id)
    loadDrafts()
  }
  useEffect(() => {
    void customForms.get('site_audit').then(({ data }) => {
      if (data?.schema) setSchema(data.schema as SiteAuditSchema)
    })
  }, [])

  // Admins (owners) can pick any site; everyone else is locked to their active
  // site, so a manager only ever sees the site they have selected.
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

  const canCustomize = profile?.role === 'owner' || profile?.role === 'manager'

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
      <PageHeader
        title="Site Audits"
        subtitle="Quality-check audits across all sites."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Submit audit</Button>}
      />
      <div className="flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
        <p className="text-ink"><span className="font-medium text-accent">Tip:</span> You can customize this form for your wash's needs.</p>
        {canCustomize && (
          <Button variant="secondary" size="sm" onClick={() => setBuilderOpen(true)}>Customize</Button>
        )}
      </div>
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
        onExportPdf={() => exportPdf('Site Audits', EXPORT_COLUMNS, table.rows, { logoUrl: isMightyWash ? '/mw-logo.png' : null })}
        onExportExcel={() => exportExcel('site-audits', EXPORT_COLUMNS, table.rows)}
      />

      {drafts.length > 0 && (
        <div className="rounded-md border border-warn/40 bg-warn-soft/50 p-3">
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-warn">
            <ClipboardCheck className="size-3.5" /> In progress — saved drafts
          </h3>
          <ul className="flex flex-col gap-2">
            {drafts.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{d.location?.name ?? 'Unassigned site'}</p>
                  <p className="text-xs text-ink-muted">Saved {d.updated_at ? shortDate(d.updated_at) : shortDate(d.created_at)}</p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" onClick={() => setResuming(d)}>Resume</Button>
                  <Button variant="ghost" size="sm" onClick={() => void discardDraft(d)}>Discard</Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={ClipboardCheck} title="No audits" description="Site audits in this timeframe will appear here." />
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
                    <td className="px-3 py-2.5 text-ink-muted">{a.submitted_by_name ?? '—'}</td>
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
      {(adding || resuming) && (
        <AddAudit
          accountId={profile?.account_id ?? ''}
          submitterId={profile?.id ?? null}
          submitterName={profile?.name ?? null}
          schema={schema}
          draft={resuming ? { id: resuming.id, locationId: resuming.location_id ?? '', answers: (resuming.draft_answers as unknown as SiteAuditAnswers) ?? {} } : null}
          onClose={() => { setAdding(false); setResuming(null); loadDrafts() }}
          onSaved={() => { setAdding(false); setResuming(null); void load(); loadDrafts() }}
        />
      )}
      {builderOpen && (
        <SiteAuditBuilder
          open
          onClose={() => setBuilderOpen(false)}
          onSaved={() => {
            setBuilderOpen(false)
            void customForms.get('site_audit').then(({ data }) => {
              if (data?.schema) setSchema(data.schema as SiteAuditSchema)
            })
          }}
        />
      )}
    </div>
  )
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

// Every storage photo path attached to an audit's items (new storage-based audits).
function auditPhotoPaths(schema: SiteAuditSchema, audit: Row): string[] {
  const answers = reconstructAuditAnswers(schema, audit)
  const paths: string[] = []
  for (const v of Object.values(answers)) {
    const ph = (v as { photos?: unknown } | null | undefined)?.photos
    if (Array.isArray(ph)) for (const p of ph) if (typeof p === 'string') paths.push(p)
  }
  return [...new Set(paths)]
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

const KNOWN_SECTION_IDS = new Set([
  'initial_observations',
  'primary',
  'secondary',
  'priority',
  'final_thoughts',
  'explanation',
  'attachments',
])

function sliceAnswers(schema: SiteAuditSchema, answers: SiteAuditAnswers, sectionId: string): SiteAuditAnswers {
  const section = schema.sections.find((s) => s.id === sectionId)
  if (!section) return {}
  const slice: SiteAuditAnswers = {}
  for (const item of section.items) {
    if (item.id in answers) slice[item.id] = answers[item.id]
  }
  return slice
}

function firstCommentsText(schema: SiteAuditSchema, answers: SiteAuditAnswers, sectionId: string): string | null {
  const section = schema.sections.find((s) => s.id === sectionId)
  if (!section) return null
  for (const item of section.items) {
    if (item.type === 'comments') {
      const ans = (answers[item.id] ?? {}) as Record<string, unknown>
      const v = ((ans.value as string | undefined) ?? '').trim()
      if (v) return v
    }
  }
  return null
}

function AddAudit({ accountId, submitterId, submitterName, schema, draft, onClose, onSaved }: {
  accountId: string
  submitterId: string | null
  submitterName: string | null
  schema: SiteAuditSchema
  // When set, we're resuming a saved draft (its id, site, and answers).
  draft?: { id: string; locationId: string; answers: SiteAuditAnswers } | null
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  // A local copy of an audit that hasn't got a site yet (so it can't be a server
  // draft): if the phone reloads the page, the next "New audit" picks it back up.
  const backupKey = `site-audit-backup:${submitterId ?? 'anon'}`
  const [restored] = useState<{ locationId: string; answers: SiteAuditAnswers } | null>(() => {
    if (draft) return null
    try {
      const b = JSON.parse(localStorage.getItem(backupKey) ?? 'null') as { locationId?: string; answers?: SiteAuditAnswers; draftRowId?: string | null; savedAt?: number } | null
      if (!b?.answers || b.draftRowId || Date.now() - (b.savedAt ?? 0) > 3 * 86_400_000 || !hasContent(b.answers)) return null
      return { locationId: b.locationId ?? '', answers: b.answers }
    } catch {
      return null
    }
  })
  const [locationId, setLocationId] = useState(draft?.locationId ?? restored?.locationId ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)

  // Autosave: every change is saved as the user's draft once a site is picked, so
  // a reloaded page (iOS does this after the camera) or an accidental close never
  // loses answers or photos. The draft is resumed from the "In progress" list and
  // removed when the audit is submitted.
  const draftRowId = useRef<string | null>(draft?.id ?? null)
  const latest = useRef<SiteAuditAnswers | null>(draft?.answers ?? restored?.answers ?? null)
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  // Set while submitting, so a late autosave can't recreate the draft after it.
  const submitted = useRef(false)
  const [tick, setTick] = useState(0)
  const [autoState, setAutoState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')

  const persist = useCallback((): Promise<boolean> => {
    const run = async () => {
      const answers = latest.current
      if (!answers || submitted.current) return true
      try {
        localStorage.setItem(backupKey, JSON.stringify({ locationId, answers, draftRowId: draftRowId.current, savedAt: Date.now() }))
      } catch { /* storage full or blocked */ }
      if (!locationId) return true
      setAutoState('saving')
      const base = {
        account_id: accountId,
        location_id: locationId,
        submitted_by: submitterId,
        submitted_by_name: submitterName,
        draft_answers: answers as never,
      }
      const res = draftRowId.current
        ? await siteAudits.updateDraft(draftRowId.current, base)
        : await siteAudits.saveDraft(base)
      if (res.error) { setAutoState('error'); return false }
      if (!draftRowId.current) draftRowId.current = (res.data as { id: string }).id
      try {
        localStorage.setItem(backupKey, JSON.stringify({ locationId, answers, draftRowId: draftRowId.current, savedAt: Date.now() }))
      } catch { /* ignore */ }
      setAutoState('saved')
      return true
    }
    // One save at a time, so the first save's new draft id is used by the next.
    const p = chain.current.then(run, run)
    chain.current = p
    return p
  }, [accountId, backupKey, locationId, submitterId, submitterName])

  useEffect(() => {
    if (!tick) return
    const t = setTimeout(() => { void persist() }, 1200)
    return () => clearTimeout(t)
  }, [tick, persist])

  const clearBackup = () => {
    try { localStorage.removeItem(backupKey) } catch { /* ignore */ }
  }

  // Save the in-progress answers as a draft and close, so it can be resumed later.
  const saveDraft = async (answers: SiteAuditAnswers) => {
    setError(null)
    if (!locationId) { setError('Pick a site first, then save your progress.'); return }
    setSavingDraft(true)
    latest.current = answers
    const ok = await persist()
    setSavingDraft(false)
    if (!ok) { setError('Could not save your progress. Check your connection and try again.'); return }
    clearBackup()
    onSaved()
  }

  // Closing keeps the autosaved draft. Only an audit with no site yet (which
  // can't be saved as a draft) asks before it's thrown away.
  const requestClose = async () => {
    if (latest.current && hasContent(latest.current)) {
      if (!locationId) {
        if (!window.confirm('Close this audit? Pick a site to keep it as a draft, otherwise it will be lost.')) return
        clearBackup()
      } else if (await persist()) {
        clearBackup()
      }
    }
    onClose()
  }

  const save = async (answers: SiteAuditAnswers) => {
    setError(null)
    if (!locationId) {
      setError('Pick a site')
      return
    }

    const initialObservations = firstCommentsText(schema, answers, 'initial_observations')
    const explanationText = firstCommentsText(schema, answers, 'explanation')

    const extraComments: SiteAuditAnswers = {}
    for (const section of schema.sections) {
      if (KNOWN_SECTION_IDS.has(section.id)) continue
      const slice = sliceAnswers(schema, answers, section.id)
      if (Object.keys(slice).length > 0) extraComments[section.id] = slice
    }

    // Initial Observations carries scored items (e.g. Dress Code) alongside its
    // curb-appeal comments; the comments text goes to its own column, so persist
    // the scored items in section_comments too so they round-trip into the PDF.
    const initialObsSection = schema.sections.find((s) => s.id === 'initial_observations')
    if (initialObsSection) {
      const scored = sliceAnswers(schema, answers, 'initial_observations')
      for (const it of initialObsSection.items) if (it.type === 'comments') delete scored[it.id]
      if (Object.keys(scored).length > 0) extraComments['initial_observations'] = scored
    }

    // Photos are already uploaded to storage while filling the form; their paths
    // ride along on each item's answer through sliceAnswers into the columns.
    setBusy(true)
    const { data, error: err } = await siteAudits.create({
      account_id: accountId,
      location_id: locationId,
      initial_observations: initialObservations,
      primary_section: sliceAnswers(schema, answers, 'primary') as never,
      secondary_section: sliceAnswers(schema, answers, 'secondary') as never,
      priority_section: sliceAnswers(schema, answers, 'priority') as never,
      final_thoughts: sliceAnswers(schema, answers, 'final_thoughts') as never,
      section_comments: (Object.keys(extraComments).length > 0 ? extraComments : null) as never,
      explanation: explanationText,
      submitted_by: submitterId,
      submitted_by_name: submitterName,
    })
    if (err) {
      setBusy(false)
      setError(err.message)
      return
    }

    // Email the audit PDF to leadership, the site, and its RM (best-effort; a
    // delivery failure never blocks the save).
    const auditId = (data as { id?: string } | null)?.id
    if (auditId) void siteAudits.emailReport(auditId)

    // The autosaved (or resumed) draft is done with now that the audit is submitted.
    submitted.current = true
    await chain.current.catch(() => undefined)
    if (draftRowId.current) void siteAudits.removeDraft(draftRowId.current)
    clearBackup()

    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={() => void requestClose()} title={draft ? 'Resume site audit' : 'Submit site audit'} size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => { setLocationId(e.target.value); if (latest.current) setTick((t) => t + 1) }}>
              <option value="">Select…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>

        <p className={cn('-mt-2 text-xs', autoState === 'error' ? 'text-danger' : 'text-ink-muted')}>
          {autoState === 'saving' ? 'Saving…'
            : autoState === 'saved' ? 'Progress saved. If you leave, finish it from In progress.'
            : autoState === 'error' ? 'Couldn’t save progress. Check your connection.'
            : locationId ? 'Your progress saves automatically, photos included.'
            : 'Pick the site first so your progress saves automatically.'}
        </p>
        {restored && (
          <p className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">We restored the audit you were working on.</p>
        )}

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <SiteAuditForm
          accountId={accountId}
          schema={schema}
          initialAnswers={draft?.answers ?? restored?.answers}
          onSubmit={save}
          onSaveDraft={saveDraft}
          onAnswersChange={(a) => { latest.current = a; setTick((t) => t + 1) }}
          submitting={busy}
          savingDraft={savingDraft}
        />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={() => void requestClose()}>Close</Button>
        </div>
      </div>
    </Modal>
  )
}

// Whether any item has an answer or a photo (an empty form isn't worth keeping).
function hasContent(answers: SiteAuditAnswers): boolean {
  return Object.values(answers).some((v) => {
    const a = (v ?? {}) as { value?: unknown; photos?: unknown }
    return (a.value != null && a.value !== '') || (Array.isArray(a.photos) && a.photos.length > 0)
  })
}
