import { useCallback, useEffect, useMemo, useState } from 'react'
import { ExternalLink, Plus, Shirt } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import { employees as empQ, uniforms as uniformsQ, type Employee, type UniformRequest } from '@/lib/queries/people'
import { UNIFORM_CATALOG, type UniformProduct } from '@/lib/uniformCatalog'

const STATUS_TONE = { pending: 'warn', ordered: 'accent', fulfilled: 'ok' } as const

const priceLabel = (p: UniformProduct) =>
  p.priceMax && p.priceMax !== p.price ? `$${p.price}–$${p.priceMax}` : `$${p.price}`

function Inner({ locationId }: { locationId: string }) {
  const [emps, setEmps] = useState<Employee[]>([])
  const [rows, setRows] = useState<UniformRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'catalog' | 'requests'>('catalog')
  // The request modal is open when a target is set: a catalog product, or
  // 'custom' for a free-text request not tied to a listed item.
  const [requestFor, setRequestFor] = useState<UniformProduct | 'custom' | null>(null)
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
  const pendingCount = rows.filter((r) => r.status !== 'fulfilled').length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Uniforms"
        subtitle="Browse the Mighty Wash uniform catalog and track requests to fulfilment."
        actions={
          <div className="flex gap-2">
            {selected.size > 0 && <Button variant="secondary" onClick={bulkFulfill}>Fulfill {selected.size} selected</Button>}
            <Button onClick={() => setRequestFor('custom')}><Plus className="size-4" /> Custom request</Button>
          </div>
        }
      />

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-border">
        {([['catalog', 'Catalog'], ['requests', `Requests${pendingCount ? ` (${pendingCount})` : ''}`]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 pb-2 pt-1 text-sm font-medium transition',
              tab === key ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'catalog' && (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
          {UNIFORM_CATALOG.map((p) => (
            <CatalogCard key={p.url} product={p} onRequest={() => setRequestFor(p)} />
          ))}
        </div>
      )}

      {tab === 'requests' && (loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={Shirt} title="No requests" description="Request an item from the Catalog, or submit a custom request." action={<Button onClick={() => setTab('catalog')}>Browse catalog</Button>} />
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
      ))}

      {requestFor && (
        <RequestModal
          employees={emps}
          product={requestFor === 'custom' ? null : requestFor}
          onClose={() => setRequestFor(null)}
          onSaved={() => { setRequestFor(null); setTab('requests'); void load() }}
        />
      )}
    </div>
  )
}

function CatalogCard({ product, onRequest }: { product: UniformProduct; onRequest: () => void }) {
  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex aspect-square items-center justify-center bg-white p-3">
        {product.image ? (
          <img
            src={product.image}
            alt={product.name}
            loading="lazy"
            referrerPolicy="no-referrer"
            className="max-h-full max-w-full object-contain"
          />
        ) : (
          <Shirt className="size-12 text-ink-subtle" strokeWidth={1.5} />
        )}
      </div>
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.brand && <p className="text-[11px] uppercase tracking-wide text-ink-subtle">{product.brand}</p>}
        <p className="line-clamp-2 text-sm font-semibold text-ink" title={product.name}>{product.name}</p>
        <p className="text-sm font-medium text-ink">{priceLabel(product)}</p>
        {product.sizes.length > 0 && (
          <p className="text-xs text-ink-muted">{product.sizes.join(', ')}</p>
        )}
        <div className="mt-auto flex items-center gap-2 pt-2">
          <Button size="sm" onClick={onRequest}>Request</Button>
          <a
            href={product.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-ink-muted hover:text-ink"
          >
            View <ExternalLink className="size-3" />
          </a>
        </div>
      </div>
    </div>
  )
}

function RequestModal({
  employees, product, onClose, onSaved,
}: {
  employees: Employee[]
  product: UniformProduct | null
  onClose: () => void
  onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = useState('')
  // Which catalog product this request is for (null = custom free-text item).
  const [productName, setProductName] = useState(product ? product.name : '')
  const [customItem, setCustomItem] = useState('')
  const [color, setColor] = useState('')
  const [size, setSize] = useState('')
  const [customSize, setCustomSize] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)

  const selectedProduct = useMemo(
    () => UNIFORM_CATALOG.find((p) => p.name === productName) ?? null,
    [productName],
  )
  const isCustom = productName === ''

  // Default the color when the chosen product has exactly one.
  useEffect(() => {
    setColor(selectedProduct && selectedProduct.colors.length === 1 ? selectedProduct.colors[0] : '')
    setSize('')
  }, [selectedProduct])

  const save = async () => {
    setError(null)
    if (!employeeId) return setError('Select an employee')
    const item = isCustom ? customItem.trim() : productName
    if (!item) return setError('Choose an item')
    if (selectedProduct) {
      if (selectedProduct.sizes.length > 0 && !size) return setError('Choose a size')
      if (selectedProduct.colors.length > 1 && !color) return setError('Choose a color')
    }
    // The requests table only has item/size/quantity, so fold the color into the
    // size field (e.g. "L · Black", or just the color for one-size items).
    const parts = isCustom ? [customSize.trim()] : [size, color]
    const sizeValue = parts.filter(Boolean).join(' · ') || null
    const { error: err } = await uniformsQ.create({
      employee_id: employeeId,
      item,
      size: sizeValue,
      quantity: Number(quantity) || 1,
    })
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={product ? 'Request uniform' : 'New uniform request'}>
      <div className="flex flex-col gap-4">
        <Field label="Employee" required>
          {(id) => (
            <Select id={id} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">Select…</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
            </Select>
          )}
        </Field>

        <Field label="Item" required>
          {(id) => (
            <Select id={id} value={productName} onChange={(e) => setProductName(e.target.value)}>
              <option value="">Other (custom item)</option>
              {UNIFORM_CATALOG.map((p) => <option key={p.url} value={p.name}>{p.name}</option>)}
            </Select>
          )}
        </Field>

        {isCustom && (
          <Field label="Custom item" required>
            {(id) => <Input id={id} value={customItem} onChange={(e) => setCustomItem(e.target.value)} placeholder="Shirt, hat…" />}
          </Field>
        )}

        <div className="grid grid-cols-2 gap-3">
          {selectedProduct ? (
            <>
              {selectedProduct.sizes.length > 0 && (
                <Field label="Size" required>
                  {(id) => (
                    <Select id={id} value={size} onChange={(e) => setSize(e.target.value)}>
                      <option value="">Select…</option>
                      {selectedProduct.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                    </Select>
                  )}
                </Field>
              )}
              {selectedProduct.colors.length > 1 && (
                <Field label="Color" required>
                  {(id) => (
                    <Select id={id} value={color} onChange={(e) => setColor(e.target.value)}>
                      <option value="">Select…</option>
                      {selectedProduct.colors.map((c) => <option key={c} value={c}>{c}</option>)}
                    </Select>
                  )}
                </Field>
              )}
            </>
          ) : (
            <Field label="Size">{(id) => <Input id={id} value={customSize} onChange={(e) => setCustomSize(e.target.value)} />}</Field>
          )}
          <Field label="Quantity">{(id) => <Input id={id} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
        </div>

        {selectedProduct && selectedProduct.colors.length === 1 && (
          <p className="text-xs text-ink-muted">Color: {selectedProduct.colors[0]}</p>
        )}

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Submit request</Button></div>
      </div>
    </Modal>
  )
}

export default function UniformsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
