import { useState, type ReactNode } from 'react'
import { CheckCircle2, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { itInventory, type ItAssetPatch, type ItAssetRow } from '@/lib/queries/itInventory'
import { assetTag, categoryOf, IT_CATEGORIES, IT_GROUPS, IT_STATUSES } from './itInventorySchema'

// Add or edit one IT Inventory record. Labels follow the category's kind: a
// service reuses serial_number as its account or circuit number, model as its
// plan and vendor as its provider, so one set of columns covers a laptop and an
// internet circuit alike. Mount it fresh per use (the parent renders it
// conditionally) so the form always starts from the record it was opened with.

const TEXT_KEYS = [
  'name', 'placement', 'assigned_to', 'manufacturer', 'model', 'serial_number', 'hostname',
  'ip_address', 'mac_address', 'operating_system', 'remote_access_id', 'vendor', 'purchase_date',
  'purchase_cost', 'warranty_expires', 'monthly_cost', 'renewal_date', 'notes',
] as const
type TextKey = (typeof TEXT_KEYS)[number]
type Form = Record<TextKey, string> & { category: string; status: string; location_id: string }

// What differs from one unit to the next. "Save and add another" clears these
// and keeps the rest, so entering ten identical cameras is mostly the serials.
const PER_UNIT: TextKey[] = ['serial_number', 'hostname', 'ip_address', 'mac_address', 'remote_access_id', 'assigned_to']

function toForm(a: Partial<ItAssetRow> | null | undefined, siteId: string): Form {
  const f = Object.fromEntries(TEXT_KEYS.map((k) => [k, a?.[k] == null ? '' : String(a[k])])) as Record<TextKey, string>
  return {
    ...f,
    category: a?.category ?? 'computer',
    status: a?.status ?? 'in_use',
    location_id: a ? a.location_id ?? '' : siteId,
  }
}

function toPatch(f: Form): ItAssetPatch {
  const text = (k: TextKey) => f[k].trim() || null
  const money = (k: TextKey) => {
    const n = Number(f[k].replace(/[$,\s]/g, ''))
    return f[k].trim() && Number.isFinite(n) ? n : null
  }
  return {
    name: f.name.trim(),
    category: f.category,
    status: f.status,
    location_id: f.location_id || null,
    placement: text('placement'),
    assigned_to: text('assigned_to'),
    manufacturer: text('manufacturer'),
    model: text('model'),
    serial_number: text('serial_number'),
    hostname: text('hostname'),
    ip_address: text('ip_address'),
    mac_address: f.mac_address.trim().toUpperCase() || null,
    operating_system: text('operating_system'),
    remote_access_id: text('remote_access_id'),
    vendor: text('vendor'),
    purchase_date: text('purchase_date'),
    purchase_cost: money('purchase_cost'),
    warranty_expires: text('warranty_expires'),
    monthly_cost: money('monthly_cost'),
    renewal_date: text('renewal_date'),
    notes: text('notes'),
  }
}

export function ItAssetModal({
  asset,
  copyFrom,
  defaultSiteId = '',
  onClose,
  onSaved,
}: {
  // Editing this record. Without it the modal adds a new one.
  asset?: ItAssetRow | null
  // New record pre-filled from another (Duplicate), minus its per-unit details.
  copyFrom?: ItAssetRow | null
  defaultSiteId?: string
  onClose: () => void
  onSaved: (id: string) => void
}) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const editing = !!asset
  const [form, setForm] = useState<Form>(() => {
    if (asset) return toForm(asset, defaultSiteId)
    const f = toForm(copyFrom, defaultSiteId)
    if (copyFrom) for (const k of PER_UNIT) f[k] = ''
    return f
  })
  // New records default to "I'm looking at it", which stamps the in-person check.
  const [checkedNow, setCheckedNow] = useState(!asset)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])

  const cat = categoryOf(form.category)
  const service = cat.kind === 'service'
  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const text = (k: TextKey, label: string, opts?: { placeholder?: string; hint?: string; type?: string; mono?: boolean }) => (
    <Field label={label} hint={opts?.hint}>
      {(id) => (
        <Input id={id} type={opts?.type ?? 'text'} value={form[k]} onChange={set(k)} placeholder={opts?.placeholder}
          inputMode={k === 'purchase_cost' || k === 'monthly_cost' ? 'decimal' : undefined}
          className={opts?.mono ? 'font-mono' : undefined} />
      )}
    </Field>
  )

  const save = async (another: boolean) => {
    if (!profile) return
    if (!form.name.trim()) { setError('Give it a name.'); return }
    setSaving(true)
    setError(null)
    const patch = toPatch(form)
    if (checkedNow) patch.last_verified_at = new Date().toISOString()
    if (asset) {
      const { error: err } = await itInventory.update(asset.id, patch)
      setSaving(false)
      if (err) { setError(err.message); return }
      onSaved(asset.id)
      return
    }
    const { data, error: err } = await itInventory.create({ ...patch, name: form.name.trim(), account_id: profile.account_id })
    setSaving(false)
    if (err || !data) { setError(err?.message ?? 'Could not save.'); return }
    if (!another) { onSaved(data.id); return }
    setAdded((a) => [...a, `${assetTag(data.asset_number)} ${form.name.trim()}`])
    setForm((f) => {
      const next = { ...f }
      for (const k of PER_UNIT) next[k] = ''
      return next
    })
  }

  return (
    <Modal
      open
      onClose={() => (added.length ? onSaved('') : onClose())}
      size="lg"
      title={asset ? `Edit ${assetTag(asset.asset_number)}` : copyFrom ? 'Duplicate item' : 'Add to IT inventory'}
      description={asset ? asset.name : 'Gear or a recurring service. Only a name and category are required.'}
    >
      <div className="space-y-5">
        {added.length > 0 && (
          <div className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
            <div className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="size-4" /> Added {added.length}</div>
            <div className="mt-0.5 text-xs">{added.slice(-3).join(' · ')}</div>
          </div>
        )}

        <Section title="Basics">
          <div className="sm:col-span-2">
            {text('name', 'Name', { placeholder: service ? 'e.g. Spectrum business internet' : 'e.g. Manager office PC' })}
          </div>
          <Field label="Category" required>
            {(id) => (
              <Select id={id} value={form.category} onChange={set('category')}>
                {IT_GROUPS.map((g) => (
                  <optgroup key={g} label={g}>
                    {IT_CATEGORIES.filter((c) => c.group === g).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Status">
            {(id) => (
              <Select id={id} value={form.status} onChange={set('status')}>
                {IT_STATUSES.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Site">
            {(id) => (
              <Select id={id} value={form.location_id} onChange={set('location_id')}>
                <option value="">No site (office or storage)</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          {text('placement', service ? 'Where it terminates' : 'Where at the site', {
            placeholder: service ? 'e.g. Equipment room' : 'e.g. Manager office, Pay station 2',
          })}
          {text('assigned_to', 'Assigned to', { placeholder: 'Person who has it, if anyone' })}
        </Section>

        {service ? (
          <Section title="Service">
            {text('vendor', 'Provider', { placeholder: 'e.g. Spectrum, Verizon, Microsoft' })}
            {text('model', 'Plan', { placeholder: 'e.g. 500 Mbps business' })}
            {text('serial_number', 'Account or circuit #', { mono: true })}
            {form.category === 'internet' && text('ip_address', 'Static IP', { mono: true })}
          </Section>
        ) : (
          <>
            <Section title="Hardware">
              {text('manufacturer', 'Manufacturer', { placeholder: 'e.g. Dell, Ubiquiti, Axis' })}
              {text('model', 'Model')}
              {text('serial_number', 'Serial number', { mono: true })}
            </Section>
            <Section title="Network & access">
              {text('hostname', 'Hostname', { mono: true })}
              {text('ip_address', 'IP address', { mono: true, placeholder: '192.168.1.20' })}
              {text('mac_address', 'MAC address', { mono: true, placeholder: 'AA:BB:CC:DD:EE:FF' })}
              {text('operating_system', 'Operating system', { placeholder: 'e.g. Windows 11 Pro' })}
              <div className="sm:col-span-2">
                {text('remote_access_id', 'Remote access ID', {
                  mono: true,
                  hint: 'TeamViewer, AnyDesk or similar ID. Never store passwords here.',
                })}
              </div>
            </Section>
          </>
        )}

        <Section title={service ? 'Cost & renewal' : 'Cost & coverage'}>
          {!service && text('vendor', 'Bought from')}
          {text('purchase_date', service ? 'Start date' : 'Purchase date', { type: 'date' })}
          {!service && text('purchase_cost', 'Purchase cost', { placeholder: '$0.00' })}
          {!service && text('warranty_expires', 'Warranty expires', { type: 'date' })}
          {text('monthly_cost', 'Monthly cost', {
            placeholder: '$0.00',
            hint: service ? undefined : 'Lease or support plan, if any',
          })}
          {text('renewal_date', 'Renews on', { type: 'date' })}
        </Section>

        <Field label="Notes">
          {(id) => (
            <textarea id={id} value={form.notes} onChange={set('notes')} rows={3}
              placeholder="Anything worth knowing: quirks, what it connects to, who to call"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
          )}
        </Field>

        {!service && (
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" checked={checkedNow} onChange={(e) => setCheckedNow(e.target.checked)}
              className="mt-0.5 size-4 rounded border-border text-accent focus:ring-accent" />
            <span>
              I'm looking at it right now
              <span className="block text-xs text-ink-muted">Records an in-person check, so it won't show as unchecked.</span>
            </span>
          </label>
        )}

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={() => (added.length ? onSaved('') : onClose())} disabled={saving}>
            {added.length ? 'Done' : 'Cancel'}
          </Button>
          {!editing && (
            <Button variant="secondary" onClick={() => void save(true)} disabled={saving}>
              Save and add another
            </Button>
          )}
          <Button onClick={() => void save(false)} disabled={saving}>
            {saving && <Loader2 className="size-4 animate-spin" />} {editing ? 'Save changes' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{title}</legend>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  )
}
