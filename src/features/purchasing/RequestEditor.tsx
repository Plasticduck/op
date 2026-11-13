import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowRight, FileText, Loader2, Lock, Paperclip, Plus, Trash2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { purchaseRequests, type PrFile, type PurchaseRequest, type PurchaseRequestDraft } from '@/lib/queries/purchaseRequests'
import { CATEGORIES, PAYMENT_METHODS, prNumber } from './access'
import { fileSize, totals } from './logic'

type Row = { description: string; quantity: string; unit_price: string }
const QTY = /^\d+(\.\d{1,3})?$/
const PRICE = /^\d+(\.\d{1,2})?$/
const MAX_FILE = 25 * 1024 * 1024
const selectCls = 'h-10 w-full rounded-md border border-border bg-card px-3 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent'

function num(s: string, re: RegExp): number | string {
  const t = s.trim().replace(/[$,]/g, '')
  return re.test(t) ? Number(t) : t
}

// Create or edit a draft. Nothing here is signed yet; the request is locked once
// it is sent for signature.
export function RequestEditor({ request, accountId, vendors, glCodes, sites, onClose, onSaved, onContinue, onDeleted }: {
  request: PurchaseRequest | null
  accountId: string
  vendors: string[]
  glCodes: string[]
  sites: string[]
  onClose: () => void
  onSaved: (pr: PurchaseRequest) => void
  onContinue: (pr: PurchaseRequest) => void
  onDeleted: () => void
}) {
  const [pr, setPr] = useState<PurchaseRequest | null>(request)
  const [title, setTitle] = useState(request?.title ?? '')
  const [vendor, setVendor] = useState(request?.vendor ?? '')
  const [site, setSite] = useState(request?.site ?? '')
  const [category, setCategory] = useState(request?.category ?? '')
  const [glCode, setGlCode] = useState(request?.gl_code ?? '')
  const [payment, setPayment] = useState(request?.payment_method ?? '')
  const [neededBy, setNeededBy] = useState(request?.needed_by ?? '')
  const [priority, setPriority] = useState<'normal' | 'urgent'>(request?.priority === 'urgent' ? 'urgent' : 'normal')
  const [reason, setReason] = useState(request?.justification ?? '')
  const [rows, setRows] = useState<Row[]>(
    request?.line_items?.length
      ? request.line_items.map((l) => ({ description: String(l.description ?? ''), quantity: String(l.quantity ?? ''), unit_price: String(l.unit_price ?? '') }))
      : [{ description: '', quantity: '1', unit_price: '' }],
  )
  const [shipping, setShipping] = useState(request && Number(request.shipping) ? String(request.shipping) : '')
  const [tax, setTax] = useState(request && Number(request.tax) ? String(request.tax) : '')
  const [files, setFiles] = useState<PrFile[]>([])
  const [uploading, setUploading] = useState(0)
  const [busy, setBusy] = useState<null | 'save' | 'continue' | 'delete'>(null)
  const [error, setError] = useState<string | null>(null)
  const [showErrors, setShowErrors] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!pr?.id) return
    void purchaseRequests.files(pr.id).then(({ data }) => setFiles((data ?? []).filter((f) => f.kind === 'attachment' && !f.removed_at)))
  }, [pr?.id])

  const items = rows.map((r) => ({ description: r.description.trim(), quantity: num(r.quantity, QTY), unit_price: num(r.unit_price, PRICE) }))
  const t = totals(items, num(shipping, PRICE), num(tax, PRICE))

  const problems = useMemo(() => {
    const p: Record<string, string> = {}
    if (!title.trim()) p.title = 'Say what you are buying.'
    if (!vendor.trim()) p.vendor = 'Add the vendor.'
    if (!site) p.site = 'Pick the site.'
    if (!category) p.category = 'Pick a category.'
    if (!reason.trim()) p.reason = 'Add the business reason.'
    rows.forEach((r, i) => {
      if (!r.description.trim()) p[`d${i}`] = 'Required'
      if (!QTY.test(r.quantity.trim()) || Number(r.quantity) <= 0) p[`q${i}`] = 'Above 0'
      if (!PRICE.test(r.unit_price.trim().replace(/[$,]/g, ''))) p[`u${i}`] = 'Dollars and cents'
    })
    if (shipping.trim() && !PRICE.test(shipping.trim().replace(/[$,]/g, ''))) p.shipping = 'Dollars and cents'
    if (tax.trim() && !PRICE.test(tax.trim().replace(/[$,]/g, ''))) p.tax = 'Dollars and cents'
    if (!rows.length) p.rows = 'Add at least one line.'
    if (t.total <= 0 && !Object.keys(p).some((k) => /^[qu]\d/.test(k))) p.total = 'The total must be more than $0.00.'
    return p
  }, [title, vendor, site, category, reason, rows, shipping, tax, t.total])
  const err = (k: string) => (showErrors ? problems[k] : undefined)

  const draft = (): Partial<PurchaseRequestDraft> => ({
    title: title.trim(), vendor: vendor.trim() || null, site: site || null, category: category || null,
    gl_code: glCode.trim() || null, payment_method: payment || null, needed_by: neededBy || null, priority,
    justification: reason.trim() || null, line_items: items,
    shipping: typeof num(shipping, PRICE) === 'number' ? (num(shipping, PRICE) as number) : 0,
    tax: typeof num(tax, PRICE) === 'number' ? (num(tax, PRICE) as number) : 0,
  })

  // Saves the draft (creating it the first time) and returns the stored row.
  const persist = async (): Promise<PurchaseRequest | null> => {
    const res = pr?.id ? await purchaseRequests.update(pr.id, draft()) : await purchaseRequests.create(draft())
    if (res.error || !res.data) {
      setError(res.error?.message?.includes('row-level security') ? 'This request can no longer be edited.' : 'Could not save. Check your connection and try again.')
      return null
    }
    const saved = res.data as unknown as PurchaseRequest
    setPr(saved)
    return saved
  }

  const save = async () => {
    setBusy('save'); setError(null)
    const saved = await persist()
    setBusy(null)
    if (saved) onSaved(saved)
  }

  const next = async () => {
    setShowErrors(true)
    if (Object.keys(problems).length) { setError('Fix the highlighted fields first.'); return }
    if (uploading) { setError('Wait for the files to finish uploading.'); return }
    setBusy('continue'); setError(null)
    const saved = await persist()
    setBusy(null)
    if (saved) onContinue(saved)
  }

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return
    setError(null)
    let target = pr
    if (!target?.id) {
      target = await persist()
      if (!target) return
    }
    for (const f of Array.from(list)) {
      if (f.size > MAX_FILE) { setError(`${f.name} is over 25 MB.`); continue }
      setUploading((n) => n + 1)
      const { data, error: e } = await purchaseRequests.upload(accountId, target.id, f)
      setUploading((n) => n - 1)
      if (e || !data) setError(`${f.name} did not upload. Try again.`)
      else setFiles((prev) => [...prev, data])
    }
    if (fileInput.current) fileInput.current.value = ''
  }

  const removeFile = async (f: PrFile) => {
    const { error: e } = await purchaseRequests.removeFile(f)
    if (e) setError(`Could not remove ${f.name}.`)
    else setFiles((prev) => prev.filter((x) => x.id !== f.id))
  }

  const del = async () => {
    if (!pr?.id) { onClose(); return }
    setBusy('delete')
    const { error: e } = await purchaseRequests.remove(pr.id)
    setBusy(null)
    setConfirmDelete(false)
    if (e) setError('Could not delete this draft.')
    else onDeleted()
  }

  const setRow = (i: number, patch: Partial<Row>) => setRows((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const openFile = async (f: PrFile) => {
    const url = await purchaseRequests.fileUrl(f.path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <Modal open onClose={onClose} size="xl" title={pr?.id ? `Edit ${prNumber(pr.number)}` : 'New purchase request'}
      description="Fill it in, then choose who approves it. Nothing is signed until you send it.">
      <div className="flex flex-col gap-5">
        {pr?.ever_sent && (
          <p className="rounded-md border border-warn/40 bg-warn-soft px-3 py-2 text-sm text-warn">
            This request was sent before. Sending it again starts a new version, and everyone signs again.
          </p>
        )}

        <F label="What are you buying?" required error={err('title')}>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Replacement dryer motor for tunnel exit" maxLength={200} invalid={!!err('title')} autoFocus={!pr?.id} />
        </F>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <F label="Vendor" required error={err('vendor')}>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} list="pr-vendors" placeholder="Type or pick" maxLength={200} invalid={!!err('vendor')} />
            <datalist id="pr-vendors">{vendors.map((v) => <option key={v} value={v} />)}</datalist>
          </F>
          <F label="Site" required error={err('site')}>
            <select value={site} onChange={(e) => setSite(e.target.value)} className={cn(selectCls, err('site') && 'border-danger')} aria-label="Site">
              <option value="">Pick a site</option>
              {sites.map((s) => <option key={s} value={s}>{s}</option>)}
              {site && !sites.includes(site) && <option value={site}>{site}</option>}
            </select>
          </F>
          <F label="Category" required error={err('category')}>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={cn(selectCls, err('category') && 'border-danger')} aria-label="Category">
              <option value="">Pick a category</option>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </F>
          <F label="GL code">
            <Input value={glCode} onChange={(e) => setGlCode(e.target.value)} list="pr-gl" placeholder="Optional" maxLength={120} />
            <datalist id="pr-gl">{glCodes.map((g) => <option key={g} value={g} />)}</datalist>
          </F>
          <F label="Payment method">
            <select value={payment} onChange={(e) => setPayment(e.target.value)} className={selectCls} aria-label="Payment method">
              <option value="">Not sure yet</option>
              {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </F>
          <F label="Needed by">
            <Input type="date" value={neededBy} onChange={(e) => setNeededBy(e.target.value)} />
          </F>
        </div>

        <F label="Priority">
          <div className="inline-flex w-fit gap-1 rounded-lg bg-content p-1" role="radiogroup" aria-label="Priority">
            {(['normal', 'urgent'] as const).map((p) => (
              <button key={p} type="button" role="radio" aria-checked={priority === p} onClick={() => setPriority(p)}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium capitalize transition',
                  priority === p ? (p === 'urgent' ? 'bg-danger text-white' : 'bg-card text-ink shadow-sm') : 'text-ink-muted hover:text-ink')}>
                {p}
              </button>
            ))}
          </div>
        </F>

        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-medium text-ink">Line items <span className="text-danger">*</span></h3>
          </div>
          <div className="flex flex-col gap-2">
            <div className="hidden grid-cols-[1fr_80px_120px_110px_36px] gap-2 px-1 text-xs font-medium uppercase tracking-wide text-ink-subtle sm:grid">
              <span>Description</span><span>Qty</span><span>Unit price</span><span className="text-right">Amount</span><span />
            </div>
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_80px] gap-2 rounded-md border border-border p-2 sm:grid-cols-[1fr_80px_120px_110px_36px] sm:border-0 sm:p-0">
                <div className="col-span-2 sm:col-span-1">
                  <Input value={r.description} onChange={(e) => setRow(i, { description: e.target.value })} placeholder="What it is" aria-label={`Line ${i + 1} description`} maxLength={300} invalid={!!err(`d${i}`)} />
                </div>
                <div>
                  <Input value={r.quantity} onChange={(e) => setRow(i, { quantity: e.target.value })} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} invalid={!!err(`q${i}`)} />
                </div>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">$</span>
                  <Input value={r.unit_price} onChange={(e) => setRow(i, { unit_price: e.target.value })} inputMode="decimal" placeholder="0.00" className="pl-6" aria-label={`Line ${i + 1} unit price`} invalid={!!err(`u${i}`)} />
                </div>
                <div className="flex items-center justify-end text-sm tabular-nums text-ink">{currency(t.lines[i] / 100)}</div>
                <div className="flex items-center justify-end">
                  <button type="button" onClick={() => setRows((prev) => prev.filter((_, j) => j !== i))} disabled={rows.length === 1}
                    className="rounded-md p-2 text-ink-muted hover:bg-content hover:text-danger disabled:opacity-30" aria-label={`Remove line ${i + 1}`}>
                    <X className="size-4" />
                  </button>
                </div>
              </div>
            ))}
            <div>
              <Button variant="ghost" size="sm" onClick={() => setRows((prev) => [...prev, { description: '', quantity: '1', unit_price: '' }])} disabled={rows.length >= 50}>
                <Plus className="size-4" /> Add a line
              </Button>
            </div>
          </div>
          <div className="mt-3 ml-auto flex w-full max-w-xs flex-col gap-2 text-sm">
            <Money label="Shipping" value={shipping} onChange={setShipping} invalid={!!err('shipping')} />
            <Money label="Tax" value={tax} onChange={setTax} invalid={!!err('tax')} />
            <div className="flex items-center justify-between border-t border-border pt-2 font-semibold text-ink">
              <span>Total</span><span className="tabular-nums" data-testid="pr-total">{currency(t.total / 100)}</span>
            </div>
            {err('total') && <p className="text-xs text-danger">{err('total')}</p>}
          </div>
        </section>

        <F label="Business reason" required error={err('reason')}>
          <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={4} maxLength={4000}
            placeholder="Why it's needed, what happens without it, and any quotes you compared."
            className={cn('w-full rounded-md border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent', err('reason') ? 'border-danger' : 'border-border')} />
        </F>

        <section>
          <h3 className="text-sm font-medium text-ink">Quotes and attachments</h3>
          <p className="text-xs text-ink-muted">Each file is fingerprinted when you send, so the record shows exactly what was approved.</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
                <FileText className="size-4 shrink-0 text-ink-muted" />
                <button type="button" onClick={() => void openFile(f)} className="min-w-0 flex-1 truncate text-left text-ink hover:underline">{f.name}</button>
                <span className="shrink-0 text-xs text-ink-subtle">{fileSize(Number(f.size ?? 0))}</span>
                {f.locked && <span title="Part of an earlier version; kept with that record"><Lock className="size-3.5 text-ink-subtle" /></span>}
                <button type="button" onClick={() => void removeFile(f)} className="rounded p-1 text-ink-muted hover:text-danger" aria-label={`Remove ${f.name}`}>
                  <X className="size-4" />
                </button>
              </li>
            ))}
            {uploading > 0 && <li className="flex items-center gap-2 px-1 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Uploading…</li>}
          </ul>
          <input ref={fileInput} type="file" multiple className="sr-only" onChange={(e) => void addFiles(e.target.files)} data-testid="pr-files"
            accept=".pdf,.png,.jpg,.jpeg,.heic,.webp,.doc,.docx,.xls,.xlsx,.csv,.txt" />
          <Button variant="secondary" size="sm" className="mt-2" onClick={() => fileInput.current?.click()}>
            <Paperclip className="size-4" /> Add files
          </Button>
        </section>

        {error && <p role="alert" className="rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            {(!pr || !pr.ever_sent) && (
              <Button variant="ghost" onClick={() => (pr?.id ? setConfirmDelete(true) : onClose())} disabled={!!busy} className="text-danger">
                <Trash2 className="size-4" /> {pr?.id ? 'Delete draft' : 'Discard'}
              </Button>
            )}
          </div>
          <div className="flex flex-col-reverse gap-2 sm:flex-row">
            <Button variant="secondary" onClick={() => void save()} disabled={!!busy || uploading > 0}>
              {busy === 'save' && <Loader2 className="size-4 animate-spin" />} Save draft
            </Button>
            <Button onClick={() => void next()} disabled={!!busy || uploading > 0} data-testid="pr-continue">
              {busy === 'continue' ? <Loader2 className="size-4 animate-spin" /> : null} Choose approvers <ArrowRight className="size-4" />
            </Button>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDelete}
        title="Delete this draft?"
        description="It hasn't been sent, so nothing else is affected."
        confirmLabel="Delete draft"
        destructive
        loading={busy === 'delete'}
        onConfirm={() => void del()}
        onCancel={() => setConfirmDelete(false)}
      />
    </Modal>
  )
}

function F({ label, required, error, children }: { label: string; required?: boolean; error?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}{required && <span className="text-danger"> *</span>}</span>
      {children}
      {error && <span className="text-xs text-danger">{error}</span>}
    </label>
  )
}

function Money({ label, value, onChange, invalid }: { label: string; value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-ink-muted">{label}</span>
      <div className="relative w-32">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-ink-subtle">$</span>
        <Input value={value} onChange={(e) => onChange(e.target.value)} inputMode="decimal" placeholder="0.00" className="pl-6 text-right" aria-label={label} invalid={invalid} />
      </div>
    </div>
  )
}
