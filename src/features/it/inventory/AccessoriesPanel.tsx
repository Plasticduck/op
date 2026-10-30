import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { Headphones, Loader2, LogIn, LogOut, Search, Trash2, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { currency } from '@/lib/format'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { itInventory, type ItAccessoryAssignment, type ItAccessoryStock } from '@/lib/queries/itInventory'
import { Row, Section } from './DetailParts'
import { friendlyError, type Tone } from './format'
import { Footer, NoteField } from './ItemActions'
import { useItRefs, type ItRefs } from './useItRefs'

// Accessories: counted things that are lent out and come back (chargers,
// cables, cases, keyboards, headsets). Each is a total at a site; checking
// some out goes to a person on the roster or a device at the site, and
// checking in brings them back. The database won't let more go out than are
// left. Shown on the Supplies tab next to supplies (which get used up).

function accessoryState(a: ItAccessoryStock): { label: string; tone: Tone } {
  if (a.qty_total === 0) return { label: 'None yet', tone: 'neutral' }
  if (a.available <= 0) return { label: 'All out', tone: 'danger' }
  if (a.min_qty > 0 && a.available <= a.min_qty) return { label: 'Low', tone: 'warn' }
  return { label: 'OK', tone: 'ok' }
}
const isLow = (a: ItAccessoryStock) => a.qty_total > 0 && (a.available <= 0 || (a.min_qty > 0 && a.available <= a.min_qty))

export function AccessoriesPanel({ adding, onAddingClose }: { adding: boolean; onAddingClose: () => void }) {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const { refs, reload: reloadRefs } = useItRefs()
  const [params, setParams] = useSearchParams()
  const site = params.get('site') ?? (locations.length > 1 ? 'all' : activeLocation?.id ?? 'all')
  const low = params.get('low') === '1'
  const q = params.get('q') ?? ''
  const [rows, setRows] = useState<ItAccessoryStock[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [open, setOpen] = useState<ItAccessoryStock | null>(null)
  const [lending, setLending] = useState<ItAccessoryStock | null>(null)
  const staff = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const load = useCallback(async () => {
    const { data, error: err } = await itInventory.accessories()
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

  const atSite = (rows ?? []).filter((a) => site === 'all' || a.location_id === site)
  const words = q.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = atSite
    .filter((a) => !low || isLow(a))
    .filter((a) => !words.length || words.every((w) => `${a.name} ${a.model_number ?? ''}`.toLowerCase().includes(w)))
    .sort((a, b) => (siteName.get(a.location_id) ?? '').localeCompare(siteName.get(b.location_id) ?? '') || a.name.localeCompare(b.name))
  const lowCount = atSite.filter(isLow).length
  const done = (m: string) => { setOpen(null); setLending(null); onAddingClose(); setFlash(m); void load() }

  return (
    <>
      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">Couldn't load accessories: {friendlyError(error)}</p>}

      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_220px_auto]">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setParam({ q: e.target.value })} className="pl-9" placeholder="Search accessories" aria-label="Search accessories" />
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
        <EmptyState className="mt-6" icon={Headphones} title={low ? 'Nothing is running low' : 'No accessories here yet'}
          description={low ? 'Accessories show here when what\'s left drops to the minimum.' : 'Add the chargers, cables, cases and keyboards a site keeps on hand and lends out.'} />
      ) : (
        <div className="mt-4 overflow-hidden rounded-md border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="hidden bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle md:table-header-group">
              <tr>
                <th className="px-3 py-2 font-semibold">Accessory</th>
                <th className="px-3 py-2 font-semibold">Site</th>
                <th className="px-3 py-2 text-right font-semibold">Total</th>
                <th className="px-3 py-2 text-right font-semibold">Out</th>
                <th className="px-3 py-2 text-right font-semibold">Left</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="hidden px-3 py-2 md:table-cell"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {shown.map((a) => {
                const st = accessoryState(a)
                const actions = staff && (a.available > 0 || a.checked_out > 0) ? (
                  <>
                    {a.available > 0 && (
                      <Button size="sm" variant="secondary" className="whitespace-nowrap" onClick={() => setLending(a)}><LogOut className="size-3.5" /> Check out</Button>
                    )}
                    {a.checked_out > 0 && (
                      <Button size="sm" variant="ghost" className="whitespace-nowrap" onClick={() => setOpen(a)}><LogIn className="size-3.5" /> Check in</Button>
                    )}
                  </>
                ) : null
                return (
                  <tr key={a.id} className="align-top md:align-middle">
                    <td className="px-3 py-2.5">
                      <button type="button" onClick={() => setOpen(a)} className="text-left font-medium text-ink hover:underline">{a.name}</button>
                      <div className="text-xs text-ink-muted">{[a.category_id && refs.category.get(a.category_id)?.name, a.model_number].filter(Boolean).join(' · ') || ' '}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted md:hidden">
                        <span>{siteName.get(a.location_id) ?? 'Another site'}</span>
                        <span className="tabular-nums text-ink">{a.available} of {a.qty_total} left</span>
                        <Badge tone={st.tone}>{st.label}</Badge>
                      </div>
                      {actions && <div className="mt-2 flex flex-wrap gap-2 md:hidden">{actions}</div>}
                    </td>
                    <td className="hidden px-3 py-2.5 text-ink md:table-cell">{siteName.get(a.location_id) ?? 'Another site'}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums text-ink-muted md:table-cell">{a.qty_total}</td>
                    <td className="hidden px-3 py-2.5 text-right tabular-nums md:table-cell">{a.checked_out || <span className="text-ink-subtle">0</span>}</td>
                    <td className="hidden px-3 py-2.5 text-right font-medium tabular-nums text-ink md:table-cell">{a.available}</td>
                    <td className="hidden px-3 py-2.5 md:table-cell"><Badge tone={st.tone}>{st.label}</Badge></td>
                    <td className="hidden px-3 py-2.5 md:table-cell">
                      <div className="flex justify-end gap-1">{actions}</div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {lending && profile && <CheckOutAccessory acc={lending} accountId={profile.account_id} onClose={() => setLending(null)} onDone={done} />}
      {(open || adding) && refs && profile && (
        <AccessoryEditor refs={refs} acc={open} accountId={profile.account_id} canEdit={staff} admin={profile.role === 'owner'}
          defaultSite={site !== 'all' ? site : activeLocation?.id ?? ''} onRefsChanged={() => void reloadRefs()}
          onClose={() => { setOpen(null); onAddingClose() }} onDone={done} onChanged={() => void load()} />
      )}
    </>
  )
}

function CheckOutAccessory({ acc, accountId, onClose, onDone }: {
  acc: ItAccessoryStock
  accountId: string
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [qty, setQty] = useState('1')
  const [to, setTo] = useState<'user' | 'asset'>('user')
  const [target, setTarget] = useState('')
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [people, setPeople] = useState<{ id: string; label: string }[] | null>(null)
  const [devices, setDevices] = useState<{ id: string; label: string }[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void itInventory.roster(acc.location_id).then(({ data }) => {
      if (alive) setPeople((data ?? []).map((e) => ({ id: e.id, label: `${e.first_name} ${e.last_name ?? ''}`.trim() + (e.role_title ? ` (${e.role_title})` : '') })))
    })
    void itInventory.assetsAtSite(acc.location_id).then(({ data }) => {
      if (alive) setDevices((data ?? []).map((a) => ({ id: a.id, label: `${a.asset_tag} ${a.name}` })))
    })
    return () => { alive = false }
  }, [acc.location_id])

  const save = async () => {
    const n = Number(qty)
    if (!Number.isInteger(n) || n < 1) { setError('How many: 1 or more.'); return }
    if (n > acc.available) { setError(`Only ${acc.available} left.`); return }
    if (!target) { setError(to === 'user' ? 'Pick who has them.' : 'Pick the device.'); return }
    setBusy(true)
    setError(null)
    const { error: err } = await itInventory.checkOutAccessory({
      account_id: accountId, location_id: acc.location_id, accessory_id: acc.id, qty: n, assigned_type: to, assigned_id: target,
      expected_return_at: due ? new Date(`${due}T17:00:00`).toISOString() : null, note: note.trim() || null,
    })
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); return }
    const who = (to === 'user' ? people : devices)?.find((x) => x.id === target)?.label.replace(/ \(.*\)$/, '') ?? ''
    onDone(`Checked out ${n} × ${acc.name} to ${who}.`)
  }

  const list = to === 'user' ? people : devices
  return (
    <Modal open onClose={onClose} size="md" title={`Check out ${acc.name}`} description={`${acc.available} of ${acc.qty_total} left`}>
      <div className="space-y-3">
        <div className="flex items-end gap-3">
          <Field label="How many" className="w-28">
            {(id) => <Input id={id} type="number" min={1} max={acc.available} value={qty} onChange={(e) => setQty(e.target.value)} />}
          </Field>
          <span className="mb-1 inline-flex rounded-lg border border-border bg-card p-0.5">
            {([['user', 'A person'], ['asset', 'A device']] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => { setTo(k); setTarget('') }}
                className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', to === k ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
                {l}
              </button>
            ))}
          </span>
        </div>
        <Field label={to === 'user' ? 'Who' : 'Which device'}>
          {(id) => (
            <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)} disabled={!list}>
              <option value="">{list ? (list.length ? 'Choose…' : to === 'user' ? 'No one on this site\'s roster' : 'No devices at this site') : 'Loading…'}</option>
              {(list ?? []).map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Due back" hint="Optional.">
          {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
        </Field>
        <NoteField value={note} onChange={setNote} placeholder="What it's for" />
      </div>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Check out</Button>
      </Footer>
    </Modal>
  )
}

function CheckInAccessory({ a, onClose, onDone }: { a: ItAccessoryAssignment; onClose: () => void; onDone: (m: string) => void }) {
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setBusy(true)
    const { error: err } = await itInventory.checkInAccessory(a.id, note.trim() || null)
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); return }
    onDone(`Checked in ${a.qty} × ${a.accessory_name ?? 'accessory'} from ${a.assigned_label}.`)
  }
  return (
    <Modal open onClose={onClose} size="md" title={`Check in ${a.qty} × ${a.accessory_name ?? 'accessory'}?`} description={`From ${a.assigned_label}`}>
      <NoteField value={note} onChange={setNote} placeholder="Anything missing or broken" />
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Check in</Button>
      </Footer>
    </Modal>
  )
}

function AccessoryEditor({ refs, acc, accountId, defaultSite, canEdit, admin, onRefsChanged, onClose, onDone, onChanged }: {
  refs: ItRefs
  acc: ItAccessoryStock | null
  accountId: string
  defaultSite: string
  canEdit: boolean
  admin: boolean
  onRefsChanged: () => void
  onClose: () => void
  onDone: (message: string) => void
  onChanged: () => void
}) {
  const { locations } = useLocations()
  const [name, setName] = useState(acc?.name ?? '')
  const [site, setSite] = useState(acc?.location_id ?? defaultSite)
  const [categoryId, setCategoryId] = useState(acc?.category_id ?? '')
  const [model, setModel] = useState(acc?.model_number ?? '')
  const [total, setTotal] = useState(acc ? String(acc.qty_total) : '')
  const [minQty, setMinQty] = useState(acc ? String(acc.min_qty) : '')
  const [cost, setCost] = useState(acc?.unit_cost != null ? String(acc.unit_cost) : '')
  const [supplier, setSupplier] = useState(acc?.supplier_id ? refs.supplier.get(acc.supplier_id)?.name ?? '' : '')
  const [notes, setNotes] = useState(acc?.notes ?? '')
  const [history, setHistory] = useState<ItAccessoryAssignment[] | null>(null)
  const [returning, setReturning] = useState<ItAccessoryAssignment | null>(null)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const ro = !canEdit

  const loadHistory = useCallback(async () => {
    if (!acc) return
    const { data } = await itInventory.accessoryAssignments(acc.id)
    setHistory(data ?? [])
  }, [acc])
  useEffect(() => { void loadHistory() }, [loadHistory])
  const out = (history ?? []).filter((h) => !h.checked_in_at)
  const past = (history ?? []).filter((h) => h.checked_in_at).slice(0, 20)

  const save = async () => {
    if (!name.trim()) { setError('Give it a name, like "Tablet charger".'); return }
    if (!site) { setError('Pick a site.'); return }
    const t = total.trim() ? Number(total) : 0
    const m = minQty.trim() ? Number(minQty) : 0
    if (!Number.isInteger(t) || t < 0 || !Number.isInteger(m) || m < 0) { setError('Totals are whole numbers, 0 or more.'); return }
    const c = cost.trim() ? Number(cost.replace(/[$,]/g, '')) : null
    if (c !== null && (!Number.isFinite(c) || c < 0)) { setError('Cost should be a dollar amount.'); return }
    setBusy(true)
    setError(null)
    try {
      let supplierId: string | null = null
      const sp = supplier.trim()
      if (sp) {
        const existing = refs.suppliers.find((s) => s.name.toLowerCase() === sp.toLowerCase())
        if (existing) supplierId = existing.id
        else {
          const { data, error: err } = await itInventory.addSupplier(accountId, sp)
          if (err) throw new Error(err.message)
          supplierId = data.id
          onRefsChanged()
        }
      }
      const { error: err } = await itInventory.saveAccessory({
        ...(acc ? { id: acc.id } : {}), account_id: accountId, location_id: site, name: name.trim(), category_id: categoryId || null,
        model_number: model.trim() || null, qty_total: t, min_qty: m, unit_cost: c, supplier_id: supplierId, notes: notes.trim() || null,
      })
      if (err) throw new Error(err.message)
      onDone(acc ? `Saved ${name.trim()}.` : `Added ${t} × ${name.trim()}.`)
    } catch (e) {
      setBusy(false)
      setError(friendlyError(e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={acc ? acc.name : 'Add an accessory'}
      description={acc ? `${acc.available} of ${acc.qty_total} left` : 'Things lent out that come back, counted rather than stickered one by one.'}>
      {msg && <p className="mb-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">{msg}</p>}
      {acc && out.length > 0 && (
        <div className="mb-4">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Who has them</div>
          <ul className="divide-y divide-border rounded-md border border-border">
            {out.map((h) => {
              const late = h.expected_return_at && new Date(h.expected_return_at) < new Date()
              return (
                <li key={h.id} className="flex items-center gap-3 px-3 py-2.5 text-sm">
                  <span className="w-8 shrink-0 tabular-nums text-ink-muted">{h.qty} ×</span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-ink">{h.assigned_label}</span>
                    <span className="block text-xs text-ink-muted">
                      Since {format(new Date(h.checked_out_at), 'MMM d')}
                      {h.expected_return_at && <span className={cn(late && 'font-medium text-danger')}>{' · '}{late ? 'Overdue since' : 'Due back'} {format(new Date(h.expected_return_at), 'MMM d')}</span>}
                      {h.note && ` · "${h.note}"`}
                    </span>
                  </span>
                  {canEdit && <Button size="sm" variant="secondary" className="shrink-0 whitespace-nowrap" onClick={() => setReturning(h)}><LogIn className="size-3.5" /> Check in</Button>}
                </li>
              )
            })}
          </ul>
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} disabled={ro} placeholder="Tablet charger" />}</Field>
        <Field label="Site" required hint={acc && acc.checked_out > 0 ? 'Check them all in to move them.' : undefined}>
          {(id) => (
            <Select id={id} value={site} onChange={(e) => setSite(e.target.value)} disabled={ro || (!!acc && acc.checked_out > 0)}>
              <option value="">Choose a site</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={categoryId} onChange={(e) => setCategoryId(e.target.value)} disabled={ro}>
              <option value="">Choose one</option>
              {refs.categories.filter((c) => c.kind === 'accessory').map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Model or part number">{(id) => <Input id={id} value={model} onChange={(e) => setModel(e.target.value)} disabled={ro} />}</Field>
        <Field label="How many in all" hint={acc && acc.checked_out ? `${acc.checked_out} out right now.` : 'Including any out right now.'}>
          {(id) => <Input id={id} type="number" min={0} value={total} onChange={(e) => setTotal(e.target.value)} disabled={ro} />}
        </Field>
        <Field label="Minimum left" hint="Shows as low at or below this. 0 means never.">
          {(id) => <Input id={id} type="number" min={0} value={minQty} onChange={(e) => setMinQty(e.target.value)} disabled={ro} />}
        </Field>
        <Field label="Cost each">{(id) => <Input id={id} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="$0.00" disabled={ro} />}</Field>
        <Field label="Bought from">
          {(id) => (
            <>
              <Input id={id} list="it-acc-suppliers" value={supplier} onChange={(e) => setSupplier(e.target.value)} autoComplete="off" disabled={ro} />
              <datalist id="it-acc-suppliers">{refs.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </>
          )}
        </Field>
        <div className="sm:col-span-2"><NoteField value={notes} onChange={setNotes} placeholder="Where they're kept" /></div>
      </div>
      {acc?.unit_cost != null && acc.qty_total > 0 && (
        <p className="mt-2 text-xs text-ink-muted">Worth about {currency(acc.unit_cost * acc.qty_total)} in all.</p>
      )}

      {acc && past.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Returned</div>
          <ul className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm">
            {past.map((h) => (
              <li key={h.id} className="flex items-center gap-3 px-3 py-2">
                <span className="w-10 shrink-0 tabular-nums text-ink-muted">{h.qty} ×</span>
                <span className="min-w-0 flex-1 truncate text-ink">{h.assigned_label}{h.checkin_note ? ` · "${h.checkin_note}"` : ''}</span>
                <span className="shrink-0 text-xs text-ink-subtle">
                  {format(new Date(h.checked_out_at), 'MMM d')} to {format(new Date(h.checked_in_at!), 'MMM d')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:items-center">
        {acc && admin && acc.checked_out === 0 && (
          <Button variant="ghost" className="text-danger sm:mr-auto" onClick={() => setRemoving(true)} disabled={busy}><Trash2 className="size-4" /> Remove</Button>
        )}
        <Button variant="secondary" onClick={onClose} disabled={busy} className={acc && admin && acc.checked_out === 0 ? '' : 'sm:ml-auto'}>{ro ? 'Close' : 'Cancel'}</Button>
        {!ro && <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {acc ? 'Save' : 'Add accessory'}</Button>}
      </div>

      {returning && (
        <CheckInAccessory a={returning} onClose={() => setReturning(null)}
          onDone={(m) => { setReturning(null); setMsg(m); void loadHistory(); onChanged() }} />
      )}
      <ConfirmDialog
        open={removing}
        title={`Remove ${acc?.name ?? ''}?`}
        description="For accessories you no longer keep. The history stays in the activity log."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onCancel={() => setRemoving(false)}
        onConfirm={() => {
          if (!acc) return
          setBusy(true)
          void itInventory.removeAccessory(acc.id).then(({ error: err }) => {
            setBusy(false)
            setRemoving(false)
            if (err) setError(friendlyError(err.message))
            else onDone(`Removed ${acc.name}.`)
          })
        }}
      />
    </Modal>
  )
}

// On a device's page: the accessories that went out with it (a charger with a tablet).
export function AccessoriesWithAsset({ assetId, canEdit }: { assetId: string; canEdit: boolean }) {
  const [rows, setRows] = useState<ItAccessoryAssignment[]>([])
  const [returning, setReturning] = useState<ItAccessoryAssignment | null>(null)
  const load = useCallback(async () => {
    const { data } = await itInventory.accessoriesWithAsset(assetId)
    setRows(data ?? [])
  }, [assetId])
  useEffect(() => { void load() }, [load])
  if (!rows.length) return null
  return (
    <>
      <Section title="Accessories with it">
        {rows.map((h) => (
          <Row key={h.id} label={`${h.qty} ×`}>
            <span className="flex flex-wrap items-center justify-between gap-2">
              <span>
                {h.accessory_name}
                <span className="block text-xs text-ink-muted">Since {format(new Date(h.checked_out_at), 'MMM d, yyyy')}</span>
              </span>
              {canEdit && <Button size="sm" variant="ghost" onClick={() => setReturning(h)}><LogIn className="size-3.5" /> Check in</Button>}
            </span>
          </Row>
        ))}
      </Section>
      {returning && <CheckInAccessory a={returning} onClose={() => setReturning(null)} onDone={() => { setReturning(null); void load() }} />}
    </>
  )
}
