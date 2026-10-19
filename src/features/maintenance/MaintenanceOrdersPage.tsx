import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Package, Plus, Wrench } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import {
  maintenanceOrders,
  MAINTENANCE_ORDER_STATUSES,
  type MaintenanceOrderRow,
} from '@/lib/queries/maintenanceOrders'

// Maintenance (equipment) orders — mirrors the Signage flow: users see their own
// orders, the admin sees every order and manages status, and a new order emails
// the maintenance team. The equipment catalog is a placeholder for now; orders
// are placed with a simple item request until the catalog ships.

function statusBadge(status: string | null | undefined): { label: string; cls: string } {
  const s = (status ?? 'ordered').toLowerCase()
  if (s === 'cancelled') return { label: 'Cancelled', cls: 'bg-danger-soft text-danger' }
  if (s === 'completed') return { label: 'Completed', cls: 'bg-ok text-white' }
  if (s === 'shipped') return { label: 'Shipped', cls: 'bg-ok-soft text-ok' }
  if (s === 'in_production') return { label: 'In Production', cls: 'bg-warn-soft text-warn' }
  return { label: 'Ordered', cls: 'bg-accent-soft text-accent' }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export default function MaintenanceOrdersPage() {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const isAdmin = (profile?.email ?? '').toLowerCase() === 'kevan@washlyfe.com'

  const [rows, setRows] = useState<MaintenanceOrderRow[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [tab, setTab] = useState<'open' | 'completed' | 'cancelled'>('open')

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await maintenanceOrders.list()
    setRows((data as unknown as MaintenanceOrderRow[]) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  const statusOf = (r: MaintenanceOrderRow) => (r.status ?? 'ordered').toLowerCase()
  const counts = useMemo(() => {
    let open = 0, completed = 0, cancelled = 0
    for (const r of rows) {
      const s = statusOf(r)
      if (s === 'cancelled') cancelled++
      else if (s === 'completed') completed++
      else open++
    }
    return { open, completed, cancelled }
  }, [rows])

  const shown = useMemo(() => {
    if (!isAdmin) return rows
    if (tab === 'completed') return rows.filter((r) => statusOf(r) === 'completed')
    if (tab === 'cancelled') return rows.filter((r) => statusOf(r) === 'cancelled')
    return rows.filter((r) => statusOf(r) !== 'completed' && statusOf(r) !== 'cancelled')
  }, [rows, tab, isAdmin])

  const changeStatus = async (id: string, status: string) => {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)))
    await maintenanceOrders.updateStatus(id, { status, status_updated_at: new Date().toISOString() })
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-8">
      <PageHeader
        title="Maintenance Orders"
        subtitle="Order equipment for your site and track every order through to completion."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Order</Button>}
      />

      {/* Placeholder: the equipment catalog is coming soon. */}
      <div className="mt-3 flex items-start gap-3 rounded-xl border border-accent/20 bg-accent-soft/40 p-4">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent"><Package className="size-5" /></span>
        <div>
          <div className="text-sm font-semibold text-ink">Equipment catalog coming soon</div>
          <p className="mt-0.5 text-sm text-ink-muted">
            A full equipment catalog is on the way. In the meantime you can place an order by describing the item you need — the maintenance team is notified on every new order.
          </p>
        </div>
      </div>

      {/* Admin status tabs. */}
      {isAdmin && (
        <div className="mt-4 flex items-center gap-1 border-b border-border">
          {([
            ['open', `Open${counts.open ? ` (${counts.open})` : ''}`],
            ['completed', `Completed${counts.completed ? ` (${counts.completed})` : ''}`],
            ['cancelled', `Cancelled${counts.cancelled ? ` (${counts.cancelled})` : ''}`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'border-b-2 px-3 py-2 text-sm font-medium transition',
                tab === key ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      {!isAdmin && <h2 className="mt-5 text-sm font-semibold text-ink">My orders</h2>}

      <div className="mt-3 overflow-hidden rounded-xl border border-border bg-card">
        {loading ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">Loading orders…</p>
        ) : shown.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-ink-muted">
            {isAdmin ? 'No orders in this tab.' : 'You haven’t placed any orders yet.'}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Item</th>
                <th className="px-4 py-2 text-right font-medium">Qty</th>
                <th className="px-4 py-2 font-medium">Site</th>
                {isAdmin && <th className="px-4 py-2 font-medium">Requested by</th>}
                <th className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((r) => {
                const b = statusBadge(r.status)
                return (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-4 py-2.5 text-ink-muted">{fmtDate(r.created_at)}</td>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-ink">{r.item}</div>
                      {r.notes && <div className="mt-0.5 text-xs text-ink-subtle">{r.notes}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-ink-muted">{r.quantity}</td>
                    <td className="px-4 py-2.5 text-ink-muted">{r.location?.name ?? 'All sites'}</td>
                    {isAdmin && <td className="px-4 py-2.5 text-ink-muted">{r.requester_name ?? '—'}</td>}
                    <td className="px-4 py-2.5">
                      {isAdmin ? (
                        <select
                          value={statusOf(r)}
                          onChange={(e) => void changeStatus(r.id, e.target.value)}
                          className="h-8 rounded-lg border border-border bg-content px-2 text-sm text-ink"
                        >
                          {MAINTENANCE_ORDER_STATUSES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                      ) : (
                        <span className={cn('inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold', b.cls)}>{b.label}</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <NewOrderModal
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          defaultLocationId={activeLocation?.id ?? ''}
          accountId={profile?.account_id ?? ''}
          userId={profile?.id ?? null}
          userName={profile?.name ?? ''}
          onClose={() => setCreating(false)}
          onCreated={() => { setCreating(false); void load() }}
        />
      )}
    </div>
  )
}

function NewOrderModal({
  locations, defaultLocationId, accountId, userId, userName, onClose, onCreated,
}: {
  locations: Array<{ id: string; name: string }>
  defaultLocationId: string
  accountId: string
  userId: string | null
  userName: string
  onClose: () => void
  onCreated: () => void
}) {
  const [item, setItem] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [locationId, setLocationId] = useState(defaultLocationId)
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async () => {
    if (!item.trim()) { setError('Enter the item you need to order.'); return }
    setBusy(true)
    setError(null)
    const { data, error: err } = await maintenanceOrders.create({
      account_id: accountId,
      location_id: locationId || null,
      requested_by: userId,
      requester_name: userName || null,
      item: item.trim(),
      quantity: Number(quantity) || 1,
      notes: notes.trim() || null,
    })
    if (err || !data) {
      setError(err?.message ?? 'Could not place the order.')
      setBusy(false)
      return
    }
    void maintenanceOrders.emailOrder((data as { id: string }).id)
    setBusy(false)
    onCreated()
  }

  return (
    <Modal open onClose={onClose} title="New maintenance order">
      <div className="flex flex-col gap-4">
        <Field label="Item" required>
          {(id) => (
            <Input id={id} value={item} onChange={(e) => setItem(e.target.value)} placeholder="e.g. Blower motor, tire shine applicator…" autoFocus />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity">
            {(id) => (
              <Input id={id} type="number" min={1} value={quantity} onChange={(e) => setQuantity(e.target.value)} />
            )}
          </Field>
          <Field label="Site">
            {(id) => (
              <select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}
                className="h-10 w-full rounded-lg border border-border bg-content px-2 text-sm text-ink">
                <option value="">All sites</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </select>
            )}
          </Field>
        </div>
        <Field label="Notes" hint="Model, specs, urgency, or any detail the team needs">
          {(id) => (
            <textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
              className="w-full rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink" />
          )}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Wrench className="size-4" />} Place order
          </Button>
        </div>
      </div>
    </Modal>
  )
}
