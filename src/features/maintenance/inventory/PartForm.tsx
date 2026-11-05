import { useEffect, useState } from 'react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { mi, type PartDetail } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { errText } from './format'
import { ErrorNote, useDebounced, WarnNote } from './ui'

// New or edit, for the catalog. Similar names warn while you type; an exact manufacturer
// part number or barcode blocks the save on the server.

export function PartForm({ existing, onCancel, onSaved }: { existing?: PartDetail['part']; onCancel: () => void; onSaved: (id: string) => void }) {
  const { refs, accountId } = useMi()
  const [f, setF] = useState({
    name: existing?.name ?? '',
    description: existing?.description ?? '',
    sku: existing?.sku ?? '',
    category_id: existing?.category_id ?? '',
    manufacturer: existing?.manufacturer ?? '',
    mfr_part_number: existing?.mfr_part_number ?? '',
    barcode: existing?.barcode ?? '',
    uom: existing?.uom ?? 'ea',
    pack_qty: String(existing?.pack_qty ?? 1),
    unit_cost: existing?.unit_cost != null ? String(existing.unit_cost) : '',
    lead_time_days: existing?.lead_time_days != null ? String(existing.lead_time_days) : '',
    abc_class: existing?.abc_class ?? '',
    is_critical: existing?.is_critical ?? false,
    stale_days: existing?.stale_days != null ? String(existing.stale_days) : '',
    spec: existing?.spec && Object.keys(existing.spec).length ? JSON.stringify(existing.spec) : '',
  })
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [similar, setSimilar] = useState<Array<{ id: string; name: string }>>([])
  const [exact, setExact] = useState<Array<{ name: string; match: string }>>([])
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((p) => ({ ...p, [k]: v }))

  const dName = useDebounced(f.name, 350)
  const dMfr = useDebounced(f.manufacturer, 350)
  const dMpn = useDebounced(f.mfr_part_number, 350)
  const dBarcode = useDebounced(f.barcode, 350)
  useEffect(() => {
    if (dName.trim().length < 3 && !dBarcode && !dMpn) return
    let alive = true
    void mi.checkDuplicates({ name: dName, manufacturer: dMfr, mpn: dMpn, barcode: dBarcode, exclude: existing?.id ?? null }).then((d) => {
      if (!alive) return
      setSimilar(d.similar)
      setExact(d.exact)
    }).catch(() => {})
    return () => { alive = false }
  }, [dName, dMfr, dMpn, dBarcode, existing?.id])

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      let spec: Record<string, unknown> | undefined
      if (f.spec.trim()) {
        try {
          spec = JSON.parse(f.spec) as Record<string, unknown>
        } catch {
          throw new Error('Specs need to be valid JSON, like {"voltage": "230V"}.')
        }
      }
      const photo_path = photo ? await mi.upload(accountId, 'parts', photo, photo.name) : undefined
      const saved = await mi.savePart({ ...f, id: existing?.id, spec: spec ?? {}, ...(photo_path ? { photo_path } : {}) })
      onSaved(saved.id)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const shownSimilar = similar.filter((s) => s.name.toLowerCase() !== (existing?.name ?? '').toLowerCase())
  return (
    <div className="flex flex-col gap-3">
      <Field label="Name" required>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} />}</Field>
      {exact.length > 0 && <ErrorNote>That {exact[0].match} is already on "{exact[0].name}". Edit that part instead.</ErrorNote>}
      {exact.length === 0 && shownSimilar.length > 0 && <WarnNote>Similar parts: {shownSimilar.map((s) => s.name).join(', ')}. Make sure this isn't one of them.</WarnNote>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="SKU">{(id) => <Input id={id} value={f.sku} onChange={(e) => set('sku', e.target.value)} />}</Field>
        <Field label="Category">
          {(id) => (
            <Select id={id} value={f.category_id} onChange={(e) => set('category_id', e.target.value)}>
              <option value="">None</option>
              {refs.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Manufacturer">{(id) => <Input id={id} value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />}</Field>
        <Field label="Manufacturer part number">{(id) => <Input id={id} value={f.mfr_part_number} onChange={(e) => set('mfr_part_number', e.target.value)} />}</Field>
        <Field label="Barcode (UPC/EAN)">{(id) => <Input id={id} inputMode="numeric" value={f.barcode} onChange={(e) => set('barcode', e.target.value)} />}</Field>
        <Field label="Unit">{(id) => <Input id={id} value={f.uom} onChange={(e) => set('uom', e.target.value)} placeholder="ea, ft, gal" />}</Field>
        <Field label="Pack size" hint="Orders round up to this.">{(id) => <Input id={id} inputMode="decimal" value={f.pack_qty} onChange={(e) => set('pack_qty', e.target.value)} />}</Field>
        <Field label="List cost">{(id) => <Input id={id} inputMode="decimal" value={f.unit_cost} onChange={(e) => set('unit_cost', e.target.value)} />}</Field>
        <Field label="Lead time (days)">{(id) => <Input id={id} inputMode="numeric" value={f.lead_time_days} onChange={(e) => set('lead_time_days', e.target.value)} />}</Field>
        <Field label="ABC class">
          {(id) => (
            <Select id={id} value={f.abc_class} onChange={(e) => set('abc_class', e.target.value)}>
              <option value="">None</option>
              <option value="A">A</option>
              <option value="B">B</option>
              <option value="C">C</option>
            </Select>
          )}
        </Field>
        <Field label="Stale after (days)" hint="Blank uses the default.">{(id) => <Input id={id} inputMode="numeric" value={f.stale_days} onChange={(e) => set('stale_days', e.target.value)} />}</Field>
        <Field label="Photo">{(id) => <Input id={id} type="file" accept="image/*" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />}</Field>
      </div>
      <Field label="Description">{(id) => <Input id={id} value={f.description} onChange={(e) => set('description', e.target.value)} />}</Field>
      <Field label="Specs" hint={'Optional JSON, like {"voltage": "230V"}.'}>{(id) => <Input id={id} value={f.spec} onChange={(e) => set('spec', e.target.value)} />}</Field>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" className="size-4" checked={f.is_critical} onChange={(e) => set('is_critical', e.target.checked)} />
        Critical spare: running out can take a tunnel down
      </label>
      {error && <ErrorNote>{error}</ErrorNote>}
      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button disabled={busy || !f.name.trim() || exact.length > 0} onClick={() => void save()}>Save</Button>
      </div>
    </div>
  )
}
