import { useCallback, useEffect, useState } from 'react'
import { Plus, Shirt } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { timeAgo } from '@/lib/format'
import { employees as empQ, uniforms as uniformsQ, type Employee, type UniformRequest } from '@/lib/queries/people'

const STATUS_TONE = { pending: 'warn', ordered: 'accent', fulfilled: 'ok' } as const

function Inner({ locationId }: { locationId: string }) {
  const [emps, setEmps] = useState<Employee[]>([])
  const [rows, setRows] = useState<UniformRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const empName = (eid: string) => {
    const e = emps.find((x) => x.id === eid)
    return e ? `${e.first_name} ${e.last_name}` : '—'
  }

  const load = useCallback(async () => {
    setLoading(true)
    const { data: e } = await empQ.list(locationId)
    const list = (e as Employee[] | null) ?? []
    setEmps(list)
    if (list.length) {
      const { data } = await uniformsQ.list(list.map((x) => x.id))
      setRows((data as UniformRequest[] | null) ?? [])
    } else setRows([])
    setSelected(new Set())
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const advance = async (r: UniformRequest) => {
    const next = r.status === 'pending' ? 'ordered' : 'fulfilled'
    await uniformsQ.update(r.id, { status: next, ...(next === 'fulfilled' ? { fulfilled_at: new Date().toISOString() } : {}) })
    void load()
  }

  const bulkFulfill = async () => {
    await Promise.all([...selected].map((id) => uniformsQ.update(id, { status: 'fulfilled', fulfilled_at: new Date().toISOString() })))
    void load()
  }

  const pendingSelectable = rows.filter((r) => r.status !== 'fulfilled')

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Uniform requests"
        subtitle="Track requests from pending to fulfilled."
        actions={
          <div className="flex gap-2">
            {selected.size > 0 && <Button variant="secondary" onClick={bulkFulfill}>Fulfill {selected.size} selected</Button>}
            <Button onClick={() => setCreating(true)}><Plus className="size-4" /> New request</Button>
          </div>
        }
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Shirt} title="No requests" description="Submit uniform requests and track fulfilment." action={<Button onClick={() => setCreating(true)}>New request</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={selected.size > 0 && selected.size === pendingSelectable.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(pendingSelectable.map((r) => r.id)) : new Set())}
                  />
                </th>
                <th className="px-3 py-2.5 font-medium">Employee</th>
                <th className="px-3 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">Requested</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5">
                    {r.status !== 'fulfilled' && (
                      <input
                        type="checkbox"
                        checked={selected.has(r.id)}
                        onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n })}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2.5 font-medium text-ink">{empName(r.employee_id)}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.item}{r.size ? ` (${r.size})` : ''} ×{r.quantity}</td>
                  <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE]}>{r.status}</Badge></td>
                  <td className="px-3 py-2.5 text-ink-muted">{timeAgo(r.requested_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {r.status !== 'fulfilled' && (
                      <Button variant="secondary" size="sm" onClick={() => advance(r)}>
                        {r.status === 'pending' ? 'Mark ordered' : 'Mark fulfilled'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <RequestModal employees={emps} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
    </div>
  )
}

function RequestModal({ employees, onClose, onSaved }: { employees: Employee[]; onClose: () => void; onSaved: () => void }) {
  const [employeeId, setEmployeeId] = useState('')
  const [item, setItem] = useState('')
  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!employeeId) return setError('Select an employee')
    if (!item.trim()) return setError('Enter an item')
    const { error: err } = await uniformsQ.create({ employee_id: employeeId, item: item.trim(), size: size.trim() || null, quantity: Number(quantity) || 1 })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New uniform request">
      <div className="flex flex-col gap-4">
        <Field label="Employee" required>
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Item" required>{(id) => <Input id={id} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Shirt, hat…" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Size">{(id) => <Input id={id} value={size} onChange={(e) => setSize(e.target.value)} />}</Field>
          <Field label="Quantity">{(id) => <Input id={id} type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Submit request</Button></div>
      </div>
    </Modal>
  )
}

export default function UniformsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
