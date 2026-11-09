import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { Check, UserRound } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useLocations } from '@/lib/locations'
import { academy, levelStatus, type Learner, type Progress } from '@/lib/queries/academy'
import { useAcademy } from './context'
import { BackLink, Bar, Card, Dot, Eyebrow, Pill } from './ui'
import { errText, fmtDate } from './helpers'

// One person's whole Academy record, for their leaders.
export default function LearnerPage() {
  const { learnerId } = useParams()
  const { outline, me, startTrainee, toast } = useAcademy()
  const { locations } = useLocations()
  const navigate = useNavigate()
  const [learner, setLearner] = useState<Learner | null | undefined>(undefined)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!learnerId) return
    try {
      const [l, p] = await Promise.all([academy.learner(learnerId), academy.progress(learnerId)])
      setLearner(l)
      setProgress(p)
    } catch (e) {
      setError(errText(e))
    }
  }, [learnerId])
  useEffect(() => { void load() }, [load])

  const act = async (key: string, fn: () => Promise<void>, done: string) => {
    setBusy(key)
    try {
      await fn()
      toast(done)
      await load()
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(null)
    }
  }

  const back = <BackLink to="/app/training?tab=team">Team progress</BackLink>
  if (error) return <div className="flex flex-col gap-3">{back}<p className="text-sm text-danger">{error}</p></div>
  if (learner === undefined) return <div className="flex flex-col gap-3">{back}<p className="text-sm text-ink-muted">Loading…</p></div>
  if (!learner || !outline) return <div className="flex flex-col gap-3">{back}<p className="text-sm text-ink-muted">You can't see that person's record.</p></div>

  const own = learner.id === me?.learner?.id
  const site = locations.find((l) => l.id === learner.location_id)?.name
  const role = outline.levels.find((l) => l.key === learner.level_key)
  return (
    <div className="flex flex-col gap-4">
      {back}
      <Card className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-11 items-center justify-center rounded-full bg-content text-ink-muted ring-1 ring-border"><UserRound className="size-5" /></span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-ink">{learner.name}</h2>
              {!learner.user_id && <Pill>no login</Pill>}
            </div>
            <p className="text-sm text-ink-muted">
              {[site, role ? `${role.num}. ${role.title}` : 'Role not set', learner.last_active_at ? `last active ${fmtDate(learner.last_active_at)}` : 'not started']
                .filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
        {learner.employee_id && me?.leader && (
          <Button
            variant="secondary"
            disabled={busy === 'train'}
            onClick={() => void (async () => {
              setBusy('train')
              try {
                await startTrainee(learner.employee_id!)
                toast(`Training ${learner.name.split(' ')[0]} on this device`)
                navigate('/app/training')
              } catch (e) {
                toast(errText(e))
                setBusy(null)
              }
            })()}
          >
            Train on this device
          </Button>
        )}
      </Card>

      {outline.levels.map((level) => {
        const s = levelStatus(level, progress)
        const tries = progress?.assessments.get(level.id) ?? []
        const scen = progress?.scenarios.get(level.id)?.[0]
        const sign = progress?.signoffs.get(level.id)
        const started = s.got > 0 || tries.length > 0
        return (
          <Card key={level.id} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <Eyebrow>Level {level.num}</Eyebrow>
                <h3 className="font-semibold text-ink">{level.title}</h3>
              </div>
              <div className="flex items-center gap-2">
                <Bar pct={s.pct} className="w-28" />
                <b className="tabular-nums text-ink">{s.pct}%</b>
              </div>
            </div>
            {!started ? (
              <p className="text-sm text-ink-muted">Not started.</p>
            ) : (
              <div className="grid gap-3 text-sm md:grid-cols-3">
                <div>
                  <Eyebrow>Lessons</Eyebrow>
                  <details className="mt-1">
                    <summary className="cursor-pointer text-ink">{s.done} of {s.total} done</summary>
                    <ul className="mt-1.5 flex flex-col gap-1">
                      {level.lessons.map((l) => {
                        const d = progress?.lessons.get(l.id)?.done_at
                        return (
                          <li key={l.id} className="flex items-center gap-2 text-ink-muted">
                            <Dot done={!!d} /> <span className="min-w-0 flex-1 truncate text-ink">{l.title}</span>
                            {d && <span className="shrink-0 text-xs">{fmtDate(d)}</span>}
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                </div>
                <div>
                  <Eyebrow>Practice and assessment</Eyebrow>
                  <p className="mt-1 text-ink">
                    {level.scenarioCount > 0 && (scen ? `Scenarios ${scen.correct}/${scen.total} on ${fmtDate(scen.created_at)}` : 'Scenarios not done')}
                  </p>
                  {level.assessmentCount > 0 && (
                    tries.length === 0 ? <p className="text-ink">Assessment not taken</p> : (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {tries.map((a) => (
                          <li key={a.id} className="flex items-center gap-2 text-ink">
                            <span className="tabular-nums">{a.score}%</span>
                            {a.passed ? <Pill tone="ok">passed</Pill> : <Pill tone="warn">below {level.pass_pct}%</Pill>}
                            <span className="text-xs text-ink-muted">{fmtDate(a.created_at)}</span>
                          </li>
                        ))}
                      </ul>
                    )
                  )}
                </div>
                <div>
                  <Eyebrow>{level.ack_formal ? 'Acknowledgment' : 'Sign-off'}</Eyebrow>
                  {!sign ? (
                    <p className="mt-1 text-ink">Not signed</p>
                  ) : (
                    <div className="mt-1 flex flex-col gap-1.5">
                      <p className="text-ink">
                        Signed by {sign.signer_name} on {fmtDate(sign.signed_on)}
                        {sign.site_label ? ` at ${sign.site_label}` : ''}
                        {sign.leader_name ? `, with ${sign.leader_name}` : ''}.
                      </p>
                      {sign.verified_at
                        ? <span><Pill tone="ok">Verified by {sign.verified_name} {fmtDate(sign.verified_at)}</Pill></span>
                        : <span><Pill tone="warn">Not verified</Pill></span>}
                      {me?.leader && !own && (
                        <div className="flex flex-wrap gap-2">
                          {sign.verified_at ? (
                            <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void act(sign.id, () => academy.verify(sign.id, false), 'Verification removed')}>Undo verify</Button>
                          ) : (
                            <Button size="sm" disabled={!!busy} onClick={() => void act(sign.id, () => academy.verify(sign.id, true), 'Sign-off verified')}><Check className="size-4" /> Verify</Button>
                          )}
                          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => void act(`u${sign.id}`, () => academy.unsign(sign.id), 'Sign-off reopened')}>Reopen</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </Card>
        )
      })}
    </div>
  )
}
