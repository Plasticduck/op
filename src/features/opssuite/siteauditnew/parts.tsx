import { cn } from '@/lib/utils'
import {
  AUDIT_SECTIONS,
  SECTION_POINTS,
  fmtPoints,
  gradeTone,
  type AuditResult,
  type Rating,
  type SectionResult,
  type Tone,
} from './form'

const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', warn: 'text-warn', danger: 'text-danger' }
const TONE_BOX: Record<Tone, string> = {
  ok: 'border-ok/40 bg-ok-soft',
  warn: 'border-warn/40 bg-warn-soft',
  danger: 'border-danger/40 bg-danger-soft',
}
const TONE_PILL: Record<Tone, string> = {
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
}

export function GradePill({ grade, safetyFailed }: { grade: string | null; safetyFailed?: boolean | null }) {
  if (!grade) return <span className="text-ink-subtle">—</span>
  return (
    <span className={cn('inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-sm font-bold', TONE_PILL[gradeTone(grade, safetyFailed)])}>
      {grade}
      {safetyFailed && <span className="text-[11px] font-semibold uppercase tracking-wide">Safety</span>}
    </span>
  )
}

export function SectionChip({ r }: { r: SectionResult }) {
  const cls = 'shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold'
  if (r.status === 'pass') return <span className={cn(cls, TONE_PILL.ok)}>Pass · {fmtPoints(SECTION_POINTS)} pts</span>
  if (r.status === 'fail') return <span className={cn(cls, TONE_PILL.danger)}>Fail · 0 pts</span>
  return <span className={cn(cls, 'bg-content text-ink-muted')}>{r.rated} of {r.section.items.length} rated</span>
}

const RATING_PILL: Record<Rating, { label: string; tone: Tone }> = {
  pass: { label: 'Pass', tone: 'ok' },
  warn: { label: 'Needs attention', tone: 'warn' },
  fail: { label: 'Fail', tone: 'danger' },
}

export function RatingPill({ value }: { value: Rating | null }) {
  if (!value) return <span className="shrink-0 rounded-md bg-content px-2 py-0.5 text-xs font-semibold text-ink-muted">Not rated</span>
  const p = RATING_PILL[value]
  return <span className={cn('shrink-0 rounded-md px-2 py-0.5 text-xs font-semibold', TONE_PILL[p.tone])}>{p.label}</span>
}

// The audit's result: the grade (or FAILED on Safety), the points, and which
// sections failed. While items are still unrated it shows the score so far.
export function ResultBox({ result, className }: { result: AuditResult; className?: string }) {
  const failed = result.failedSections.length ? `Failed: ${result.failedSections.join(', ')}.` : ''
  const passed = `${result.sectionsPassed} of ${AUDIT_SECTIONS.length} sections passed`
  if (result.safetyFailed) {
    return (
      <div className={cn('rounded-md border px-4 py-3', TONE_BOX.danger, className)}>
        <p className="text-2xl font-bold tracking-tight text-danger">FAILED</p>
        <p className="mt-0.5 text-sm font-medium text-ink">A Safety item failed, so the whole audit fails.</p>
        <p className="mt-1 text-sm text-ink-muted">
          {passed} ({fmtPoints(result.points)} points). {failed}
        </p>
      </div>
    )
  }
  if (!result.grade) {
    return (
      <div className={cn('rounded-md border border-border bg-card px-4 py-3', className)}>
        <p className="text-sm font-medium text-ink-muted">Score so far</p>
        <p className="text-2xl font-bold tracking-tight text-ink">
          {fmtPoints(result.points)} <span className="text-base font-medium text-ink-muted">/ 100</span>
        </p>
        <p className="mt-0.5 text-sm text-ink-muted">
          {result.rated} of {result.total} items rated. The grade shows once every item is rated.
        </p>
      </div>
    )
  }
  const tone = gradeTone(result.grade)
  return (
    <div className={cn('flex items-center gap-4 rounded-md border px-4 py-3', TONE_BOX[tone], className)}>
      <p className={cn('text-5xl font-bold leading-none tracking-tight', TONE_TEXT[tone])}>{result.grade}</p>
      <div className="min-w-0">
        <p className="text-2xl font-bold tracking-tight text-ink">
          {fmtPoints(result.points)} <span className="text-base font-medium text-ink-muted">/ 100</span>
        </p>
        <p className="text-sm text-ink-muted">{passed}. {failed || 'Every section passed.'}</p>
      </div>
    </div>
  )
}
