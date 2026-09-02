import { useCallback, useEffect, useState } from 'react'
import { Plus, Truck } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supplies, type SupplyRequest } from '@/lib/queries/ops'

const CATEGORIES = ['Wash', 'Detail', 'Lube', 'POS', 'Office', 'Maintenance', 'Other'] as const
const PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'middle', label: 'Middle' },
  { value: 'high', label: 'High' },
] as const
const PRIORITY_TONE = { low: 'neutral', middle: 'accent', high: 'danger' } as const

type Row = SupplyRequest & { requested_by: { name: string } | null }

const STATUS_FLOW = ['pending', 'approved', 'ordered', 'received'] as const
const STATUS_TONE = { pending: 'warn', approved: 'accent', ordered: 'neutral', received: 'ok' } as const

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const isManagerPlus = profile?.role !== 'employee'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await supplies.list(locationId)
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const advance = async (r: Row) => {
    const idx = STATUS_FLOW.indexOf(r.status as (typeof STATUS_FLOW)[number])
    const next = STATUS_FLOW[idx + 1]
    if (next) { await supplies.update(r.id, { status: next }); void load() }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Supplies requests"
        subtitle="Request consumables; managers approve and track fulfilment."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New request</Button>}
      />

      <a
        href="https://shop.officewiseco.solutions/Authentication/Login"
        target="_blank"
        rel="noreferrer"
        className="flex flex-col items-start gap-2 self-start rounded-md border border-border bg-card p-4 transition hover:border-accent hover:shadow-sm"
      >
        <span className="text-sm font-semibold text-ink">Office Supplies &amp; Furniture</span>
        <img src="/officewise.jpg" alt="Officewise" className="h-auto w-60 max-w-full" />
      </a>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Truck} title="No requests" description="Submit a supply request and track it through to received." action={<Button onClick={() => setCreating(true)}>New request</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 font-medium numeric">Qty</th>
                <th className="px-3 py-2.5 font-medium">Category</th>
                <th className="px-3 py-2.5 font-medium">Priority</th>
                <th className="px-3 py-2.5 font-medium">Requested by</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">
                    {r.item}
                    {r.notes && <p className="text-xs font-normal text-ink-muted">{r.notes}</p>}
                  </td>
                  <td className="px-3 py-2.5 numeric tabular text-ink-muted">{r.quantity}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.category ?? '—'}
                    {r.category === 'Other' && r.category_other && (
                      <p className="text-xs text-ink-subtle">{r.category_other}</p>
                    )}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={PRIORITY_TONE[(r.priority as keyof typeof PRIORITY_TONE) ?? 'middle']}>
                      {PRIORITIES.find((p) => p.value === r.priority)?.label ?? 'Middle'}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.first_name || r.last_name
                      ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
                      : r.requested_by?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE]}>{r.status}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-muted">{timeAgo(r.created_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {isManagerPlus && r.status !== 'received' && (
                      <Button variant="secondary" size="sm" onClick={() => advance(r)}>
                        {r.status === 'pending' ? 'Approve' : r.status === 'approved' ? 'Mark ordered' : 'Mark received'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <RequestModal locationId={locationId} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
    </div>
  )
}

function RequestModal({ locationId, onClose, onSaved }: { locationId: string; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  // Prefill the requester name from the signed-in user, but keep it editable.
  const [pf, ...pl] = (profile?.name ?? '').trim().split(' ')
  const [firstName, setFirstName] = useState(pf ?? '')
  const [lastName, setLastName] = useState(pl.join(' '))
  const [category, setCategory] = useState<string>('Wash')
  const [categoryOther, setCategoryOther] = useState('')
  const [priority, setPriority] = useState<string>('middle')
  const [item, setItem] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!firstName.trim() || !lastName.trim()) return setError('Enter your first and last name')
    if (!item.trim()) return setError('Enter an item name')
    if (category === 'Other' && !categoryOther.trim()) return setError('Describe the "Other" category')
    const { error: err } = await supplies.create({
      location_id: locationId,
      requested_by: profile?.id ?? null,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      category,
      category_other: category === 'Other' ? categoryOther.trim() : null,
      priority,
      item: item.trim(),
      quantity: Number(quantity) || 1,
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New supply request">
      <div className="flex flex-col gap-4">
        <Field label="Site">
          {(id) => (
            <Input id={id} value={activeLocation?.name ?? ''} readOnly className="bg-content text-ink-muted" />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name" required>{(id) => <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}</Field>
          <Field label="Last name" required>{(id) => <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} />}</Field>
        </div>
        <Field label="Category" required>
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
        </Field>
        {category === 'Other' && (
          <Field label="Please explain" required>
            {(id) => <Input id={id} value={categoryOther} onChange={(e) => setCategoryOther(e.target.value)} placeholder="What is it for?" />}
          </Field>
        )}
        <Field label="Priority" required>
          {(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Item name" required>{(id) => <Input id={id} value={item} onChange={(e) => setItem(e.target.value)} />}</Field>
        <Field label="Quantity" required>{(id) => <Input id={id} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Submit request</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function SuppliesPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
