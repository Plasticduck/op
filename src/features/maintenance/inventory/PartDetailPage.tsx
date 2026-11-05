import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, Paperclip, Pencil, Plus, Printer, Trash2 } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi, type PartDetail, type StockRow } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { dayTime, errText, LEDGER_TYPE, money, qty } from './format'
import { LabelsDialog, type LabelItem } from './LabelsDialog'
import { PartForm } from './PartForm'
import { ConsumePanel, CountPanel, ReceivePanel, TransferRequestPanel } from './StockActions'
import { Card, ErrorNote, Loading, Muted, Thumb } from './ui'

const BASE = '/app/maintenance-inventory'
type Dialog =
  | { kind: 'edit' } | { kind: 'vendor' } | { kind: 'stock'; row?: StockRow } | { kind: 'adjust'; row: StockRow }
  | { kind: 'consume' | 'receive' | 'count' | 'transfer'; row: StockRow } | { kind: 'labels'; items: LabelItem[] }

export default function PartDetailPage() {
  const { id = '' } = useParams()
  const { me, refs, notify, accountId, userId } = useMi()
  const [d, setD] = useState<PartDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)

  const load = useCallback(async () => {
    try {
      setD(await mi.partDetail(id))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [id])
  useEffect(() => {
    void load()
    window.addEventListener('mi-changed', load)
    return () => window.removeEventListener('mi-changed', load)
  }, [load])

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  const p = d.part
  const canCatalog = me.rank >= 4
  const close = () => setDialog(null)
  const done = (m: string) => { close(); notify(m); void load() }

  const attach = async (file: File) => {
    try {
      const path = await mi.upload(accountId, 'parts', file, file.name)
      await mi.addAttachment({ account_id: accountId, entity_type: 'part', entity_id: p.id, storage_path: path, file_name: file.name, kind: file.type.startsWith('image/') ? 'photo' : 'document', uploaded_by: userId })
      void load()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const openFile = async (path: string) => {
    const url = await mi.fileUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="flex flex-col gap-4">
      <Link to={`${BASE}/parts`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Parts</Link>

      <div className="flex flex-wrap items-start gap-3">
        <Thumb path={p.photo_path} className="size-16" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold text-ink">{p.name}</h1>
            {p.is_critical && <Badge tone="danger">Critical</Badge>}
            {p.abc_class && <Badge>Class {p.abc_class}</Badge>}
            {p.is_sample && <Badge>Sample</Badge>}
          </div>
          <p className="text-sm text-ink-muted">
            {[p.sku && `SKU ${p.sku}`, p.manufacturer, p.mfr_part_number, p.category, p.barcode && `Barcode ${p.barcode}`, p.pack_qty > 1 && `Pack of ${qty(p.pack_qty)}`].filter(Boolean).join(' · ') || 'No details yet'}
          </p>
          {p.description && <p className="mt-1 text-sm text-ink">{p.description}</p>}
          {p.sku_legacy_dup && <p className="mt-1 text-xs text-warn">Another part in the catalog has this same SKU. Worth merging.</p>}
        </div>
        {canCatalog && <Button variant="secondary" onClick={() => setDialog({ kind: 'edit' })}><Pencil className="size-4" /> Edit</Button>}
      </div>

      <Card title="Stock" actions={me.rank >= 2 ? <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'stock' })}><Plus className="size-4" /> Stock at a location</Button> : undefined}>
        {d.stock.length === 0 ? <Muted>Not stocked anywhere you can see.</Muted> : (
          <ul className="flex flex-col divide-y divide-border">
            {d.stock.map((s) => (
              <li key={s.location_id} className="py-2">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="min-w-0">
                    <span className="font-medium text-ink">{s.location_name}</span>
                    <span className="text-sm text-ink-muted">{s.site_name ? ` (${s.site_name})` : ''}{s.bin_name ? `, bin ${s.bin_name}` : ''}</span>
                  </div>
                  <span className="text-sm tabular-nums text-ink">
                    <b>{qty(s.on_hand)}</b> on hand{Number(s.reserved) > 0 ? `, ${qty(s.reserved)} reserved` : ''}{Number(s.on_order) > 0 ? `, ${qty(s.on_order)} on order` : ''}
                  </span>
                </div>
                <p className="text-xs text-ink-muted">
                  Min {qty(s.min_qty)}, max {qty(s.max_qty)}, reorder at {qty(s.reorder_point)}{me.rank >= 2 ? `. Average cost ${money(s.avg_cost)}` : ''}
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {s.can_act && <Button size="sm" onClick={() => setDialog({ kind: 'consume', row: s })}>Consume</Button>}
                  {s.can_act && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'receive', row: s })}>Receive</Button>}
                  {s.can_act && <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'count', row: s })}>Count</Button>}
                  <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'transfer', row: s })}>Transfer</Button>
                  {s.can_manage && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'stock', row: s })}>Min/max</Button>}
                  {s.can_manage && <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'adjust', row: s })}>Adjust</Button>}
                  {s.bin_id && (
                    <Button size="sm" variant="ghost" onClick={() => setDialog({ kind: 'labels', items: [{ type: 'bin', id: s.bin_id as string, name: `${s.bin_name}: ${p.name}`, site: s.site_name ?? s.location_name }] })}>
                      <Printer className="size-4" /> Bin label
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
        {d.elsewhere.filter((e) => !d.stock.some((s) => s.location_id === e.location_id)).length > 0 && (
          <p className="mt-2 border-t border-border pt-2 text-xs text-ink-muted">
            Also at: {d.elsewhere.filter((e) => !d.stock.some((s) => s.location_id === e.location_id)).map((e) => `${e.location_name} (${qty(e.available)})`).join(', ')}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Vendors" actions={canCatalog ? <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: 'vendor' })}><Plus className="size-4" /> Add</Button> : undefined}>
          {d.vendors.length === 0 ? <Muted>No vendors yet. Reorder suggestions need a preferred one.</Muted> : d.vendors.map((v) => (
            <div key={v.id} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <div className="min-w-0">
                <span className="font-medium text-ink">{v.vendor_name}</span>
                {v.preferred && <Badge tone="accent" className="ml-1.5">Preferred</Badge>}
                <p className="text-xs text-ink-muted">{[v.vendor_part_number, v.price != null && money(v.price), v.pack_qty > 1 && `pack of ${qty(v.pack_qty)}`, v.lead_time_days != null && `${v.lead_time_days} day lead`].filter(Boolean).join(' · ')}</p>
              </div>
              {canCatalog && (
                <Button variant="ghost" size="icon" aria-label={`Remove ${v.vendor_name}`} onClick={() => { void mi.removePartVendor(v.id).then(load).catch((e) => notify(errText(e), 'danger')) }}>
                  <Trash2 className="size-4" />
                </Button>
              )}
            </div>
          ))}
        </Card>

        <Card title="Used on">
          {d.assets.length === 0 ? <Muted>No assets list this part yet. Add it from an asset's parts list.</Muted> : d.assets.map((a) => (
            <Link key={a.id} to={`${BASE}/assets/${a.id}`} className="flex justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
              <span className="truncate text-accent">{a.name}</span>
              <span className="shrink-0 text-ink-muted">{a.site_name}, x{qty(a.qty_per)}</span>
            </Link>
          ))}
        </Card>
      </div>

      <Card title="Files" actions={
        <label className="inline-flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border px-3 text-sm text-ink hover:bg-content">
          <Paperclip className="size-4" /> Attach
          <input type="file" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(f) }} />
        </label>
      }>
        {d.attachments.length === 0 ? <Muted>Manuals, spec sheets and photos go here.</Muted> : d.attachments.map((a) => (
          <button key={a.id} type="button" className="block w-full truncate border-t border-border py-2 text-left text-sm text-accent first:border-t-0 hover:underline" onClick={() => void openFile(a.storage_path)}>{a.file_name ?? 'File'}</button>
        ))}
      </Card>

      <Card title="History">
        {d.history.length === 0 ? <Muted>No movements yet.</Muted> : (
          <ul className="flex flex-col divide-y divide-border">
            {d.history.map((h) => (
              <li key={h.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <div className="min-w-0">
                  <span className="font-medium text-ink">{LEDGER_TYPE[h.type] ?? h.type}</span>
                  <span className="text-ink-muted"> at {h.location_name}{h.work_order_number ? `, WO #${h.work_order_number}` : ''}{h.asset_name ? `, ${h.asset_name}` : ''}{h.reason_code ? `, ${h.reason_code.replace(/_/g, ' ')}` : ''}</span>
                  <p className="text-xs text-ink-subtle">{dayTime(h.created_at)}{h.by ? `, ${h.by}` : ''}</p>
                </div>
                <span className="tabular-nums text-ink">{Number(h.qty) > 0 ? '+' : ''}{qty(h.qty)}{!['reserve', 'unreserve'].includes(h.type) ? <span className="text-ink-muted"> to {qty(h.qty_after)}</span> : null}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {dialog?.kind === 'edit' && (
        <Modal open onClose={close} title="Edit part" size="lg"><PartForm existing={p} onCancel={close} onSaved={() => { close(); void load() }} /></Modal>
      )}
      {dialog?.kind === 'vendor' && <VendorDialog partId={p.id} accountId={accountId} onClose={close} onSaved={() => { close(); void load() }} vendors={refs.vendors} />}
      {dialog?.kind === 'stock' && <StockParams partId={p.id} row={dialog.row} existing={d.stock} onClose={close} onSaved={() => { close(); void load() }} />}
      {dialog?.kind === 'adjust' && <AdjustDialog row={dialog.row} onClose={close} onDone={done} />}
      {dialog?.kind === 'consume' && <Modal open onClose={close} title={`Consume: ${p.name}`}><ConsumePanel stock={dialog.row} onDone={done} onTransfer={() => setDialog({ kind: 'transfer', row: dialog.row })} /></Modal>}
      {dialog?.kind === 'receive' && <Modal open onClose={close} title={`Receive: ${p.name}`}><ReceivePanel stock={dialog.row} onDone={done} /></Modal>}
      {dialog?.kind === 'count' && <Modal open onClose={close} title={`Count: ${p.name}`}><CountPanel stock={dialog.row} onDone={done} /></Modal>}
      {dialog?.kind === 'transfer' && <Modal open onClose={close} title={`Transfer: ${p.name}`}><TransferRequestPanel stock={dialog.row} onDone={done} /></Modal>}
      {dialog?.kind === 'labels' && <LabelsDialog items={dialog.items} onClose={close} />}
    </div>
  )
}

function VendorDialog({ partId, accountId, vendors, onClose, onSaved }: { partId: string; accountId: string; vendors: Array<{ id: string; name: string }>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ vendor_id: '', vendor_part_number: '', price: '', pack_qty: '1', lead_time_days: '', preferred: true })
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    try {
      await mi.savePartVendor({
        account_id: accountId, part_id: partId, vendor_id: f.vendor_id, vendor_part_number: f.vendor_part_number || null,
        price: f.price ? Number(f.price) : null, pack_qty: Number(f.pack_qty) || 1, lead_time_days: f.lead_time_days ? Number(f.lead_time_days) : null, preferred: f.preferred,
      })
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="Add a vendor">
      <div className="flex flex-col gap-3">
        <Field label="Vendor" required>
          {(id) => (
            <Select id={id} value={f.vendor_id} onChange={(e) => setF({ ...f, vendor_id: e.target.value })}>
              <option value="">Pick one</option>
              {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Their part number">{(id) => <Input id={id} value={f.vendor_part_number} onChange={(e) => setF({ ...f, vendor_part_number: e.target.value })} />}</Field>
          <Field label="Price">{(id) => <Input id={id} inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />}</Field>
          <Field label="Pack size">{(id) => <Input id={id} inputMode="decimal" value={f.pack_qty} onChange={(e) => setF({ ...f, pack_qty: e.target.value })} />}</Field>
          <Field label="Lead time (days)">{(id) => <Input id={id} inputMode="numeric" value={f.lead_time_days} onChange={(e) => setF({ ...f, lead_time_days: e.target.value })} />}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4" checked={f.preferred} onChange={(e) => setF({ ...f, preferred: e.target.checked })} /> Preferred vendor (reorders group under it)</label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.vendor_id} onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}

function StockParams({ partId, row, existing, onClose, onSaved }: { partId: string; row?: StockRow; existing: StockRow[]; onClose: () => void; onSaved: () => void }) {
  const { refs, accountId } = useMi()
  const [location, setLocation] = useState(row?.location_id ?? '')
  const [bin, setBin] = useState(row?.bin_id ?? '')
  const [newBin, setNewBin] = useState('')
  const [min, setMin] = useState(row?.min_qty != null ? String(row.min_qty) : '')
  const [max, setMax] = useState(row?.max_qty != null ? String(row.max_qty) : '')
  const [reorder, setReorder] = useState(row?.reorder_point != null ? String(row.reorder_point) : '')
  const [error, setError] = useState<string | null>(null)
  const { reload } = useMi()
  const choices = refs.locations.filter((l) => l.can_manage && l.active && (row ? l.id === row.location_id : !existing.some((s) => s.location_id === l.id)))
  const save = async () => {
    try {
      let binId = bin || null
      if (newBin.trim()) binId = (await mi.addBin(accountId, location, newBin.trim())).id
      await mi.setStockParams({ part: partId, location, bin: binId, min: min === '' ? null : Number(min), max: max === '' ? null : Number(max), reorder: reorder === '' ? null : Number(reorder) })
      if (newBin.trim()) await reload()
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title={row ? `Stock rules at ${row.location_name}` : 'Stock at a location'}>
      <div className="flex flex-col gap-3">
        {!row && (
          <Field label="Location" required>
            {(id) => (
              <Select id={id} value={location} onChange={(e) => { setLocation(e.target.value); setBin('') }}>
                <option value="">Pick one</option>
                {choices.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        {location && (
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bin">
              {(id) => (
                <Select id={id} value={bin} onChange={(e) => setBin(e.target.value)}>
                  <option value="">None</option>
                  {refs.bins.filter((b) => b.location_id === location).map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Or a new bin">{(id) => <Input id={id} value={newBin} onChange={(e) => setNewBin(e.target.value)} placeholder="A-12" />}</Field>
          </div>
        )}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Min">{(id) => <Input id={id} inputMode="decimal" value={min} onChange={(e) => setMin(e.target.value)} />}</Field>
          <Field label="Max">{(id) => <Input id={id} inputMode="decimal" value={max} onChange={(e) => setMax(e.target.value)} />}</Field>
          <Field label="Reorder at" hint="Blank uses min.">{(id) => <Input id={id} inputMode="decimal" value={reorder} onChange={(e) => setReorder(e.target.value)} />}</Field>
        </div>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!location} onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}

function AdjustDialog({ row, onClose, onDone }: { row: StockRow; onClose: () => void; onDone: (m: string) => void }) {
  const [newQty, setNewQty] = useState(String(row.on_hand))
  const [cost, setCost] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const delta = Number(newQty) - Number(row.on_hand)
  const save = async () => {
    try {
      await mi.adjustStock({ part: row.part_id, location: row.location_id, delta, reason, cost: cost === '' ? null : Number(cost) })
      onDone(`${row.part_name} is now ${qty(newQty)} at ${row.location_name}.`)
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title={`Adjust ${row.part_name}`} description="For first stock-in and corrections. Day to day, count it instead.">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <Field label={`New quantity (now ${qty(row.on_hand)})`}>{(id) => <Input id={id} inputMode="decimal" value={newQty} onChange={(e) => setNewQty(e.target.value)} />}</Field>
          <Field label="Cost each" hint="Only when adding stock.">{(id) => <Input id={id} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={money(row.avg_cost)} />}</Field>
        </div>
        <Field label="Reason" required>{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Opening balance, damaged in storage..." />}</Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!reason.trim() || delta === 0 || Number.isNaN(delta)} onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}
