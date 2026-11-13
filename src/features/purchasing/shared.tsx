import type { ReactNode } from 'react'
import { FileText, Lock } from 'lucide-react'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PrDocument, PrFile } from '@/lib/queries/purchaseRequests'
import { fileSize, STATUS_META } from './logic'

export function StatusPill({ status }: { status: string }) {
  const m = STATUS_META[status] ?? STATUS_META.draft
  return <span className={cn('inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold', m.cls)}>{m.label}</span>
}

const fmtDay = (d: string) => (d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '')

// The request as it reads on paper. `files` lets attachments open; `locked`
// marks a signed snapshot.
export function DocumentView({ doc, files, onOpenFile, locked }: {
  doc: PrDocument
  files?: PrFile[]
  onOpenFile?: (f: PrFile) => void
  locked?: boolean
}) {
  const pairs: [string, ReactNode][] = [
    ['Vendor', doc.vendor || 'Not set'],
    ['Site', doc.site || 'Not set'],
    ['Category', doc.category || 'Not set'],
    ['GL code', doc.gl_code || 'Not set'],
    ['Payment method', doc.payment_method || 'Not set'],
    ['Needed by', doc.needed_by ? fmtDay(doc.needed_by) : 'No date'],
    ['Priority', doc.priority === 'Urgent' ? <span className="font-semibold text-danger">Urgent</span> : 'Normal'],
    ['Requested by', doc.requester.name],
  ]
  return (
    <div className="flex flex-col gap-5">
      {locked && (
        <p className="inline-flex w-fit items-center gap-1.5 rounded-full bg-content px-2.5 py-1 text-xs text-ink-muted">
          <Lock className="size-3" /> This is the signed version. It can't be edited.
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-4">
        {pairs.map(([k, v]) => (
          <div key={k} className="min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{k}</dt>
            <dd className="mt-0.5 break-words text-sm text-ink">{v}</dd>
          </div>
        ))}
      </dl>

      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full min-w-[480px] text-sm">
          <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Description</th>
              <th className="px-3 py-2 text-right font-medium">Qty</th>
              <th className="px-3 py-2 text-right font-medium">Unit price</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody>
            {doc.line_items.map((l, i) => (
              <tr key={i} className="border-t border-border">
                <td className="px-3 py-2 text-ink">{l.description || <span className="text-ink-subtle">No description</span>}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{l.quantity}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{currency(Number(l.unit_price))}</td>
                <td className="px-3 py-2 text-right tabular-nums text-ink">{currency(Number(l.amount))}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="text-sm">
            {([['Subtotal', doc.subtotal], ['Shipping', doc.shipping], ['Tax', doc.tax]] as const).map(([k, v]) => (
              <tr key={k} className="border-t border-border text-ink-muted">
                <td colSpan={3} className="px-3 py-1.5 text-right">{k}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{currency(Number(v))}</td>
              </tr>
            ))}
            <tr className="border-t border-border font-semibold text-ink">
              <td colSpan={3} className="px-3 py-2 text-right">Total</td>
              <td className="px-3 py-2 text-right tabular-nums">{currency(Number(doc.total))}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Business reason</h4>
        <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{doc.justification || <span className="text-ink-subtle">None given</span>}</p>
      </div>

      {doc.attachments.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Attachments</h4>
          <ul className="mt-1.5 flex flex-col gap-1.5">
            {doc.attachments.map((a) => {
              const f = files?.find((x) => x.id === a.id)
              return (
                <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                  <button
                    type="button"
                    disabled={!f || !onOpenFile}
                    onClick={() => f && onOpenFile?.(f)}
                    className="inline-flex items-center gap-1.5 font-medium text-accent hover:underline disabled:text-ink disabled:no-underline"
                  >
                    <FileText className="size-4" /> {a.name}
                  </button>
                  <span className="text-xs text-ink-subtle">{fileSize(a.size)}</span>
                  {a.sha256 && <span className="font-mono text-[11px] text-ink-subtle" title={`SHA-256 ${a.sha256}`}>{a.sha256.slice(0, 12)}…</span>}
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}

