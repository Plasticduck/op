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
  normalizeResponses,
  redItems,
} from '@/features/opssuite/siteauditnew/form'
import { buildSiteReviewPdf, type PdfAppendix, type PdfTone } from './siteReviewPdf'
import { dueDay, savedWorkOrders } from '@/lib/queries/siteWorkOrders'
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
    appendix: [...followUpAppendix(audit), ...workOrdersAppendix(audit)],
  })
}

// Where the audit's follow-up stands: the RM's answer to each red item once it's
// complete, or that it's still waiting.
function followUpAppendix(audit: SiteAuditV2): PdfAppendix[] {
  const answers = normalizeAnswers(audit.answers)
  const reds = redItems(answers)
  if (audit.review_status === 'needs_attention') {
    return [{
      title: 'Follow-up',
      note: { text: 'Needs attention', tone: 'danger' },
      message: `Waiting on the site's Regional Manager to answer ${reds.length} red item${reds.length === 1 ? '' : 's'} and mark the audit complete.`,
    }]
  }
  if (audit.review_status !== 'complete') return []
  if (!audit.completed_by_name && !reds.length) {
    return [{ title: 'Follow-up', note: { text: 'Complete', tone: 'ok' }, message: 'No red items, so no Regional Manager follow-up was needed.' }]
  }
  const responses = normalizeResponses(audit.rm_responses)
  const role = audit.completed_role === 'admin' ? 'Admin' : 'Regional Manager'
  const when = audit.completed_at ? ` on ${format(new Date(audit.completed_at), 'MMM d, yyyy h:mm a')}` : ''
  const contentWidth = 215.9 - 28
  return [{
    title: role === 'Admin' ? 'Follow-up' : 'Regional Manager response',
    note: { text: `Complete. Acknowledged by ${audit.completed_by_name ?? 'unknown'} (${role})${when}`, tone: 'ok' },
    head: ['Red item', 'Auditor comments', 'Response'],
    widths: [48, 52, contentWidth - 100],
    body: [
      ...reds.map((r) => [`${r.section.title}\n${r.item.label}`, r.answer.comments.trim() || '-', responses[r.key] || '-']),
      ...(audit.rm_note ? [['Note', '', audit.rm_note]] : []),
    ],
    tones: reds.map(() => ({ 0: 'danger' as const })),
  }]
}

const WO_PRIORITY: Record<string, { label: string; tone: PdfTone }> = {
  HIGH: { label: 'High', tone: 'danger' },
  MEDIUM: { label: 'Medium', tone: 'warn' },
  LOW: { label: 'Low', tone: 'muted' },
  NONE: { label: '-', tone: 'muted' },
}
const WO_STATUS: Record<string, string> = { OPEN: 'Open', IN_PROGRESS: 'In progress', ON_HOLD: 'On hold' }

// The open MaintainX work orders saved when the audit was sent, as a table after
// the sections. Same layout as the emailed PDF (site-audit-new-notify/report.ts).
function workOrdersAppendix(audit: SiteAuditV2): PdfAppendix[] {
  const wo = savedWorkOrders(audit.work_orders)
  if (!wo) return []
  const title = 'Open work orders in MaintainX'
  const asOf = wo.fetchedAt ? `as of ${format(new Date(wo.fetchedAt), 'MMM d, yyyy, h:mm a')}` : ''
  if ('error' in wo) return [{ title, note: { text: asOf, tone: 'muted' }, message: 'MaintainX could not be reached when this audit was sent.' }]
  if (!wo.matched) return [{ title, note: { text: asOf, tone: 'muted' }, message: `${wo.site || 'This site'} isn't set up in MaintainX.` }]
  const list = wo.workOrders
  if (!list.length) return [{ title, note: { text: asOf, tone: 'muted' }, message: 'No open work orders.' }]
  const high = list.filter((w) => w.priority === 'HIGH').length
  const now = Date.now()
  const contentWidth = 215.9 - 28
  return [{
    title,
    note: { text: `${list.length} open${high ? ` (${high} high)` : ''}, ${asOf}`, tone: high ? 'danger' : 'muted' },
    head: ['#', 'Priority', 'Status', 'Work order', 'Assigned to', 'Opened'],
    widths: [15, 18, 21, contentWidth - 15 - 18 - 21 - 44 - 30, 44, 30],
    body: list.map((w) => {
      const days = w.createdAt ? Math.max(0, Math.floor((now - new Date(w.createdAt).getTime()) / 86_400_000)) : null
      const due = w.dueDate ? dueDay(w.dueDate) : null
      return [
        w.number != null ? `#${w.number}` : '-',
        (WO_PRIORITY[w.priority] ?? WO_PRIORITY.NONE).label,
        WO_STATUS[w.status] ?? String(w.status),
        `${w.title}${w.asset ? `\n${w.asset}` : ''}`,
        w.assignees.join(', ') || 'Unassigned',
        (w.createdAt ? `${format(new Date(w.createdAt), 'MMM d, yyyy')}\n${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'}`}` : '-')
          + (due ? `\n${due.getTime() < now ? 'Overdue' : 'Due'} ${format(due, 'MMM d, yyyy')}` : ''),
      ]
    }),
    tones: list.map((w) => ({
      1: (WO_PRIORITY[w.priority] ?? WO_PRIORITY.NONE).tone,
      5: w.dueDate && dueDay(w.dueDate).getTime() < now ? 'danger' : null,
    })),
  }]
}
