import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { academy, type AcademyLesson } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { levelPath, lessonPath, stepPath, useAcademy } from './context'
import { sanitizeHtml, splitAfterFirstParagraph } from './prose'
import { QuestionSet } from './QuestionSet'
import { DraftNote, Eyebrow, LinkButton, Pill, WhyBox } from './ui'
import { errText, fmtDate, useLevel } from './helpers'

export default function LessonPage() {
  const { lessonKey } = useParams()
  const { level, questions } = useLevel()
  const { progress, learner, reloadProgress, toast } = useAcademy()
  const meta = level.courses.flatMap((c) => c.lessons).find((l) => l.key === lessonKey)
  const [lesson, setLesson] = useState<AcademyLesson | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!meta) return
    let live = true
    setLesson(null)
    academy.lesson(meta.id).then((l) => { if (live) setLesson(l) }).catch((e) => { if (live) setError(errText(e)) })
    return () => { live = false }
  }, [meta])

  const html = useMemo(() => splitAfterFirstParagraph(sanitizeHtml(lesson?.body ?? '')), [lesson?.body])

  if (!meta) return <p className="text-sm text-ink-muted">That lesson isn't in this level.</p>
  const course = level.courses.find((c) => c.id === meta.course_id)
  const list = level.lessons
  const idx = list.findIndex((l) => l.id === meta.id)
  const prev = idx > 0 ? list[idx - 1] : null
  const next = idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null
  const done = progress?.lessons.get(meta.id)
  const multi = level.courses.filter((c) => c.active).length > 1
  const inCourse = course?.lessons.filter((l) => l.active) ?? []
  const crumb = multi && course
    ? `${level.name} · ${course.title} · Lesson ${inCourse.findIndex((l) => l.id === meta.id) + 1} of ${inCourse.length}`
    : `${level.name} · ${level.short_title} · Lesson ${idx + 1} of ${list.length}`
  const quiz = (questions ?? []).filter((q) => q.lesson_id === meta.id && q.kind === 'quiz')

  return (
    <article className="mx-auto flex max-w-3xl flex-col gap-4">
      {!meta.active || (course && !course.active) ? (
        <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">This lesson has been retired from the program.</div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <Eyebrow tone="red">{crumb} · {meta.minutes} min</Eyebrow>
        {done?.done_at && <Pill tone="ok">Complete</Pill>}
      </div>
      <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{meta.title}</h2>
      <DraftNote show={level.draft || !!course?.draft} />
      {error && <p className="text-sm text-danger">{error}</p>}
      {!lesson ? (
        !error && <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {html[0] && <div className="ac-prose" dangerouslySetInnerHTML={{ __html: html[0] }} />}
          <WhyBox text={lesson.why} />
          {html[1] && <div className="ac-prose" dangerouslySetInnerHTML={{ __html: html[1] }} />}
        </div>
      )}

      {lesson && lesson.kind === 'selfcheck' ? (
        // Remount when saved answers arrive, so the boxes start from them.
        <SelfCheck key={done?.updated_at ?? (progress ? 'none' : 'loading')} lesson={lesson} />
      ) : questions == null ? (
        <p className="text-sm text-ink-muted">Loading the knowledge check…</p>
      ) : quiz.length > 0 ? (
        <div className="mt-4">
          <QuestionSet
            key={meta.id}
            questions={quiz}
            variant="quiz"
            title="Knowledge check"
            subtitle={`All ${quiz.length} correct marks the lesson complete.`}
            onCheck={async (answers) => {
              const r = await academy.checkQuiz(meta.id, answers, learner?.id ?? null)
              if (r.done && learner) {
                await reloadProgress()
                toast(done?.done_at ? 'Still perfect' : 'Lesson complete')
              }
              return r
            }}
          />
        </div>
      ) : lesson && learner && !done?.done_at ? (
        // No knowledge check on this lesson: reading it completes it.
        <div className="mt-4">
          <Button
            onClick={() => void academy.checkQuiz(meta.id, {}, learner.id)
              .then(async () => { await reloadProgress(); toast('Lesson complete') })
              .catch((e) => toast(errText(e)))}
          >
            Mark as read
          </Button>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-between gap-2">
        {prev ? (
          <LinkButton variant="secondary" to={lessonPath(level.key, prev.key)}>← {prev.title}</LinkButton>
        ) : (
          <LinkButton variant="secondary" to={levelPath(level.key)}>← {level.track.unit_label} overview</LinkButton>
        )}
        {next ? (
          <LinkButton variant={done?.done_at ? 'primary' : 'secondary'} to={lessonPath(level.key, next.key)}>{next.title} →</LinkButton>
        ) : level.scenarioCount > 0 ? (
          <LinkButton variant={done?.done_at ? 'primary' : 'secondary'} to={stepPath(level.key, 'scenarios')}>Scenario practice →</LinkButton>
        ) : (
          <LinkButton variant={done?.done_at ? 'primary' : 'secondary'} to={stepPath(level.key, 'assessment')}>{level.track.unit_label} assessment →</LinkButton>
        )}
      </div>
    </article>
  )
}

// A diagnostic instead of a quiz: check what's true at your site, then pick the one
// thing to fix this week.
function SelfCheck({ lesson }: { lesson: AcademyLesson }) {
  const { progress, learner, reloadProgress, toast } = useAcademy()
  const row = progress?.lessons.get(lesson.id)
  const saved = (row?.data ?? {}) as { checks?: boolean[]; focus?: number | null }
  const [checks, setChecks] = useState<boolean[]>(() => lesson.checks.map((_, i) => !!saved.checks?.[i]))
  const [focus, setFocus] = useState<string>(saved.focus != null ? String(saved.focus) : '')
  const [busy, setBusy] = useState(false)
  const open = lesson.checks.map((t, i) => ({ t, i })).filter((x) => !checks[x.i])
  const choices = open.length === 0 ? lesson.checks.map((t, i) => ({ t, i })) : open

  const save = async () => {
    if (!learner) return
    if (focus === '') { toast('Choose your focus item first'); return }
    setBusy(true)
    try {
      await academy.saveSelfcheck(lesson.id, checks, Number(focus), true, learner.id)
      await reloadProgress()
      toast('Self-check saved')
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-2">
      {lesson.checks.map((t, i) => (
        <label
          key={i}
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border px-4 py-3 text-sm',
            checks[i] ? 'border-ok bg-ok-soft' : 'border-border bg-card',
          )}
        >
          <input
            type="checkbox"
            checked={checks[i]}
            onChange={(e) => {
              const n = checks.slice()
              n[i] = e.target.checked
              setChecks(n)
              setFocus('')
            }}
            className="mt-0.5 size-4 accent-[var(--color-ok)]"
          />
          <span className="text-ink">{t}</span>
        </label>
      ))}
      <div className="mt-3 rounded-xl border border-accent/40 bg-accent-soft p-4">
        <Eyebrow tone="blue">This week's focus</Eyebrow>
        <p className="mt-1 text-sm text-ink">
          {open.length === 0
            ? 'Every box is checked. Pick one to re-verify on your next site walk anyway; standards drift quietly.'
            : `You have ${open.length} unchecked. Pick the one you will fix this week.`}
        </p>
        <select
          value={focus}
          onChange={(e) => setFocus(e.target.value)}
          className="mt-2 h-9 w-full rounded-md border border-border bg-card px-2.5 text-sm text-ink outline-none focus:border-accent"
        >
          <option value="">Choose one</option>
          {choices.map((x) => <option key={x.i} value={x.i}>{x.t}</option>)}
        </select>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {learner ? (
            <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save self-check'}</Button>
          ) : (
            <span className="text-sm text-ink-muted">This login can't save a self-check.</span>
          )}
          {row?.done_at && <Pill tone="ok">Saved {fmtDate(row.done_at)}</Pill>}
        </div>
      </div>
    </div>
  )
}
