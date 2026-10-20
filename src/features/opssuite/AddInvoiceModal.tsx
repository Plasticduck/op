import { useState } from 'react'
import { FileText, Loader2, Upload, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { opsInvoices } from '@/lib/queries/opsInvoices'

// Manually add an invoice (paper, hand-delivered, or anything that wasn't
// emailed in). It's filed exactly like an emailed one: same storage path, lands
// in Unassigned, due date defaults to the invoice date + 30, and a matching
// vendor + invoice number is flagged as a possible duplicate. Site, approver,
// and GL are set afterward in the normal workflow.

const MAX_BYTES = 25 * 1024 * 1024 // the ops-invoices bucket limit
const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif'

const plus30 = (isoDate: string) => {
  const d = new Date(isoDate + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 30)
  return d.toISOString().slice(0, 10)
}

export function AddInvoiceModal({ vendors, onClose, onCreated }: {
  vendors: string[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { profile } = useAuth()
  const [file, setFile] = useState<File | null>(null)
  const [vendor, setVendor] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [invoiceDate, setInvoiceDate] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDate, setDueDate] = useState('')
  // Keep auto-filling the due date from the invoice date until it's edited.
  const [dueTouched, setDueTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pickFile = (f: File | null) => {
    setError(null)
    if (!f) return
    if (f.size > MAX_BYTES) return setError('That file is over 25 MB.')
    setFile(f)
  }

  const onInvoiceDate = (v: string) => {
    setInvoiceDate(v)
    if (!dueTouched) setDueDate(v ? plus30(v) : '')
  }

  const submit = async () => {
    setError(null)
    if (!profile) return
    const vendorName = vendor.trim()
    const total = Number(amount.replace(/[$,\s]/g, ''))
    if (!vendorName) return setError('Enter the vendor.')
    if (!Number.isFinite(total) || total <= 0) return setError('Enter the invoice amount.')
    setBusy(true)

    const id = crypto.randomUUID()
    let filePath: string | null = null
    if (file) {
      const up = await opsInvoices.uploadFile(profile.account_id, id, file)
      if (up.error || !up.path) {
        setBusy(false)
        return setError(`Couldn't upload the file: ${up.error?.message ?? 'unknown error'}`)
      }
      filePath = up.path
    }

    const num = invoiceNumber.trim() || null
    const { error: err } = await opsInvoices.create({
      id,
      account_id: profile.account_id,
      vendor_name: vendorName,
      amount: Math.round(total * 100) / 100,
      invoice_number: num,
      invoice_date: invoiceDate || null,
      due_date: dueDate || null,
      status: 'unassigned',
      file_name: file?.name ?? null,
      file_type: file?.type || null,
      file_path: filePath,
      duplicate_of: await opsInvoices.findDuplicate(num, vendorName),
      submitted_by: profile.id,
      submitted_by_name: (profile.name ?? '').trim() || profile.email,
    })
    // If the insert fails, the uploaded file stays in the account's private
    // folder unreferenced; users can't delete from this bucket, and it's harmless.
    if (err) {
      setBusy(false)
      return setError(err.message)
    }
    setBusy(false)
    onCreated(id)
  }

  return (
    <Modal open onClose={onClose} title="Add invoice" size="md">
      <div className="flex flex-col gap-4">
        {file ? (
          <div className="flex items-center gap-3 rounded-md border border-border bg-content px-3 py-2.5">
            <FileText className="size-5 shrink-0 text-accent" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm text-ink">{file.name}</div>
              <div className="text-xs text-ink-subtle">{(file.size / 1024 / 1024).toFixed(1)} MB</div>
            </div>
            <button type="button" onClick={() => setFile(null)} className="rounded-md p-1 text-ink-muted hover:text-danger" aria-label="Remove file">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-accent/30 bg-accent-soft/30 py-6 text-sm font-medium text-accent hover:bg-accent-soft/50">
            <Upload className="mb-1 size-5" />
            Attach the invoice (PDF or photo)
            <span className="mt-0.5 text-xs font-normal text-ink-subtle">Optional, but approvers will want to see it</span>
            <input type="file" accept={ACCEPT} className="hidden" onChange={(e) => pickFile(e.target.files?.[0] ?? null)} />
          </label>
        )}

        <Field label="Vendor" required>
          {(id) => (
            <>
              <Input id={id} list="add-invoice-vendors" value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="Start typing a vendor" autoComplete="off" />
              <datalist id="add-invoice-vendors">
                {vendors.map((v) => <option key={v} value={v} />)}
              </datalist>
            </>
          )}
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Invoice #">{(id) => <Input id={id} value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />}</Field>
          <Field label="Amount" required>{(id) => <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />}</Field>
          <Field label="Invoice date">{(id) => <Input id={id} type="date" value={invoiceDate} onChange={(e) => onInvoiceDate(e.target.value)} />}</Field>
          <Field label="Due date">{(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => { setDueTouched(true); setDueDate(e.target.value) }} />}</Field>
        </div>
        <p className="-mt-2 text-xs text-ink-subtle">
          It lands in Unassigned, where you set the site, approver, and GL code as usual.
        </p>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Add invoice
          </Button>
        </div>
      </div>
    </Modal>
  )
}
