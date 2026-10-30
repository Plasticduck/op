import type { Json } from '@/lib/database.types'
import type { OpsInvoice } from '@/lib/queries/opsInvoices'
import type { QbListItem } from '@/lib/queries/quickbooks'
import { billDateOf, billLinesOf, billNoOf, type BillLine } from './invoiceBill'

// An approved invoice checked against QuickBooks' own lists (brought back by
// the Web Connector) and turned into what the qbwc function sends: every name
// replaced by QuickBooks' ListID, so a bill can only go once everything in it
// exists in QuickBooks, is active, and is one thing.
//
// Vendors match by name; classes by full name ("West:22- 87th and Evans
// Odessa"), or by name when only one class has it. GL codes are stored the way
// QuickBooks shows them with account numbers on ("70000 · Sales and
// Marketing:700001 · Advertising"); QuickBooks knows that account as
// "Sales and Marketing:Advertising", number 700001, so it matches on the name
// without the numbers, then on the last number.

const norm = (s: string) => s.trim().replace(/\s+/g, ' ').toLowerCase()
const NUMBERED = /^\s*([0-9][0-9A-Za-z.-]*)\s+·\s+(.+)$/

export function glParts(code: string): { fullName: string; number: string | null } {
  const segs = code.split(':').map((seg) => {
    const m = seg.match(NUMBERED)
    return m ? { name: m[2].trim(), number: m[1] } : { name: seg.trim(), number: null }
  })
  return { fullName: segs.map((s) => s.name).join(':'), number: segs[segs.length - 1]?.number ?? null }
}

export type QbLists = {
  vendors: Map<string, QbListItem[]>
  accountsByName: Map<string, QbListItem[]>
  accountsByNumber: Map<string, QbListItem[]>
  classesByFullName: Map<string, QbListItem[]>
  classesByName: Map<string, QbListItem[]>
  counts: { vendor: number; account: number; class: number }
}

export function indexLists(items: QbListItem[]): QbLists {
  const add = (m: Map<string, QbListItem[]>, k: string | null, v: QbListItem) => {
    if (!k) return
    const key = norm(k)
    m.set(key, [...(m.get(key) ?? []), v])
  }
  const l: QbLists = {
    vendors: new Map(), accountsByName: new Map(), accountsByNumber: new Map(), classesByFullName: new Map(), classesByName: new Map(),
    counts: { vendor: 0, account: 0, class: 0 },
  }
  for (const it of items) {
    if (it.list_type === 'vendor') { add(l.vendors, it.name, it); l.counts.vendor++ }
    if (it.list_type === 'account') { add(l.accountsByName, it.full_name, it); add(l.accountsByNumber, it.account_number, it); l.counts.account++ }
    if (it.list_type === 'class') { add(l.classesByFullName, it.full_name, it); add(l.classesByName, it.name, it); l.counts.class++ }
  }
  return l
}

function pickOne(hits: QbListItem[] | undefined, what: string, label: string): { item: QbListItem | null; problem: string | null } {
  if (!hits?.length) return { item: null, problem: `${what} "${label}" isn't in QuickBooks.` }
  const active = hits.filter((h) => h.is_active)
  if (!active.length) return { item: null, problem: `${what} "${label}" is inactive in QuickBooks.` }
  if (active.length > 1) return { item: null, problem: `More than one ${what.toLowerCase()} in QuickBooks matches "${label}".` }
  return { item: active[0], problem: null }
}

export type PreparedBill = {
  invoice: OpsInvoice
  refNumber: string
  vendor: string
  date: string
  total: number
  lines: BillLine[]
  // Why it can't go yet; empty when it's ready.
  problems: string[]
  payload: Json | null
}

export function prepareBill(inv: OpsInvoice, lists: QbLists): PreparedBill {
  const problems: string[] = []
  const refNumber = billNoOf(inv)
  const lines = billLinesOf(inv)
  const total = Math.round(lines.reduce((s, l) => s + l.amount, 0) * 100) / 100
  const vendorName = (inv.vendor_name ?? '').trim()
  const date = billDateOf(inv)

  let vendor: QbListItem | null = null
  if (!vendorName) problems.push('No vendor.')
  else {
    const p = pickOne(lists.vendors.get(norm(vendorName)), 'Vendor', vendorName)
    vendor = p.item
    if (p.problem) problems.push(p.problem)
  }
  if (!date) problems.push('No invoice date.')
  if (refNumber.length > 20) problems.push(`Bill number "${refNumber}" is longer than QuickBooks allows (20 characters).`)
  if (!(total > 0)) problems.push('The total is $0.')

  const out = lines.map((l) => {
    let account: QbListItem | null = null
    if (!l.account.trim()) problems.push('A line has no GL account.')
    else {
      const { fullName, number } = glParts(l.account)
      let hits = lists.accountsByName.get(norm(fullName))
      if (!hits?.length && number) hits = lists.accountsByNumber.get(norm(number))
      const p = pickOne(hits, 'Account', l.account)
      account = p.item
      if (p.problem) problems.push(p.problem)
    }
    let cls: QbListItem | null = null
    if (l.cls.trim()) {
      const byFull = lists.classesByFullName.get(norm(l.cls))
      const p = pickOne(byFull?.length ? byFull : lists.classesByName.get(norm(l.cls)), 'Class', l.cls)
      cls = p.item
      if (p.problem) problems.push(p.problem)
    }
    return { account, amount: l.amount, cls }
  })

  const unique = [...new Set(problems)]
  const payload = unique.length || !vendor ? null : {
    vendor: { list_id: vendor.list_id, name: vendor.name },
    txn_date: date,
    due_date: inv.due_date ?? null,
    ref_number: refNumber,
    memo: inv.memo ?? '',
    lines: out.map((l) => ({
      account: { list_id: l.account!.list_id, full_name: l.account!.full_name },
      amount: l.amount,
      class: l.cls ? { list_id: l.cls.list_id, full_name: l.cls.full_name } : null,
    })),
  }
  return { invoice: inv, refNumber, vendor: vendorName, date, total, lines, problems: unique, payload }
}
