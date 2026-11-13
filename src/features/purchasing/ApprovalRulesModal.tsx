import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import type { AccountUser } from '@/lib/queries/account'
import { purchaseRequests, type ApprovalRule } from '@/lib/queries/purchaseRequests'
import { CATEGORIES } from './access'

type Draft = { id?: string; label: string; min_amount: string; category: string; signer_ids: string[]; active: boolean }
const selectCls = 'h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent'

// Owner-only. A rule adds required approvers to any request at or above its amount
// (and in its category, when set). They are added when the request is sent, and
// the requester can't take them off.
export function ApprovalRulesModal({ accountId, rules, signers, onClose, onSaved }: {
  accountId: string
  rules: ApprovalRule[]
  signers: AccountUser[]
  onClose: () => void
  onSaved: () => void
}) {
  const [drafts, setDrafts] = useState<Draft[]>([])
  const [removed, setRemoved] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setDrafts(rules.map((r) => ({
      id: r.id, label: r.label ?? '', min_amount: String(Number(r.min_amount)), category: r.category ?? '',
      signer_ids: r.signer_ids ?? [], active: r.active,
    })))
  }, [rules])

  const set = (i: number, patch: Partial<Draft>) => setDrafts((prev) => prev.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  const byId = new Map(signers.map((u) => [u.id, u]))

  const save = async () => {
    for (const d of drafts) {
      if (!/^\d+(\.\d{1,2})?$/.test(d.min_amount.trim())) { setError('Each rule needs an amount in dollars, like 5000.'); return }
      if (!d.signer_ids.length) { setError('Each rule needs at least one approver.'); return }
    }
    setBusy(true); setError(null)
    for (const id of removed) {
      const { error: e } = await purchaseRequests.removeRule(id)
      if (e) { setError('Could not save the rules.'); setBusy(false); return }
    }
    for (const [i, d] of drafts.entries()) {
      const { error: e } = await purchaseRequests.saveRule({
        id: d.id, account_id: accountId, label: d.label.trim() || null, min_amount: Number(d.min_amount),
        category: d.category || null, signer_ids: d.signer_ids, active: d.active, sort_order: i,
      })
      if (e) { setError('Could not save the rules.'); setBusy(false); return }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} size="lg" title="Approval rules"
      description="Require more approvers on bigger or special purchases. Rules apply when a request is sent.">
      <div className="flex flex-col gap-4">
        {drafts.length === 0 && (
          <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-ink-muted">
            No rules yet. Requesters choose their own approvers.
          </p>
        )}
        {drafts.map((d, i) => (
          <div key={d.id ?? `new-${i}`} className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_140px_1fr]">
              <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Name</span>
                <Input value={d.label} onChange={(e) => set(i, { label: e.target.value })} placeholder="e.g. Over $5,000" maxLength={80} /></label>
              <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">At or above</span>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">$</span>
                  <Input value={d.min_amount} onChange={(e) => set(i, { min_amount: e.target.value })} inputMode="decimal" className="pl-6" aria-label="Minimum amount" />
                </div></label>
              <label className="flex flex-col gap-1 text-sm"><span className="font-medium text-ink">Category</span>
                <select value={d.category} onChange={(e) => set(i, { category: e.target.value })} className={selectCls}>
                  <option value="">Any category</option>
                  {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                </select></label>
            </div>
            <div>
              <div className="text-sm font-medium text-ink">Must also be signed by</div>
              <div className="mt-1.5 flex flex-wrap gap-2">
                {d.signer_ids.map((id) => (
                  <span key={id} className="inline-flex items-center gap-1 rounded-full bg-content px-2.5 py-1 text-sm text-ink">
                    {byId.get(id)?.name ?? 'Someone who can no longer sign'}
                    <button type="button" onClick={() => set(i, { signer_ids: d.signer_ids.filter((x) => x !== id) })} className="text-ink-muted hover:text-danger" aria-label="Remove"><X className="size-3.5" /></button>
                  </span>
                ))}
              </div>
              <select value="" onChange={(e) => e.target.value && set(i, { signer_ids: [...d.signer_ids, e.target.value] })} className={`${selectCls} mt-2`} aria-label="Add an approver to this rule">
                <option value="">Add an approver…</option>
                {signers.filter((u) => !d.signer_ids.includes(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name} ({u.email})</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={d.active} onChange={(e) => set(i, { active: e.target.checked })} className="size-4 accent-accent" /> On
              </label>
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => {
                if (d.id) setRemoved((prev) => [...prev, d.id!])
                setDrafts((prev) => prev.filter((_, j) => j !== i))
              }}><Trash2 className="size-4" /> Remove rule</Button>
            </div>
          </div>
        ))}
        <div>
          <Button variant="secondary" size="sm" onClick={() => setDrafts((prev) => [...prev, { label: '', min_amount: '', category: '', signer_ids: [], active: true }])}>
            <Plus className="size-4" /> Add a rule
          </Button>
        </div>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2 border-t border-border pt-4">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Save rules</Button>
        </div>
      </div>
    </Modal>
  )
}
