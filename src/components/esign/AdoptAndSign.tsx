import { useEffect, useState } from 'react'
import { Download, FileSignature, Fingerprint, Loader2, ShieldCheck } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { esign, savePdf, type Disclosure, type SignatureInput } from '@/lib/queries/purchaseRequests'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { SignaturePad, type PadValue } from './SignaturePad'
import { DisclosureText } from './DisclosureText'

// Shown next to every Sign button. The server records its own copy of this text
// with each signature (INTENT_TEXT in supabase/functions/_shared/esign.ts); keep
// the two the same.
export const INTENT_TEXT =
  'By selecting Sign, I adopt the signature shown above as my electronic signature on this record. ' +
  'I agree it is the legal equivalent of my handwritten signature, and I intend to sign.'

// The signing step: accept the disclosure (first time only), adopt a signature,
// read what signing means, then sign. Used by the requester (sign and send) and by
// approvers (sign and approve).
export function AdoptAndSign({ documentHash, meaning, actionLabel, busy, error, onSign, onCancel }: {
  documentHash: string
  meaning: string
  actionLabel: string
  busy: boolean
  error?: string | null
  onSign: (p: { signature: SignatureInput; consentVersion: string | null; saveSignature: boolean }) => void
  onCancel?: () => void
}) {
  const { profile } = useAuth()
  const { name: company } = useCompany()
  const [disclosure, setDisclosure] = useState<Disclosure | null>(null)
  const [hasConsent, setHasConsent] = useState<boolean | null>(null)
  const [agreed, setAgreed] = useState(false)
  const [saved, setSaved] = useState<{ kind: 'drawn' | 'typed'; image: string; name: string | null } | null>(null)
  const [name, setName] = useState(profile?.name ?? '')
  const [value, setValue] = useState<PadValue>(null)
  const [save, setSave] = useState(true)
  const [pdfBusy, setPdfBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    if (!profile) return
    let live = true
    void (async () => {
      const [{ data: d }, { data: cs }, { data: s }] = await Promise.all([
        esign.disclosure(), esign.myConsents(profile.id), esign.savedSignature(profile.id),
      ])
      if (!live) return
      setDisclosure(d ?? null)
      setHasConsent(!!d && (cs ?? []).some((c) => c.disclosure_version === d.version && !c.withdrawn_at))
      if (s) {
        setSaved({ kind: s.kind as 'drawn' | 'typed', image: s.image, name: s.typed_name })
        if (s.typed_name) setName(s.typed_name)
        setSave(false)
      }
      setLoaded(true)
    })()
    return () => { live = false }
  }, [profile])

  const needsConsent = hasConsent === false
  const ready = loaded && !!value && name.trim().length >= 2 && (!needsConsent || agreed) && !busy

  const downloadDisclosure = async () => {
    setPdfBusy(true)
    try { savePdf(await esign.disclosurePdf()) } catch { /* the text is on screen */ }
    setPdfBusy(false)
  }

  if (!loaded) {
    return <div className="flex items-center gap-2 py-6 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Getting things ready…</div>
  }

  return (
    <div className="flex flex-col gap-5">
      {needsConsent && disclosure && (
        <section className="rounded-lg border border-accent/30 bg-accent-soft/30 p-4" aria-labelledby="esign-consent-title">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <h3 id="esign-consent-title" className="flex items-center gap-2 text-sm font-semibold text-ink">
              <ShieldCheck className="size-4 text-accent" /> {disclosure.title}
            </h3>
            <button type="button" onClick={() => void downloadDisclosure()} disabled={pdfBusy}
              className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline disabled:opacity-60">
              <Download className="size-3.5" /> Download as PDF
            </button>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Read this once before your first electronic signature. Version {disclosure.version}.</p>
          <div className="mt-3 max-h-56 overflow-y-auto rounded-md border border-border bg-card p-3" tabIndex={0} aria-label="Disclosure text">
            <DisclosureText body={disclosure.body} company={company || 'your company'} />
          </div>
          <label className="mt-3 flex items-start gap-2.5 text-sm text-ink">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-accent" data-testid="esign-consent" />
            <span>I have read the disclosure, I can open and keep these records and PDF files on this device, and I agree to use electronic records and signatures.</span>
          </label>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Your full name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={120} aria-label="Your full name" />
        </label>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Your signature</div>
          <SignaturePad name={name} onChange={setValue} saved={saved} />
        </div>
        <label className="flex items-center gap-2 text-sm text-ink-muted">
          <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} className="size-4 accent-accent" />
          Save this signature for next time
        </label>
      </section>

      <section className="rounded-lg border border-border bg-content/60 p-4 text-sm">
        <p className="font-medium text-ink">Signing means: <span className="font-normal">{meaning}</span></p>
        <p className="mt-2 text-ink-muted">{INTENT_TEXT}</p>
        <p className="mt-3 flex items-center gap-1.5 font-mono text-[11px] text-ink-subtle" title={`SHA-256 ${documentHash}`}>
          <Fingerprint className="size-3.5 shrink-0" /> Document fingerprint {documentHash.slice(0, 12)}…{documentHash.slice(-8)}
        </p>
      </section>

      {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className={cn('flex flex-wrap items-center gap-2', onCancel ? 'justify-between' : 'justify-end')}>
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={busy}>Back</Button>}
        <Button
          disabled={!ready}
          onClick={() => value && onSign({
            signature: { kind: value.kind, image: value.image, name: name.trim() },
            consentVersion: needsConsent && disclosure ? disclosure.version : null,
            saveSignature: save,
          })}
          data-testid="esign-sign"
        >
          {busy ? <Loader2 className="size-4 animate-spin" /> : <FileSignature className="size-4" />} {actionLabel}
        </Button>
      </div>
    </div>
  )
}
