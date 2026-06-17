import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { assets, type Asset, type AssetRow, type AssetCriticality, type AssetStatus } from '@/lib/queries/assets'
import { cn } from '@/lib/utils'

const CRITICALITY_OPTS: Array<{ value: AssetCriticality; label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' }> = [
  { value: 'none', label: 'Normal', tone: 'neutral' },
  { value: 'low', label: 'Low', tone: 'ok' },
  { value: 'medium', label: 'Important', tone: 'warn' },
  { value: 'high', label: 'Critical', tone: 'danger' },
]

const STATUS_OPTS: Array<{ value: AssetStatus; label: string }> = [
  { value: 'online', label: 'Online' },
  { value: 'offline_planned', label: 'Offline (Planned)' },
  { value: 'offline_unplanned', label: 'Offline (Unplanned)' },
  { value: 'retired', label: 'Retired' },
]

type FormProps = {
  initial?: Partial<Asset>
  allAssets?: AssetRow[]
  onClose: () => void
  onSaved: (id: string) => void
  mode: 'create' | 'edit'
}

function AssetForm({ initial, allAssets, onClose, onSaved, mode }: FormProps) {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()

  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState(initial?.type ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [locationId, setLocationId] = useState(initial?.location_id ?? activeLocation?.id ?? '')
  const [parentId, setParentId] = useState<string>((initial?.parent_asset_id as string | undefined) ?? '')
  const [criticality, setCriticality] = useState<AssetCriticality>((initial?.criticality as AssetCriticality) ?? 'none')
  const [status, setStatus] = useState<AssetStatus>((initial?.status as AssetStatus) ?? 'online')
  const [manufacturer, setManufacturer] = useState(initial?.manufacturer ?? '')
  const [model, setModel] = useState(initial?.model ?? '')
  const [serial, setSerial] = useState(initial?.serial_number ?? '')
  const [purchase, setPurchase] = useState((initial?.purchase_date as string | null) ?? '')
  const [warranty, setWarranty] = useState((initial?.warranty_expiry as string | null) ?? '')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!name.trim()) return setError('Enter a name')
    if (!locationId) return setError('Pick a location')
    if (!profile) return
    setBusy(true)

    const payload = {
      account_id: profile.account_id,
      location_id: locationId,
      name: name.trim(),
      type: type.trim() || null,
      description: description.trim() || null,
      parent_asset_id: parentId || null,
      criticality,
      status,
      manufacturer: manufacturer.trim() || null,
      model: model.trim() || null,
      serial_number: serial.trim() || null,
      purchase_date: purchase || null,
      warranty_expiry: warranty || null,
    }

    if (mode === 'edit' && initial?.id) {
      const { data, error: err } = await assets.update(initial.id, payload)
      setBusy(false)
      if (err || !data) return setError(err?.message ?? 'Save failed')
      onSaved(data.id)
    } else {
      const { data, error: err } = await assets.create(payload)
      setBusy(false)
      if (err || !data) return setError(err?.message ?? 'Could not create asset')
      onSaved(data.id)
    }
  }

  const parentOptions = (allAssets ?? []).filter((a) => a.id !== initial?.id)

  return (
    <Modal open onClose={onClose} title={mode === 'edit' ? `Edit ${initial?.name ?? 'Asset'}` : 'New Asset'} size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Air Comp 1" />}</Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Asset Type" hint="e.g. Air Compressor, Blower, Pump">
            {(id) => <Input id={id} value={type ?? ''} onChange={(e) => setType(e.target.value)} />}
          </Field>
          <Field label="Location" required>
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Choose...</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
        </div>

        {allAssets && allAssets.length > 0 && (
          <Field label="Parent Asset" hint="Pick a parent to make this a sub-asset">
            {(id) => (
              <Select id={id} value={parentId} onChange={(e) => setParentId(e.target.value)}>
                <option value="">No parent (this is a root asset)</option>
                {parentOptions.map((a) => (
                  <option key={a.id} value={a.id}>#{a.asset_number} . {a.name}</option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Criticality</div>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {CRITICALITY_OPTS.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => setCriticality(o.value)}
                className={cn(
                  'border-l border-border px-4 py-1.5 text-sm font-medium first:border-l-0',
                  criticality === o.value
                    ? (o.tone === 'danger' ? 'bg-danger-soft text-danger' : o.tone === 'warn' ? 'bg-warn-soft text-warn' : o.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent')
                    : 'bg-card text-ink-muted hover:text-ink',
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Manufacturer">{(id) => <Input id={id} value={manufacturer ?? ''} onChange={(e) => setManufacturer(e.target.value)} />}</Field>
          <Field label="Model">{(id) => <Input id={id} value={model ?? ''} onChange={(e) => setModel(e.target.value)} />}</Field>
          <Field label="Serial Number">{(id) => <Input id={id} value={serial ?? ''} onChange={(e) => setSerial(e.target.value)} />}</Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="Status">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value as AssetStatus)}>
                {STATUS_OPTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Purchase Date">{(id) => <Input id={id} type="date" value={purchase ?? ''} onChange={(e) => setPurchase(e.target.value)} />}</Field>
          <Field label="Warranty Expires">{(id) => <Input id={id} type="date" value={warranty ?? ''} onChange={(e) => setWarranty(e.target.value)} />}</Field>
        </div>

        <Field label="Description">
          {(id) => (
            <textarea
              id={id}
              value={description ?? ''}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          )}
        </Field>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {mode === 'edit' ? 'Save changes' : 'Create asset'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

export function NewAssetModal({ allAssets, onClose, onCreated }: {
  allAssets?: AssetRow[]
  onClose: () => void
  onCreated: (id: string) => void
}) {
  return <AssetForm mode="create" allAssets={allAssets} onClose={onClose} onSaved={onCreated} />
}

export function EditAssetModal({ asset, onClose, onSaved }: {
  asset: Asset
  onClose: () => void
  onSaved: (id: string) => void
}) {
  return <AssetForm mode="edit" initial={asset} onClose={onClose} onSaved={onSaved} />
}
