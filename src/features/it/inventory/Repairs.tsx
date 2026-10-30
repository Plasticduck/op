import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { differenceInCalendarDays, format, parseISO } from 'date-fns'
import { CircleCheck, Loader2, Pencil, Plus, ShieldCheck, Trash2, Wrench } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { currency } from '@/lib/format'
import { itInventory, type ItAssetRow, type ItRepairRow } from '@/lib/queries/itInventory'
import { fmtDay, fmtDowntime, friendlyError, type Tone } from './format'
import { Footer, NoteField } from './ItemActions'
import type { ItRefs } from './useItRefs'

// Repairs and service on one item (it_maintenances): log one (optionally
// taking it out of service, which sets Out for Repair and puts the old status
// back when it's done), mark it done, edit or remove it. The Repairs tab on
// the asset page; RepairsPage lists them all.

const today = () => format(new Date(), 'yyyy-MM-dd')
// Kinds where the item is usually out of action while it's worked on.
const OUT_BY_DEFAULT = ['repair', 'replacement', 'vendor service call']

async function supplierId(refs: ItRefs, accountId: string, text: string, onRefsChanged: () => void): Promise<string | null> {
  const t = text.trim()
  if (!t) return null
  const existing = refs.suppliers.find((s) => s.name.toLowerCase() === t.toLowerCase())
  if (existing) return existing.id
  const { data, error } = await itInventory.addSupplier(accountId, t)
  if (error) throw new Error(error.message)
  onRefsChanged()
  return data.id
}

const money = (v: string): number | null | 'bad' => {
  if (!v.trim()) return null
  const n = Number(v.replace(/[$,]/g, ''))
  return Number.isFinite(n) && n >= 0 ? n : 'bad'
}

export function RepairDialog({ refs, asset, repair, onClose, onSaved, onRefsChanged }: {
  refs: ItRefs
  asset: Pick<ItAssetRow, 'id' | 'asset_tag' | 'name' | 'status_label_id'>
  repair?: ItRepairRow // edit
  onClose: () => void
  onSaved: (message: string) => void
  onRefsChanged: () => void
}) {
  const { profile } = useAuth()
  const defaultType = refs.repairTypes.find((t) => t.name.toLowerCase() === 'repair') ?? refs.repairTypes[0]
  const deployable = refs.status.get(asset.status_label_id)?.type === 'deployable'
  const [typeId, setTypeId] = useState(repair ? repair.maintenance_type_id ?? '' : defaultType?.id ?? '')
  const [title, setTitle] = useState(repair?.title ?? '')
  const [supplier, setSupplier] = useState(repair?.supplier_id ? refs.supplier.get(repair.supplier_id)?.name ?? '' : '')
  const [warranty, setWarranty] = useState(repair?.is_warranty ?? false)
  const [cost, setCost] = useState(repair?.cost != null ? String(repair.cost) : '')
  const [start, setStart] = useState(repair?.start_date ?? today())
  const [done, setDone] = useState(!!repair?.completion_date)
  const [completed, setCompleted] = useState(repair?.completion_date ?? today())
  const [hours, setHours] = useState(repair?.downtime_minutes != null ? String(Math.round((repair.downtime_minutes / 60) * 10) / 10) : '')
  const [out, setOut] = useState(deployable && OUT_BY_DEFAULT.includes((defaultType?.name ?? '').toLowerCase()))
  const [notes, setNotes] = useState(repair?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const repairStatus = refs.statuses.find((s) => s.name.toLowerCase() === 'out for repair')?.name ?? 'Out for Repair'
  const backTo = refs.status.get(asset.status_label_id)?.name ?? 'its status'

  const pickType = (id: string) => {
    setTypeId(id)
    if (!repair) setOut(deployable && OUT_BY_DEFAULT.includes((refs.repairTypes.find((t) => t.id === id)?.name ?? '').toLowerCase()))
  }

  const save = async () => {
    if (!profile) return
    if (!title.trim()) { setError("Say what's being done, like \"Replace the card reader\"."); return }
    const c = money(cost)
    if (c === 'bad') { setError('Cost should be a dollar amount.'); return }
    const h = hours.trim() ? Number(hours) : null
    if (h !== null && (!Number.isFinite(h) || h < 0)) { setError('Out of service should be a number of hours.'); return }
    if (done && completed < start) { setError("It can't be done before it started."); return }
    setBusy(true)
    setError(null)
    try {
      const sid = await supplierId(refs, profile.account_id, supplier, onRefsChanged)
      if (repair) {
        const { error: err } = await itInventory.updateRepair(repair.id, {
          maintenance_type_id: typeId || null, title: title.trim(), supplier_id: sid, is_warranty: warranty, cost: c,
          start_date: start, notes: notes.trim() || null,
          ...(repair.completion_date ? { completion_date: completed, downtime_minutes: h === null ? null : Math.round(h * 60) } : {}),
        })
        if (err) throw new Error(err.message)
        onSaved('Saved.')
      } else {
        const { error: err } = await itInventory.logRepair({
          assetId: asset.id, typeId: typeId || null, title: title.trim(), supplierId: sid, isWarranty: warranty, cost: c,
          start, completed: done ? completed : null, downtimeMinutes: done && h !== null ? Math.round(h * 60) : null,
          outOfService: !done && out, notes: notes.trim() || null,
        })
        if (err) throw new Error(err.message)
        onSaved(done ? 'Logged.' : out ? `Logged. ${asset.asset_tag} is ${repairStatus} until you mark the repair done.` : 'Logged. Mark it done when the work is finished.')
      }
    } catch (e) {
      setBusy(false)
      setError(friendlyError(e instanceof Error ? e.message : String(e)))
    }
  }

  return (
    <Modal open onClose={onClose} size="lg" title={repair ? 'Edit repair' : 'Log a repair or service'} description={`${asset.asset_tag} ${asset.name}`}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="What's being done" required className="sm:col-span-2">
          {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replace the card reader" autoFocus={!repair} />}
        </Field>
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={typeId} onChange={(e) => pickType(e.target.value)}>
              <option value="">Choose one</option>
              {refs.repairTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Who's doing it" hint="A vendor, or leave blank if it's us.">
          {(id) => (
            <>
              <Input id={id} list="it-repair-vendors" value={supplier} onChange={(e) => setSupplier(e.target.value)} autoComplete="off" />
              <datalist id="it-repair-vendors">{refs.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
            </>
          )}
        </Field>
        <Field label="Cost" hint={done || repair?.completion_date ? undefined : 'An estimate is fine; you can change it when it\'s done.'}>
          {(id) => <Input id={id} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="$0.00" />}
        </Field>
        <Field label="Started">
          {(id) => <Input id={id} type="date" value={start} onChange={(e) => setStart(e.target.value)} />}
        </Field>
        <label className="flex items-center gap-2.5 text-sm text-ink sm:col-span-2">
          <input type="checkbox" checked={warranty} onChange={(e) => setWarranty(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent" />
          Covered by warranty
        </label>
        {!repair && (
          <label className="flex items-center gap-2.5 text-sm text-ink sm:col-span-2">
            <input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent" />
            It's already done
          </label>
        )}
        {(done || repair?.completion_date) && (
          <>
            <Field label="Done on">
              {(id) => <Input id={id} type="date" value={completed} onChange={(e) => setCompleted(e.target.value)} />}
            </Field>
            <Field label="Out of service (hours)" hint="Optional.">
              {(id) => <Input id={id} type="number" min={0} step="0.5" value={hours} onChange={(e) => setHours(e.target.value)} />}
            </Field>
          </>
        )}
        {!repair && !done && (
          <label className="flex items-start gap-2.5 rounded-md border border-border bg-content/40 px-3 py-2.5 text-sm text-ink sm:col-span-2">
            <input type="checkbox" checked={out} onChange={(e) => setOut(e.target.checked)} className="mt-0.5 size-4 rounded border-border text-accent focus:ring-accent" />
            <span>
              Out of service until it's done
              <span className="block text-xs text-ink-muted">
                Its status becomes {repairStatus} now, and goes back to {backTo} when you mark the repair done. Downtime is counted for you.
              </span>
            </span>
          </label>
        )}
        <div className="sm:col-span-2"><NoteField value={notes} onChange={setNotes} placeholder="Ticket number, what they found, parts used" /></div>
      </div>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} {repair ? 'Save' : 'Log it'}</Button>
      </Footer>
    </Modal>
  )
}

export function FinishRepairDialog({ refs, repair, onClose, onDone }: {
  refs: ItRefs
  repair: ItRepairRow
  onClose: () => void
  onDone: (message: string) => void
}) {
  const [completed, setCompleted] = useState(today())
  const [cost, setCost] = useState(repair.cost != null ? String(repair.cost) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const prior = repair.prior_status_id ? refs.status.get(repair.prior_status_id)?.name : null

  const save = async () => {
    const c = money(cost)
    if (c === 'bad') { setError('Cost should be a dollar amount.'); return }
    setBusy(true)
    setError(null)
    const { data, error: err } = await itInventory.finishRepair(repair.id, completed, c, note.trim() || null)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    const down = fmtDowntime(data?.downtime_minutes)
    onDone(['Marked done.', down && `Out of service for ${down}.`, data?.restored && `It's back to ${data.restored}.`].filter(Boolean).join(' '))
  }

  return (
    <Modal open onClose={onClose} size="md" title={`Mark "${repair.title}" done?`}
      description={prior ? `It goes back to ${prior}, and the time it was out of service is recorded.` : undefined}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Done on">{(id) => <Input id={id} type="date" value={completed} onChange={(e) => setCompleted(e.target.value)} />}</Field>
        <Field label="Final cost">{(id) => <Input id={id} value={cost} onChange={(e) => setCost(e.target.value)} inputMode="decimal" placeholder="$0.00" />}</Field>
      </div>
      <div className="mt-3"><NoteField value={note} onChange={setNote} placeholder="What fixed it" /></div>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void save()} disabled={busy}>{busy && <Loader2 className="size-4 animate-spin" />} Mark done</Button>
      </Footer>
    </Modal>
  )
}

// One repair as a card: open ones show how long they've been going.
export function RepairCard({ r, refs, actions }: { r: ItRepairRow; refs: ItRefs; actions?: ReactNode }) {
  const type = r.maintenance_type_id ? refs.repairTypes.find((t) => t.id === r.maintenance_type_id) : undefined
  const vendor = r.supplier_id ? refs.supplier.get(r.supplier_id)?.name : null
  const open = !r.completion_date
  const days = differenceInCalendarDays(new Date(), parseISO(r.start_date))
  return (
    <li className="px-3 py-2.5 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{r.title}</span>
        {type && <Badge tone={type.color as Tone}>{type.name}</Badge>}
        {r.is_warranty && <Badge tone="ok"><ShieldCheck className="size-3" /> Warranty</Badge>}
        {open && <Badge tone="warn">Open{days > 0 ? ` ${days} day${days === 1 ? '' : 's'}` : ''}</Badge>}
      </div>
      <div className="mt-0.5 text-xs text-ink-muted">
        {[vendor, open ? `started ${fmtDay(r.start_date)}` : `${fmtDay(r.start_date)} to ${fmtDay(r.completion_date!)}`,
          r.cost != null && `${currency(r.cost)}${open ? ' (estimate)' : ''}`,
          !open && fmtDowntime(r.downtime_minutes) && `out of service ${fmtDowntime(r.downtime_minutes)}`,
          r.out_of_service_at && open && 'out of service now'].filter(Boolean).join(' · ')}
      </div>
      {r.notes && <p className="mt-1 whitespace-pre-wrap text-xs text-ink">{r.notes}</p>}
      {actions && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
    </li>
  )
}

// The Repairs tab on an asset.
export function AssetRepairs({ asset, refs, canEdit, onChanged, onRefsChanged }: {
  asset: ItAssetRow
  refs: ItRefs
  canEdit: boolean
  onChanged: (message: string) => void
  onRefsChanged: () => void
}) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<ItRepairRow[] | null>(null)
  const [dialog, setDialog] = useState<null | { kind: 'log' } | { kind: 'edit' | 'finish' | 'remove'; r: ItRepairRow }>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await itInventory.repairsForAsset(asset.id)
    setRows((data as unknown as ItRepairRow[] | null) ?? [])
  }, [asset.id])
  useEffect(() => { void load() }, [load, asset.updated_at])

  const done = (m: string) => { setDialog(null); onChanged(m); void load() }
  if (rows === null) return <div className="grid place-items-center py-12 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  const open = rows.filter((r) => !r.completion_date)
  const finished = rows.filter((r) => r.completion_date)
  const total = rows.reduce((s, r) => s + (r.completion_date ? r.cost ?? 0 : 0), 0)
  const downtime = finished.reduce((s, r) => s + (r.downtime_minutes ?? 0), 0)

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-ink-muted">
          {finished.length
            ? <>Spent <span className="font-medium text-ink">{currency(total)}</span> on {finished.length} {finished.length === 1 ? 'repair' : 'repairs'}{downtime ? `, out of service ${fmtDowntime(downtime)} in all` : ''}.</>
            : 'No repairs done yet.'}
        </div>
        {canEdit && !asset.deleted_at && <Button size="sm" onClick={() => setDialog({ kind: 'log' })}><Plus className="size-3.5" /> Log repair</Button>}
      </div>

      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {rows.length === 0 ? (
        <div className="mt-4 rounded-md border border-dashed border-border p-6 text-center text-sm text-ink-muted">
          <Wrench className="mx-auto mb-2 size-5" />
          Log repairs, service calls, upgrades and firmware updates here, with what they cost and how long it was out.
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <>
              <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Open</div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {open.map((r) => (
                  <RepairCard key={r.id} r={r} refs={refs} actions={canEdit ? (
                    <>
                      <Button size="sm" onClick={() => setDialog({ kind: 'finish', r })}><CircleCheck className="size-3.5" /> Mark done</Button>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', r })}><Pencil className="size-3.5" /> Edit</Button>
                    </>
                  ) : undefined} />
                ))}
              </ul>
            </>
          )}
          {finished.length > 0 && (
            <>
              <div className="mb-2 mt-4 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Done</div>
              <ul className="divide-y divide-border rounded-md border border-border">
                {finished.map((r) => (
                  <RepairCard key={r.id} r={r} refs={refs} actions={canEdit ? (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'edit', r })}><Pencil className="size-3.5" /> Edit</Button>
                      {profile?.role === 'owner' && (
                        <Button size="sm" variant="ghost" className="text-danger" onClick={() => setDialog({ kind: 'remove', r })}><Trash2 className="size-3.5" /> Remove</Button>
                      )}
                    </>
                  ) : undefined} />
                ))}
              </ul>
            </>
          )}
        </>
      )}

      {dialog?.kind === 'log' && <RepairDialog refs={refs} asset={asset} onClose={() => setDialog(null)} onSaved={done} onRefsChanged={onRefsChanged} />}
      {dialog?.kind === 'edit' && <RepairDialog refs={refs} asset={asset} repair={dialog.r} onClose={() => setDialog(null)} onSaved={done} onRefsChanged={onRefsChanged} />}
      {dialog?.kind === 'finish' && <FinishRepairDialog refs={refs} repair={dialog.r} onClose={() => setDialog(null)} onDone={done} />}
      <ConfirmDialog
        open={dialog?.kind === 'remove'}
        title={`Remove "${dialog?.kind === 'remove' ? dialog.r.title : ''}"?`}
        description="For a repair logged by mistake. It leaves the list and the totals; the activity log keeps a record."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onCancel={() => setDialog(null)}
        onConfirm={() => {
          if (dialog?.kind !== 'remove') return
          setBusy(true)
          void itInventory.removeRepair(dialog.r.id).then(({ error }) => {
            setBusy(false)
            if (error) { setDialog(null); setError(friendlyError(error.message)); return }
            done('Removed.')
          })
        }}
      />
    </div>
  )
}
