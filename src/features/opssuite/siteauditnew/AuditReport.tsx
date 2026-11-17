import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, FileText, ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { dateTime } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { siteAuditPhotos } from '@/lib/queries/opsSuite'
import { siteAuditsV2, type SiteAuditV2 } from '@/lib/queries/siteAuditsV2'
import { openPdfInNewTab } from '@/lib/reports/siteReviewPdf'
import { loadPdfLogo } from '@/lib/pdfLogo'
import { AUDIT_SECTIONS, gradeAudit, itemKey, normalizeAnswers, type AuditResult } from './form'
import { RatingPill, ResultBox, SectionChip } from './parts'
import { useBrandLogoUrl } from '@/lib/brandLogo'

const LIST = '/app/site-audits-new'

// A submitted audit: the grade, then every section and item as it was rated.
export function AuditReport({ audit }: { audit: SiteAuditV2 }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const logoUrl = useBrandLogoUrl()
  const answers = useMemo(() => normalizeAnswers(audit.answers), [audit.answers])
  // The sections' pass / fail come from the answers; the grade is the one stored at submit.
  const result: AuditResult = useMemo(() => {
    const r = gradeAudit(answers)
    return {
      ...r,
      points: audit.score != null ? Number(audit.score) : r.points,
      grade: (audit.grade as AuditResult['grade']) ?? r.grade,
      safetyFailed: audit.safety_failed ?? r.safetyFailed,
      failedSections: audit.failed_sections?.length ? audit.failed_sections : r.failedSections,
    }
  }, [answers, audit])

  const [pdfBusy, setPdfBusy] = useState(false)
  const openPdf = async () => {
    setPdfBusy(true)
    try {
      const { buildSiteAuditNewPdf } = await import('@/lib/reports/siteAuditNewPdf')
      const logo = logoUrl ? await loadPdfLogo(logoUrl, { maxPx: 400 }) : null
      openPdfInNewTab(await buildSiteAuditNewPdf(audit, logo))
    } catch (e) {
      window.alert('Could not build the PDF: ' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setPdfBusy(false)
    }
  }

  const remove = async () => {
    if (!window.confirm('Delete this audit? It and its photos will be gone for good.')) return
    const { data, error } = await siteAuditsV2.remove(audit.id)
    if (error || !data?.length) {
      window.alert('Could not delete the audit' + (error ? ': ' + error.message : '.'))
      return
    }
    void siteAuditsV2.removePhotos(Object.values(answers).flatMap((a) => a.photos))
    navigate(LIST)
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to={LIST} className="inline-flex w-fit items-center gap-1 text-sm font-medium text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Site Audit NEW
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold tracking-tight text-ink">Site audit: {audit.location?.name ?? 'Site'}</h1>
          <p className="mt-0.5 text-sm text-ink-muted">
            {dateTime(audit.submitted_at ?? audit.created_at)} · Audited by {audit.auditor_name ?? 'unknown'}
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" disabled={pdfBusy} onClick={() => void openPdf()}>
            <FileText className="size-4" /> {pdfBusy ? 'PDF…' : 'PDF'}
          </Button>
          {profile?.role === 'owner' && (
            <Button variant="ghost" onClick={() => void remove()} className="text-danger" aria-label="Delete audit">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </div>

      <ResultBox result={result} />

      {AUDIT_SECTIONS.map((section, si) => (
        <section key={section.id} className="rounded-md border border-border bg-card px-4 pb-1 pt-3">
          <div className="flex items-center justify-between gap-3 border-b border-border pb-2">
            <h2 className="text-base font-semibold text-ink">
              <span className="mr-1.5 text-ink-subtle">{si + 1}.</span>
              {section.title}
            </h2>
            <SectionChip r={result.sections[si]} />
          </div>
          {section.failsAudit && result.sections[si].status === 'fail' && (
            <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-danger">
              <ShieldAlert className="size-3.5" /> A red item here fails the whole audit.
            </p>
          )}
          <ul className="flex flex-col">
            {section.items.map((item) => {
              const a = answers[itemKey(section, item)]
              return (
                <li key={item.id} className="border-b border-border py-2.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <p className="font-medium text-ink">{item.label}</p>
                    <RatingPill value={a.value} />
                  </div>
                  {a.comments.trim() && <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted">{a.comments}</p>}
                  {a.photos.length > 0 && <Photos paths={a.photos} />}
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

function Photos({ paths }: { paths: string[] }) {
  const [urls, setUrls] = useState<Record<string, string>>({})
  const key = paths.join('|')
  useEffect(() => {
    let alive = true
    for (const p of paths) siteAuditPhotos.signedUrl(p).then((u) => { if (alive && u) setUrls((prev) => ({ ...prev, [p]: u })) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  return (
    <div className="mt-2 flex flex-wrap gap-2">
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
  )
}
