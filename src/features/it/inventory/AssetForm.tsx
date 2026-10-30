import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Camera, ChevronDown, ChevronRight, Loader2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import type { Json } from '@/lib/database.types'
import { itInventory, type DuplicateHit, type ItAssetInsert, type ItAssetRow, type ItCustomField } from '@/lib/queries/itInventory'
import type { ItRefs } from './useItRefs'
import { fieldOptions, fieldsFor } from './customFields'
import { friendlyError, isIp, normalizeMac } from './format'

// Add, edit or clone an asset. Quick by default: site, category (or model) and
// a name are all it takes; everything else is under "More details". Add N
// identical units in one go (each gets its own tag). The database decides the
// tag, warranty end, category-from-model and enforces unique serial and MAC;
// this form warns about duplicates before saving so nobody is surprised.

export type AssetFormMode = 'add' | 'edit' | 'clone'

type Form = {
  location_id: string
  category_id: string
  model: string
  manufacturer: string
  name: string
  asset_tag: string
  quantity: string
  status_label_id: string
  area_id: string
  serial: string
  mac: string
  ip: string
  hostname: string
  purchase_date: string
  purchase_cost: string
  supplier: string
  order_number: string
  warranty_end_date: string
  notes: string
}

const MAX_UNITS = 50

function initialForm(mode: AssetFormMode, refs: ItRefs, siteId: string, asset?: ItAssetRow | null, tag?: string): Form {
  const defaultStatus = refs.statuses.find((s) => s.is_default)?.id ?? refs.statuses[0]?.id ?? ''
  if (!asset) {
    return {
      location_id: siteId, category_id: '', model: '', manufacturer: '', name: '', asset_tag: tag ?? '', quantity: '1',
      status_label_id: defaultStatus, area_id: '', serial: '', mac: '', ip: '', hostname: '', purchase_date: '',
      purchase_cost: '', supplier: '', order_number: '', warranty_end_date: '', notes: '',
    }
  }
  const model = asset.model_id ? refs.model.get(asset.model_id) : undefined
  const clone = mode === 'clone'
  return {
    location_id: asset.location_id,
    category_id: asset.category_id,
    model: model?.name ?? '',
    manufacturer: (model?.manufacturer_id && refs.manufacturer.get(model.manufacturer_id)?.name) || '',
    name: asset.name,
    asset_tag: clone ? '' : asset.asset_tag,
    quantity: '1',
    status_label_id: clone ? defaultStatus : asset.status_label_id,
    area_id: asset.area_id ?? '',
    serial: clone ? '' : asset.serial ?? '',
    // inet / macaddr arrive as text; the generated types say unknown.
    mac: clone ? '' : (asset.mac_address as string | null) ?? '',
    ip: clone ? '' : (asset.ip_address as string | null) ?? '',
    hostname: clone ? '' : asset.hostname ?? '',
    purchase_date: asset.purchase_date ?? '',
    purchase_cost: asset.purchase_cost != null ? String(asset.purchase_cost) : '',
    supplier: (asset.supplier_id && refs.supplier.get(asset.supplier_id)?.name) || '',
    order_number: asset.order_number ?? '',
    warranty_end_date: asset.warranty_end_manual ? asset.warranty_end_date ?? '' : '',
    notes: asset.notes ?? '',
  }
}

export function AssetForm({
  mode,
  refs,
  asset,
  initialTag,
  defaultSiteId,
  onClose,
  onSaved,
  onRefsChanged,
}: {
  mode: AssetFormMode
  refs: ItRefs
  asset?: ItAssetRow | null
  // A blank pre-printed sticker that was just scanned.
  initialTag?: string
  defaultSiteId?: string
  onClose: () => void
  onSaved: (created: { id: string; asset_tag: string }[]) => void
  // A new model, manufacturer or supplier was added along the way.
  onRefsChanged: () => void
}) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const [form, setForm] = useState<Form>(() =>
    initialForm(mode, refs, defaultSiteId ?? locations[0]?.id ?? '', asset, initialTag))
  const [more, setMore] = useState(mode !== 'add')
  // Custom field values as text while editing; secrets go to Vault on save.
  const [custom, setCustom] = useState<Record<string, string>>(() =>
    Object.fromEntries(Object.entries((asset?.custom_values as Record<string, unknown> | null) ?? {})
      .map(([k, v]) => [k, typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v ?? '')])))
  const [secrets, setSecrets] = useState<Record<string, string>>({})
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({})
  const admin = profile?.role === 'owner'
  const [photo, setPhoto] = useState<File | null>(null)
  const [dups, setDups] = useState<DuplicateHit[]>([])
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const photoUrl = useMemo(() => (photo ? URL.createObjectURL(photo) : null), [photo])
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl) }, [photoUrl])

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const assetCategories = refs.categories.filter((c) => c.kind === 'asset')
  const units = Math.max(1, Math.min(MAX_UNITS, Number(form.quantity) || 1))

  // The model the typed text points at, if it already exists.
  const matchedModel = useMemo(() => {
    const t = form.model.trim().toLowerCase()
    if (!t) return null
    const hits = refs.models.filter((m) => m.name.toLowerCase() === t && (!form.category_id || m.category_id === form.category_id))
    if (hits.length <= 1) return hits[0] ?? null
    const mf = form.manufacturer.trim().toLowerCase()
    return hits.find((m) => refs.manufacturer.get(m.manufacturer_id ?? '')?.name.toLowerCase() === mf) ?? hits[0]
  }, [form.model, form.category_id, form.manufacturer, refs])
  const newModel = !!form.model.trim() && !matchedModel
  const modelOptions = refs.models.filter((m) => !form.category_id || m.category_id === form.category_id)
  const modelWarrantyMonths = matchedModel?.default_warranty_months ?? null
  const areas = refs.areas.filter((a) => a.location_id === form.location_id)
  const cfs = fieldsFor(refs, matchedModel?.category_id ?? form.category_id, matchedModel?.id ?? (newModel ? null : asset?.model_id))

  const checkDuplicates = async () => {
    const mac = form.mac.trim() ? normalizeMac(form.mac) : null
    if (!form.serial.trim() && !mac) { setDups([]); return }
    const { data } = await itInventory.findDuplicates(form.serial.trim() || null, mac, mode === 'edit' ? asset?.id : null)
    setDups((data as DuplicateHit[] | null) ?? [])
  }

  const validate = (): boolean => {
    const e: Partial<Record<keyof Form, string>> = {}
    if (!form.location_id) e.location_id = 'Pick the site.'
    if (!form.category_id && !matchedModel) e.category_id = 'Pick a category or a model.'
    if (!form.name.trim() && !form.model.trim()) e.name = 'Give it a name or a model.'
    if (newModel && !form.category_id) e.model = 'New model: pick its category first.'
    if (form.mac.trim() && !normalizeMac(form.mac)) e.mac = "That doesn't look like a MAC address."
    if (form.ip.trim() && !isIp(form.ip)) e.ip = "That doesn't look like an IP address."
    if (form.purchase_cost.trim() && !Number.isFinite(Number(form.purchase_cost.replace(/[$,\s]/g, '')))) e.purchase_cost = 'Enter a dollar amount.'
    if (units > 1 && (form.serial.trim() || form.mac.trim() || form.asset_tag.trim())) {
      e.quantity = 'Leave tag, serial and MAC empty when adding several at once. Each one gets its own tag.'
    }
    setErrors(e)
    const ce: Record<string, string> = {}
    for (const f of cfs) {
      if (f.is_required && f.field_type !== 'secret' && !(custom[f.key] ?? '').trim()) ce[f.key] = 'Required.'
    }
    setCustomErrors(ce)
    if (Object.keys(ce).length) setMore(true)
    return Object.keys(e).length === 0 && Object.keys(ce).length === 0
  }

  // Non-secret values typed for this item's fields, merged over what it had.
  const customValues = (): Record<string, unknown> => {
    const out: Record<string, unknown> = { ...((asset?.custom_values as Record<string, unknown> | null) ?? {}) }
    for (const f of cfs) {
      if (f.field_type === 'secret') continue
      const v = (custom[f.key] ?? '').trim()
      if (!v) delete out[f.key]
      else out[f.key] = f.field_type === 'number' ? Number(v) : f.field_type === 'boolean' ? v === 'yes' : v
    }
    return out
  }
  const saveSecrets = async (ids: string[]) => {
    for (const f of cfs) {
      const v = secrets[f.id]
      if (f.field_type !== 'secret' || !v) continue
      for (const id of ids) {
        const { error: err } = await itInventory.setSecret(id, f.id, v)
        if (err) throw new Error(`Saved, but ${f.name} wasn't: ${err.message}`)
      }
    }
  }

  const save = async () => {
    if (!profile || !validate()) return
    if (dups.length) { setError('Fix the duplicate first, or open the existing item instead.'); return }
    setSaving(true)
    setError(null)
    try {
      let refsChanged = false
      // Model (and its manufacturer) typed in for the first time.
      let modelId = matchedModel?.id ?? null
      if (newModel) {
        let manufacturerId: string | null = null
        const mfText = form.manufacturer.trim()
        if (mfText) {
          const existing = refs.manufacturers.find((m) => m.name.toLowerCase() === mfText.toLowerCase())
          if (existing) manufacturerId = existing.id
          else {
            const { data, error: err } = await itInventory.addManufacturer(profile.account_id, mfText)
            if (err) throw new Error(err.message)
            manufacturerId = data.id
          }
        }
        const { data, error: err } = await itInventory.addModel({
          account_id: profile.account_id,
          category_id: form.category_id,
          manufacturer_id: manufacturerId,
          name: form.model.trim(),
        })
        if (err) throw new Error(err.message)
        modelId = data.id
        refsChanged = true
      }
      let supplierId: string | null = null
      const spText = form.supplier.trim()
      if (spText) {
        const existing = refs.suppliers.find((s) => s.name.toLowerCase() === spText.toLowerCase())
        if (existing) supplierId = existing.id
        else {
          const { data, error: err } = await itInventory.addSupplier(profile.account_id, spText)
          if (err) throw new Error(err.message)
          supplierId = data.id
          refsChanged = true
        }
      }

      const fields = {
        location_id: form.location_id,
        category_id: matchedModel?.category_id ?? form.category_id,
        model_id: modelId,
        name: form.name.trim(),
        status_label_id: form.status_label_id,
        area_id: form.area_id || null,
        serial: form.serial.trim() || null,
        mac_address: form.mac.trim() ? normalizeMac(form.mac) : null,
        ip_address: form.ip.trim() || null,
        hostname: form.hostname.trim() || null,
        purchase_date: form.purchase_date || null,
        purchase_cost: form.purchase_cost.trim() ? Number(form.purchase_cost.replace(/[$,\s]/g, '')) : null,
        supplier_id: supplierId,
        order_number: form.order_number.trim() || null,
        // Empty = follow the model's warranty from the purchase date.
        warranty_end_date: form.warranty_end_date || null,
        notes: form.notes.trim() || null,
        custom_values: customValues() as Json,
      }

      if (mode === 'edit' && asset) {
        const { error: err } = await itInventory.updateAsset(asset.id, fields)
        if (err) throw new Error(err.message)
        await saveSecrets([asset.id])
        if (refsChanged) onRefsChanged()
        onSaved([{ id: asset.id, asset_tag: asset.asset_tag }])
        return
      }

      const rows: ItAssetInsert[] = Array.from({ length: units }, () => ({
        ...fields,
        account_id: profile.account_id,
        asset_tag: form.asset_tag.trim().toUpperCase(),
      }))
      const { data, error: err } = await itInventory.createAssets(rows)
      if (err || !data) throw new Error(err?.message ?? 'Could not save.')
      await saveSecrets(data.map((d) => d.id))
      if (photo && data.length === 1) {
        const up = await itInventory.uploadAssetPhoto(profile.account_id, data[0].id, form.location_id, await shrinkPhoto(photo))
        if (up.error) setError(`Saved, but the photo didn't upload: ${up.error}`)
      }
      if (refsChanged) onRefsChanged()
      onSaved(data)
    } catch (e) {
      setError(friendlyError(e instanceof Error ? e.message : String(e)))
    } finally {
      setSaving(false)
    }
  }

  const title = mode === 'edit' ? `Edit ${asset?.asset_tag ?? ''}` : mode === 'clone' ? `Clone ${asset?.asset_tag ?? ''}` : 'Add equipment'
  const saveLabel = mode === 'edit' ? 'Save changes' : units > 1 ? `Add ${units}` : 'Add'

  return (
    <Modal open onClose={onClose} size="lg" title={title}
      description={mode === 'add' ? 'Site, category and a name are all you need. Add the rest now or later.' : undefined}>
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Site" required error={errors.location_id}>
            {(id) => (
              <Select id={id} value={form.location_id} disabled={mode === 'edit' && !!asset?.assigned_type}
                onChange={(e) => setForm((f) => ({ ...f, location_id: e.target.value, area_id: '' }))} invalid={!!errors.location_id}>
                <option value="">Pick a site</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Category" required={!matchedModel} error={errors.category_id}>
            {(id) => (
              <Select id={id} value={matchedModel?.category_id ?? form.category_id} onChange={set('category_id')}
                disabled={!!matchedModel} invalid={!!errors.category_id}>
                <option value="">Pick a category</option>
                {assetCategories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Model" error={errors.model}
            hint={newModel ? 'New model. It will be saved for next time.' : matchedModel ? 'Category comes from the model.' : 'Start typing to pick one you have used before.'}>
            {(id) => (
              <>
                <Input id={id} list="it-models" value={form.model} onChange={set('model')} placeholder="e.g. XPT pay station" autoComplete="off" />
                <datalist id="it-models">
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.name}>{refs.manufacturer.get(m.manufacturer_id ?? '')?.name ?? ''}</option>
                  ))}
                </datalist>
              </>
            )}
          </Field>
          {newModel ? (
            <Field label="Manufacturer" hint="Optional">
              {(id) => (
                <>
                  <Input id={id} list="it-manufacturers" value={form.manufacturer} onChange={set('manufacturer')} autoComplete="off" />
                  <datalist id="it-manufacturers">
                    {refs.manufacturers.map((m) => <option key={m.id} value={m.name} />)}
                  </datalist>
                </>
              )}
            </Field>
          ) : (
            <div className="hidden sm:block" />
          )}
          <Field label="Name" required={!form.model.trim()} error={errors.name}
            hint={!form.name.trim() && form.model.trim() ? `Will be "${form.model.trim()}"` : undefined} className="sm:col-span-2">
            {(id) => (
              <Input id={id} value={form.name} onChange={set('name')} invalid={!!errors.name}
                placeholder="e.g. Pay Lane 1 pay station" />
            )}
          </Field>
          {mode !== 'edit' && (
            <Field label="Sticker tag" hint={form.asset_tag ? 'From the sticker you scanned.' : 'Leave blank and we make the next one.'}>
              {(id) => (
                <Input id={id} value={form.asset_tag} onChange={set('asset_tag')} className="font-mono uppercase"
                  placeholder={refs.settings.tag_prefix + '-' + '0'.repeat(refs.settings.tag_padding - 1) + '1'} disabled={units > 1} />
              )}
            </Field>
          )}
          {mode !== 'edit' && (
            <Field label="How many?" error={errors.quantity} hint="Identical units, each with its own tag.">
              {(id) => (
                <Input id={id} type="number" min={1} max={MAX_UNITS} inputMode="numeric" value={form.quantity} onChange={set('quantity')} />
              )}
            </Field>
          )}
        </div>

        {mode === 'add' && units === 1 && (
          <div>
            <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
            {photo ? (
              <div className="flex items-center gap-3 rounded-md border border-border p-2">
                {photoUrl && <img src={photoUrl} alt="" className="size-14 rounded-md object-cover" />}
                <span className="min-w-0 flex-1 truncate text-sm text-ink">{photo.name}</span>
                <button type="button" onClick={() => setPhoto(null)} aria-label="Remove photo"
                  className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content"><X className="size-4" /></button>
              </div>
            ) : (
              <Button variant="secondary" size="sm" onClick={() => photoInput.current?.click()}>
                <Camera className="size-4" /> Add a photo
              </Button>
            )}
          </div>
        )}

        <button type="button" onClick={() => setMore((v) => !v)}
          className="flex items-center gap-1 text-sm font-medium text-accent hover:underline">
          {more ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />} More details
        </button>

        {more && (
          <div className="space-y-4">
            <Section title="Where and status">
              <Field label="Area">
                {(id) => (
                  <Select id={id} value={form.area_id} onChange={set('area_id')}>
                    <option value="">No area</option>
                    {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                  </Select>
                )}
              </Field>
              <Field label="Status">
                {(id) => (
                  <Select id={id} value={form.status_label_id} onChange={set('status_label_id')}>
                    {refs.statuses.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </Select>
                )}
              </Field>
            </Section>
            <Section title="Identity">
              <Field label="Serial number">
                {(id) => <Input id={id} value={form.serial} onChange={set('serial')} onBlur={() => void checkDuplicates()} className="font-mono" disabled={units > 1} />}
              </Field>
              <Field label="MAC address" error={errors.mac}>
                {(id) => (
                  <Input id={id} value={form.mac} onChange={set('mac')} onBlur={() => void checkDuplicates()} className="font-mono"
                    placeholder="aa:bb:cc:dd:ee:ff" invalid={!!errors.mac} disabled={units > 1} />
                )}
              </Field>
              <Field label="IP address" error={errors.ip} hint="IPs change. Serial and MAC are what identify a device.">
                {(id) => <Input id={id} value={form.ip} onChange={set('ip')} className="font-mono" placeholder="192.168.1.20" invalid={!!errors.ip} />}
              </Field>
              <Field label="Hostname">
                {(id) => <Input id={id} value={form.hostname} onChange={set('hostname')} className="font-mono" />}
              </Field>
            </Section>
            <Section title="Purchase and warranty">
              <Field label="Purchase date">
                {(id) => <Input id={id} type="date" value={form.purchase_date} onChange={set('purchase_date')} />}
              </Field>
              <Field label="Cost" error={errors.purchase_cost}>
                {(id) => <Input id={id} value={form.purchase_cost} onChange={set('purchase_cost')} inputMode="decimal" placeholder="$0.00" />}
              </Field>
              <Field label="Bought from">
                {(id) => (
                  <>
                    <Input id={id} list="it-suppliers" value={form.supplier} onChange={set('supplier')} autoComplete="off" />
                    <datalist id="it-suppliers">{refs.suppliers.map((s) => <option key={s.id} value={s.name} />)}</datalist>
                  </>
                )}
              </Field>
              <Field label="Order number">
                {(id) => <Input id={id} value={form.order_number} onChange={set('order_number')} />}
              </Field>
              <Field label="Warranty ends"
                hint={modelWarrantyMonths != null ? `Leave blank to use the model's ${modelWarrantyMonths}-month warranty from the purchase date.` : 'Leave blank if you don\'t know.'}>
                {(id) => <Input id={id} type="date" value={form.warranty_end_date} onChange={set('warranty_end_date')} />}
              </Field>
            </Section>
            {cfs.some((f) => f.field_type !== 'secret' || admin) && (
              <Section title="Details">
                {cfs.map((f) => (f.field_type === 'secret' && !admin ? null : (
                  <Field key={f.id} label={f.name} required={f.is_required && f.field_type !== 'secret'}
                    hint={f.field_type === 'secret' ? (mode === 'edit' ? "Hidden. Leave blank to keep what's saved." : 'Only admins can see this.') : f.help_text ?? undefined}
                    error={customErrors[f.key]}>
                    {(id) => <CustomInput id={id} field={f}
                      value={f.field_type === 'secret' ? secrets[f.id] ?? '' : custom[f.key] ?? ''}
                      onChange={(v) => (f.field_type === 'secret'
                        ? setSecrets((s) => ({ ...s, [f.id]: v }))
                        : setCustom((c) => ({ ...c, [f.key]: v })))} />}
                  </Field>
                )))}
              </Section>
            )}
            <Field label="Notes">
              {(id) => (
                <textarea id={id} value={form.notes} onChange={set('notes')} rows={3}
                  placeholder="Anything worth knowing: quirks, what it connects to, who to call"
                  className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
              )}
            </Field>
          </div>
        )}

        {dups.length > 0 && (
          <div className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            {dups.map((d) => (
              <div key={d.field + d.asset_tag} className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>
                  That {d.field === 'mac' ? 'MAC address' : 'serial number'} is already on {d.asset_tag}
                  {d.asset_name ? ` ${d.asset_name}` : ''} at {d.site_name}.{' '}
                  {d.can_open && d.asset_id && (
                    <Link to={`/app/it-inventory/${d.asset_id}`} onClick={onClose} className="font-medium underline">Open it</Link>
                  )}
                </span>
              </div>
            ))}
          </div>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} {saveLabel}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function CustomInput({ id, field, value, onChange }: { id: string; field: ItCustomField; value: string; onChange: (v: string) => void }) {
  const t = field.field_type
  if (t === 'boolean') {
    return (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option><option value="yes">Yes</option><option value="no">No</option>
      </Select>
    )
  }
  if (t === 'select') {
    return (
      <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Not set</option>
        {fieldOptions(field).map((o) => <option key={o} value={o}>{o}</option>)}
      </Select>
    )
  }
  return (
    <Input id={id} value={value} onChange={(e) => onChange(e.target.value)} autoComplete="off"
      type={t === 'number' ? 'number' : t === 'date' ? 'date' : t === 'url' ? 'url' : t === 'secret' ? 'password' : 'text'}
      inputMode={t === 'number' ? 'decimal' : undefined} className={t === 'ip' || t === 'secret' ? 'font-mono' : undefined} />
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}
