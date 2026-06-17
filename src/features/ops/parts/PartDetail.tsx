import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ClipboardCopy,
  Cog,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { QrCodeImage } from '@/components/data/QrCodeImage'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { currency } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { parts, type Part, type PartRestockLog } from '@/lib/queries/parts'
import { EditPartModal } from './NewPartModal'

type Detail = Part & {
  vendor: { id: string; name: string } | null
  stock: Array<{
    id: string
    location_id: string
    quantity_on_hand: number
    minimum_in_stock: number
    location: { id: string; name: string } | null
  }>
  asset_links: Array<{ asset: { id: string; asset_number: number; name: string } | null }>
}

type Tab = 'details' | 'history'

export function PartDetail({
  partId, onBack, onChanged,
}: {
  partId: string
  onBack: () => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('details')
  const [history, setHistory] = useState<Array<PartRestockLog & { location: { id: string; name: string } | null }>>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [restocking, setRestocking] = useState(false)
  const [linkingAssets, setLinkingAssets] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await parts.byId(partId)
    setD(data as unknown as Detail)
    setLoading(false)
  }, [partId])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (tab !== 'history') return
    setHistoryLoading(true)
    void parts.history(partId).then(({ data }) => {
      setHistory((data as unknown as typeof history) ?? [])
      setHistoryLoading(false)
    })
  }, [partId, tab])

  useEffect(() => {
    const ch = supabase
      .channel('part-' + partId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts', filter: `id=eq.${partId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'parts_inventory', filter: `part_id=eq.${partId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'part_restock_log', filter: `part_id=eq.${partId}` }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [partId, load])

  const removePart = async () => {
    if (!d) return
    if (!window.confirm(`Delete part "${d.name}"? Inventory rows go with it.`)) return
    await parts.remove(d.id)
    onChanged()
    onBack()
  }

  if (loading || !d) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  const totalUnits = d.stock.reduce((a, s) => a + Number(s.quantity_on_hand), 0)
  const minTotal = d.stock.reduce((a, s) => a + Number(s.minimum_in_stock), 0)
  const low = d.stock.some((s) => Number(s.quantity_on_hand) < Number(s.minimum_in_stock))

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-2 py-2.5 sm:px-3">
        <button
          type="button"
          onClick={onBack}
          className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-ink-subtle">#{String(d.part_number).padStart(2, '0')}</span>
            {low && <Badge tone="warn">Low stock</Badge>}
          </div>
          <h1 className="truncate text-[17px] font-semibold text-ink">{d.name}</h1>
          <p className="text-[12px] text-ink-muted">{totalUnits} {d.uom ?? 'ea'} in stock</p>
        </div>
        <Button variant="secondary" onClick={() => setRestocking(true)} size="sm"><RefreshCw className="size-3.5" /> Restock</Button>
        <Button variant="secondary" onClick={() => setEditing(true)} size="sm"><Pencil className="size-3.5" /> Edit</Button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content"
            aria-label="More"
          ><MoreVertical className="size-4" /></button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-border bg-card py-1 shadow-md">
              <button
                onClick={() => { setMenuOpen(false); void prefillNewWO(d, navigate) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-content"
              >
                <Plus className="size-4" /> Use in New Work Order
              </button>
              <button
                onClick={() => { setMenuOpen(false); void removePart() }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-content"
              >
                <Trash2 className="size-4" /> Delete part
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(['details', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition',
              tab === t ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {tab === 'details' && (
          <div className="flex flex-col gap-4">
            {/* Summary row */}
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <FieldBlock label="Minimum in Stock" value={String(minTotal)} />
              <FieldBlock label="Unit Cost" value={d.unit_cost != null ? currency(Number(d.unit_cost)) : '—'} />
              <FieldBlock label="Available Quantity" value={`${totalUnits} ${d.uom ?? 'ea'}`} />
            </section>

            {/* Location stock table */}
            <section>
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Locations</div>
              {d.stock.length === 0 ? (
                <p className="rounded-md border border-dashed border-border bg-content/40 p-3 text-sm text-ink-muted">
                  No stock recorded yet. Click Restock to add some.
                </p>
              ) : (
                <div className="overflow-hidden rounded-md border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-content text-left text-[10px] uppercase tracking-wider text-ink-subtle">
                      <tr>
                        <th className="px-3 py-2 font-medium">Location</th>
                        <th className="px-3 py-2 text-right font-medium">Units in Stock</th>
                        <th className="px-3 py-2 text-right font-medium">Minimum</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.stock.map((s) => (
                        <tr key={s.id} className="border-t border-border">
                          <td className="px-3 py-2 text-ink">{s.location?.name ?? '—'}</td>
                          <td className={cn('px-3 py-2 text-right tabular',
                            Number(s.quantity_on_hand) === 0 ? 'text-danger font-semibold' :
                            Number(s.quantity_on_hand) < Number(s.minimum_in_stock) ? 'text-warn font-semibold' :
                            'text-ink')}>
                            {s.quantity_on_hand}
                          </td>
                          <td className="px-3 py-2 text-right tabular text-ink-muted">{s.minimum_in_stock}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* UOM + Lead Time */}
            <section className="grid grid-cols-2 gap-4 sm:grid-cols-3">
              <FieldBlock label="UOM" value={d.uom ?? 'ea'} />
              <FieldBlock label="Lead Time (Days)" value={d.lead_time_days != null ? String(d.lead_time_days) : '—'} />
              {d.sku && <FieldBlock label="SKU" value={d.sku} />}
            </section>

            {/* QR + Assets */}
            <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">QR Code / Barcode</div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="font-mono text-sm text-ink">{d.qr_code}</span>
                  <CopyButton text={d.qr_code} />
                </div>
                <div className="mt-2">
                  <QrCodeImage value={`https://operator.washlyfe.com/app/parts/${d.id}`} size={132} />
                </div>
                <p className="mt-1 text-[10px] text-ink-subtle">Print + tape on the shelf. Scans open the part in the app.</p>
              </div>
              <div>
                <div className="flex items-center justify-between">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    Assets ({d.asset_links.length})
                  </div>
                  <button
                    type="button"
                    onClick={() => setLinkingAssets(true)}
                    className="inline-flex items-center gap-0.5 text-xs font-medium text-accent hover:text-accent-hover"
                  >
                    <Plus className="size-3" /> {d.asset_links.length === 0 ? 'Add Assets' : 'Edit'}
                  </button>
                </div>
                {d.asset_links.length === 0 ? (
                  <p className="mt-1 text-sm text-ink-muted">Attach this Part to all related Assets</p>
                ) : (
                  <div className="mt-2 flex flex-col gap-1">
                    {d.asset_links.map((a) => a.asset ? (
                      <button
                        key={a.asset.id}
                        type="button"
                        onClick={() => navigate(`/app/assets/${a.asset!.id}`)}
                        className="flex items-center gap-2 rounded-md border border-border bg-card px-2 py-1.5 text-left text-sm hover:bg-content"
                      >
                        <span className="grid size-6 place-items-center rounded bg-accent/15 text-[10px] font-semibold text-accent">#{a.asset.asset_number}</span>
                        <span className="truncate text-ink">{a.asset.name}</span>
                      </button>
                    ) : null)}
                  </div>
                )}
              </div>
            </section>

            {/* Vendor */}
            <section>
              <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Vendor</div>
              {d.vendor ? (
                <div className="mt-1 flex items-center justify-between gap-2 rounded-md border border-border bg-card px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    <span className="grid size-7 place-items-center rounded-full bg-warn/15 text-[10px] font-semibold text-warn">
                      {d.vendor.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                    </span>
                    <span className="font-medium text-ink">{d.vendor.name}</span>
                  </div>
                  {d.ordering_part_number && (
                    <div className="text-right">
                      <div className="text-[10px] uppercase tracking-wider text-ink-subtle">Ordering Part Number</div>
                      <div className="font-mono text-sm text-ink">{d.ordering_part_number}</div>
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-1 text-sm text-ink-muted">No vendor linked yet.</p>
              )}
            </section>

            {/* Description */}
            {d.description && (
              <section>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Description</div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-ink">{d.description}</p>
              </section>
            )}

            {d.link_url && (
              <section>
                <a href={d.link_url} target="_blank" rel="noreferrer" className="text-sm text-accent hover:underline">
                  Product page
                </a>
              </section>
            )}

            <div className="flex justify-center pt-2">
              <button
                type="button"
                onClick={() => void prefillNewWO(d, navigate)}
                className="inline-flex items-center gap-1.5 rounded-full border border-accent px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
              >
                <Plus className="size-3.5" /> Use in New Work Order
              </button>
            </div>
          </div>
        )}

        {tab === 'history' && (
          <HistoryTab loading={historyLoading} history={history} />
        )}
      </div>

      {editing && (
        <EditPartModal
          part={d}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); onChanged() }}
        />
      )}
      {restocking && (
        <RestockModal
          partId={d.id}
          partName={d.name}
          unitCost={d.unit_cost != null ? Number(d.unit_cost) : null}
          stock={d.stock}
          userId={profile?.id ?? null}
          userName={(profile?.name ?? '').trim() || profile?.email || 'Someone'}
          onClose={() => setRestocking(false)}
          onSaved={() => { setRestocking(false); void load(); onChanged() }}
        />
      )}
      {linkingAssets && (
        <LinkAssetsModal
          partId={d.id}
          currentIds={d.asset_links.map((a) => a.asset?.id).filter((x): x is string => !!x)}
          onClose={() => setLinkingAssets(false)}
          onSaved={() => { setLinkingAssets(false); void load() }}
        />
      )}
    </div>
  )
}

function FieldBlock({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink">{value}</div>
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [ok, setOk] = useState(false)
  return (
    <button
      type="button"
      onClick={async () => { await navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500) }}
      className="rounded p-1 text-ink-subtle hover:text-accent"
      aria-label="Copy"
    >
      {ok ? <span className="text-[11px] text-ok">Copied</span> : <ClipboardCopy className="size-3.5" />}
    </button>
  )
}

// ---- History tab ---------------------------------------------------------

function HistoryTab({ loading, history }: {
  loading: boolean
  history: Array<PartRestockLog & { location: { id: string; name: string } | null }>
}) {
  if (loading) return <p className="text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Loading history...</p>
  if (history.length === 0) return <p className="rounded-md border border-border bg-content/40 p-3 text-sm text-ink-muted">No restock history yet.</p>
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {history.map((h) => (
        <div key={h.id} className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 text-sm last:border-0">
          <div className="min-w-0">
            <div className="text-ink">
              <span className="font-semibold text-ok">+{h.quantity_added}</span> at {h.location?.name ?? '—'}
              {h.unit_cost_at_time != null && <span className="text-ink-muted"> . {currency(Number(h.unit_cost_at_time))}/ea</span>}
            </div>
            <div className="text-[11px] text-ink-subtle">
              by {h.restocked_by_name ?? 'Someone'} . {format(new Date(h.created_at), 'MM/dd/yyyy, h:mm a')}
            </div>
            {h.notes && <p className="mt-0.5 text-[12px] text-ink-muted">{h.notes}</p>}
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Restock modal -------------------------------------------------------

function RestockModal({
  partId, partName, unitCost, stock, userId, userName, onClose, onSaved,
}: {
  partId: string
  partName: string
  unitCost: number | null
  stock: Array<{ location_id: string; location: { id: string; name: string } | null }>
  userId: string | null
  userName: string
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState(stock[0]?.location_id ?? locations[0]?.id ?? '')
  const [qty, setQty] = useState('1')
  const [cost, setCost] = useState(unitCost != null ? String(unitCost) : '')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!locationId) return setError('Pick a location')
    const n = Number(qty)
    if (!Number.isFinite(n) || n <= 0) return setError('Enter a quantity')
    setBusy(true)
    const { error: err } = await parts.restock({
      partId,
      locationId,
      quantityAdded: n,
      unitCost: cost ? Number(cost) : null,
      notes: notes.trim() || null,
      userId,
      userName,
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`Restock ${partName}`}>
      <div className="flex flex-col gap-3">
        <Field label="Location" required>
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Choose...</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Quantity to add" required>{(id) => <Input id={id} type="number" min="0" step="any" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />}</Field>
          <Field label="Unit cost (optional)">{(id) => <Input id={id} type="number" min="0" step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Purchase order #, vendor invoice, etc." />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Restock
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// ---- Link assets modal --------------------------------------------------

function LinkAssetsModal({
  partId, currentIds, onClose, onSaved,
}: {
  partId: string
  currentIds: string[]
  onClose: () => void
  onSaved: () => void
}) {
  const [assets, setAssets] = useState<Array<{ id: string; asset_number: number; name: string }>>([])
  const [picked, setPicked] = useState<Set<string>>(new Set(currentIds))
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('equipment').select('id, asset_number, name').order('asset_number')
      setAssets((data as typeof assets | null) ?? [])
      setLoading(false)
    })()
  }, [])

  const filtered = assets.filter((a) => {
    if (!search) return true
    const q = search.toLowerCase()
    return a.name.toLowerCase().includes(q) || String(a.asset_number).includes(q)
  })

  const toggle = (id: string) => {
    setPicked((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const save = async () => {
    setBusy(true)
    await parts.setLinkedAssets(partId, Array.from(picked))
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Attach to Assets" size="md">
      <div className="flex flex-col gap-3">
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search assets..." autoFocus />
        <div className="max-h-72 overflow-y-auto rounded-md border border-border">
          {loading ? (
            <p className="px-3 py-4 text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Loading...</p>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-4 text-sm text-ink-muted">No assets match.</p>
          ) : (
            filtered.map((a) => {
              const on = picked.has(a.id)
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggle(a.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 border-b border-border px-3 py-2 text-left text-sm last:border-0',
                    on ? 'bg-accent-soft' : 'hover:bg-content',
                  )}
                >
                  <Cog className="size-4 text-ink-subtle" />
                  <span className="grid size-6 place-items-center rounded bg-accent/15 text-[10px] font-semibold text-accent">#{a.asset_number}</span>
                  <span className="flex-1 truncate text-ink">{a.name}</span>
                  {on && <Plus className="size-4 rotate-45 text-accent" />}
                </button>
              )
            })
          )}
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Save</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---- side effects --------------------------------------------------------

async function prefillNewWO(d: Detail, navigate: ReturnType<typeof useNavigate>) {
  sessionStorage.setItem('newWO.prefill', JSON.stringify({ part_id: d.id, part_name: d.name }))
  navigate('/app/work-orders')
}
