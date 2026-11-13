import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  AlertTriangle, Ban, BellRing, CheckCircle2, Circle, Clock, Download, Eye, FileSignature, Fingerprint,
  Loader2, Mail, PackageCheck, Pencil, Printer, RotateCcw, Send, ShieldCheck, Upload, XCircle,
} from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { AdoptAndSign } from '@/components/esign/AdoptAndSign'
import { useCompany } from '@/lib/company'
import { supabase } from '@/lib/supabase'
import { currency, dateTime } from '@/lib/format'
import { cn } from '@/lib/utils'
import {
  fileToBase64, purchaseRequests, savePdf,
  type Envelope, type EsignEvent, type PrDocument, type PrFile, type PurchaseRequest, type Recipient,
} from '@/lib/queries/purchaseRequests'
import { prNumber } from './access'
import { DocumentView, StatusPill } from './shared'
import { draftToDoc, progressOf } from './logic'

const MEANING_APPROVER = 'I approve this purchase request.'

const EVENT_LABEL: Record<string, string> = {
  created: 'Created and sent', consent: 'Accepted the e-sign disclosure', signed: 'Signed', sent: 'Sent for signature',
  viewed: 'Viewed', declined: 'Declined', voided: 'Voided', completed: 'Completed', sealed: 'Sealed',
  email_sent: 'Completed copy emailed', reminder_sent: 'Reminder sent', paper_requested: 'Asked to sign on paper',
  paper_signed: 'Paper signature recorded', consent_withdrawn: 'Withdrew e-sign consent', downloaded: 'Downloaded the PDF',
  purchased: 'Marked purchased',
}

type Mode = 'view' | 'sign' | 'decline' | 'void' | 'purchase' | 'paper' | 'paper_request'

export function RequestDetail({ requestId, meId, isAP, onClose, onEdit, onSend }: {
  requestId: string
  meId: string
  isAP: boolean
  onClose: () => void
  onEdit: (pr: PurchaseRequest) => void
  onSend: (pr: PurchaseRequest) => void
}) {
  const { name: company } = useCompany()
  const [pr, setPr] = useState<PurchaseRequest | null>(null)
  const [missing, setMissing] = useState(false)
  const [files, setFiles] = useState<PrFile[]>([])
  const [envelopes, setEnvelopes] = useState<Envelope[]>([])
  const [recipients, setRecipients] = useState<Recipient[]>([])
  const [events, setEvents] = useState<EsignEvent[]>([])
  const [mode, setMode] = useState<Mode>('view')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [allEvents, setAllEvents] = useState(false)
  const viewed = useRef(false)
  const signRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    const { data } = await purchaseRequests.get(requestId)
    if (!data) { setMissing(true); return }
    const row = data as unknown as PurchaseRequest
    setPr(row)
    const [{ data: fs }, { data: envs }] = await Promise.all([purchaseRequests.files(requestId), purchaseRequests.envelopes(requestId)])
    setFiles(fs ?? [])
    setEnvelopes(envs ?? [])
    const current = (envs ?? []).find((e) => e.id === row.envelope_id) ?? null
    if (current) {
      const [{ data: rs }, { data: evs }] = await Promise.all([purchaseRequests.recipients([current.id]), purchaseRequests.events(current.id)])
      setRecipients(rs ?? [])
      setEvents((evs ?? []) as EsignEvent[])
    } else {
      setRecipients([]); setEvents([])
    }
  }, [requestId])

  useEffect(() => {
    void load()
    const ch = supabase
      .channel('purchase-request-' + requestId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'purchase_requests', filter: `id=eq.${requestId}` }, () => void load())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'esign_events' }, () => void load())
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [requestId, load])

  const env = useMemo(() => envelopes.find((e) => e.id === pr?.envelope_id) ?? null, [envelopes, pr?.envelope_id])
  const older = envelopes.filter((e) => e.id !== pr?.envelope_id)
  const prog = progressOf(recipients)
  const myTurn = !!pr && pr.status === 'pending' && env?.status === 'sent' && prog.current.some((r) => r.user_id === meId)
  const myRow = recipients.find((r) => r.user_id === meId && r.role === 'signer' && prog.current.includes(r))
  const isRequester = pr?.requester_id === meId

  // A signer opening a request they were sent records "viewed" in the audit trail.
  useEffect(() => {
    if (!pr || viewed.current || !myRow || myRow.status !== 'sent') return
    viewed.current = true
    void purchaseRequests.view(pr.id).catch(() => undefined)
  }, [pr, myRow])

  useEffect(() => {
    if (mode === 'sign') signRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [mode])

  const doc: PrDocument | null = env ? (env.document as unknown as PrDocument) : pr ? draftToDoc(pr, files, company) : null

  const run = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key); setError(null); setNotice(null)
    try {
      await fn()
      if (done) setNotice(done)
      setMode('view')
      await load()
    } catch (e) { setError((e as Error).message) }
    setBusy(null)
  }

  const download = (envelopeId?: string) => run('pdf', async () => savePdf(await purchaseRequests.pdf(requestId, envelopeId)))
  const openFile = async (f: PrFile) => {
    const url = await purchaseRequests.fileUrl(f.path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  if (missing) {
    return (
      <Modal open onClose={onClose} title="Purchase request">
        <p className="text-sm text-ink-muted">This request doesn't exist, or you don't have access to it.</p>
      </Modal>
    )
  }
  if (!pr || !doc) {
    return (
      <Modal open onClose={onClose} title="Purchase request">
        <div className="flex items-center gap-2 py-8 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Loading…</div>
      </Modal>
    )
  }

  const completed = env?.status === 'completed'
  const shownEvents = allEvents ? events : events.filter((e) => e.event !== 'downloaded').slice(-8)

  return (
    <Modal open onClose={busy ? () => undefined : onClose} size="xl" title={`${prNumber(pr.number)} · ${pr.title || 'Untitled request'}`}>
      <div className="flex flex-col gap-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <StatusPill status={pr.status} />
          <span className="text-lg font-semibold tabular-nums text-ink">{currency(Number(pr.total))}</span>
          {pr.priority === 'urgent' && <span className="rounded-full bg-danger-soft px-2 py-0.5 text-xs font-semibold text-danger">Urgent</span>}
          <span className="text-sm text-ink-muted">
            Requested by {pr.requester_name}{pr.submitted_at ? ` · sent ${dateTime(pr.submitted_at)}` : ''}{env ? ` · version ${env.version}` : ''}
          </span>
        </div>

        {myTurn && mode === 'view' && (
          <div className="flex flex-col gap-3 rounded-lg border border-accent/40 bg-accent-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink"><FileSignature className="size-4 text-accent" /> Your signature is needed</div>
              <p className="mt-0.5 text-sm text-ink-muted">Review the request below, then sign to approve it or decline it.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button onClick={() => setMode('sign')} data-testid="pr-sign-start"><FileSignature className="size-4" /> Review and sign</Button>
              <Button variant="secondary" onClick={() => setMode('decline')}><XCircle className="size-4" /> Decline</Button>
            </div>
          </div>
        )}

        {completed && (
          <div className="flex flex-col gap-2 rounded-lg border border-ok/40 bg-ok-soft p-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm">
              <div className="flex items-center gap-2 font-semibold text-ok"><ShieldCheck className="size-4" /> Approved and sealed</div>
              <p className="mt-0.5 text-ink-muted">
                Everyone signed {dateTime(env?.completed_at)}.
                {env?.sealed_pdf_sha256 && <span className="ml-1 font-mono text-[11px]" title={`SHA-256 ${env.sealed_pdf_sha256}`}>PDF fingerprint {env.sealed_pdf_sha256.slice(0, 12)}…</span>}
              </p>
            </div>
            <Button variant="secondary" onClick={() => void download()} disabled={busy === 'pdf'}>
              {busy === 'pdf' ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />} Signed PDF
            </Button>
          </div>
        )}

        {(pr.status === 'declined' || pr.status === 'voided') && env && (
          <div className="rounded-lg border border-danger/30 bg-danger-soft p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-danger">
              {pr.status === 'declined' ? <XCircle className="size-4" /> : <Ban className="size-4" />}
              {pr.status === 'declined' ? 'Declined' : 'Voided'}
            </div>
            <p className="mt-0.5 text-ink">
              {pr.status === 'declined'
                ? (() => { const d = recipients.find((r) => r.status === 'declined'); return d ? `${d.name}: ${d.decline_reason ?? ''}` : '' })()
                : `${env.voided_by_name ?? ''}${env.void_reason ? `: ${env.void_reason}` : ''}`}
            </p>
            {isRequester && <p className="mt-1 text-ink-muted">You can edit it and send it again. It starts a new version and everyone signs again.</p>}
          </div>
        )}

        {pr.status === 'purchased' && (
          <div className="rounded-lg border border-accent/30 bg-accent-soft/40 p-4 text-sm">
            <div className="flex items-center gap-2 font-semibold text-accent"><PackageCheck className="size-4" /> Purchased</div>
            <p className="mt-0.5 text-ink">
              {pr.purchased_by_name} · {dateTime(pr.purchased_at)}
              {pr.po_number ? ` · PO ${pr.po_number}` : ''}{pr.actual_amount != null ? ` · paid ${currency(Number(pr.actual_amount))}` : ''}
            </p>
            {pr.purchase_note && <p className="mt-1 text-ink-muted">{pr.purchase_note}</p>}
          </div>
        )}

        {notice && <p className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">{notice}</p>}
        {error && mode === 'view' && <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_300px]">
          <section className="min-w-0">
            <DocumentView doc={doc} files={files} onOpenFile={(f) => void openFile(f)} locked={!!env} />
          </section>

          <aside className="flex min-w-0 flex-col gap-5">
            {env && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Signatures</h4>
                <p className="mt-0.5 text-xs text-ink-muted">{prog.signed} of {prog.total} approver{prog.total === 1 ? '' : 's'} signed{env.sign_in_order ? ', in order' : ', any order'}</p>
                <ol className="mt-2 flex flex-col gap-2" data-testid="pr-recipients">
                  {recipients.filter((r) => r.role !== 'cc').map((r) => <SignerRow key={r.id} r={r} current={prog.current.includes(r)} />)}
                </ol>
                {recipients.some((r) => r.role === 'cc') && (
                  <p className="mt-2 flex items-start gap-1.5 text-xs text-ink-muted">
                    <Mail className="mt-0.5 size-3.5 shrink-0" /> Copy when complete: {recipients.filter((r) => r.role === 'cc').map((r) => r.name).join(', ')}
                  </p>
                )}
                <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-ink-subtle" title={`SHA-256 ${env.document_hash}`}>
                  <Fingerprint className="size-3.5 shrink-0" /> {env.document_hash.slice(0, 16)}…
                </p>
              </div>
            )}

            {events.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Activity</h4>
                <ol className="mt-2 flex flex-col gap-2 border-l border-border pl-3" data-testid="pr-activity">
                  {shownEvents.map((e) => (
                    <li key={e.id} className="text-xs">
                      <div className="font-medium text-ink">
                        {EVENT_LABEL[e.event] ?? e.event}
                        {typeof e.detail?.to === 'string' && e.event === 'sent' ? ` to ${e.detail.to}` : ''}
                      </div>
                      <div className="text-ink-muted">
                        {e.actor_name ?? 'Operator'} · {dateTime(e.at)}{e.ip ? ` · ${e.ip}` : ''}
                      </div>
                      {typeof e.detail?.reason === 'string' && <div className="text-ink-muted">“{e.detail.reason}”</div>}
                    </li>
                  ))}
                </ol>
                {events.length > shownEvents.length && (
                  <button type="button" onClick={() => setAllEvents(true)} className="mt-2 text-xs font-medium text-accent hover:underline">Show all {events.length}</button>
                )}
              </div>
            )}

            {older.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Earlier versions</h4>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {older.map((o) => (
                    <li key={o.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-ink-muted">Version {o.version}: {o.status === 'sent' ? 'in progress' : o.status}, {dateTime(o.sent_at)}</span>
                      <button type="button" onClick={() => void download(o.id)} className="inline-flex items-center gap-1 font-medium text-accent hover:underline"><Download className="size-3" /> PDF</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </aside>
        </div>

        {mode === 'sign' && env && (
          <div ref={signRef} className="scroll-mt-4 border-t border-border pt-5">
            <h3 className="mb-3 text-base font-semibold text-ink">Sign {prNumber(pr.number)}</h3>
            <AdoptAndSign
              documentHash={env.document_hash}
              meaning={MEANING_APPROVER}
              actionLabel="Sign and approve"
              busy={busy === 'sign'}
              error={error}
              onCancel={() => { setMode('view'); setError(null) }}
              onSign={(p) => void run('sign', () => purchaseRequests.sign({
                requestId: pr.id, envelopeId: env.id, documentHash: env.document_hash,
                signature: p.signature, consentVersion: p.consentVersion, saveSignature: p.saveSignature,
              }), 'Signed. Thank you.')}
            />
            <p className="mt-3 text-center text-xs text-ink-muted">
              Rather sign on paper? <button type="button" className="font-medium text-accent hover:underline" onClick={() => { setMode('paper_request'); setError(null) }}>Sign on paper instead</button>
            </p>
          </div>
        )}

        {mode === 'decline' && (
          <ReasonForm title="Decline this request" hint="Say why, so the requester can fix it and send it again." label="Decline" danger
            busy={busy === 'decline'} error={error} onCancel={() => setMode('view')}
            onSubmit={(reason) => void run('decline', () => purchaseRequests.decline(pr.id, reason), 'Declined. The requester was told.')} />
        )}
        {mode === 'void' && (
          <ReasonForm title="Void this request" hint="It stops the signing. Everyone who was sent it is told." label="Void request" danger
            busy={busy === 'void'} error={error} onCancel={() => setMode('view')}
            onSubmit={(reason) => void run('void', () => purchaseRequests.void(pr.id, reason), 'Voided.')} />
        )}
        {mode === 'paper_request' && (
          <ReasonForm title="Sign on paper instead" optional label="Ask to sign on paper"
            hint="The requester is told. They print the PDF for you to sign by hand, and Accounts Payable scans the signed copy into the request."
            busy={busy === 'paper_request'} error={error} onCancel={() => setMode('view')}
            onSubmit={(note) => void run('paper_request', () => purchaseRequests.paperRequest(pr.id, note), 'The requester was told you will sign on paper.')} />
        )}
        {mode === 'purchase' && (
          <PurchaseForm busy={busy === 'purchase'} error={error} total={Number(pr.total)} onCancel={() => setMode('view')}
            onSubmit={(p) => void run('purchase', () => purchaseRequests.purchased(pr.id, p), 'Marked purchased.')} />
        )}
        {mode === 'paper' && env && (
          <PaperForm signers={prog.current} busy={busy === 'paper'} error={error} onCancel={() => setMode('view')}
            onSubmit={(p) => void run('paper', async () => purchaseRequests.paperSign({ requestId: pr.id, ...p }), 'Paper signature recorded.')} />
        )}

        {mode === 'view' && (
          <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              {isRequester && pr.status === 'draft' && (
                <>
                  <Button variant="secondary" onClick={() => onEdit(pr)}><Pencil className="size-4" /> Edit</Button>
                  <Button onClick={() => onSend(pr)}><Send className="size-4" /> Send for signature</Button>
                </>
              )}
              {isRequester && (pr.status === 'declined' || pr.status === 'voided') && (
                <Button onClick={() => void run('reopen', async () => { await purchaseRequests.reopen(pr.id); const { data } = await purchaseRequests.get(pr.id); if (data) onEdit(data as unknown as PurchaseRequest) })}
                  disabled={busy === 'reopen'}>
                  <RotateCcw className="size-4" /> Edit and send again
                </Button>
              )}
              {pr.status === 'pending' && (isRequester || isAP) && (
                <>
                  <Button variant="secondary" onClick={() => void run('remind', async () => {
                    const r = await purchaseRequests.remind(pr.id)
                    setNotice(`Reminder sent to ${r.reminded.join(', ')}.`)
                  })} disabled={busy === 'remind'}>
                    <BellRing className="size-4" /> Send reminder
                  </Button>
                  <Button variant="secondary" onClick={() => { setMode('void'); setError(null) }}><Ban className="size-4" /> Void</Button>
                </>
              )}
              {pr.status === 'pending' && isAP && prog.current.length > 0 && (
                <Button variant="secondary" onClick={() => { setMode('paper'); setError(null) }}><Upload className="size-4" /> Record paper signature</Button>
              )}
              {pr.status === 'approved' && isAP && (
                <Button onClick={() => { setMode('purchase'); setError(null) }}><PackageCheck className="size-4" /> Mark purchased</Button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {!completed && (pr.status !== 'draft' || isRequester || isAP) && (
                <Button variant="ghost" onClick={() => void download()} disabled={busy === 'pdf'}>
                  {busy === 'pdf' ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} {pr.status === 'draft' ? 'Preview PDF' : 'PDF copy'}
                </Button>
              )}
              <Button variant="secondary" onClick={onClose}>Close</Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function SignerRow({ r, current }: { r: Recipient; current: boolean }) {
  const icon = r.status === 'signed' ? <CheckCircle2 className="size-4 text-ok" />
    : r.status === 'declined' ? <XCircle className="size-4 text-danger" />
      : current ? (r.status === 'viewed' ? <Eye className="size-4 text-accent" /> : <Clock className="size-4 text-warn" />)
        : <Circle className="size-4 text-ink-subtle" />
  const status = r.status === 'signed'
    ? `${r.signature_kind === 'paper' ? 'Signed on paper' : 'Signed'} ${dateTime(r.signed_at)}`
    : r.status === 'declined' ? `Declined ${dateTime(r.declined_at)}`
      : current ? (r.status === 'viewed' ? `Viewed ${dateTime(r.viewed_at)}, not signed` : 'Waiting for their signature')
        : 'Not sent yet'
  return (
    <li className={cn('rounded-md border px-3 py-2', current ? 'border-accent/40 bg-accent-soft/20' : 'border-border')}>
      <div className="flex items-start gap-2">
        <span className="mt-0.5 shrink-0">{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-ink">{r.name}</div>
          <div className="text-[11px] text-ink-muted">{r.label}{r.required_by_rule ? ` · rule: ${r.required_by_rule}` : ''}</div>
          <div className="text-[11px] text-ink-muted">{status}</div>
          {r.paper_requested_at && r.status !== 'signed' && <div className="text-[11px] font-medium text-warn">Asked to sign on paper</div>}
          {r.signature_image && <img src={r.signature_image} alt={`${r.name}'s signature`} className="mt-1 max-h-9 max-w-[180px] rounded bg-white" />}
        </div>
      </div>
    </li>
  )
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-border pt-5">
      <div>
        <h3 className="text-base font-semibold text-ink">{title}</h3>
        {hint && <p className="mt-0.5 text-sm text-ink-muted">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function ReasonForm({ title, hint, label, danger, optional, busy, error, onCancel, onSubmit }: {
  title: string; hint: string; label: string; danger?: boolean; optional?: boolean; busy: boolean; error: string | null
  onCancel: () => void; onSubmit: (text: string) => void
}) {
  const [text, setText] = useState('')
  return (
    <Panel title={title} hint={hint}>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} maxLength={1000} autoFocus
        placeholder={optional ? 'Add a note (optional)' : 'Reason'} aria-label={optional ? 'Note' : 'Reason'}
        className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Back</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={() => onSubmit(text.trim())} disabled={busy || (!optional && !text.trim())}>
          {busy && <Loader2 className="size-4 animate-spin" />} {label}
        </Button>
      </div>
    </Panel>
  )
}

function PurchaseForm({ total, busy, error, onCancel, onSubmit }: {
  total: number; busy: boolean; error: string | null; onCancel: () => void
  onSubmit: (p: { po_number: string; actual_amount: number | null; note: string }) => void
}) {
  const [po, setPo] = useState('')
  const [amount, setAmount] = useState(total ? total.toFixed(2) : '')
  const [note, setNote] = useState('')
  const amt = amount.trim() ? Number(amount.replace(/[$,]/g, '')) : null
  const bad = amt !== null && !(amt >= 0)
  return (
    <Panel title="Mark purchased" hint="Record how it was bought. The signed record doesn't change.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-ink">PO or order number</span>
          <Input value={po} onChange={(e) => setPo(e.target.value)} maxLength={60} /></label>
        <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-ink">Amount paid</span>
          <Input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" invalid={bad} /></label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-ink">Note</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={1000}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent" /></label>
      {amt !== null && total > 0 && Math.abs(amt - total) >= 0.01 && !bad && (
        <p className="flex items-center gap-1.5 text-xs text-warn"><AlertTriangle className="size-3.5" /> That is {currency(Math.abs(amt - total))} {amt > total ? 'more' : 'less'} than approved.</p>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Back</Button>
        <Button onClick={() => onSubmit({ po_number: po.trim(), actual_amount: amt, note: note.trim() })} disabled={busy || bad}>
          {busy && <Loader2 className="size-4 animate-spin" />} Mark purchased
        </Button>
      </div>
    </Panel>
  )
}

function PaperForm({ signers, busy, error, onCancel, onSubmit }: {
  signers: Recipient[]; busy: boolean; error: string | null; onCancel: () => void
  onSubmit: (p: { recipientId: string; fileBase64: string; fileName: string; mime: string; signedOn: string }) => void
}) {
  const [who, setWho] = useState(signers[0]?.id ?? '')
  const [file, setFile] = useState<File | null>(null)
  const [on, setOn] = useState(new Date().toLocaleDateString('en-CA'))
  const [err, setErr] = useState<string | null>(null)
  const submit = async () => {
    if (!file) return
    if (file.size > 10 * 1024 * 1024) { setErr('The scan must be under 10 MB.'); return }
    onSubmit({ recipientId: who, fileBase64: await fileToBase64(file), fileName: file.name, mime: file.type, signedOn: on })
  }
  return (
    <Panel title="Record a paper signature" hint="Scan or photograph the page they signed by hand. It is kept with the record and fingerprinted.">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-ink">Who signed</span>
          <select value={who} onChange={(e) => setWho(e.target.value)} className="h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink">
            {signers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></label>
        <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-ink">Date on the signed page</span>
          <Input type="date" value={on} onChange={(e) => setOn(e.target.value)} /></label>
      </div>
      <label className="flex flex-col gap-1.5 text-sm"><span className="font-medium text-ink">Signed page (PDF or photo)</span>
        <input type="file" accept="application/pdf,image/png,image/jpeg,image/heic,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" /></label>
      {(err || error) && <p role="alert" className="text-sm text-danger">{err || error}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Back</Button>
        <Button onClick={() => void submit()} disabled={busy || !file || !who}>{busy && <Loader2 className="size-4 animate-spin" />} Record signature</Button>
      </div>
    </Panel>
  )
}
