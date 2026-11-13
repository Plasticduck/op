import { useMemo, useState } from 'react'
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Loader2, Lock, Mail, UserPlus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { AdoptAndSign } from '@/components/esign/AdoptAndSign'
import { cn } from '@/lib/utils'
import type { AccountUser } from '@/lib/queries/account'
import { purchaseRequests, type ApprovalRule, type Prepared, type PurchaseRequest } from '@/lib/queries/purchaseRequests'
import { prNumber } from './access'
import { DocumentView } from './shared'
import { requiredByRules } from './logic'

const selectCls = 'h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent'

// Step 1: who approves and in what order. Step 2: review the exact document that
// will be signed, then the requester signs it and it goes to the first approver.
export function SendForSignature({ request, signers: eligible, rules, meId, onClose, onBack, onSent }: {
  request: PurchaseRequest
  signers: AccountUser[]
  rules: ApprovalRule[]
  meId: string
  onClose: () => void
  onBack: () => void
  onSent: (envelopeId: string) => void
}) {
  const byId = useMemo(() => new Map(eligible.map((u) => [u.id, u])), [eligible])
  const required = useMemo(() => requiredByRules(rules, Number(request.total), request.category, meId), [rules, request.total, request.category, meId])
  const [order, setOrder] = useState<string[]>(() => [...required.keys()].filter((id) => byId.has(id)))
  const [cc, setCc] = useState<string[]>([])
  const [inOrder, setInOrder] = useState(true)
  const [message, setMessage] = useState('')
  const [step, setStep] = useState<1 | 2>(1)
  const [prepared, setPrepared] = useState<Prepared | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const available = eligible.filter((u) => u.id !== meId && !order.includes(u.id) && !cc.includes(u.id))
  const missingRuleSigners = [...required.keys()].filter((id) => !byId.has(id))

  const move = (i: number, d: -1 | 1) => setOrder((prev) => {
    const next = [...prev]
    const j = i + d
    if (j < 0 || j >= next.length) return prev
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  })

  const review = async () => {
    setBusy(true); setError(null)
    try {
      const p = await purchaseRequests.prepare(request.id, order, cc, inOrder)
      setPrepared(p)
      setStep(2)
    } catch (e) { setError((e as Error).message) }
    setBusy(false)
  }

  const send = async (p: { signature: { kind: 'drawn' | 'typed'; image: string; name: string }; consentVersion: string | null; saveSignature: boolean }) => {
    if (!prepared) return
    setBusy(true); setError(null)
    try {
      const r = await purchaseRequests.send({
        requestId: request.id, signers: order, cc, signInOrder: inOrder, documentHash: prepared.document_hash,
        signature: p.signature, consentVersion: p.consentVersion, message: message.trim(), saveSignature: p.saveSignature,
      })
      onSent(r.envelope_id)
    } catch (e) {
      const msg = (e as Error).message
      setError(msg)
      if (/changed since you reviewed/i.test(msg)) { setStep(1); setPrepared(null) }
    }
    setBusy(false)
  }

  return (
    <Modal open onClose={busy ? () => undefined : onClose} size="xl"
      title={step === 1 ? `Send ${prNumber(request.number)} for signature` : `Review and sign ${prNumber(request.number)}`}
      description={step === 1 ? 'Choose who approves it. You sign first, then it goes to them.' : 'This is exactly what everyone will sign. Check it, then sign to send it.'}>
      {step === 1 ? (
        <div className="flex flex-col gap-5">
          <section>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-ink">Approvers</h3>
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={inOrder} onChange={(e) => setInOrder(e.target.checked)} className="size-4 accent-accent" />
                Sign in this order
              </label>
            </div>
            <p className="mt-0.5 text-xs text-ink-muted">
              {inOrder ? 'Each approver gets it after the one above signs.' : 'Everyone gets it at once and can sign in any order.'}
            </p>
            <ol className="mt-3 flex flex-col gap-2" data-testid="pr-signers">
              {order.map((id, i) => {
                const u = byId.get(id)
                const rule = required.get(id)
                return (
                  <li key={id} className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent/10 text-xs font-semibold text-accent">{inOrder ? i + 1 : '•'}</span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-medium text-ink">{u?.name ?? 'Unknown'}</div>
                      <div className="truncate text-xs text-ink-muted">{u?.email}{rule ? ` · Required by rule: ${rule}` : ''}</div>
                    </div>
                    {inOrder && (
                      <div className="flex shrink-0">
                        <button type="button" onClick={() => move(i, -1)} disabled={i === 0} className="rounded p-1.5 text-ink-muted hover:bg-content disabled:opacity-30" aria-label={`Move ${u?.name} up`}><ArrowUp className="size-4" /></button>
                        <button type="button" onClick={() => move(i, 1)} disabled={i === order.length - 1} className="rounded p-1.5 text-ink-muted hover:bg-content disabled:opacity-30" aria-label={`Move ${u?.name} down`}><ArrowDown className="size-4" /></button>
                      </div>
                    )}
                    {rule
                      ? <span className="shrink-0 p-1.5 text-ink-subtle" title="Required by an approval rule"><Lock className="size-4" /></span>
                      : <button type="button" onClick={() => setOrder((prev) => prev.filter((x) => x !== id))} className="shrink-0 rounded p-1.5 text-ink-muted hover:text-danger" aria-label={`Remove ${u?.name}`}><X className="size-4" /></button>}
                  </li>
                )
              })}
              {!order.length && <li className="rounded-md border border-dashed border-border px-3 py-4 text-center text-sm text-ink-muted">No approvers yet. Add at least one.</li>}
            </ol>
            <div className="mt-2 flex items-center gap-2">
              <UserPlus className="size-4 shrink-0 text-ink-muted" />
              <select value="" onChange={(e) => e.target.value && setOrder((prev) => [...prev, e.target.value])} className={selectCls} aria-label="Add an approver" data-testid="pr-add-signer">
                <option value="">Add an approver…</option>
                {available.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </div>
            {missingRuleSigners.length > 0 && (
              <p className="mt-2 text-xs text-warn">An approval rule names someone who can't sign purchase requests yet. They will be added when you send, if they can.</p>
            )}
          </section>

          <section>
            <h3 className="text-sm font-medium text-ink">Send a copy to <span className="font-normal text-ink-muted">(optional)</span></h3>
            <p className="text-xs text-ink-muted">They get the sealed PDF when everyone has signed. They don't sign.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {cc.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 rounded-full bg-content px-2.5 py-1 text-sm text-ink">
                  <Mail className="size-3.5 text-ink-muted" /> {byId.get(id)?.name}
                  <button type="button" onClick={() => setCc((prev) => prev.filter((x) => x !== id))} className="text-ink-muted hover:text-danger" aria-label={`Remove ${byId.get(id)?.name}`}><X className="size-3.5" /></button>
                </span>
              ))}
            </div>
            <select value="" onChange={(e) => e.target.value && setCc((prev) => [...prev, e.target.value])} className={cn(selectCls, 'mt-2')} aria-label="Send a copy to">
              <option value="">Add someone…</option>
              {available.map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
            </select>
          </section>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">Message to approvers <span className="font-normal text-ink-muted">(optional)</span></span>
            <textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={2} maxLength={2000}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
          </label>

          {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-between">
            <Button variant="secondary" onClick={onBack} disabled={busy}><ArrowLeft className="size-4" /> Back to edit</Button>
            <Button onClick={() => void review()} disabled={busy || !order.length} data-testid="pr-review">
              {busy && <Loader2 className="size-4 animate-spin" />} Review and sign <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      ) : prepared && (
        <div className="flex flex-col gap-6">
          <section className="rounded-lg border border-border p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-base font-semibold text-ink">{prepared.document.title}</h3>
              <span className="text-sm text-ink-muted">{prepared.document.number} · version {prepared.document.version}</span>
            </div>
            <div className="mt-4"><DocumentView doc={prepared.document} /></div>
            <div className="mt-5">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Signing order</h4>
              <ol className="mt-1.5 flex flex-col gap-1 text-sm text-ink">
                <li>You sign first (requested by).</li>
                {prepared.signers.map((s, i) => (
                  <li key={s.user_id}>
                    {prepared.document.routing.sign_in_order ? `${i + 1}. ` : '• '}{s.name}
                    {s.required_by_rule ? <span className="text-ink-muted"> · required by rule: {s.required_by_rule}</span> : null}
                  </li>
                ))}
                {prepared.cc.length > 0 && <li className="text-ink-muted">Copy when complete: {prepared.cc.map((c) => c.name).join(', ')}</li>}
              </ol>
            </div>
          </section>
          <AdoptAndSign
            documentHash={prepared.document_hash}
            meaning={prepared.meaning}
            actionLabel="Sign and send"
            busy={busy}
            error={error}
            onSign={(p) => void send(p)}
            onCancel={() => { setStep(1); setError(null) }}
          />
        </div>
      )}
    </Modal>
  )
}
