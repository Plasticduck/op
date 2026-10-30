import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ClipboardList, ExternalLink, Loader2, Minus, PackagePlus, Plus, Search, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { itInventory, type ItConsumable, type ItConsumableEvent, type ItPerson } from '@/lib/queries/itInventory'
import { friendlyError, type Tone } from './format'
import { AccessoriesPanel } from './AccessoriesPanel'
import { Footer, NoteField } from './ItemActions'
import { SectionNav } from './SectionNav'
import { useItRefs, type ItRefs } from './useItRefs'

// Supplies: receipt paper, label rolls, printer ink, the asset sticker stock.
// The number on hand only moves through stock events (count, restock, use),
// so every change is explained. A supply nobody has counted yet says so
// instead of showing a guess, and only counted supplies can run low and send
// a reminder. Printing stickers counts the site's Sticker Stock down.
// Accessories (lent out and returned) share this tab: ?kind=accessories.

type StockMode = 'count' | 'restock' | 'use'

function supplyState(c: ItConsumable): { label: string; tone: Tone } {
  if (!c.counted_at) return { label: 'Not counted', tone: 'neutral' }
  if (c.qty_on_hand <= 0) return { label: 'Out', tone: 'danger' }
  if (c.low_since) return { label: 'Low', tone: 'warn' }
  return { label: 'OK', tone: 'ok' }
}

export function SuppliesPage() {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const { refs, error: refsError, reload: reloadRefs } = useItRefs()
  const [params, setParams] = useSearchParams()
  const site = params.get('site') ?? (locations.length > 1 ? 'all' : activeLocation?.id ?? 'all')
  const low = params.get('low') === '1'
  const q = params.get('q') ?? ''
  const [rows, setRows] = useState<ItConsumable[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [stock, setStock] = useState<{ mode: StockMode; row: ItConsumable } | null>(null)
  const [editing, setEditing] = useState<ItConsumable | 'new' | null>(null)
  const [addingAccessory, setAddingAccessory] = useState(false)
  // Supplies get used up; accessories are lent out and come back.
  const kind = params.get('kind') === 'accessories' ? 'accessories' : 'supplies'
  const staff = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const load = useCallback(async () => {
    const { data, error: err } = await itInventory.consumables()
    if (err) setError(err.message)
    setRows(data)
  }, [])
  useEffect(() => { void load() }, [load])

  const setParam = (patch: Record<string, string | null>) => setParams((p) => {
    const next = new URLSearchParams(p)
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k)
      else next.set(k, v)
    }
    return next
  }, { replace: true })

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean)
    return (rows ?? [])
      .filter((c) => site === 'all' || c.location_id === site)
      .filter((c) => !low || !!c.low_since)
      .filter((c) => !words.length || words.every((w) => `${c.name} ${c.model_number ?? ''}`.toLowerCase().includes(w)))
      .sort((a, b) => (siteName.get(a.location_id) ?? '').localeCompare(siteName.get(b.location_id) ?? '')
        || Number(b.is_sticker_stock) - Number(a.is_sticker_stock) || a.name.localeCompare(b.name))
  }, [rows, site, low, q, siteName])
  const lowCount = (rows ?? []).filter((c) => (site === 'all' || c.location_id === site) && c.low_since).length
  const done = (m: string) => { setStock(null); setEditing(null); setFlash(m); void load() }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <PageHeader
        title="IT Inventory"
        subtitle={kind === 'supplies'
          ? 'Supplies on hand at each site, so nobody runs out of receipt paper or stickers.'
          : 'Chargers, cables, cases and other accessories each site lends out, and who has them.'}
        actions={staff ? (kind === 'supplies'
          ? <Button onClick={() => setEditing('new')} disabled={!refs}><Plus className="size-4" /> Add supply</Button>
          : <Button onClick={() => setAddingAccessory(true)} disabled={!refs}><Plus className="size-4" /> Add accessory</Button>) : undefined}
      />
      <SectionNav className="mt-4" />
      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex rounded-lg border border-border bg-card p-0.5">
          {([['supplies', 'Supplies'], ['accessories', 'Accessories']] as const).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setParam({ kind: k === 'supplies' ? null : k, low: null })}
              className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', kind === k ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
              {l}
            </button>
          ))}
        </span>
        <span className="text-xs text-ink-muted">{kind === 'supplies' ? 'Things that get used up.' : 'Things lent out that come back.'}</span>
      </div>

      {kind === 'accessories' ? <AccessoriesPanel adding={addingAccessory} onAddingClose={() => setAddingAccessory(false)} /> : <>

      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {(error || refsError) && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load supplies: {friendlyError(error ?? refsError ?? '')}</p>}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9" placeholder="Search supplies" aria-label="Search supplies" />
        </div>
        <Select value={site} onChange={(e) => setParam({ site: e.target.value })} aria-label="Site">
          <option value="all">All sites</option>
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
        <Button variant={low ? 'primary' : 'secondary'} onClick={() => setParam({ low: low ? null : '1' })}>
          Running low{lowCount ? ` (${lowCount})` : ''}
        </Button>
      </div>

      {rows === null || !refs ? (
        !error && <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : shown.length === 0 ? (
        <EmptyState className="mt-6" icon={ClipboardList} title={low ? 'Nothing is running low' : 'No supplies here yet'}
          description={low ? 'Supplies show here once they drop to their minimum.' : 'Add receipt paper, label rolls or anything else a site keeps on hand.'} />
      ) : (
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="hidden bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle md:table-header-group">
              <tr>
                <th className="px-3 py-2 font-semibold">Supply</th>
                <th className="px-3 py-2 font-semibold">Site</th>
                <th className="px-3 py-2 text-right font-semibold">On hand</th>
                <th className="px-3 py-2 text-right font-semibold">Minimum</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((c) => {
                const st = supplyState(c)
                return (
                  <tr key={c.id} className="align-top md:align-middle">
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setEditing(c)} className="text-left font-medium text-ink hover:underline">{c.name}</button>
                      <div className="text-xs text-ink-muted">
                        {c.is_sticker_stock ? 'Printing stickers counts this down' : c.model_number || ' '}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted md:hidden">
                        <span>{siteName.get(c.location_id) ?? 'Another site'}</span>
                        <span className="tabular-nums text-ink">{c.counted_at ? `${c.qty_on_hand} on hand` : 'Not counted'}{c.min_qty ? `, min ${c.min_qty}` : ''}</span>
                        {c.counted_at && <Badge tone={st.tone}>{st.label}</Badge>}
                      </div>
                    </td>
                    <td className="hidden px-3 py-2.5 text-ink md:table-cell">{siteName.get(c.location_id) ?? 'Another site'}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">
                      {c.counted_at ? <span className="font-medium text-ink">{c.qty_on_hand}</span> : <span className="text-ink-subtle">–</span>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-muted md:table-cell">{c.min_qty || '–'}</td>
                    <td className="hidden px-3 py-2.5 md:table-cell"><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-1">
                        {staff && (
                          <>
                            <Button size="sm" variant={c.counted_at ? 'ghost' : 'secondary'} onClick={() => setStock({ mode: 'count', row: c })}>Count</Button>
                            <Button size="sm" variant="ghost" onClick={() => setStock({ mode: 'restock', row: c })} aria-label={`Restock ${c.name}`} title="Restock"><PackagePlus className="size-4" /></Button>
                            <Button size="sm" variant="ghost" onClick={() => setStock({ mode: 'use', row: c })} aria-label={`Use ${c.name}`} title="Used some"><Minus className="size-4" /></Button>
                          </>
                        )}
                        {c.reorder_url && (
                          <a href={c.reorder_url} target="_blank" rel="noreferrer" title="Reorder" aria-label={`Reorder ${c.name}`}
                            className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-content hover:text-ink">
                            <ExternalLink className="size-4" />
                          </a>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {stock && profile && (
        <StockDialog mode={stock.mode} row={stock.row} accountId={profile.account_id}
          siteName={siteName.get(stock.row.location_id) ?? ''} onClose={() => setStock(null)} onDone={done} />
      )}
      {editing && refs && profile && (
        <SupplyForm refs={refs} row={editing === 'new' ? null : editing} accountId={profile.account_id}
          defaultSite={site !== 'all' ? site : activeLocation?.id ?? ''} canEdit={staff} admin={profile.role === 'owner'}
          onRefsChanged={() => void reloadRefs()} onClose={() => setEditing(null)} onDone={done} />
      )}
      </>}
    </div>
  )
}

const STOCK_COPY: Record<StockMode, { title: string; label: string; button: string }> = {
  count: { title: 'Count', label: 'How many are there now?', button: 'Save count' },
  restock: { title: 'Restock', label: 'How many did you add?', button: 'Add to stock' },
  use: { title: 'Used some', label: 'How many were used?', button: 'Take from stock' },
}

function StockDialog({ mode, row, accountId, siteName, onClose, onDone }: {
  mode: StockMode
  row: ItConsumable
  accountId: string
  siteName: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [n, setN] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const copy = STOCK_COPY[mode]

  const save = async () => {
    const v = Number(n)
    if (n.trim() === '' || !Number.isInteger(v) || v < 0 || (mode !== 'count' && v === 0)) {
      setError(mode === 'count' ? 'Enter how many there are, 0 or more.' : 'Enter a whole number above 0.')
      return
    }
    const delta = mode === 'count' ? v - row.qty_on_hand : mode === 'restock' ? v : -v
    setBusy(true)
    setError(null)
    const { error: err } = delta === 0
      ? await itInventory.markCounted(row.id)
      : await itInventory.adjustStock({
        account_id: accountId, location_id: row.location_id, consumable_id: row.id, delta,
        reason: mode === 'count' ? 'adjustment' : mode === 'restock' ? 'restock' : 'used',
        note: note.trim() || (mode === 'count' ? 'Counted' : undefined),
      })
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); return }
    const now = mode === 'count' ? v : row.qty_on_hand + delta
    onDone(`${row.name} at ${siteName}: ${row.counted_at || mode === 'count' ? `${now} on hand` : 'saved. Count it to start tracking how many are left'}.`)
  }

  return (
    <Modal open onClose={onClose} size="sm" title={`${copy.title}: ${row.name}`} description={siteName}>
      <Field label={copy.label} hint={mode === 'count' && row.counted_at ? `On record: ${row.qty_on_hand}.` : undefined}>
        {(id) => <Input id={id} type="number" min={0} inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} autoFocus />}
      </Field>
      <div className="mt-3"><NoteField value={note} onChange={setNote} placeholder={mode === 'restock' ? 'Order number, where from' : ''} /></div>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {copy.button}</Button>
      </Footer>
    </Modal>
  )
}

const REASON: Record<string, string> = { restock: 'Restocked', used: 'Used', adjustment: 'Counted' }

function SupplyForm({ refs, row, accountId, defaultSite, canEdit, admin, onRefsChanged, onClose, onDone }: {
  refs: ItRefs
  row: ItConsumable | null
  accountId: string
  defaultSite: string
  canEdit: boolean
  admin: boolean
  onRefsChanged: () => void
  onClose: () => void
  onDone: (message: string) => void
}) {
  const { locations } = useLocations()
  const [name, setName] = useState(row?.name ?? '')
  const [site, setSite] = useState(row?.location_id ?? defaultSite)
  const [categoryId, setCategoryId] = useState(row?.category_id ?? '')
  const [modelNumber, setModelNumber] = useState(row?.model_number ?? '')
  const [minQty, setMinQty] = useState(row ? String(row.min_qty) : '')
  const [reorderUrl, setReorderUrl] = useState(row?.reorder_url ?? '')
  const [supplier, setSupplier] = useState(row?.supplier_id ? refs.supplier.get(row.supplier_id)?.name ?? '' : '')
  const [start, setStart] = useState('')
  const [events, setEvents] = useState<ItConsumableEvent[] | null>(null)
  const [people, setPeople] = useState<Map<string, string>>(new Map())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const ro = !canEdit

  useEffect(() => {
    if (!row) return
    let alive = true
    void itInventory.consumableEvents(row.id).then(({ data }) => { if (alive) setEvents(data ?? []) })
    void itInventory.people().then(({ data }) => {
      if (alive) setPeople(new Map(((data as ItPerson[] | null) ?? []).map((p) => [p.id, p.name])))
    })
    return () => { alive = false }
  }, [row])

  const save = async () => {
    if (!name.trim()) { setError('Give it a name, like "Receipt paper".'); return }
    if (!site) { setError('Pick a site.'); return }
    const min = minQty.trim() ? Number(minQty) : 0
    if (!Number.isInteger(min) || min < 0) { setError('Minimum should be a whole number.'); return }
    const startN = start.trim() ? Number(start) : null
    if (startN !== null && (!Number.isInteger(startN) || startN < 0)) { setError('How many on hand should be a whole number.'); return }
    if (reorderUrl.trim() && !/^https?:\/\//i.test(reorderUrl.trim())) { setError('The reorder link should start with https://'); return }
    setBusy(true)
    setError(null)
    try {
      let supplierId: string | null = null
      const spText = supplier.trim()
      if (spText) {
        const existing = refs.suppliers.find((s) => s.name.toLowerCase() === spText.toLowerCase())
        if (existing) supplierId = existing.id
        else {
          const { data, error: err } = await itInventory.addSupplier(accountId, spText)
          if (err) throw new Error(err.message)
          supplierId = data.id
          onRefsChanged()
        }
      }
      const { data, error: err } = await itInventory.saveConsumable({
        ...(row ? { id: row.id } : { counted_at: startN !== null ? new Date().toISOString() : null }),
        account_id: accountId,
        location_id: site,
        name: name.trim(),
        category_id: categoryId || null,
        model_number: modelNumber.trim() || null,
        min_qty: min,
        reorder_url: reorderUrl.trim() || null,
        supplier_id: supplierId,
      })
      if (err) throw new Error(err.message)
      if (!row && startN) {
        const { error: e2 } = await itInventory.adjustStock({
          account_id: accountId, location_id: site, consumable_id: data.id, delta: startN, reason: 'adjustment', note: 'Starting count',
        })
        if (e2) throw new Error(e2.message)
      }
      onDone(row ? `Saved ${name.trim()}.` : `Added ${name.trim()}.`)
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!row) return
    setBusy(true)
    const { error: err } = await itInventory.removeConsumable(row.id)
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); setRemoving(false); return }
    onDone(`Removed ${row.name}.`)
  }

  return (
    <Modal open onClose={onClose} size="lg" title={row ? row.name : 'Add a supply'}
      description={row?.is_sticker_stock ? 'The blank asset stickers at this site. Printing stickers counts it down.' : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={ro} placeholder="Receipt paper" />}
        </Field>
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={site} onChange={(e) => setSite(e.target.value)} disabled={ro || !!row}>
              <option value="">Choose a site</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={ro}>
              <option value="">Choose one</option>
              {refs.categories.filter((c) => c.kind === 'consumable').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Model or part number">
          {(id) => <Input id={id} value={modelNumber} onChange={(e) => setModelNumber(e.target.value)} disabled={ro} />}
        </Field>
        <Field label="Minimum" hint="Reminders go out when it drops to this. 0 means no reminder.">
          {(id) => <Input id={id} type="number" min={0} value={minQty} onChange={(e) => setMinQty(e.target.value)} disabled={ro} />}
        </Field>
        {!row && (
          <Field label="How many on hand now" hint="Leave blank if you haven't counted.">
            {(id) => <Input id={id} type="number" min={0} value={start} onChange={(e) => setStart(e.target.value)} />}
          </Field>
        )}
        <Field label="Bought from">
          {(id) => (
            <>
              <Input id={id} list="it-supply-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} autoComplete="off" disabled={ro} />
              <datalist id="it-supply-suppliers">{refs.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Reorder link" className={row ? 'sm:col-span-1' : 'sm:col-span-2'}>
          {(id) => <Input id={id} type="url" value={reorderUrl} onChange={(e) => setReorderUrl(e.target.value)} disabled={ro} placeholder="https://" />}
        </Field>
      </div>

      {row && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">History</div>
          {events === null ? (
            <div className="grid place-items-center py-4 text-ink-muted"><Loader2 className="size-4 animate-spin" /></div>
          ) : events.length === 0 ? (
            <p className="text-sm text-ink-muted">No stock changes yet.</p>
          ) : (
            <ul className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">
              {events.map((e) => (
                <li key={e.id} className="flex items-center gap-3 px-3 py-2">
                  <span className={e.delta > 0 ? 'w-12 shrink-0 font-medium tabular-nums text-ok' : 'w-12 shrink-0 font-medium tabular-nums text-ink'}>
                    {e.delta > 0 ? `+${e.delta}` : e.delta}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-ink">
                    {REASON[e.reason] ?? e.reason}{e.note && e.note !== REASON[e.reason] ? `: ${e.note}` : ''}
                  </span>
                  <span className="shrink-0 text-xs text-ink-subtle">
                    {(e.user_id && people.get(e.user_id)) || 'Operator'} · {format(new Date(e.created_at), 'MMM d')}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        {row && admin && !row.is_sticker_stock && (
          <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => setRemoving(true)} disabled={busy}>
            <Trash2 className="size-4" /> Remove
          </Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={busy} className={row && admin && !row.is_sticker_stock ? '' : 'sm:ml-auto'}>{ro ? 'Close' : 'Cancel'}</Button>
        {!ro && <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {row ? 'Save' : 'Add supply'}</Button>}
      </div>
      <ConfirmDialog
        open={removing}
        title={`Remove ${row?.name ?? ''}?`}
        description="It leaves the list and stops low-stock reminders. Its history stays in the activity log."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onCancel={() => setRemoving(false)}
        onConfirm={() => void remove()}
      />
    </Modal>
  )
}
