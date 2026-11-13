// Purchase Request helpers shared by the page's components.
import { currency } from '@/lib/format'
import type { ApprovalRule, LineItem, PrDocument, PrFile, PurchaseRequest, Recipient } from '@/lib/queries/purchaseRequests'
import { prNumber } from './access'

export const STATUS_META: Record<string, { label: string; cls: string }> = {
  draft: { label: 'Draft', cls: 'bg-ink/10 text-ink-muted' },
  pending: { label: 'Awaiting approval', cls: 'bg-warn-soft text-warn' },
  approved: { label: 'Approved', cls: 'bg-ok-soft text-ok' },
  purchased: { label: 'Purchased', cls: 'bg-accent-soft text-accent' },
  declined: { label: 'Declined', cls: 'bg-danger-soft text-danger' },
  voided: { label: 'Voided', cls: 'bg-ink/10 text-ink-muted' },
}

const cents = (v: unknown) => Math.round(Number(v || 0) * 100)
const money = (c: number) => (c / 100).toFixed(2)

// Same math as the purchase-requests function (doc.ts), so a draft shows exactly
// what will be signed.
export function totals(items: LineItem[], shipping: unknown, tax: unknown) {
  const lines = items.map((it) => Math.round(Number(it.quantity || 0) * cents(it.unit_price)))
  const subtotal = lines.reduce((s, n) => s + n, 0)
  return { lines, subtotal, total: subtotal + cents(shipping) + cents(tax) }
}

// A draft in the shape of a signed document, for the read-only view.
export function draftToDoc(pr: PurchaseRequest, files: PrFile[], company: string): PrDocument {
  const items = Array.isArray(pr.line_items) ? pr.line_items : []
  const t = totals(items, pr.shipping, pr.tax)
  return {
    number: prNumber(pr.number), version: 0, company,
    title: pr.title, vendor: pr.vendor ?? '', site: pr.site ?? '', category: pr.category ?? '',
    gl_code: pr.gl_code ?? '', payment_method: pr.payment_method ?? '', needed_by: pr.needed_by ?? '',
    priority: pr.priority === 'urgent' ? 'Urgent' : 'Normal', justification: pr.justification ?? '',
    line_items: items.map((it, i) => ({
      description: String(it.description ?? ''), quantity: String(Number(it.quantity || 0)),
      unit_price: money(cents(it.unit_price)), amount: money(t.lines[i]),
    })),
    subtotal: money(t.subtotal), shipping: money(cents(pr.shipping)), tax: money(cents(pr.tax)), total: money(t.total),
    requester: { id: pr.requester_id ?? '', name: pr.requester_name, email: pr.requester_email },
    attachments: files.filter((f) => f.kind === 'attachment' && !f.removed_at).map((f) => ({ id: f.id, name: f.name, size: Number(f.size ?? 0), sha256: f.sha256 ?? '' })),
    routing: { sign_in_order: true, signers: [], cc: [] },
  }
}

export function fileSize(n: number): string {
  if (n >= 1048576) return `${(n / 1048576).toFixed(1)} MB`
  if (n >= 1024) return `${Math.round(n / 1024)} KB`
  return `${n} B`
}

// Who signs a request at or above a rule's amount (and of its category).
export function requiredByRules(rules: ApprovalRule[], total: number, category: string | null, requesterId: string) {
  const out = new Map<string, string>()
  for (const r of rules) {
    if (!r.active || total < Number(r.min_amount)) continue
    if (r.category && r.category !== category) continue
    const label = r.label?.trim() || `${currency(Number(r.min_amount))} and over${r.category ? `, ${r.category}` : ''}`
    for (const id of r.signer_ids ?? []) if (id !== requesterId && !out.has(id)) out.set(id, label)
  }
  return out
}

// Where a request stands with its signers: how many signed, and whose turn it is.
export function progressOf<R extends Pick<Recipient, 'role' | 'status' | 'routing_order' | 'name' | 'user_id'>>(recipients: R[]) {
  const signers = recipients.filter((r) => r.role === 'signer')
  const signed = signers.filter((r) => r.status === 'signed').length
  const open = signers.filter((r) => r.status !== 'signed')
  const order = open.length ? Math.min(...open.map((r) => r.routing_order)) : null
  const current = open.filter((r) => r.routing_order === order && (r.status === 'sent' || r.status === 'viewed'))
  return { signers, signed, total: signers.length, current }
}
