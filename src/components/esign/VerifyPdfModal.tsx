import { useState } from 'react'
import { BadgeCheck, FileSearch, Loader2, ShieldAlert } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { esign, sha256OfFile } from '@/lib/queries/purchaseRequests'
import { dateTime } from '@/lib/format'

type Match = {
  envelope_id: string; title: string; version: number; status: string
  completed_at: string | null; sealed_at: string | null; document_hash: string
  signers: { name: string; email: string; label: string | null; signed_at: string | null; kind: string | null }[]
}

// Checks a PDF someone has against the sealed originals: the file is hashed here
// in the browser (it never leaves the device) and the fingerprint is looked up.
export function VerifyPdfModal({ onClose }: { onClose: () => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ file: string; sha: string; match: Match | null } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = async (file: File | undefined) => {
    if (!file) return
    setBusy(true); setError(null); setResult(null)
    try {
      const sha = await sha256OfFile(file)
      const { data, error: e } = await esign.verify(sha)
      if (e) throw e
      setResult({ file: file.name, sha, match: ((data ?? []) as unknown as Match[])[0] ?? null })
    } catch {
      setError('That file could not be checked. Try again.')
    }
    setBusy(false)
  }

  return (
    <Modal open onClose={onClose} title="Verify a PDF" description="Check that a signed purchase request is an untouched original from Operator.">
      <div className="flex flex-col gap-4">
        <label className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed border-border bg-content/50 px-4 py-8 text-center hover:border-accent/50">
          {busy ? <Loader2 className="size-6 animate-spin text-ink-muted" /> : <FileSearch className="size-6 text-ink-muted" />}
          <span className="text-sm font-medium text-ink">Choose the PDF to check</span>
          <span className="text-xs text-ink-muted">The file is checked on this device. It is not uploaded.</span>
          <input type="file" accept="application/pdf,.pdf" className="sr-only" onChange={(e) => void check(e.target.files?.[0])} data-testid="verify-file" />
        </label>
        {error && <p className="text-sm text-danger">{error}</p>}
        {result && result.match && (
          <div className="rounded-lg border border-ok/40 bg-ok-soft p-4 text-sm" data-testid="verify-ok">
            <div className="flex items-center gap-2 font-semibold text-ok"><BadgeCheck className="size-5" /> Authentic sealed original</div>
            <p className="mt-1 text-ink">{result.match.title} (version {result.match.version})</p>
            <p className="text-ink-muted">Completed {dateTime(result.match.completed_at)}. Nothing in this file has changed since it was sealed.</p>
            <ul className="mt-2 flex flex-col gap-0.5 text-ink-muted">
              {result.match.signers.map((s, i) => (
                <li key={i}>{s.label ?? 'Signer'}: {s.name}{s.signed_at ? `, signed ${dateTime(s.signed_at)}` : ''}{s.kind === 'paper' ? ' (on paper)' : ''}</li>
              ))}
            </ul>
          </div>
        )}
        {result && !result.match && (
          <div className="rounded-lg border border-danger/40 bg-danger-soft p-4 text-sm" data-testid="verify-fail">
            <div className="flex items-center gap-2 font-semibold text-danger"><ShieldAlert className="size-5" /> Not a sealed original</div>
            <p className="mt-1 text-ink">
              {result.file} does not match any sealed purchase request in your company. It may have been changed after it was
              sealed, it may be an unfinished copy, or it may come from somewhere else.
            </p>
          </div>
        )}
        {result && <p className="break-all font-mono text-[11px] text-ink-subtle">SHA-256 {result.sha}</p>}
        <div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Close</Button></div>
      </div>
    </Modal>
  )
}
