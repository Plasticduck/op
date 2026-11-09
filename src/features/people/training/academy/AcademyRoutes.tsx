import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { Navigate, NavLink, Outlet, Route, Routes, useParams } from 'react-router-dom'
import { ChevronDown } from 'lucide-react'
import { academy, levelStatus, nextInTrack, type OutlineLevel, type PublicQuestion } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { levelPath, lessonPath, stepPath, trackPath, useAcademy } from './context'
import { BackLink, Bar, Card, DraftNote, Dot, Eyebrow, LinkButton, Pill, Stat, TraineeBar, WhyBox } from './ui'
import { errText, fmtDate, nextStep, type LevelCtx, useLevel } from './helpers'
import { PrereqNote } from './PrereqNote'

const LessonPage = lazy(() => import('./LessonPage'))
const ScenariosPage = lazy(() => import('./StepPages').then((m) => ({ default: m.ScenariosPage })))
const AssessmentPage = lazy(() => import('./StepPages').then((m) => ({ default: m.AssessmentPage })))
const SkillsPage = lazy(() => import('./SkillsPage'))
const SignoffPage = lazy(() => import('./SignoffPage'))
const LearnerPage = lazy(() => import('./LearnerPage'))
const EditorRoutes = lazy(() => import('./edit/EditorRoutes'))

const Loading = () => <p className="text-sm text-ink-muted">Loading…</p>

// /app/training/academy/...
export default function AcademyRoutes() {
  const { outline, loading, error, canEdit } = useAcademy()
  // Wait for who's signed in too: the editor and trainee routes depend on it.
  if (loading) return <Loading />
  if (error && !outline) return <p className="text-sm text-danger">{error}</p>
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="edit/*" element={canEdit ? <EditorRoutes /> : <Navigate to="/app/training" replace />} />
        <Route path="people/:learnerId" element={<LearnerPage />} />
        <Route path=":levelKey" element={<LevelShell />}>
          <Route index element={<LevelPage />} />
          <Route path="scenarios" element={<ScenariosPage />} />
          <Route path="assessment" element={<AssessmentPage />} />
          <Route path="skills" element={<SkillsPage />} />
          <Route path="signoff" element={<SignoffPage />} />
          <Route path=":lessonKey" element={<LessonPage />} />
        </Route>
        <Route path="*" element={<Navigate to="/app/training" replace />} />
      </Routes>
    </Suspense>
  )
}

function LevelShell() {
  const { levelKey } = useParams()
  const { level: find, outline } = useAcademy()
  const level = find(levelKey)
  const [questions, setQuestions] = useState<PublicQuestion[] | null>(null)
  const [qError, setQError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)
  const levelId = level?.id
  useEffect(() => {
    if (!levelId) return
    let live = true
    setQuestions(null)
    academy.questions(levelId).then((q) => { if (live) setQuestions(q) }).catch((e) => { if (live) setQError(errText(e)) })
    return () => { live = false }
  }, [levelId, tick])

  if (!level || !outline) {
    return (
      <div className="flex flex-col gap-3">
        <BackLink to="/app/training">Academy</BackLink>
        <p className="text-sm text-ink-muted">That isn't in the program.</p>
      </div>
    )
  }
  const ctx: LevelCtx = { level, questions, reloadQuestions: () => setTick((t) => t + 1) }
  return (
    <div className="flex flex-col gap-4">
      <TraineeBar />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink to={trackPath(level.track.key)}>{level.track.title}</BackLink>
        {qError && <span className="text-sm text-danger">{qError}</span>}
      </div>
      <div className="grid gap-5 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="lg:sticky lg:top-4 lg:max-h-[calc(100vh-7rem)] lg:self-start lg:overflow-y-auto">
          <details className="group rounded-xl border border-border bg-card lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-semibold text-ink">
              {level.name}: {level.short_title}
              <ChevronDown className="size-4 text-ink-muted transition group-open:rotate-180" />
            </summary>
            <div className="border-t border-border p-2"><LevelRail level={level} /></div>
          </details>
          <div className="hidden rounded-xl border border-border bg-card p-2 lg:block">
            <div className="px-2 pb-2 pt-1">
              <Eyebrow>{level.track.title} · {level.name}</Eyebrow>
              <div className="font-semibold text-ink">{level.short_title}</div>
            </div>
            <LevelRail level={level} />
          </div>
        </aside>
        <main className="min-w-0">
          <Outlet context={ctx} />
        </main>
      </div>
    </div>
  )
}

function RailLink({ to, done, dashed, children, end }: { to: string; done?: boolean; dashed?: boolean; children: ReactNode; end?: boolean }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => cn(
        'flex items-start gap-2 rounded-md px-2 py-1.5 text-sm leading-snug transition',
        isActive ? 'bg-accent-soft font-medium text-accent' : 'text-ink hover:bg-content',
      )}
    >
      <span className="mt-px"><Dot done={done} dashed={dashed} /></span>
      <span className="min-w-0 flex-1">{children}</span>
    </NavLink>
  )
}

function LevelRail({ level }: { level: OutlineLevel }) {
  const { progress, outline } = useAcademy()
  const all = outline?.allLevels ?? []
  const s = levelStatus(level, progress, all)
  const courses = level.courses.filter((c) => c.active)
  const unit = level.track.unit_label
  const needs = level.requires.map((id) => all.find((l) => l.id === id)).filter((l): l is OutlineLevel => !!l && l.active)
  return (
    <nav className="flex flex-col gap-0.5">
      <RailLink to={levelPath(level.key)} end dashed done={s.complete}>{unit} overview</RailLink>
      {courses.map((c) => (
        <div key={c.id} className="flex flex-col gap-0.5">
          {courses.length > 1 && <Eyebrow className="px-2 pb-0.5 pt-2.5">{c.title}</Eyebrow>}
          {c.lessons.filter((l) => l.active).map((l) => (
            <RailLink key={l.id} to={lessonPath(level.key, l.key)} done={!!progress?.lessons.get(l.id)?.done_at}>{l.title}</RailLink>
          ))}
        </div>
      ))}
      <Eyebrow className="px-2 pb-0.5 pt-2.5">Apply it</Eyebrow>
      {level.scenarioCount > 0 && <RailLink to={stepPath(level.key, 'scenarios')} done={s.scenarios}>Scenario practice</RailLink>}
      {level.assessmentCount > 0 && <RailLink to={stepPath(level.key, 'assessment')} done={s.passed}>{unit} assessment</RailLink>}
      {s.skillsTotal > 0 && (
        <RailLink to={stepPath(level.key, 'skills')} done={s.skillsDone === s.skillsTotal}>Hands-on skills ({s.skillsDone}/{s.skillsTotal})</RailLink>
      )}
      <RailLink to={stepPath(level.key, 'signoff')} done={s.signed}>{level.ack_formal ? 'Acknowledgment' : `${unit} sign-off`}</RailLink>
      {needs.length > 0 && (
        <>
          <Eyebrow className="px-2 pb-0.5 pt-2.5">Required first</Eyebrow>
          {needs.map((n) => (
            <RailLink key={n.id} to={levelPath(n.key)} done={levelStatus(n, progress).finished}>{n.short_title}</RailLink>
          ))}
        </>
      )}
    </nav>
  )
}

function LevelPage() {
  const { level } = useLevel()
  const { outline, progress, learner, trainee } = useAcademy()
  const all = outline!.allLevels
  const trackLevels = outline!.levels.filter((l) => l.track_id === level.track_id)
  const s = levelStatus(level, progress, all)
  const next = nextInTrack(outline!, level)
  const sign = progress?.signoffs.get(level.id)
  const courses = level.courses.filter((c) => c.active)
  const isMine = learner?.level_key === level.key
  const unit = level.track.unit_label
  const lower = unit.toLowerCase()
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-3">
        <Eyebrow tone="red">{level.track.title} · {level.name} of {trackLevels.length}{isMine ? (trainee ? ` · their ${lower}` : ` · your ${lower}`) : ''}</Eyebrow>
        <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{level.title}</h2>
        {level.role_text && <p className="text-[15px] leading-relaxed text-ink-muted">{level.role_text}</p>}
        <PrereqNote level={level} />
        <DraftNote show={level.draft} />
        <WhyBox text={level.why} label={`Why this ${lower} matters`} />
      </div>

      {s.complete && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ok/50 bg-ok-soft px-4 py-3 text-sm text-ink">
          <span>
            <b>{unit} complete.</b>
            {sign ? ` ${sign.signer_name} signed off on ${fmtDate(sign.signed_on)}.` : ''}
            {s.best != null ? ` Assessment: ${s.best}%.` : ''}
            {next ? ` Next: ${next.title}.` : ''}
          </span>
          {next && <LinkButton size="sm" to={levelPath(next.key)}>Start {next.short_title}</LinkButton>}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_260px]">
        <div className="flex flex-col gap-4">
          {courses.map((c) => (
            <div key={c.id}>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h3 className="text-base font-semibold text-ink">{courses.length > 1 ? c.title : 'Lessons'}</h3>
                {c.draft && <Pill tone="warn">draft</Pill>}
              </div>
              {courses.length > 1 && c.blurb && <p className="-mt-1 mb-2 text-sm text-ink-muted">{c.blurb}</p>}
              {c.note && <p className="-mt-1 mb-2 text-xs text-ink-subtle">{c.note}</p>}
              <div className="overflow-hidden rounded-xl border border-border bg-card">
                {c.lessons.filter((l) => l.active).map((l, i) => (
                  <NavLink
                    key={l.id}
                    to={lessonPath(level.key, l.key)}
                    className="flex items-center gap-3 border-b border-border px-3 py-2.5 text-sm last:border-b-0 hover:bg-content"
                  >
                    <Dot done={!!progress?.lessons.get(l.id)?.done_at} />
                    <span className="min-w-0 flex-1 text-ink">{i + 1}. {l.title}</span>
                    <span className="shrink-0 text-xs text-ink-subtle">{l.minutes} min</span>
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </div>
        <Card className="self-start">
          <Eyebrow>{unit} progress</Eyebrow>
          <div className="mt-1 text-4xl font-bold text-ink">{s.pct}<span className="text-lg text-ink-muted">%</span></div>
          <Bar pct={s.pct} className="mb-3 mt-2" />
          <Stat label="Lessons" value={`${s.done} / ${s.total}`} />
          {level.scenarioCount > 0 && <Stat label="Scenarios" value={s.scenarios ? 'Done' : 'Open'} />}
          {level.assessmentCount > 0 && (
            <Stat label="Assessment" value={s.best == null ? 'Not taken' : s.passed ? `Passed ${s.best}%` : `Retake (${s.best}%)`} />
          )}
          {s.skillsTotal > 0 && <Stat label="Hands-on skills" value={`${s.skillsDone} / ${s.skillsTotal}`} />}
          <Stat label={level.ack_formal ? 'Acknowledgment' : 'Sign-off'} value={s.verified ? 'Verified' : s.signed ? 'Signed' : 'Pending'} />
          {s.missing.length > 0 && <Stat label="Required first" value={s.missing.map((m) => m.code).join(', ')} />}
          <LinkButton to={nextStep(level, progress)} className="mt-3 w-full">
            {s.pct === 0 ? `Start ${lower}` : s.finished ? 'Review' : 'Continue'}
          </LinkButton>
        </Card>
      </div>

      <div>
        <Eyebrow className="mb-2">Apply it</Eyebrow>
        <div className="grid gap-3 md:grid-cols-3">
          {level.scenarioCount > 0 && (
            <Tool title="Scenario practice" to={stepPath(level.key, 'scenarios')} action={s.scenarios ? 'Review scenarios' : 'Start scenarios'}>
              {level.scenarioCount} situations from the job. Pick what you would do and check it against the standard.
            </Tool>
          )}
          {level.assessmentCount > 0 && (
            <Tool title={`${unit} assessment`} to={stepPath(level.key, 'assessment')} action={s.best == null ? 'Take the assessment' : s.passed ? 'Review results' : 'Retake'}>
              {level.assessmentCount} questions. Pass mark {level.pass_pct}%. You can retake it.
            </Tool>
          )}
          {s.skillsTotal > 0 && (
            <Tool title="Hands-on skills" to={stepPath(level.key, 'skills')} action={s.skillsDone === s.skillsTotal ? 'View' : 'See the skills'}>
              {s.skillsTotal} things to do in front of a leader, who checks each one off. {s.skillsDone} done so far.
            </Tool>
          )}
          <Tool
            title={level.ack_formal ? (level.ack_title ? `${level.ack_title} acknowledgment` : 'Acknowledgment') : `${unit} sign-off`}
            to={stepPath(level.key, 'signoff')}
            action={s.signed ? 'View' : 'Sign'}
          >
            {level.ack_formal
              ? 'Confirm you have read and understand these standards and agree to meet them at your site.'
              : `Confirm you have completed this ${lower} and can perform its standards, with your trainer or leader.`}
          </Tool>
        </div>
      </div>
    </div>
  )
}

function Tool({ title, to, action, children }: { title: string; to: string; action: string; children: ReactNode }) {
  return (
    <Card className="flex flex-col gap-2">
      <h3 className="font-semibold text-ink">{title}</h3>
      <p className="flex-1 text-sm text-ink-muted">{children}</p>
      <div><LinkButton to={to} size="sm" variant="secondary">{action}</LinkButton></div>
    </Card>
  )
}
