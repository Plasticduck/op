import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, Clock, MessageSquareReply } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { dateTime } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { fnErrorMessage } from '@/lib/fnError'
import { siteAuditsV2, type SiteAuditV2, type SiteRm } from '@/lib/queries/siteAuditsV2'
import { noRmReason, normalizeAnswers, normalizeResponses, redItems, type RedItem } from './form'
import { AuditPhotos, GrowTextarea } from './parts'

const FRIENDLY: Record<string, string> = {
  missing_responses: 'Answer every red item before marking the audit complete.',
  not_open: 'This audit is no longer waiting on an answer. Reload the page to see where it is.',
  not_allowed: "Only the site's Regional Manager or an Admin can answer this audit.",
  not_found: "This audit isn't available to you.",
}
const friendly = (msg: string) => FRIENDLY[msg] ?? msg

// The follow-up on a submitted audit, at the top of its report. Red items wait on
// the site's Regional Manager, who answers each one and marks the audit complete
// (an Admin can too); a text then says it was acknowledged. Clean audits are
// complete from the start.
export function ReviewPanel({ audit, rms, onChanged }: { audit: SiteAuditV2; rms: Map<string, SiteRm> | null; onChanged: () => void }) {
  const { profile } = useAuth()
  const answers = useMemo(() => normalizeAnswers(audit.answers), [audit.answers])
  const reds = useMemo(() => redItems(answers), [answers])
  const rm = rms?.get(audit.location_id) ?? null

  if (audit.review_status === 'complete') return <CompleteCard audit={audit} reds={reds} />
  if (audit.review_status !== 'needs_attention') return null
  if (!rms) return <div className="h-24 animate-pulse rounded-md border border-border bg-card" />

  const isRm = !!rm?.user_id && rm.user_id === profile?.id
  if (isRm || profile?.role === 'owner') return <RespondForm audit={audit} reds={reds} rm={rm} isRm={isRm} onChanged={onChanged} />

  return (
    <section className="rounded-md border border-danger/40 bg-danger-soft/40 px-4 py-3">
      <h2 className="flex items-center gap-2 text-base font-semibold text-danger"><Clock className="size-4" /> Needs attention</h2>
      <p className="mt-1 text-sm text-ink">
        {reds.length} red item{reds.length === 1 ? '' : 's'}.{' '}
        {rm?.user_id
          ? <>Waiting on <span className="font-semibold">{rm.name}</span> (Regional Manager{rm.region ? `, ${rm.region}` : ''}) to answer and mark the audit complete.</>
          : `${noRmReason(rm)}, so an Admin answers and marks the audit complete.`}
      </p>
      <ul className="mt-2 list-disc pl-5 text-sm text-ink-muted">
        {reds.map((r) => <li key={r.key}>{r.section.title}: {r.item.label}</li>)}
      </ul>
    </section>
  )
}

function RespondForm({ audit, reds, rm, isRm, onChanged }: {
  audit: SiteAuditV2
  reds: RedItem[]
  rm: SiteRm | null
  isRm: boolean
  onChanged: () => void
}) {
  const { profile } = useAuth()
  const [responses, setResponses] = useState<Record<string, string>>(() => normalizeResponses(audit.rm_responses))
  const [note, setNote] = useState(audit.rm_note ?? '')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const id = audit.id
  const latest = useRef({ responses, note })
  const dirty = useRef(false)
  const closed = useRef(false)
  const first = useRef(true)
  const chain = useRef<Promise<unknown>>(Promise.resolve())

  // Answers save as they're typed, so an RM on a phone who gets pulled away
  // doesn't lose them.
  const persist = useCallback(() => {
    const run = async () => {
      if (closed.current || !dirty.current) return
      dirty.current = false
      setSaveState('saving')
      const { responses: r, note: n } = latest.current
      const { error: err } = await siteAuditsV2.respond(id, r, n, false)
      if (err) {
        dirty.current = true
        setSaveState('error')
        setError('Could not save: ' + friendly(err.message))
        return
      }
      setSaveState('saved')
    }
    const p = chain.current.then(run, run)
    chain.current = p
    return p
  }, [id])

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    latest.current = { responses, note }
    dirty.current = true
    const t = setTimeout(() => { void persist() }, 1000)
    return () => clearTimeout(t)
  }, [responses, note, persist])

  useEffect(() => {
    const flush = () => { if (document.visibilityState === 'hidden') void persist() }
    document.addEventListener('visibilitychange', flush)
    window.addEventListener('pagehide', persist)
    return () => {
      document.removeEventListener('visibilitychange', flush)
      window.removeEventListener('pagehide', persist)
      void persist()
    }
  }, [persist])

  const answered = reds.filter((r) => (responses[r.key] ?? '').trim()).length
  const allAnswered = answered === reds.length
  const site = audit.location?.name ?? 'This site'

  const complete = async () => {
    setBusy(true)
    setError(null)
    closed.current = true
    await chain.current.catch(() => undefined)
    const { error: err } = await siteAuditsV2.respond(id, responses, note, true)
    if (err) {
      closed.current = false
      setBusy(false)
      setConfirming(false)
      setError(friendly(err.message))
      return
    }
    const ack = await siteAuditsV2.notifyAck(id)
    if (ack.error) {
      window.alert('The audit is complete, but the text alert did not go out: ' + await fnErrorMessage(ack.error, ack.data, 'unknown error'))
    }
    onChanged()
  }

  const saveLabel = saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : saveState === 'error' ? 'Not saved' : 'Saves as you type'

  return (
    <section className="rounded-md border border-danger/40 bg-card">
      <div className="border-b border-danger/30 bg-danger-soft/50 px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-danger">
          <MessageSquareReply className="size-4" /> {isRm ? 'Needs your attention' : 'Needs attention'}
        </h2>
        <p className="mt-1 text-sm text-ink">
          {reds.length} red item{reds.length === 1 ? '' : 's'} at {site}. Answer each one with the fix or a reply, then mark the audit complete.
        </p>
        {!isRm && (
          <p className="mt-1 text-xs text-ink-muted">
            {rm?.user_id
              ? `This site's Regional Manager is ${rm.name}${rm.region ? ` (${rm.region})` : ''}. As an Admin, you can answer for them.`
              : `${noRmReason(rm)}, so an Admin answers it.`}
          </p>
        )}
      </div>

      <ol className="flex flex-col gap-3 px-4 py-3">
        {reds.map((r, i) => (
          <li key={r.key} className="rounded-md border border-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{i + 1}. {r.section.title}</p>
            <p className="font-medium text-ink">{r.item.label}</p>
            {r.answer.comments.trim() && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted"><span className="font-medium text-ink">Auditor:</span> {r.answer.comments}</p>
            )}
            {r.answer.photos.length > 0 && <AuditPhotos paths={r.answer.photos} small />}
            <GrowTextarea
              value={responses[r.key] ?? ''}
              onChange={(v) => setResponses((prev) => ({ ...prev, [r.key]: v }))}
              label={`Solution or reply for ${r.section.title}: ${r.item.label}`}
              placeholder="Solution or reply"
              className="mt-2 w-full"
            />
          </li>
        ))}
        <li>
          <GrowTextarea value={note} onChange={setNote} label="Anything else" placeholder="Anything else (optional)" className="w-full" minPx={48} />
        </li>
      </ol>

      {error && <p className="mx-4 mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
        <p className="text-xs text-ink-muted">
          <span className={allAnswered ? 'font-semibold text-ok' : 'font-semibold text-ink'}>{answered} of {reds.length} answered</span> · {saveLabel}
        </p>
        <Button disabled={!allAnswered || busy} onClick={() => setConfirming(true)}>
          <CheckCircle2 className="size-4" /> Mark complete
        </Button>
      </div>

      {confirming && (
        <Modal open onClose={() => !busy && setConfirming(false)} title="Mark this audit complete?" size="sm">
          <div className="flex flex-col gap-4">
            <p className="text-sm text-ink">
              {site} moves to Complete with your answers, and a text goes out that {isRm ? 'you' : (profile?.name ?? 'you')} acknowledged it.
              Answers can't be changed after this.
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</Button>
              <Button disabled={busy} onClick={() => void complete()}>{busy ? 'Completing…' : 'Mark complete'}</Button>
            </div>
          </div>
        </Modal>
      )}
    </section>
  )
}

function CompleteCard({ audit, reds }: { audit: SiteAuditV2; reds: RedItem[] }) {
  const responses = normalizeResponses(audit.rm_responses)
  if (!audit.completed_by_name && !reds.length) {
    return (
      <section className="flex items-start gap-2 rounded-md border border-ok/40 bg-ok-soft/50 px-4 py-3">
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
        <p className="text-sm text-ink"><span className="font-semibold text-ok">Complete.</span> No red items, so no Regional Manager follow-up was needed.</p>
      </section>
    )
  }
  const role = audit.completed_role === 'admin' ? 'Admin' : 'Regional Manager'
  return (
    <section className="rounded-md border border-ok/40 bg-card">
      <div className="border-b border-ok/30 bg-ok-soft/50 px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold text-ok"><CheckCircle2 className="size-4" /> Complete</h2>
        <p className="mt-1 text-sm text-ink">
          Acknowledged by <span className="font-semibold">{audit.completed_by_name ?? 'unknown'}</span> ({role})
          {audit.completed_at ? ` on ${dateTime(audit.completed_at)}` : ''}.
        </p>
      </div>
      <ol className="flex flex-col gap-3 px-4 py-3">
        {reds.map((r, i) => (
          <li key={r.key} className="rounded-md border border-border p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{i + 1}. {r.section.title}</p>
            <p className="font-medium text-ink">{r.item.label}</p>
            {r.answer.comments.trim() && (
              <p className="mt-1 whitespace-pre-wrap text-sm text-ink-muted"><span className="font-medium text-ink">Auditor:</span> {r.answer.comments}</p>
            )}
            <p className="mt-2 whitespace-pre-wrap rounded-md bg-ok-soft/50 px-3 py-2 text-sm text-ink">
              <span className="font-medium">{role === 'Admin' ? 'Response' : 'RM response'}:</span> {responses[r.key] || '—'}
            </p>
          </li>
        ))}
        {audit.rm_note && (
          <li className="whitespace-pre-wrap text-sm text-ink"><span className="font-medium">Note:</span> {audit.rm_note}</li>
        )}
      </ol>
    </section>
  )
}
