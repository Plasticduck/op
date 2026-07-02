import { useEffect, useState } from 'react'
import { ClipboardCheck, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { JsonView } from '@/components/data/JsonView'
import { AttachmentViewer } from '@/components/data/AttachmentViewer'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { siteAudits, customForms, type SiteAudit } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'
import SiteAuditForm, { type SiteAuditPhotos } from './SiteAuditForm'
import { SiteAuditBuilder } from './SiteAuditBuilder'
import {
  DEFAULT_SITE_AUDIT_SCHEMA,
  type SiteAuditAnswers,
  type SiteAuditSchema,
} from './siteAuditSchema'

type Row = SiteAudit & { location: { name: string } | null }

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Initial observations', value: (r) => r.initial_observations },
  { header: 'Explanation', value: (r) => r.explanation },
  { header: 'Submitted by', value: (r) => r.submitted_by_name },
  { header: 'Date', value: (r) => shortDate(r.created_at) },
]

export default function SiteAuditsPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)
  const [schema, setSchema] = useState<SiteAuditSchema>(DEFAULT_SITE_AUDIT_SCHEMA)
  const [builderOpen, setBuilderOpen] = useState(false)

  const load = () =>
    siteAudits.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])
  useEffect(() => {
    void customForms.get('site_audit').then(({ data }) => {
      if (data?.schema) setSchema(data.schema as SiteAuditSchema)
    })
  }, [])
  const table = useOpsTable(rows, (r) => r.created_at)

  const canCustomize = profile?.role === 'owner' || profile?.role === 'manager'

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
      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf('Site Audits', EXPORT_COLUMNS, table.rows)}
        onExportExcel={() => exportExcel('site-audits', EXPORT_COLUMNS, table.rows)}
      />
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
                      <Button variant="ghost" size="sm" onClick={() => setOpen(a)}>View</Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <ul className="flex flex-col gap-2 sm:hidden">
            {table.rows.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  onClick={() => setOpen(a)}
                  className="flex w-full items-center justify-between gap-3 rounded-md border border-border bg-card p-3 text-left"
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium text-ink">{a.location?.name ?? '—'}</p>
                    <p className="text-xs text-ink-muted">
                      {a.submitted_by_name ?? '—'} · {shortDate(a.created_at)}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-accent">View</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {open && (
        <Modal open onClose={() => setOpen(null)} title={`Audit · ${open.location?.name ?? 'Site'}`} size="lg">
          <div className="flex flex-col gap-4">
            {open.initial_observations && <Section title="Initial observations"><p className="text-sm text-ink whitespace-pre-wrap">{open.initial_observations}</p></Section>}
            <Section title="Primary"><JsonView value={open.primary_section} /></Section>
            <Section title="Secondary"><JsonView value={open.secondary_section} /></Section>
            <Section title="Priority"><JsonView value={open.priority_section} /></Section>
            <Section title="Section comments"><JsonView value={open.section_comments} /></Section>
            <Section title="Final thoughts"><JsonView value={open.final_thoughts} /></Section>
            {open.explanation && <Section title="Explanation"><p className="text-sm text-ink whitespace-pre-wrap">{open.explanation}</p></Section>}
            <AttachmentViewer entityType="audit" entityId={open.id} />
          </div>
        </Modal>
      )}
      {adding && (
        <AddAudit
          accountId={profile?.account_id ?? ''}
          submitterId={profile?.id ?? null}
          submitterName={profile?.name ?? null}
          schema={schema}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load() }}
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

function AddAudit({ accountId, submitterId, submitterName, schema, onClose, onSaved }: {
  accountId: string
  submitterId: string | null
  submitterName: string | null
  schema: SiteAuditSchema
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (answers: SiteAuditAnswers, photos: SiteAuditPhotos) => {
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

    // Upload each item's staged photos, tagged with the item id (label).
    const auditId = (data as { id?: string } | null)?.id
    if (auditId) {
      for (const [itemId, files] of Object.entries(photos)) {
        for (const file of files) {
          const dataUri = await fileToDataUri(file)
          const { error: upErr } = await supabase.from('ops_attachments').insert({
            account_id: accountId,
            entity_type: 'audit',
            entity_id: auditId,
            label: itemId,
            file_name: file.name,
            file_type: file.type,
            data_uri: dataUri,
          })
          if (upErr) {
            setBusy(false)
            setError(upErr.message)
            return
          }
        }
      }
    }

    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Submit site audit" size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Select…</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <SiteAuditForm schema={schema} onSubmit={save} submitting={busy} />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
