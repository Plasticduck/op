import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { currency } from '@/lib/format'
import { purchaseRequests, type PurchaseRequest } from '@/lib/queries/purchaseRequests'
import { prNumber } from './access'
import { StatusPill } from './shared'

// Super admin only: delete a request from any tab. One that was ever sent has
// signatures and an audit trail, so typing its number confirms it.
export function DeleteRequestModal({ request, onClose, onDeleted }: { request: PurchaseRequest; onClose: () => void; onDeleted: (note: string | null) => void }) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const num = prNumber(request.number)
  const signed = request.ever_sent
  const ready = !signed || typed.trim().toUpperCase() === num.toUpperCase()

  const go = async () => {
    setBusy(true)
    setError(null)
    const res = await purchaseRequests.adminDelete(request.id)
    setBusy(false)
    if (res.error) {
      setError(res.error.includes('not_allowed') ? 'Only the super admin can delete requests.' : res.error.includes('not_found') ? 'This request was already deleted.' : res.error)
      return
    }
    onDeleted(res.filesLeft ? `${num} is deleted, but ${res.filesLeft} stored file${res.filesLeft === 1 ? '' : 's'} could not be removed.` : null)
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title={`Delete ${num}?`} size="sm">
      <div className="flex flex-col gap-4 text-sm">
        <div className="flex items-start justify-between gap-3 rounded-md border border-border bg-content px-3 py-2">
          <div className="min-w-0">
            <p className="font-medium text-ink">{request.title || 'Untitled request'}</p>
            <p className="text-ink-muted">{[request.requester_name, currency(Number(request.total))].filter(Boolean).join(' · ')}</p>
          </div>
          <StatusPill status={request.status} />
        </div>
        {signed ? (
          <p className="text-ink">
            This permanently deletes the request, its attachments, every signature and its audit trail
            {request.status === 'approved' || request.status === 'purchased' ? ', and the sealed PDF' : ''}.
            It disappears for everyone it was sent to. It can’t be undone; a note that it was deleted is kept.
          </p>
        ) : (
          <p className="text-ink">This permanently deletes the draft and its attachments. It can’t be undone.</p>
        )}
        {signed && (
          <label className="flex flex-col gap-1">
            <span className="text-ink-muted">Type <b className="text-ink">{num}</b> to confirm</span>
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              aria-label="Type the request number to confirm"
              className="h-10 rounded-md border border-border bg-card px-3 text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            />
          </label>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="danger" onClick={() => void go()} disabled={!ready || busy}>{busy ? 'Deleting…' : 'Delete permanently'}</Button>
        </div>
      </div>
    </Modal>
  )
}
