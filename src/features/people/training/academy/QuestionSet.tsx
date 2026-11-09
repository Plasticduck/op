import { useState, type ReactNode } from 'react'
import { Button } from '@/components/ui/Button'
import type { GradeResult, PublicQuestion } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { Eyebrow } from './ui'
import { errText } from './helpers'

// A set of multiple-choice questions, graded on the server. Scenarios show a name and
// a situation; knowledge checks and the assessment show the question.
export function QuestionSet({
  questions, variant, title, subtitle, submitLabel = 'Check answers', onCheck, footer,
}: {
  questions: PublicQuestion[]
  variant: 'quiz' | 'scenario' | 'assessment'
  title?: string
  subtitle?: string
  submitLabel?: string
  onCheck: (answers: Record<string, number>) => Promise<GradeResult>
  footer?: ReactNode
}) {
  const [picked, setPicked] = useState<Record<string, number>>({})
  const [graded, setGraded] = useState<GradeResult | null>(null)
  const [missing, setMissing] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const check = async () => {
    const miss = new Set(questions.filter((q) => picked[q.id] === undefined).map((q) => q.id))
    setMissing(miss)
    if (miss.size) { setError(`${questions.length - miss.size} of ${questions.length} answered. Pick an answer for each one.`); return }
    setBusy(true)
    setError(null)
    try {
      setGraded(await onCheck(picked))
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const pick = (qid: string, i: number) => {
    setPicked((p) => ({ ...p, [qid]: i }))
    setMissing((m) => { if (!m.has(qid)) return m; const n = new Set(m); n.delete(qid); return n })
  }

  const scenario = variant === 'scenario'
  return (
    <div className={cn(!scenario && 'rounded-xl border border-border bg-card shadow-sm')}>
      {title && (
        <div className={cn('flex flex-wrap items-center justify-between gap-2', scenario ? 'mb-2' : 'border-b border-border px-4 py-3 sm:px-5')}>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {subtitle && <span className="text-xs text-ink-muted">{subtitle}</span>}
        </div>
      )}
      <ol data-qset={variant} className={cn(scenario ? 'flex flex-col gap-3' : 'divide-y divide-border')}>
        {questions.map((q, i) => {
          const r = graded?.results[q.id]
          return (
            <li key={q.id} className={cn(scenario ? 'rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5' : 'px-4 py-4 sm:px-5')}>
              {scenario ? (
                <>
                  <Eyebrow>Scenario {i + 1}</Eyebrow>
                  {q.title && <h3 className="mt-1 text-base font-semibold text-ink">{q.title}</h3>}
                  <p className="mt-1.5 text-[15px] leading-relaxed text-ink">{q.prompt}</p>
                </>
              ) : (
                <p className="font-medium text-ink">
                  <span className="mr-1.5 font-semibold text-ink-muted">{i + 1}.</span>
                  {q.prompt}
                </p>
              )}
              <div className="mt-2.5 flex flex-col gap-1.5">
                {q.options.map((o, j) => {
                  const chosen = picked[q.id] === j
                  const right = r && r.answer === j
                  const wrong = r && chosen && !r.correct
                  return (
                    <label
                      key={j}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg border px-3 py-2 text-sm transition',
                        right ? 'border-ok bg-ok-soft' : wrong ? 'border-danger bg-danger-soft' : chosen ? 'border-accent bg-accent-soft' : 'border-border bg-content hover:border-accent/60',
                      )}
                    >
                      <input
                        type="radio"
                        name={`q-${q.id}`}
                        checked={chosen}
                        onChange={() => pick(q.id, j)}
                        className="mt-0.5 accent-[var(--color-accent)]"
                      />
                      <span className="text-ink">{o}</span>
                    </label>
                  )
                })}
              </div>
              {missing.has(q.id) && <p className="mt-2 text-sm text-warn">Pick an answer.</p>}
              {r && (
                <p className={cn('mt-2 rounded-lg px-3 py-2 text-sm', r.correct ? 'bg-ok-soft text-ok' : 'bg-danger-soft text-danger')}>
                  {r.correct ? 'Correct.' : r.answer == null ? 'Not quite. Review the lessons and try again.' : 'Not quite.'}
                  {r.why ? ` ${r.why}` : ''}
                </p>
              )}
            </li>
          )
        })}
      </ol>
      <div className={cn('flex flex-wrap items-center gap-3', scenario ? 'mt-4' : 'border-t border-border px-4 py-3 sm:px-5')}>
        <Button onClick={() => void check()} disabled={busy || questions.length === 0}>
          {busy ? 'Checking…' : graded ? 'Check again' : submitLabel}
        </Button>
        {graded && (
          <span className="text-sm font-semibold text-ink">
            {graded.correct} of {graded.total} correct ({graded.score}%)
          </span>
        )}
        {error && <span className="text-sm text-warn">{error}</span>}
        {footer}
      </div>
    </div>
  )
}
