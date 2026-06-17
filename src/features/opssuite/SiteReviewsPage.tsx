import { useEffect, useState } from 'react'
import { ClipboardList, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { TimeSelect } from '@/components/forms/TimeSelect'
import { EmptyState } from '@/components/ui/EmptyState'
import { JsonView } from '@/components/data/JsonView'
import { AttachmentViewer } from '@/components/data/AttachmentViewer'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { siteEvaluations, customForms, type SiteEvaluation } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'
import SiteReviewForm from './SiteReviewForm'
import { SiteReviewBuilder } from './SiteReviewBuilder'
import {
  DEFAULT_SITE_REVIEW_SCHEMA,
  type SiteReviewSchema,
  type SiteReviewAnswers,
} from './siteReviewSchema'
import { buildSiteReviewPdf, openPdfInNewTab, downloadBlob } from '@/lib/reports/siteReviewPdf'

type Row = SiteEvaluation & { location: { name: string } | null }

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Result', value: (r) => r.result },
  { header: 'Notes', value: (r) => r.additional_notes },
  { header: 'Follow-up', value: (r) => r.follow_up_instructions },
  { header: 'Submitted by', value: (r) => r.submitted_by_name },
  { header: 'Date', value: (r) => shortDate(r.submitted_at) },
]

function filenameSafeDate(iso: string | null | undefined): string {
  if (!iso) return 'review'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return 'review'
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

export default function SiteReviewsPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState<Row | null>(null)
  const [adding, setAdding] = useState(false)
  const [schema, setSchema] = useState<SiteReviewSchema>(DEFAULT_SITE_REVIEW_SCHEMA)
  const [builderOpen, setBuilderOpen] = useState(false)

  const load = () =>
    siteEvaluations.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])
  useEffect(() => {
    void customForms.get('site_review').then(({ data }) => {
      if (data?.schema) setSchema(data.schema as SiteReviewSchema)
    })
  }, [])
  const table = useOpsTable(rows, (r) => r.submitted_at)

  const canCustomize = profile?.role === 'owner' || profile?.role === 'manager'

  const openReport = async (row: Row) => {
    const blob = await buildSiteReviewPdf({
      title: 'Monthly Site Review',
      siteName: row.location?.name ?? null,
      date: row.submitted_at,
      weather: null,
      timeArrived: null,
      schema,
      answers: (row.answers ?? {}) as SiteReviewAnswers,
      summaryText: row.additional_notes,
      submitterName: row.submitted_by_name,
    })
    openPdfInNewTab(blob)
  }

  const downloadReport = async (row: Row) => {
    const blob = await buildSiteReviewPdf({
      title: 'Monthly Site Review',
      siteName: row.location?.name ?? null,
      date: row.submitted_at,
      weather: null,
      timeArrived: null,
      schema,
      answers: (row.answers ?? {}) as SiteReviewAnswers,
      summaryText: row.additional_notes,
      submitterName: row.submitted_by_name,
    })
    downloadBlob(blob, `site-review-${filenameSafeDate(row.submitted_at)}.pdf`)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Monthly Site Reviews"
        subtitle="Pass/fail site reviews across all sites."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Submit review</Button>}
      />
      <div className="flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
        <p className="text-ink"><span className="font-medium text-accent">Tip:</span> You can customize this form for your wash's needs.</p>
        {canCustomize && (
          <Button variant="secondary" size="sm" onClick={() => setBuilderOpen(true)}>Customize</Button>
        )}
      </div>
      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf('Monthly Site Reviews', EXPORT_COLUMNS, table.rows)}
        onExportExcel={() => exportExcel('site-reviews', EXPORT_COLUMNS, table.rows)}
      />
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No site reviews" description="Monthly site reviews in this timeframe will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Result</th>
                <th className="px-3 py-2.5 font-medium">Submitted by</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((e) => (
                <tr key={e.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{e.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {e.result ? <Badge tone={/pass/i.test(e.result) ? 'ok' : 'danger'}>{e.result}</Badge> : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{e.submitted_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(e.submitted_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setOpen(e)}>View</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal open onClose={() => setOpen(null)} title={`Review · ${open.location?.name ?? 'Site'}`} size="lg">
          <ReviewDetail row={open} schema={schema} onView={() => void openReport(open)} onDownload={() => void downloadReport(open)} />
        </Modal>
      )}
      {adding && (
        <AddReview
          accountId={profile?.account_id ?? ''}
          submitterId={profile?.id ?? null}
          submitterName={profile?.name ?? null}
          schema={schema}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load() }}
        />
      )}
      {builderOpen && (
        <SiteReviewBuilder
          open
          onClose={() => setBuilderOpen(false)}
          onSaved={() => {
            setBuilderOpen(false)
            void customForms.get('site_review').then(({ data }) => {
              if (data?.schema) setSchema(data.schema as SiteReviewSchema)
            })
          }}
        />
      )}
    </div>
  )
}

function ReviewDetail({ row, schema, onView, onDownload }: {
  row: Row
  schema: SiteReviewSchema
  onView: () => void
  onDownload: () => void
}) {
  const answers = (row.answers ?? {}) as SiteReviewAnswers
  const knownIds = new Set<string>()
  for (const section of schema.sections) {
    for (const item of section.items) knownIds.add(item.id)
  }
  const extraEntries = Object.entries(answers).filter(([k]) => !knownIds.has(k))
  const extras: SiteReviewAnswers = {}
  for (const [k, v] of extraEntries) extras[k] = v

  return (
    <div className="flex flex-col gap-4">
      {schema.sections.map((section) => {
        const tableItems = section.items.filter((it) => it.type !== 'attachment')
        if (tableItems.length === 0) return null
        return (
          <section key={section.id}>
            <h3 className="mb-2 text-sm font-semibold text-ink">{section.title}</h3>
            <div className="overflow-x-auto rounded-md border border-border bg-card">
              <table className="w-full text-sm">
                <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-3 py-2 font-medium">Item</th>
                    <th className="px-3 py-2 font-medium">Pass/Fail</th>
                    <th className="px-3 py-2 font-medium">Comments</th>
                  </tr>
                </thead>
                <tbody>
                  {tableItems.map((item) => {
                    const ans = (answers[item.id] ?? {}) as Record<string, unknown>
                    if (item.type === 'pass_fail') {
                      const v = ans.value as 'pass' | 'fail' | null | undefined
                      const comments = (ans.comments as string | undefined)?.trim() || ''
                      return (
                        <tr key={item.id} className="border-t border-border align-top">
                          <td className="px-3 py-2 text-ink">{item.label}</td>
                          <td className="px-3 py-2">
                            {v === 'pass' ? <Badge tone="ok">Pass</Badge>
                              : v === 'fail' ? <Badge tone="danger">Fail</Badge>
                                : <span className="text-ink-subtle">-</span>}
                          </td>
                          <td className="px-3 py-2 text-ink-muted whitespace-pre-wrap">{comments || <span className="text-ink-subtle">-</span>}</td>
                        </tr>
                      )
                    }
                    const raw = ans.value as unknown
                    const text = raw == null || raw === '' ? '' : String(raw)
                    return (
                      <tr key={item.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 text-ink">{item.label}</td>
                        <td className="px-3 py-2 text-ink-subtle">-</td>
                        <td className="px-3 py-2 text-ink-muted whitespace-pre-wrap">{text || <span className="text-ink-subtle">-</span>}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )
      })}

      {extraEntries.length > 0 && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Other answers</h3>
          <JsonView value={extras} />
        </section>
      )}

      {row.additional_notes && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Notes</h3>
          <p className="text-sm text-ink whitespace-pre-wrap">{row.additional_notes}</p>
        </section>
      )}
      {row.follow_up_instructions && (
        <section>
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">Follow-up</h3>
          <p className="text-sm text-ink whitespace-pre-wrap">{row.follow_up_instructions}</p>
        </section>
      )}
      <AttachmentViewer entityType="evaluation" entityId={row.id} />

      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button variant="ghost" onClick={onDownload}>Download PDF</Button>
        <Button variant="secondary" onClick={onView}>View report</Button>
      </div>
    </div>
  )
}

function AddReview({ accountId, submitterId, submitterName, schema, onClose, onSaved }: {
  accountId: string
  submitterId: string | null
  submitterName: string | null
  schema: SiteReviewSchema
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [weather, setWeather] = useState('')
  const [timeArrived, setTimeArrived] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (answers: SiteReviewAnswers) => {
    setError(null)
    if (!locationId) {
      setError('Pick a site')
      return
    }

    let summaryText: string | null = null
    let hasFail = false
    let hasPassFail = false
    for (const section of schema.sections) {
      for (const item of section.items) {
        const ans = (answers[item.id] ?? {}) as Record<string, unknown>
        if (item.type === 'comments' && summaryText == null) {
          const v = (ans.value as string | undefined) ?? ''
          if (v.trim()) summaryText = v.trim()
        }
        if (item.type === 'pass_fail') {
          hasPassFail = true
          if (ans.value === 'fail') hasFail = true
        }
      }
    }
    const result = hasPassFail ? (hasFail ? 'Fail' : 'Pass') : null

    setBusy(true)
    const { error: err } = await siteEvaluations.create({
      account_id: accountId,
      location_id: locationId,
      result,
      answers: answers as never,
      additional_notes: summaryText,
      submitted_by: submitterId,
      submitted_by_name: submitterName,
      submitted_at: new Date().toISOString(),
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    void weather
    void timeArrived
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Submit site review" size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Site" required>
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Weather">
            {(id) => (
              <Input id={id} value={weather} onChange={(e) => setWeather(e.target.value)} placeholder="e.g. Sunny, 72°F" />
            )}
          </Field>
          <Field label="Time arrived">
            {(id) => (
              <TimeSelect id={id} value={timeArrived} onChange={setTimeArrived} allowEmpty />
            )}
          </Field>
        </div>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <SiteReviewForm schema={schema} onSubmit={save} submitting={busy} />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
