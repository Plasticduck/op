import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Check, Lock, PencilLine, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { academy, levelStatus, nextInTrack, overallPct, type OutlineTrack } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { ACADEMY_BASE, levelPath, useAcademy } from './context'
import { TraineePicker } from './TraineePicker'
import { Bar, Card, Eyebrow, LinkButton, Pill, Stat, TraineeBar, WhyBox } from './ui'
import { errText, nextStep, useMySites } from './helpers'

const selectCls = 'h-9 w-full rounded-md border border-border bg-content px-2.5 text-sm text-ink outline-none focus:border-accent'

// One track's home (Site Support, Maintenance): its intro, the person's progress in it,
// and its ladder of levels or tiers.
export function TrackHome({ track }: { track: OutlineTrack }) {
  const { outline, progress, learner, trainee, me, canEdit, setLearner, toast } = useAcademy()
  const sites = useMySites()
  const [picking, setPicking] = useState(false)
  const [saving, setSaving] = useState(false)
  if (!outline) return null
  const all = outline.allLevels
  const levels = track.levels
  const unit = track.unit_label.toLowerCase()
  const sum = overallPct(levels, progress, all)
  // The role picker belongs to the first track (Site Support's roles).
  const roleTrack = outline.tracks[0]?.id === track.id
  const mine = levels.find((l) => l.key === learner?.level_key)
    ?? levels.find((l) => !levelStatus(l, progress, all).complete)
    ?? levels[0]
  const ms = mine ? levelStatus(mine, progress, all) : null
  const next = mine ? nextInTrack(outline, mine) : undefined

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

      {levels.length > 0 && sum.complete === levels.length && (
        <div className="flex items-center gap-3 rounded-xl border border-ok/50 bg-ok-soft px-4 py-3 text-sm text-ok">
          <Check className="size-5" /> <span><b>Every {unit} of {track.title} complete.</b> Signed off.</span>
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="flex flex-col gap-3">
          {track.eyebrow && <Eyebrow tone="red">{track.eyebrow}</Eyebrow>}
          <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">{track.headline || track.title}</h2>
          {track.intro && <p className="text-[15px] leading-relaxed text-ink-muted">{track.intro}</p>}
          <WhyBox text={track.why} label={`Why ${track.title} matters`} />
          {mine && ms && (
            <div className="flex flex-wrap gap-2 pt-1">
              <LinkButton to={nextStep(mine, progress)}>
                {ms.pct === 0 ? `Start ${mine.short_title}` : ms.finished ? `Review ${mine.short_title}` : `Continue ${mine.short_title}`}
              </LinkButton>
              {next && ms.finished && (
                <LinkButton to={levelPath(next.key)} variant="secondary">Start {next.short_title}</LinkButton>
              )}
            </div>
          )}
        </Card>

        <Card>
          <Eyebrow>{who} {track.title} progress</Eyebrow>
          {learner ? (
            <>
              <div className="mt-1 text-4xl font-bold text-ink">{sum.pct}<span className="text-lg text-ink-muted">%</span></div>
              <Bar pct={sum.pct} className="mb-3 mt-2" />
              <Stat label={`${track.unit_label}s complete`} value={`${sum.complete} / ${levels.length}`} />
              <Stat label={trainee ? `Their ${unit}` : `Your ${unit}`} value={mine?.short_title ?? 'None'} />
              <Stat label={`${track.unit_label} progress`} value={`${ms?.pct ?? 0}%`} />
              {roleTrack && (
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
              )}
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
        <Eyebrow className="mb-2">The {unit}s</Eyebrow>
        <div className="flex flex-col gap-2">
          {levels.map((l) => {
            const s = levelStatus(l, progress, all)
            const isMine = l.key === learner?.level_key
            const needs = l.requires.map((id) => all.find((x) => x.id === id)).filter((x) => !!x && x.active)
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
                    'flex size-10 items-center justify-center rounded-full text-sm font-bold',
                    s.complete ? 'bg-ok text-white' : isMine ? 'bg-accent text-white' : 'bg-content text-ink-muted ring-1 ring-border',
                  )}
                >
                  {s.complete ? <Check className="size-5" strokeWidth={3} /> : l.code}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold text-ink">{l.title}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-ink-muted">
                    <span>{l.lessons.length} lessons</span>
                    {l.scenarioCount > 0 && <span>· {l.scenarioCount} scenarios</span>}
                    {l.assessmentCount > 0 && <span>· assessment</span>}
                    {l.skills.length > 0 && <span>· {l.skills.length} hands-on skills</span>}
                    <span>· {l.ack_formal ? 'acknowledgment' : 'sign-off'}</span>
                    {l.draft ? <Pill tone="warn">draft</Pill> : <Pill tone="blue">issued</Pill>}
                    {isMine && <Pill tone="red">{trainee ? `their ${unit}` : `your ${unit}`}</Pill>}
                    {s.signed && !s.verified && <Pill>awaiting leader</Pill>}
                  </span>
                  {needs.length > 0 && (
                    <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
                      {needs.map((n) => {
                        const ok = levelStatus(n!, progress).finished
                        return (
                          <span key={n!.id} className={cn('inline-flex items-center gap-1', ok ? 'text-ok' : 'text-warn')}>
                            {ok ? <Check className="size-3.5" /> : <Lock className="size-3.5" />}
                            Requires {n!.short_title}
                          </span>
                        )
                      })}
                    </span>
                  )}
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
        {levels.some((l) => l.draft) ? ` ${track.unit_label}s marked draft are pending leadership review.` : ''}
      </p>

      {picking && <TraineePicker onClose={() => setPicking(false)} />}
    </div>
  )
}
