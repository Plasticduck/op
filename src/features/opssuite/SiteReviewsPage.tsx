import { useEffect, useRef, useState } from 'react'
import { ClipboardList, FileText, Plus, Trash2 } from 'lucide-react'
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
import { siteEvaluations, customForms, siteReviewPhotos, type SiteEvaluation } from '@/lib/queries/opsSuite'
import { exportExcel, type ExportColumn } from '@/lib/opsExport'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'
import SiteReviewForm from './SiteReviewForm'
import { SiteReviewBuilder } from './SiteReviewBuilder'
import {
  DEFAULT_SITE_REVIEW_SCHEMA,
  type SiteReviewSchema,
  type SiteReviewAnswers,
} from './siteReviewSchema'
import { buildSiteReviewPdf, buildSiteReviewsPdf, openPdfInNewTab, downloadBlob, type SiteReviewPdfInput } from '@/lib/reports/siteReviewPdf'
import { fetchCurrentWeather, currentWeatherLabel, geocodeAddress } from '@/lib/weather'

// Weather + time-arrived captured on a review are stored under this reserved key
// in the answers JSON (the table has no dedicated columns for them).
type ReviewMeta = { weather?: string; timeArrived?: string }
const reviewMeta = (answers: unknown): ReviewMeta =>
  ((answers as { __meta?: ReviewMeta } | null | undefined)?.__meta ?? {})

// A long expiry (5 years) for the signed URLs embedded as clickable links in an
// exported PDF, so the links keep working long after the file is saved.
const PHOTO_LINK_TTL = 60 * 60 * 24 * 365 * 5

// Resolves a review's item photos (storage paths on the answers JSON) into a
// long-lived signed URL (for the clickable PDF link) plus a JPEG thumbnail with
// pixel dimensions (for embedding). Photos are fetched as blobs and redrawn
// through a canvas so the data URL is same-origin (no canvas taint) and JPEG
// regardless of the source format; if a source can't be decoded (e.g. HEIC), the
// link is still returned without a thumbnail.
async function resolveReviewPhotos(
  answers: SiteReviewAnswers,
): Promise<Record<string, { url: string; dataUrl?: string; w?: number; h?: number }>> {
  const paths: string[] = []
  for (const v of Object.values(answers)) {
    const ph = (v as { photos?: unknown } | null | undefined)?.photos
    if (Array.isArray(ph)) for (const p of ph) if (typeof p === 'string') paths.push(p)
  }
  const out: Record<string, { url: string; dataUrl?: string; w?: number; h?: number }> = {}
  await Promise.all(
    paths.map(async (p) => {
      try {
        const url = await siteReviewPhotos.signedUrl(p, PHOTO_LINK_TTL)
        if (!url) return
        out[p] = { url }
        const resp = await fetch(url)
        if (!resp.ok) return
        const objUrl = URL.createObjectURL(await resp.blob())
        try {
          const img = await new Promise<HTMLImageElement>((resolve, reject) => {
            const im = new Image()
            im.onload = () => resolve(im)
            im.onerror = reject
            im.src = objUrl
          })
          const maxDim = 1200
          const scale = Math.min(1, maxDim / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
          const w = Math.max(1, Math.round((img.naturalWidth || 1) * scale))
          const h = Math.max(1, Math.round((img.naturalHeight || 1) * scale))
          const canvas = document.createElement('canvas')
          canvas.width = w
          canvas.height = h
          const ctx = canvas.getContext('2d')
          if (!ctx) return
          ctx.drawImage(img, 0, 0, w, h)
          out[p] = { url, dataUrl: canvas.toDataURL('image/jpeg', 0.82), w, h }
        } finally {
          URL.revokeObjectURL(objUrl)
        }
      } catch {
        // Skip a single unreadable photo rather than failing the whole export.
      }
    }),
  )
  return out
}

// Strips the data-URL prefix from a blob so only raw base64 is sent to the email
// function (Resend's attachment `content` expects base64).
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const res = typeof reader.result === 'string' ? reader.result : ''
      resolve(res.slice(res.indexOf(',') + 1))
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

// The wash logo drawn top-right on the PDF export, loaded once from /mw-logo.png
// and cached (with its natural dimensions so the aspect ratio is preserved).
let logoPromise: Promise<{ dataUrl: string; w: number; h: number } | null> | null = null
function loadReviewLogo(): Promise<{ dataUrl: string; w: number; h: number } | null> {
  if (logoPromise) return logoPromise
  logoPromise = (async () => {
    try {
      const resp = await fetch('/mw-logo.png')
      if (!resp.ok) return null
      const objUrl = URL.createObjectURL(await resp.blob())
      try {
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const im = new Image()
          im.onload = () => resolve(im)
          im.onerror = reject
          im.src = objUrl
        })
        const canvas = document.createElement('canvas')
        canvas.width = img.naturalWidth || 1
        canvas.height = img.naturalHeight || 1
        const ctx = canvas.getContext('2d')
        if (!ctx) return null
        ctx.drawImage(img, 0, 0)
        return { dataUrl: canvas.toDataURL('image/png'), w: canvas.width, h: canvas.height }
      } finally {
        URL.revokeObjectURL(objUrl)
      }
    } catch {
      return null
    }
  })()
  return logoPromise
}

// Thumbnails for a review item's attached photos (read-only, in the detail view).
function ReviewItemPhotos({ photos }: { photos: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  useEffect(() => {
    let alive = true
    for (const p of photos) {
      siteReviewPhotos.signedUrl(p).then((u) => { if (alive && u) setUrls((prev) => ({ ...prev, [p]: u })) })
    }
    return () => { alive = false }
  }, [photos])
  if (!photos.length) return null
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      {photos.map((p) => (
        urls[p] ? (
          <a key={p} href={urls[p]} target="_blank" rel="noreferrer" className="block size-16 overflow-hidden rounded-md border border-border">
            <img src={urls[p]} alt="Review photo" className="size-full object-cover" />
          </a>
        ) : (
          <div key={p} className="size-16 animate-pulse rounded-md border border-border bg-content" />
        )
      ))}
    </div>
  )
}

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
  // Only this admin account may delete monthly site reviews (enforced by RLS too).
  const canDelete = (profile?.email ?? '').toLowerCase() === 'kevan@washlyfe.com'
  const [removing, setRemoving] = useState<string | null>(null)
  const remove = async (row: Row) => {
    if (!window.confirm(`Delete the ${row.location?.name ?? 'site'} review from ${shortDate(row.submitted_at)}? This cannot be undone.`)) return
    setRemoving(row.id)
    const { error } = await siteEvaluations.remove(row.id)
    setRemoving(null)
    if (error) { window.alert(`Could not delete: ${error.message}`); return }
    if (open?.id === row.id) setOpen(null)
    void load()
  }

  // The Mighty Wash logo is theirs, so only brand their account's exports.
  const isMightyWash = profile?.account_id === '54f3e299-1f61-4ed2-9921-3d02160b72e6'

  const buildReportInput = async (row: Row): Promise<SiteReviewPdfInput> => {
    const answers = (row.answers ?? {}) as SiteReviewAnswers
    const meta = reviewMeta(row.answers)
    const [photoImages, logo] = await Promise.all([
      resolveReviewPhotos(answers),
      isMightyWash ? loadReviewLogo() : Promise.resolve(null),
    ])
    return {
      title: 'Monthly Site Review',
      siteName: row.location?.name ?? null,
      date: row.submitted_at,
      weather: meta.weather ?? null,
      timeArrived: meta.timeArrived ?? null,
      schema,
      answers,
      summaryText: row.additional_notes,
      submitterName: row.submitted_by_name,
      photoImages,
      logo,
    }
  }

  const buildReportBlob = async (row: Row): Promise<Blob> => buildSiteReviewPdf(await buildReportInput(row))

  // Toolbar "PDF" export: every visible review in one file, each on its own
  // page(s), with the same clickable photo links as the single-review report.
  const [exportingAll, setExportingAll] = useState(false)
  const exportAllPdf = async () => {
    if (table.rows.length === 0) return
    setExportingAll(true)
    try {
      const inputs = await Promise.all(table.rows.map(buildReportInput))
      downloadBlob(await buildSiteReviewsPdf(inputs), `rm-site-reviews-${new Date().toISOString().slice(0, 10)}.pdf`)
    } finally {
      setExportingAll(false)
    }
  }

  const reportName = (row: Row) =>
    `site-review-${(row.location?.name ?? 'site').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${filenameSafeDate(row.submitted_at)}.pdf`

  const openReport = async (row: Row) => openPdfInNewTab(await buildReportBlob(row))
  const downloadReport = async (row: Row) => downloadBlob(await buildReportBlob(row), reportName(row))

  // On submission, email the exported PDF to the reviews recipient (MW only).
  // Best-effort: a failed send is logged but never blocks the submission.
  const emailReviewReport = async (row: Row) => {
    if (!isMightyWash) return
    try {
      const pdfBase64 = await blobToBase64(await buildReportBlob(row))
      await siteEvaluations.emailReport({
        reviewId: row.id,
        pdfBase64,
        filename: reportName(row),
        siteName: row.location?.name ?? null,
        submittedBy: row.submitted_by_name ?? null,
        date: row.submitted_at,
      })
    } catch (e) {
      console.error('Failed to email site review', e)
    }
  }

  // Selection + per-review export from the list. Each selected review downloads
  // as its own PDF, so reviews can be exported one at a time.
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const visibleIds = table.rows.map((r) => r.id)
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id))
  const toggleAll = () =>
    setSelected(() => (allSelected ? new Set() : new Set(visibleIds)))
  const exportSelected = async () => {
    const chosen = table.rows.filter((r) => selected.has(r.id))
    if (chosen.length === 0) return
    setExporting(true)
    for (const row of chosen) {
      downloadBlob(await buildReportBlob(row), reportName(row))
    }
    setExporting(false)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="RM Site Reviews"
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
        onExportPdf={() => void exportAllPdf()}
        onExportExcel={() => exportExcel('site-reviews', EXPORT_COLUMNS, table.rows)}
        disableExport={exportingAll}
      />
      {selected.size > 0 && (
        <div className="flex items-center gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
          <span className="font-medium text-accent">{selected.size} selected</span>
          <Button size="sm" onClick={() => void exportSelected()} disabled={exporting}>
            <FileText className="size-4" /> {exporting ? 'Exporting…' : `Export PDF${selected.size > 1 ? ' (one file each)' : ''}`}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>Clear</Button>
        </div>
      )}
      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={ClipboardList} title="No site reviews" description="Monthly site reviews in this timeframe will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    aria-label="Select all reviews"
                    className="size-4 cursor-pointer accent-accent align-middle"
                    checked={allSelected}
                    onChange={toggleAll}
                  />
                </th>
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
                  <td className="px-3 py-2.5">
                    <input
                      type="checkbox"
                      aria-label={`Select ${e.location?.name ?? 'review'}`}
                      className="size-4 cursor-pointer accent-accent align-middle"
                      checked={selected.has(e.id)}
                      onChange={() => toggleOne(e.id)}
                    />
                  </td>
                  <td className="px-3 py-2.5 font-medium text-ink">{e.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5">
                    {e.result ? <Badge tone={/pass/i.test(e.result) ? 'ok' : 'danger'}>{e.result}</Badge> : <span className="text-ink-subtle">—</span>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{e.submitted_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(e.submitted_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => setOpen(e)}>View</Button>
                      {canDelete && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-ink-muted hover:text-danger"
                          disabled={removing === e.id}
                          title="Delete review"
                          onClick={() => void remove(e)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
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
          onSubmitted={emailReviewReport}
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
                          <td className="px-3 py-2 text-ink-muted whitespace-pre-wrap">
                            {comments || <span className="text-ink-subtle">-</span>}
                            <ReviewItemPhotos photos={(ans.photos as string[] | undefined) ?? []} />
                          </td>
                        </tr>
                      )
                    }
                    const raw = ans.value as unknown
                    const text = raw == null || raw === '' ? '' : String(raw)
                    return (
                      <tr key={item.id} className="border-t border-border align-top">
                        <td className="px-3 py-2 text-ink">{item.label}</td>
                        <td className="px-3 py-2 text-ink-subtle">-</td>
                        <td className="px-3 py-2 text-ink-muted whitespace-pre-wrap">
                          {text || <span className="text-ink-subtle">-</span>}
                          <ReviewItemPhotos photos={(ans.photos as string[] | undefined) ?? []} />
                        </td>
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

function AddReview({ accountId, submitterId, submitterName, schema, onClose, onSaved, onSubmitted }: {
  accountId: string
  submitterId: string | null
  submitterName: string | null
  schema: SiteReviewSchema
  onClose: () => void
  onSaved: () => void
  onSubmitted: (row: Row) => void | Promise<void>
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [weather, setWeather] = useState('')
  const [timeArrived, setTimeArrived] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Auto-fill the weather field with the selected site's current conditions.
  // Only overwrites the field while it's empty or still holds a prior auto value,
  // so a manually typed note is preserved.
  const autoWeatherRef = useRef('')
  useEffect(() => {
    if (!locationId) return
    const loc = locations.find((l) => l.id === locationId)
    if (!loc) return
    let active = true
    void (async () => {
      let lat = loc.latitude
      let lon = loc.longitude
      if ((lat == null || lon == null) && loc.address) {
        const g = await geocodeAddress(loc.address)
        if (g) { lat = g.lat; lon = g.lon }
      }
      if (lat == null || lon == null) return
      const w = await fetchCurrentWeather(lat, lon)
      if (!active || !w) return
      const label = currentWeatherLabel(w)
      setWeather((prev) => (prev === '' || prev === autoWeatherRef.current ? label : prev))
      autoWeatherRef.current = label
    })()
    return () => { active = false }
  }, [locationId, locations])

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

    // Weather + time arrived have no dedicated columns; keep them on the answers
    // JSON under a reserved key so they surface in the report/PDF export.
    const meta: ReviewMeta = {}
    if (weather.trim()) meta.weather = weather.trim()
    if (timeArrived) meta.timeArrived = timeArrived
    const answersWithMeta = Object.keys(meta).length > 0 ? { ...answers, __meta: meta } : answers

    setBusy(true)
    const { data: created, error: err } = await siteEvaluations.create({
      account_id: accountId,
      location_id: locationId,
      result,
      answers: answersWithMeta as never,
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
    if (created) {
      const locName = locations.find((l) => l.id === locationId)?.name ?? null
      void onSubmitted({ ...(created as SiteEvaluation), location: locName ? { name: locName } : null } as Row)
    }
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

        <SiteReviewForm schema={schema} onSubmit={save} submitting={busy} accountId={accountId} />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
