import type { OpsInvoice } from '@/lib/queries/opsInvoices'

// An approved invoice as a QuickBooks bill. Shared by Invoice Approval's CSV
// and IIF downloads and by the QuickBooks sync, so all three carry the same
// bill number, accounts, amounts and classes.

// A per-site allocation (`name` is the QuickBooks class) and a GL split, as
// stored on ops_invoices.site_allocations / gl_allocations.
type Alloc = { name: string; amount: number }
type GlAlloc = { gl_code: string; amount: number }

export type BillLine = { account: string; amount: number; cls: string }

// True when any GL code chosen for this invoice is QuickBooks' "Ask My
// Accountant" placeholder. Those invoices get a trailing '*' on the bill number,
// in the exports and the tables, to flag them for accounting follow-up.
export function usesAskAccountant(inv: OpsInvoice): boolean {
  const codes = ((inv.gl_allocations as GlAlloc[] | null) ?? []).map((g) => String(g.gl_code ?? ''))
  if (inv.gl_code) codes.push(inv.gl_code)
  return codes.some((c) => /ask\s*my\s*accountant/i.test(c))
}

// Bill number: the AI-extracted invoice number first, then the email subject
// ("Invoice #INV-4821" -> INV-4821), then the attachment filename. Gets a
// trailing '*' (no space) when the invoice uses the "Ask My Accountant" GL code.
export function billNoOf(inv: OpsInvoice): string {
  const base = (() => {
    if (inv.invoice_number?.trim()) return inv.invoice_number.trim()
    const subj = inv.email_subject ?? ''
    const m = subj.match(/#\s*([A-Za-z0-9][\w-]*)/) ?? subj.match(/\b(INV[-\s]?[A-Za-z0-9-]+)\b/i)
    if (m) return m[1].replace(/\s+/g, '')
    if (inv.file_name) return inv.file_name.replace(/\.[^.]+$/, '')
    return ''
  })()
  return base && usesAskAccountant(inv) ? base + '*' : base
}

// The bill's expense lines. Several GL codes: one line per code (its account
// and allocated amount); a single site is the class for every line, and when
// the site split lines up 1:1 with the GL split (same count and matching
// amounts) each GL line takes its paired site's class. One GL code: one line
// per site (its own amount and class), or one line for the whole amount.
export function billLinesOf(inv: OpsInvoice): BillLine[] {
  const glAllocs = (inv.gl_allocations as GlAlloc[] | null) ?? []
  const siteAllocs = (inv.site_allocations as Alloc[] | null) ?? []
  if (Array.isArray(glAllocs) && glAllocs.length > 1) {
    const singleCls = inv.class_names?.length === 1 ? String(inv.class_names[0]) : ''
    const paired =
      Array.isArray(siteAllocs) && siteAllocs.length === glAllocs.length && siteAllocs.length > 1 &&
      glAllocs.every((g, i) => Math.abs((Number(g.amount) || 0) - (Number(siteAllocs[i]?.amount) || 0)) < 0.005)
    return glAllocs.map((g, i) => ({
      account: String(g.gl_code ?? ''),
      amount: Number(g.amount) || 0,
      cls: paired ? String(siteAllocs[i]?.name ?? '') : singleCls,
    }))
  }
  const account = glAllocs.length ? String(glAllocs[0].gl_code ?? '') : (inv.gl_code ?? '')
  return Array.isArray(siteAllocs) && siteAllocs.length
    ? siteAllocs.map((a) => ({ account, amount: Number(a.amount) || 0, cls: String(a.name ?? '') }))
    : [{ account, amount: Number(inv.amount) || 0, cls: '' }]
}

// The bill's date: the invoice date, else the day it came in.
export const billDateOf = (inv: OpsInvoice): string => (inv.invoice_date ?? inv.submitted_at ?? '').slice(0, 10)
