import { useState } from 'react'
import { CheckCircle2, Circle } from 'lucide-react'
import { academy, levelStatus } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { levelPath, stepPath, useAcademy } from './context'
import { Card, Eyebrow, LinkButton, Pill } from './ui'
import { errText, fmtDate, useLevel } from './helpers'

// Hands-on skills: things a quiz can't show, done in front of a leader who checks each
// one off. Nobody checks off their own.
export default function SkillsPage() {
  const { level } = useLevel()
  const { progress, learner, trainee, me, reloadProgress, toast } = useAcademy()
  const [busy, setBusy] = useState<string | null>(null)
  const s = levelStatus(level, progress)
  const checks = progress?.skills.get(level.id)
  // A leader can check off skills for the team member they're training on this device.
  const canCheck = !!me?.leader && !!trainee && learner?.id === trainee.id
  const unit = level.track.unit_label

  const toggle = async (skill: string, on: boolean) => {
    if (!learner) return
    setBusy(skill)
    try {
      await academy.checkSkill(learner.id, level.id, skill, on)
      await reloadProgress()
      toast(on ? 'Checked off' : 'Check removed')
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Eyebrow tone="red">{level.name} · {level.short_title} · Apply it</Eyebrow>
      <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">Hands-on skills</h2>
      <p className="text-[15px] leading-relaxed text-ink-muted">
        These are done for real, in front of a leader who watches and checks each one off.{' '}
        {canCheck
          ? `You're training ${trainee!.name}: check off each skill once you've watched them do it.`
          : 'Ask your General Manager or Regional Manager to watch you do each one. They check it off from your record under Team progress.'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={s.skillsDone === s.skillsTotal ? 'ok' : 'warn'}>{s.skillsDone} of {s.skillsTotal} checked off</Pill>
      </div>
      <Card className="p-0 sm:p-0">
        <ul className="divide-y divide-border">
          {level.skills.map((sk) => {
            const c = checks?.get(sk)
            return (
              <li key={sk} className="flex items-start gap-3 px-4 py-3">
                {c ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" /> : <Circle className="mt-0.5 size-5 shrink-0 text-ink-subtle" />}
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink">{sk}</p>
                  <p className={cn('text-xs', c ? 'text-ok' : 'text-ink-subtle')}>
                    {c ? `Checked off by ${c.checked_name ?? 'a leader'} on ${fmtDate(c.checked_at)}` : 'Not yet'}
                  </p>
                </div>
                {canCheck && (
                  <button
                    type="button"
                    disabled={busy === sk}
                    onClick={() => void toggle(sk, !c)}
                    className={cn(
                      'shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium',
                      c ? 'border-border text-ink-muted hover:bg-content' : 'border-ok bg-ok-soft text-ok hover:opacity-90',
                    )}
                  >
                    {c ? 'Undo' : 'Watched it done'}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      </Card>
      <div className="mt-6 flex flex-wrap justify-between gap-2">
        <LinkButton variant="secondary" to={level.assessmentCount > 0 ? stepPath(level.key, 'assessment') : levelPath(level.key)}>
          ← {level.assessmentCount > 0 ? `${unit} assessment` : `${unit} overview`}
        </LinkButton>
        <LinkButton variant={s.skillsDone === s.skillsTotal ? 'primary' : 'secondary'} to={stepPath(level.key, 'signoff')}>
          {level.ack_formal ? 'Acknowledgment' : 'Sign-off'} →
        </LinkButton>
      </div>
    </div>
  )
}
