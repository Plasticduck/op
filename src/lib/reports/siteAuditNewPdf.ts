import { format } from 'date-fns'
import type { SiteAuditV2 } from '@/lib/queries/siteAuditsV2'
import type { PdfLogo } from '@/lib/pdfLogo'
import type { SiteReviewSchema } from '@/features/opssuite/siteReviewSchema'
import {
  AUDIT_SECTIONS,
  SECTION_POINTS,
  fmtPoints,
  gradeAudit,
  gradeTone,
  itemKey,
  normalizeAnswers,
} from '@/features/opssuite/siteauditnew/form'
import { buildSiteReviewPdf, type PdfTone } from './siteReviewPdf'
import { resolveStoragePhotos } from './siteAuditPdf'

// One Site Audit NEW as a PDF: the grade up top, then each section with its
// result, every item's rating, comments and photos.
export async function buildSiteAuditNewPdf(audit: SiteAuditV2, logo: PdfLogo | null): Promise<Blob> {
  const answers = normalizeAnswers(audit.answers)
  const result = gradeAudit(answers)
  const photoImages = await resolveStoragePhotos(Object.values(answers).flatMap((a) => a.photos))

  const schema: SiteReviewSchema = {
    version: 1,
    sections: AUDIT_SECTIONS.map((s, i) => ({
      id: s.id,
      title: `${i + 1}. ${s.title}`,
      items: s.items.map((it) => ({ id: itemKey(s, it), label: it.label, type: 'pass_fail' as const })),
    })),
  }

  const sectionNotes: Record<string, { text: string; tone: PdfTone }> = {}
  for (const r of result.sections) {
    const pts = `${fmtPoints(r.points)} / ${fmtPoints(SECTION_POINTS)} pts`
    sectionNotes[r.section.id] =
      r.status === 'pass' ? { text: `PASS  ${pts}`, tone: 'ok' }
      : r.status === 'fail' ? { text: `FAIL  ${pts}${r.section.failsAudit ? '  (fails the audit)' : ''}`, tone: 'danger' }
      : { text: `Not finished  ${pts}`, tone: 'muted' }
  }

  // The stored result is what was submitted; it's worked out from these same answers.
  const grade = audit.grade ?? result.grade ?? '-'
  const safetyFailed = audit.safety_failed ?? result.safetyFailed
  const score = audit.score ?? result.points
  const failed = audit.failed_sections?.length ? audit.failed_sections : result.failedSections
  const passedLine = `${result.sectionsPassed} of ${AUDIT_SECTIONS.length} sections passed (${fmtPoints(Number(score))} of 100 points).`
  const banner = safetyFailed
    ? {
        title: 'FAILED  (Safety)',
        detail: `A Safety item failed, so the whole audit fails. ${passedLine}${failed.length ? ' Failed: ' + failed.join(', ') + '.' : ''}`,
        tone: 'danger' as const,
      }
    : {
        title: `Grade ${grade}   ${fmtPoints(Number(score))} / 100`,
        detail: `${passedLine}${failed.length ? ' Failed: ' + failed.join(', ') + '.' : ' Every section passed.'}`,
        tone: gradeTone(grade, false),
      }

  const when = audit.submitted_at ?? audit.created_at
  const site = audit.location?.name ?? '-'
  return buildSiteReviewPdf({
    title: 'Site Audit',
    siteName: site,
    date: when,
    metaLine: ['Site: ' + site, 'Date: ' + format(new Date(when), 'MMM d, yyyy h:mm a'), 'Auditor: ' + (audit.auditor_name ?? '-')].join('  |  '),
    schema,
    answers,
    submitterName: audit.auditor_name ? 'Audited by ' + audit.auditor_name : null,
    photoImages,
    logo,
    banner,
    sectionNotes,
    colorStatus: true,
    warnLabel: 'Needs attention',
  })
}
