import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { parts, type Part } from '@/lib/queries/parts'
import { vendors as vendorsQ, type Vendor } from '@/lib/queries/workOrders'

type FormProps = {
  initial?: Part
  onClose: () => void
  onSaved: (id: string) => void
  mode: 'create' | 'edit'
}

function PartForm({ initial, onClose, onSaved, mode }: FormProps) {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [sku, setSku] = useState(initial?.sku ?? '')
  const [uom, setUom] = useState(initial?.uom ?? 'ea')
  const [unitCost, setUnitCost] = useState(initial?.unit_cost != null ? String(initial.unit_cost) : '')
  const [leadTime, setLeadTime] = useState(initial?.lead_time_days != null ? String(initial.lead_time_days) : '')
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? '')
  const [vendorId, setVendorId] = useState<string>(initial?.vendor_id ?? '')
  const [orderingPN, setOrderingPN] = useState(initial?.ordering_part_number ?? '')
  const [linkUrl, setLinkUrl] = useState(initial?.link_url ?? '')

  // Only shown on Create: initial stock at a location.
  const [stockLocationId, setStockLocationId] = useState(activeLocation?.id ?? '')
  const [stockQty, setStockQty] = useState('0')
  const [stockMin, setStockMin] = useState('0')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await vendorsQ.list()
      setVendors((data as Vendor[] | null) ?? [])
    })()
  }, [])

  const save = async () => {
    setError(null)
    if (!name.trim()) return setError('Enter a name')
    if (!profile) return
    setBusy(true)

    const payload = {
      account_id: profile.account_id,
      name: name.trim(),
      description: description.trim() || null,
      sku: sku.trim() || null,
      uom: (uom || 'ea').trim(),
      unit_cost: unitCost ? Number(unitCost) : null,
      lead_time_days: leadTime ? Number(leadTime) : null,
      manufacturer: manufacturer.trim() || null,
      vendor_id: vendorId || null,
      ordering_part_number: orderingPN.trim() || null,
      link_url: linkUrl.trim() || null,
    }

    if (mode === 'edit' && initial?.id) {
      const { data, error: err } = await parts.update(initial.id, payload)
      setBusy(false)
      if (err || !data) return setError(err?.message ?? 'Save failed')
      onSaved(data.id)
    } else {
      const { data, error: err } = await parts.create(payload)
      if (err || !data) { setBusy(false); return setError(err?.message ?? 'Create failed') }
      // Initial stock row if a quantity was set
      if (stockLocationId && (Number(stockQty) > 0 || Number(stockMin) > 0)) {
        await supabase.from('parts_inventory').insert({
          part_id: data.id,
          location_id: stockLocationId,
          quantity_on_hand: Number(stockQty) || 0,
          minimum_in_stock: Number(stockMin) || 0,
        })
      }
      setBusy(false)
      onSaved(data.id)
    }
  }

  return (
    <Modal open onClose={onClose} title={mode === 'edit' ? `Edit ${initial?.name ?? 'part'}` : 'New Part'} size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Adjuster Feet" />}</Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="UOM" hint="Unit of measure (ea, ft, gal, oz)">
            {(id) => <Input id={id} value={uom} onChange={(e) => setUom(e.target.value)} placeholder="ea" />}
          </Field>
          <Field label="Unit Cost">
            {(id) => <Input id={id} type="number" min="0" step="0.01" value={unitCost} onChange={(e) => setUnitCost(e.target.value)} />}
          </Field>
          <Field label="Lead Time (Days)">
            {(id) => <Input id={id} type="number" min="0" value={leadTime} onChange={(e) => setLeadTime(e.target.value)} />}
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="SKU">{(id) => <Input id={id} value={sku} onChange={(e) => setSku(e.target.value)} />}</Field>
          <Field label="Manufacturer">{(id) => <Input id={id} value={manufacturer} onChange={(e) => setManufacturer(e.target.value)} />}</Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Vendor">
            {(id) => (
              <Select id={id} value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
                <option value="">No vendor</option>
                {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Ordering Part Number">
            {(id) => <Input id={id} value={orderingPN} onChange={(e) => setOrderingPN(e.target.value)} placeholder="Vendor's part #" />}
          </Field>
        </div>

        <Field label="Description">
          {(id) => (
            <textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          )}
        </Field>

        <Field label="Product URL">
          {(id) => <Input id={id} type="url" value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} placeholder="https://" />}
        </Field>

        {mode === 'create' && (
          <fieldset className="rounded-md border border-border bg-content/40 p-3">
            <legend className="px-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Initial stock (optional)</legend>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Location">
                {(id) => (
                  <Select id={id} value={stockLocationId} onChange={(e) => setStockLocationId(e.target.value)}>
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Units in stock">{(id) => <Input id={id} type="number" min="0" step="any" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />}</Field>
              <Field label="Minimum">{(id) => <Input id={id} type="number" min="0" step="any" value={stockMin} onChange={(e) => setStockMin(e.target.value)} />}</Field>
            </div>
          </fieldset>
        )}

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === 'edit' ? 'Save changes' : 'Create part'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function NewPartModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  return <PartForm mode="create" onClose={onClose} onSaved={onCreated} />
}

export function EditPartModal({ part, onClose, onSaved }: { part: Part; onClose: () => void; onSaved: (id: string) => void }) {
  return <PartForm mode="edit" initial={part} onClose={onClose} onSaved={onSaved} />
}
