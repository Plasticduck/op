import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, ShieldCheck, ShieldOff, Trash2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { esign, savePdf, type Consent, type Disclosure, type SavedSignature } from '@/lib/queries/purchaseRequests'
import { dateTime } from '@/lib/format'
import { DisclosureText } from './DisclosureText'

// A person's e-signature settings: their consent (read, download, withdraw) and
// their saved signature.
export function EsignSettingsModal({ onClose }: { onClose: () => void }) {
  const { profile } = useAuth()
  const { name: company } = useCompany()
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null)
  const [consents, setConsents] = useState<Consent[]>([])
  const [saved, setSaved] = useState<SavedSignature | null>(null)
  const [confirm, setConfirm] = useState<'withdraw' | 'signature' | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [showText, setShowText] = useState(false)

  const load = useCallback(async () => {
    if (!profile) return
    const [{ data: d }, { data: cs }, { data: s }] = await Promise.all([
      esign.disclosure(), esign.myConsents(profile.id), esign.savedSignature(profile.id),
    ])
    setDisclosure(d ?? null)
    setConsents(cs ?? [])
    setSaved(s ?? null)
  }, [profile])
  useEffect(() => { void load() }, [load])

  const current = consents.find((c) => !c.withdrawn_at && c.disclosure_version === disclosure?.version) ?? null

  const withdraw = async () => {
    setBusy(true)
    try {
      const r = await esign.withdraw()
      setNote(r.pending
        ? `Consent withdrawn. ${r.pending} request${r.pending === 1 ? '' : 's'} waiting on you will be signed on paper; the requester${r.pending === 1 ? ' was' : 's were'} told.`
        : 'Consent withdrawn. You will be asked to accept the disclosure again before you sign electronically.')
      await load()
    } catch (e) { setNote((e as Error).message) }
    setBusy(false)
    setConfirm(null)
  }

  const forgetSignature = async () => {
    if (!profile) return
    setBusy(true)
    await esign.removeSavedSignature(profile.id)
    await load()
    setBusy(false)
    setConfirm(null)
  }

  return (
    <Modal open onClose={onClose} title="E-signature settings" size="lg">
      <div className="flex flex-col gap-5">
        <section className="rounded-lg border border-border p-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            {current ? <ShieldCheck className="size-4 text-ok" /> : <ShieldOff className="size-4 text-ink-muted" />}
            Electronic Record and Signature Disclosure
          </h3>
          <p className="mt-1 text-sm text-ink-muted">
            {current
              ? `You accepted version ${current.disclosure_version} on ${dateTime(current.consented_at)}.`
              : 'You have not accepted the current version. You will be asked to before you sign electronically.'}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setShowText((v) => !v)}>{showText ? 'Hide' : 'Read'} the disclosure</Button>
            <Button variant="secondary" size="sm" onClick={() => void esign.disclosurePdf().then(savePdf).catch(() => undefined)}>
              <Download className="size-4" /> Download PDF
            </Button>
            {current && (
              <Button variant="secondary" size="sm" onClick={() => setConfirm('withdraw')} className="text-danger">
                Withdraw consent
              </Button>
            )}
          </div>
          {showText && disclosure && (
            <div className="mt-3 max-h-72 overflow-y-auto rounded-md border border-border bg-content/40 p-3">
              <DisclosureText body={disclosure.body} company={company || 'your company'} />
            </div>
          )}
          {note && <p className="mt-3 rounded-md bg-content px-3 py-2 text-sm text-ink">{note}</p>}
        </section>

        <section className="rounded-lg border border-border p-4">
          <h3 className="text-sm font-semibold text-ink">Saved signature</h3>
          {saved ? (
            <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
              <div className="rounded-md border border-border bg-white px-3 py-2">
                <img src={saved.image} alt="Your saved signature" className="max-h-16 max-w-[260px]" />
              </div>
              <Button variant="ghost" size="sm" onClick={() => setConfirm('signature')}><Trash2 className="size-4" /> Forget it</Button>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink-muted">None. When you sign, you can save your signature to use next time.</p>
          )}
        </section>

        {consents.length > 0 && (
          <section>
            <h3 className="text-sm font-semibold text-ink">Your consent history</h3>
            <ul className="mt-2 flex flex-col gap-1 text-sm text-ink-muted">
              {consents.map((c) => (
                <li key={c.id}>
                  Version {c.disclosure_version}: accepted {dateTime(c.consented_at)}
                  {c.withdrawn_at ? `, withdrawn ${dateTime(c.withdrawn_at)}` : ''}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>{busy ? <Loader2 className="size-4 animate-spin" /> : null} Done</Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirm === 'withdraw'}
        title="Withdraw your e-sign consent?"
        description="Signatures you already made stay valid. Requests that still need your signature will be signed on paper, and their requesters will be told."
        confirmLabel="Withdraw consent"
        destructive
        loading={busy}
        onConfirm={() => void withdraw()}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'signature'}
        title="Forget your saved signature?"
        description="You will draw or type it again next time you sign."
        confirmLabel="Forget it"
        loading={busy}
        onConfirm={() => void forgetSignature()}
        onCancel={() => setConfirm(null)}
      />
    </Modal>
  )
}
