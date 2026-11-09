import { academy } from '@/lib/queries/academy'
import { levelPath, stepPath, useAcademy } from './context'
import { QuestionSet } from './QuestionSet'
import { Eyebrow, LinkButton, Pill, WhyBox } from './ui'
import { fmtDate, useLevel } from './helpers'

export function ScenariosPage() {
  const { level, questions } = useLevel()
  const { outline, progress, learner, reloadProgress, toast } = useAcademy()
  const qs = (questions ?? []).filter((q) => q.kind === 'scenario')
  const last = progress?.scenarios.get(level.id)?.[0]
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Eyebrow tone="red">{level.name} · {level.short_title} · Apply it</Eyebrow>
      <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Scenario practice</h2>
      <p className="text-[15px] leading-relaxed text-ink-muted">
        {qs.length || level.scenarioCount} situations you will actually face in this role. Choose what you would do, then check against
        the standard. Answering all of them marks this section complete; read the explanations on any miss.
      </p>
      <WhyBox text={outline?.program?.why_scenarios} />
      {last && (
        <p><Pill tone="ok">Completed {fmtDate(last.created_at)} with {last.correct} of {last.total}</Pill></p>
      )}
      {questions == null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <QuestionSet
          key={level.id}
          questions={qs}
          variant="scenario"
          submitLabel="Check my answers"
          onCheck={async (answers) => {
            const r = await academy.submit(level.id, 'scenarios', answers, learner?.id ?? null)
            if (learner) {
              await reloadProgress()
              toast(r.correct === r.total ? 'Every answer matches the standard' : 'Scenarios complete. Read the explanations on the misses.')
            }
            return r
          }}
        />
      )}
      <div className="mt-6 flex flex-wrap justify-between gap-2">
        <LinkButton variant="secondary" to={levelPath(level.key)}>← {level.track.unit_label} overview</LinkButton>
        {level.assessmentCount > 0 ? (
          <LinkButton variant={last ? 'primary' : 'secondary'} to={stepPath(level.key, 'assessment')}>{level.track.unit_label} assessment →</LinkButton>
        ) : (
          <LinkButton variant={last ? 'primary' : 'secondary'} to={stepPath(level.key, 'signoff')}>Sign-off →</LinkButton>
        )}
      </div>
    </div>
  )
}

export function AssessmentPage() {
  const { level, questions } = useLevel()
  const { outline, progress, learner, reloadProgress, toast } = useAcademy()
  const qs = (questions ?? []).filter((q) => q.kind === 'assessment')
  const tries = progress?.assessments.get(level.id) ?? []
  const passed = tries.find((a) => a.passed)
  const left = level.lessons.filter((l) => !progress?.lessons.get(l.id)?.done_at).length
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Eyebrow tone="red">{level.name} · {level.short_title} · Apply it</Eyebrow>
      <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{level.track.unit_label} assessment</h2>
      <p className="text-[15px] leading-relaxed text-ink-muted">
        {qs.length || level.assessmentCount} questions from this level. Pass mark is {level.pass_pct}%.{' '}
        {left
          ? `${left} lesson${left > 1 ? 's are' : ' is'} still open. You can take it now, but finishing the lessons first is the better route.`
          : 'All lessons are complete. Good luck.'}{' '}
        The right answers show once you pass.
      </p>
      <WhyBox text={outline?.program?.why_assessment} />
      {tries.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
          {passed
            ? <Pill tone="ok">Passed {passed.score}% on {fmtDate(passed.created_at)}</Pill>
            : <Pill tone="warn">Not yet passed · best {Math.max(...tries.map((t) => t.score))}%</Pill>}
          <span>{tries.length} attempt{tries.length === 1 ? '' : 's'}</span>
        </div>
      )}
      {questions == null ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <QuestionSet
          key={level.id}
          questions={qs}
          variant="assessment"
          title="Assessment"
          subtitle={`${level.pass_pct}% to pass`}
          submitLabel="Submit answers"
          onCheck={async (answers) => {
            const r = await academy.submit(level.id, 'assessment', answers, learner?.id ?? null)
            if (learner) {
              await reloadProgress()
              toast(r.passed ? `Passed with ${r.score}%` : `${r.score}%. Review the lessons and retake.`)
            }
            return r
          }}
        />
      )}
      <div className="mt-6 flex flex-wrap justify-between gap-2">
        {level.scenarioCount > 0 ? (
          <LinkButton variant="secondary" to={stepPath(level.key, 'scenarios')}>← Scenario practice</LinkButton>
        ) : (
          <LinkButton variant="secondary" to={levelPath(level.key)}>← {level.track.unit_label} overview</LinkButton>
        )}
        {level.skills.length > 0 ? (
          <LinkButton variant={passed ? 'primary' : 'secondary'} to={stepPath(level.key, 'skills')}>Hands-on skills →</LinkButton>
        ) : (
          <LinkButton variant={passed ? 'primary' : 'secondary'} to={stepPath(level.key, 'signoff')}>
            {level.ack_formal ? 'Acknowledgment' : 'Sign-off'} →
          </LinkButton>
        )}
      </div>
    </div>
  )
}
