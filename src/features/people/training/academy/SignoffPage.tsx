import { useState } from 'react'
import { useAuth } from '@/lib/auth'
import { Button } from '@/components/ui/Button'
import { academy, levelStatus } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { levelPath, useAcademy } from './context'
import { Card, Eyebrow, LinkButton, Pill, WhyBox } from './ui'
import { errText, fmtDate, todayIso, useLevel, useMySites } from './helpers'

const inputCls = 'h-10 w-full rounded-md border border-border bg-content px-3 text-sm text-ink outline-none focus:border-accent'
const labelCls = 'mb-1 block text-xs font-medium text-ink-muted'

// Keyed by learner, so the form starts from the right person once they load.
export default function SignoffPage() {
  const { learner } = useAcademy()
  return <Signoff key={learner?.id ?? "none"} />
}

function Signoff() {
  const { level } = useLevel()
  const { outline, progress, learner, trainee, me, reloadProgress, toast } = useAcademy()
  const { profile } = useAuth()
  const sites = useMySites()
  const sign = progress?.signoffs.get(level.id)
  const s = levelStatus(level, progress)
  const formal = level.ack_formal
  const levels = outline!.levels
  const next = levels[levels.indexOf(level) + 1]

  const [name, setName] = useState(learner?.name ?? '')
  const [site, setSite] = useState(learner?.location_id ?? '')
  const [date, setDate] = useState(todayIso())
  const [leader, setLeader] = useState(trainee ? (profile?.name ?? '') : '')
  const [agree, setAgree] = useState(false)
  const [verify, setVerify] = useState(!!trainee)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ready = s.done === s.total && (level.scenarioCount === 0 || s.scenarios) && (level.assessmentCount === 0 || s.passed)
  const ownLearner = !!learner && learner.id === me?.learner?.id
  const canWithdraw = !!sign && (!sign.verified_at || (!!me?.leader && !ownLearner))

  const submit = async () => {
    if (!learner) return
    if (!name.trim() || !site) { setError('Enter the name and pick the site.'); return }
    if (!agree) { setError('Check the signature box to sign.'); return }
    setBusy(true)
    setError(null)
    try {
      await academy.sign({ learner: learner.id, level: level.id, name, location: site, signedOn: date, leaderName: leader, verify: !!trainee && verify })
      await reloadProgress()
      toast(formal ? 'Acknowledgment signed' : 'Level signed off')
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const withdraw = async () => {
    if (!sign) return
    setBusy(true)
    try {
      await academy.unsign(sign.id)
      await reloadProgress()
      toast('Sign-off removed')
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Eyebrow tone="red">Level {level.num} · {level.short_title}</Eyebrow>
      <h2 className="text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        {formal ? (level.ack_title || 'Acknowledgment') : `${level.title} sign-off`}
      </h2>
      <WhyBox text={outline?.program?.why_signoff} />

      {sign ? (
        <>
          <div className="rounded-xl border-2 border-ok bg-card p-5">
            <Eyebrow tone="blue">{formal ? 'Acknowledged' : 'Signed off'}</Eyebrow>
            <p className="mt-2 text-[15px] leading-relaxed text-ink">{sign.statement}</p>
            <div className="ac-signature mt-3 inline-block border-b border-ink px-1 text-ink">{sign.signer_name}</div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <Field label={formal ? 'Signed by' : 'Team member'} value={sign.signer_name} />
              <Field label="Site" value={sign.site_label ?? ''} />
              <Field label="Date" value={fmtDate(sign.signed_on)} />
              <Field label={formal ? 'Regional Manager' : 'Trainer or leader'} value={sign.leader_name ?? ''} />
            </dl>
            <div className="mt-4">
              {sign.verified_at ? (
                <Pill tone="ok">Verified by {sign.verified_name} on {fmtDate(sign.verified_at)}</Pill>
              ) : (
                <Pill tone="warn">Waiting for a leader to verify</Pill>
              )}
            </div>
          </div>
          <p className="text-xs text-ink-subtle">
            Signed {fmtDate(sign.signed_at)}. {sign.verified_at ? '' : 'A leader verifies it under Team progress.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {canWithdraw && learner && (
              <Button variant="secondary" disabled={busy} onClick={() => void withdraw()}>
                {sign.verified_at ? 'Reopen' : 'Take back'}
              </Button>
            )}
            <LinkButton variant="secondary" to={levelPath(level.key)}>Back to level</LinkButton>
            {next && <LinkButton to={levelPath(next.key)}>Start {next.short_title}</LinkButton>}
          </div>
        </>
      ) : !learner ? (
        <Card>
          <p className="text-[15px] leading-relaxed text-ink">{level.ack_statement}</p>
          <p className="mt-3 text-sm text-ink-muted">This login can read the statement but can't sign it.</p>
        </Card>
      ) : (
        <Card className="flex flex-col gap-3">
          <p className="text-[15px] font-medium leading-relaxed text-ink">{level.ack_statement}</p>
          {!ready && (
            <p className="text-sm text-ink-muted">
              You can sign now, but the program expects the lessons{level.scenarioCount ? ', scenarios' : ''}
              {level.assessmentCount ? ' and assessment' : ''} to be complete first. {s.done} of {s.total} lessons done
              {level.assessmentCount ? (s.passed ? ', assessment passed' : ', assessment not yet passed') : ''}.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block">
              <span className={labelCls}>{formal ? 'Your name' : trainee ? 'Team member' : 'Your name'}</span>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} autoComplete="name" />
            </label>
            <label className="block">
              <span className={labelCls}>Site</span>
              <select value={site} onChange={(e) => setSite(e.target.value)} className={inputCls}>
                <option value="">Pick the site</option>
                {sites.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            </label>
            <label className="block">
              <span className={labelCls}>Date</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={inputCls} />
            </label>
            <label className="block">
              <span className={labelCls}>{formal ? 'Regional Manager' : 'Trainer or leader who verified'}</span>
              <input value={leader} onChange={(e) => setLeader(e.target.value)} className={inputCls} />
            </label>
          </div>
          <label className={cn('flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 text-sm', agree ? 'border-ok bg-ok-soft' : 'border-border')}>
            <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5 size-4" />
            <span className="text-ink">
              Typing {trainee ? 'their' : 'my'} name above is {trainee ? 'their' : 'my'} signature.{' '}
              {formal ? 'I agree to meet these standards at my site.' : `${trainee ? 'They' : 'I'} can perform the standards in this level and will hold them on every shift.`}
            </span>
          </label>
          {trainee && (
            <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border px-3 py-2.5 text-sm">
              <input type="checkbox" checked={verify} onChange={(e) => setVerify(e.target.checked)} className="mt-0.5 size-4" />
              <span className="text-ink">I'm the leader here and I verify this sign-off ({profile?.name}).</span>
            </label>
          )}
          {error && <p className="text-sm text-danger">{error}</p>}
          <div>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? 'Signing…' : formal ? 'Sign acknowledgment' : 'Sign off this level'}
            </Button>
          </div>
        </Card>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-bold uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="text-ink">{value || 'Not given'}</dd>
    </div>
  )
}
