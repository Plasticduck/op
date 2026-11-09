import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, PencilLine, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { academy, levelStatus, overallPct } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { ACADEMY_BASE, levelPath, useAcademy } from './context'
import { TraineePicker } from './TraineePicker'
import { Bar, Card, Eyebrow, LinkButton, Pill, Stat, TraineeBar, WhyBox } from './ui'
import { errText, nextStep, useMySites } from './helpers'

const selectCls = 'h-9 w-full rounded-md border border-border bg-content px-2.5 text-sm text-ink outline-none focus:border-accent'

export function RoadMap() {
  const { outline, progress, learner, trainee, me, canEdit, setLearner, toast } = useAcademy()
  const sites = useMySites()
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  if (!outline) return null
  const levels = outline.levels
  const program = outline.program
  const all = overallPct(levels, progress)
  const mine = levels.find((l) => l.key === learner?.level_key) ?? levels.find((l) => !levelStatus(l, progress).complete) ?? levels[0]
  const ms = mine ? levelStatus(mine, progress) : null
  const next = mine ? levels[levels.indexOf(mine) + 1] : undefined

  const update = async (levelKey: string | null, location: string | null) => {
    if (!learner) return
    setSaving(true)
    try {
      await academy.updateLearner(learner.id, levelKey, location)
      setLearner({ ...learner, level_key: levelKey, location_id: location })
      toast('Saved')
    } catch (e) {
      toast(errText(e))
    } finally {
      setSaving(false)
    }
  }

  const who = trainee ? `${trainee.name.split(' ')[0]}'s` : 'Your'
  return (
    <div className="flex flex-col gap-5">
      <TraineeBar />
      {(me?.leader || canEdit) && (
        <div className="flex flex-wrap justify-end gap-2">
          {me?.leader && (
            <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
              <UserPlus className="size-4" /> Train a team member
            </Button>
          )}
          {canEdit && (
            <Link to={`${ACADEMY_BASE}/edit`} className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-sm font-medium text-ink hover:bg-content">
              <PencilLine className="size-4" /> Edit content
            </Link>
          )}
        </div>
      )}

      {levels.length > 0 && all.complete === levels.length && (
        <div className="flex items-center gap-3 rounded-xl border border-ok/50 bg-ok-soft px-4 py-3 text-sm text-ok">
          <Check className="size-5" /> <span><b>Every level complete.</b> The whole program, signed off.</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex flex-col gap-3">
          {program?.eyebrow && <Eyebrow tone="red">{program.eyebrow}</Eyebrow>}
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{program?.headline || program?.title || 'Academy'}</h2>
          {program?.intro && <p className="text-[15px] leading-relaxed text-ink-muted">{program.intro}</p>}
          <WhyBox text={program?.why_program} label="Why this program exists" />
          {mine && ms && (
            <div className="flex flex-wrap gap-2 pt-1">
              <LinkButton to={nextStep(mine, progress)}>
                {ms.pct === 0 ? `Start ${mine.short_title}` : ms.complete ? `Review ${mine.short_title}` : `Continue ${mine.short_title}`}
              </LinkButton>
              {next && ms.complete && (
                <LinkButton to={levelPath(next.key)} variant="secondary">Start {next.short_title}</LinkButton>
              )}
            </div>
          )}
        </Card>

        <Card>
          <Eyebrow>{who} progress</Eyebrow>
          {learner ? (
            <>
              <div className="mt-1 text-4xl font-bold text-ink">{all.pct}<span className="text-lg text-ink-muted">%</span></div>
              <Bar pct={all.pct} className="mb-3 mt-2" />
              <Stat label="Levels complete" value={`${all.complete} / ${levels.length}`} />
              <Stat label={trainee ? 'Their level' : 'Your level'} value={mine?.short_title ?? 'None'} />
              <Stat label="Level progress" value={`${ms?.pct ?? 0}%`} />
              <label className="mt-3 block text-xs font-medium text-ink-muted">
                {trainee ? 'Their current role' : 'My current role'}
                <select
                  className={cn(selectCls, 'mt-1')}
                  disabled={saving}
                  value={learner.level_key ?? ''}
                  onChange={(e) => void update(e.target.value || null, learner.location_id)}
                >
                  <option value="">Choose a role</option>
                  {levels.map((l) => <option key={l.id} value={l.key}>{l.num}. {l.title}</option>)}
                </select>
              </label>
              <label className="mt-2 block text-xs font-medium text-ink-muted">
                {trainee ? 'Their site' : 'My site'}
                <select
                  className={cn(selectCls, 'mt-1')}
                  disabled={saving}
                  value={learner.location_id ?? ''}
                  onChange={(e) => void update(learner.level_key, e.target.value || null)}
                >
                  <option value="">Choose a site</option>
                  {sites.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </label>
            </>
          ) : (
            <p className="mt-2 text-sm text-ink-muted">This login can read the training. Progress isn't recorded for it.</p>
          )}
        </Card>
      </div>

      <div>
        <Eyebrow className="mb-2">The ladder</Eyebrow>
        <div className="flex flex-col gap-2">
          {levels.map((l) => {
            const s = levelStatus(l, progress)
            const isMine = l.key === learner?.level_key
            return (
              <Link
                key={l.id}
                to={levelPath(l.key)}
                className={cn(
                  'grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-xl border bg-card p-3 shadow-sm transition hover:border-accent/60 sm:p-4',
                  isMine ? 'border-accent' : 'border-border',
                )}
              >
                <span
                  className={cn(
                    'flex size-10 items-center justify-center rounded-full text-base font-bold',
                    s.complete ? 'bg-ok text-white' : isMine ? 'bg-accent text-white' : 'bg-content text-ink-muted ring-1 ring-border',
                  )}
                >
                  {s.complete ? <Check className="size-5" strokeWidth={3} /> : l.num}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{l.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
                    <span>{l.lessons.length} lessons</span>
                    {l.scenarioCount > 0 && <span>· {l.scenarioCount} scenarios</span>}
                    {l.assessmentCount > 0 && <span>· assessment</span>}
                    <span>· {l.ack_formal ? 'acknowledgment' : 'sign-off'}</span>
                    {l.draft ? <Pill tone="warn">draft</Pill> : <Pill tone="blue">issued</Pill>}
                    {isMine && <Pill tone="red">{trainee ? 'their level' : 'your level'}</Pill>}
                    {s.signed && !s.verified && <Pill>awaiting leader</Pill>}
                  </span>
                  <Bar pct={s.pct} className="mt-2 max-w-md" />
                </span>
                <span className="text-right">
                  <span className="block text-lg font-bold text-ink">{s.pct}%</span>
                  <span className="text-xs text-accent">{s.pct === 0 ? 'Start' : s.complete ? 'Review' : 'Continue'} →</span>
                </span>
              </Link>
            )
          })}
        </div>
      </div>

      <p className="text-xs text-ink-subtle">
        {learner ? 'Progress saves to the Operator account, so it follows the person to any device.' : ''}
        {levels.some((l) => l.draft) ? ' Levels marked draft are pending leadership review.' : ''}
      </p>

      {picking && <TraineePicker onClose={() => setPicking(false)} />}
    </div>
  )
}
