import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi, type AssetRow } from '@/lib/queries/maintenanceInventory'
import { miEquipment, type EquipmentDetail, type EquipmentInput, type UsageBasis } from '@/lib/queries/miEquipment'
import { useMi } from '../context'
import { errText } from '../format'
import { ErrorNote, WarnNote } from '../ui'
import { CRIT, shortName, STATUS, USAGE_BASIS } from './format'

// Add, edit or clone a machine. Zones are typed by name: a new name makes that zone at
// the site. "Part of" makes it a component of another machine at the same site.

export type FormMode =
  | { mode: 'add'; siteId?: string; parentId?: string; preset?: Partial<EquipmentInput> }
  | { mode: 'edit'; detail: EquipmentDetail }
  | { mode: 'clone'; detail: EquipmentDetail }

type Saved = { ids: Array<{ id: string; name: string }>; message: string }

export function EquipmentForm({ m, onClose, onSaved }: { m: FormMode; onClose: () => void; onSaved: (s: Saved) => void }) {
  if (m.mode === 'clone') return <CloneForm d={m.detail} onClose={onClose} onSaved={onSaved} />
  return <EditForm m={m} onClose={onClose} onSaved={onSaved} />
}

function EditForm({ m, onClose, onSaved }: { m: Exclude<FormMode, { mode: 'clone' }>; onClose: () => void; onSaved: (s: Saved) => void }) {
  const { refs } = useMi()
  const a = m.mode === 'edit' ? m.detail.asset : null
  const [site, setSite] = useState(a?.location_id ?? (m.mode === 'add' ? m.siteId : undefined) ?? refs.sites[0]?.id ?? '')
  const [f, setF] = useState(() => ({
    name: a?.name ?? (m.mode === 'add' ? m.preset?.name ?? '' : ''),
    type: a?.type ?? (m.mode === 'add' ? m.preset?.type ?? '' : ''),
    description: a?.description ?? '',
    status: (a?.status && a.status !== 'retired' ? a.status : 'online') as Exclude<EquipmentInput['status'], undefined>,
    parent_asset_id: a?.parent_asset_id ?? (m.mode === 'add' ? m.parentId ?? '' : ''),
    area_name: a?.area_name ?? (m.mode === 'add' ? m.preset?.area_name ?? '' : ''),
    crit_class: a?.crit_class ?? '',
    vendor_id: a?.vendor_id ?? '',
    manufacturer: a?.manufacturer ?? '',
    model: a?.model ?? '',
    serial_number: a?.serial_number ?? '',
    purchase_date: a?.purchase_date ?? '',
    install_date: a?.install_date ?? '',
    warranty_expiry: a?.warranty_expiry ?? '',
    usage_basis: (a?.usage_basis ?? 'all_cars') as UsageBasis,
  }))
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  const [siteRows, setSiteRows] = useState<AssetRow[]>([])
  const [zones, setZones] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!site) return
    let alive = true
    void Promise.all([mi.assets(site), mi.areas(site)]).then(([rows, areas]) => {
      if (!alive) return
      setSiteRows(rows)
      setZones(areas.map((x) => x.name))
    }).catch(() => {})
    return () => { alive = false }
  }, [site])

  // A machine can't sit under itself or one of its own components.
  const parents = useMemo(() => {
    if (!a) return siteRows.filter((r) => r.status !== 'retired')
    const below = new Set<string>([a.id])
    let grew = true
    while (grew) {
      grew = false
      for (const r of siteRows) if (r.parent_id && below.has(r.parent_id) && !below.has(r.id)) { below.add(r.id); grew = true }
    }
    return siteRows.filter((r) => !below.has(r.id) && r.status !== 'retired')
  }, [siteRows, a])
  const types = useMemo(() => [...new Set(siteRows.map((r) => r.type).filter((t): t is string => !!t))].sort(), [siteRows])
  const typeChanged = !!a && (a.type ?? '') !== f.type

  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      const p: EquipmentInput = {
        ...(a ? { id: a.id } : { location_id: site }),
        name: f.name, type: f.type || null, description: f.description || null, status: f.status,
        parent_asset_id: f.parent_asset_id || null, crit_class: f.crit_class || null, vendor_id: f.vendor_id || null,
        manufacturer: f.manufacturer || null, model: f.model || null, serial_number: f.serial_number || null,
        purchase_date: f.purchase_date || null, install_date: f.install_date || null, warranty_expiry: f.warranty_expiry || null,
        usage_basis: f.usage_basis,
      }
      if (f.area_name.trim()) p.area_name = f.area_name.trim()
      else p.area_id = null
      const r = await miEquipment.save(p)
      onSaved({ ids: [r], message: a ? 'Saved.' : `Added ${r.name}.` })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={a ? `Edit ${shortName(a.name)}` : 'Add equipment'} size="lg">
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Site" required>
            {(id) => (
              <Select id={id} value={site} disabled={!!a} onChange={(e) => { setSite(e.target.value); set('parent_asset_id', '') }}>
                {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Name" required>{(id) => <Input id={id} value={f.name} onChange={(e) => set('name', e.target.value)} placeholder="#02 - Top Brush 1" autoFocus={!a} />}</Field>
          <Field label="Type" hint="The same machine at every site shares a type, like Top Brush 1.">
            {(id) => (
              <>
                <Input id={id} list="mi-equipment-types" value={f.type} onChange={(e) => set('type', e.target.value)} />
                <datalist id="mi-equipment-types">{types.map((t) => <option key={t} value={t} />)}</datalist>
              </>
            )}
          </Field>
          <Field label="Part of" hint="Leave empty for a machine on its own.">
            {(id) => (
              <Select id={id} value={f.parent_asset_id} onChange={(e) => set('parent_asset_id', e.target.value)}>
                <option value="">Nothing, it's a machine</option>
                {parents.filter((r) => !r.parent_id).map((r) => <option key={r.id} value={r.id}>{shortName(r.name)}</option>)}
                {parents.some((r) => r.parent_id) && (
                  <optgroup label="Components">
                    {parents.filter((r) => r.parent_id).map((r) => <option key={r.id} value={r.id}>{shortName(r.name)}</option>)}
                  </optgroup>
                )}
              </Select>
            )}
          </Field>
          <Field label="Zone">
            {(id) => (
              <>
                <Input id={id} list="mi-form-zones" value={f.area_name} onChange={(e) => set('area_name', e.target.value)} placeholder="Wash" />
                <datalist id="mi-form-zones">{zones.map((z) => <option key={z} value={z} />)}</datalist>
              </>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={f.status} onChange={(e) => set('status', e.target.value as typeof f.status)}>
                {(['online', 'offline_planned', 'offline_unplanned'] as const).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Criticality">
            {(id) => (
              <Select id={id} value={f.crit_class} onChange={(e) => set('crit_class', e.target.value)}>
                <option value="">Not set</option>
                {(['A', 'B', 'C'] as const).map((c) => <option key={c} value={c}>{CRIT[c].label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Vendor">
            {(id) => (
              <Select id={id} value={f.vendor_id} onChange={(e) => set('vendor_id', e.target.value)}>
                <option value="">None</option>
                {refs.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Manufacturer">{(id) => <Input id={id} value={f.manufacturer} onChange={(e) => set('manufacturer', e.target.value)} />}</Field>
          <Field label="Model">{(id) => <Input id={id} value={f.model} onChange={(e) => set('model', e.target.value)} />}</Field>
          <Field label="Serial">{(id) => <Input id={id} value={f.serial_number} onChange={(e) => set('serial_number', e.target.value)} />}</Field>
          <Field label="Installed" hint="Its use counter starts here.">{(id) => <Input id={id} type="date" value={f.install_date} onChange={(e) => set('install_date', e.target.value)} />}</Field>
          <Field label="Bought">{(id) => <Input id={id} type="date" value={f.purchase_date} onChange={(e) => set('purchase_date', e.target.value)} />}</Field>
          <Field label="Warranty until">{(id) => <Input id={id} type="date" value={f.warranty_expiry} onChange={(e) => set('warranty_expiry', e.target.value)} />}</Field>
          <Field label="Count its use by" className="sm:col-span-2">
            {(id) => (
              <Select id={id} value={f.usage_basis} onChange={(e) => set('usage_basis', e.target.value as UsageBasis)}>
                {(Object.keys(USAGE_BASIS) as UsageBasis[]).map((k) => <option key={k} value={k}>{USAGE_BASIS[k]}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            {(id) => (
              <textarea id={id} value={f.description} onChange={(e) => set('description', e.target.value)} rows={2}
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none" />
            )}
          </Field>
        </div>
        {typeChanged && (
          <WarnNote>Type is how this machine matches the same machine at other sites: tunnel diagrams link by it, and schedules copied between sites use it. Change it only to fix a mistake.</WarnNote>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy || !f.name.trim() || !site} onClick={() => void save()}>{busy && <Loader2 className="size-4 animate-spin" />} {a ? 'Save' : 'Add'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function CloneForm({ d, onClose, onSaved }: { d: EquipmentDetail; onClose: () => void; onSaved: (s: Saved) => void }) {
  const [count, setCount] = useState(1)
  const [withChildren, setWithChildren] = useState(true)
  const [names, setNames] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const a = d.asset
  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      const list = names.split('\n').map((x) => x.trim()).filter(Boolean)
      const made = await miEquipment.clone(a.id, count, withChildren, list.length ? list : undefined)
      onSaved({ ids: made, message: `Made ${made.length} cop${made.length === 1 ? 'y' : 'ies'} of ${shortName(a.name)}.` })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open onClose={onClose} title={`Clone ${shortName(a.name)}`} description="Copies the type, zone, criticality, make, model and parts list. Serial numbers, dates and stickers start blank." size="sm">
      <div className="flex flex-col gap-3">
        <Field label="How many">{(id) => <Input id={id} type="number" min={1} max={50} value={count} onChange={(e) => setCount(Math.max(1, Math.min(50, Number(e.target.value) || 1)))} />}</Field>
        {d.children.length > 0 && (
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={withChildren} onChange={(e) => setWithChildren(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent" />
            Copy its {d.children.length} component{d.children.length === 1 ? '' : 's'} too
          </label>
        )}
        <Field label="Names (optional)" hint="One per line. Leave empty for numbered copies.">
          {(id) => (
            <textarea id={id} value={names} onChange={(e) => setNames(e.target.value)} rows={3} placeholder={`${a.name} (copy)`}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none" />
          )}
        </Field>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button disabled={busy} onClick={() => void run()}>{busy && <Loader2 className="size-4 animate-spin" />} Clone</Button>
        </div>
      </div>
    </Modal>
  )
}
