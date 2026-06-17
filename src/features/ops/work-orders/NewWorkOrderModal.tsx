import { useEffect, useMemo, useState } from 'react'
import { Camera, ChevronDown, Loader2, Plus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  workOrders,
  workOrderCategories,
  vendors as vendorsQ,
  PRIORITY_OPTIONS,
  WORK_TYPE_OPTIONS,
  RECURRENCE_OPTIONS,
  type WorkOrderCategory,
  type Vendor,
  type WorkOrderPriority,
  type WorkOrderWorkType,
  type WorkOrderRecurrence,
} from '@/lib/queries/workOrders'

type DirUser = { id: string; name: string | null; email: string }

type Prefill = {
  equipment_id?: string
  equipment_name?: string
  part_id?: string
  part_name?: string
}

export function NewWorkOrderModal({
  onClose, onCreated, parentWorkOrderId, prefill,
}: {
  onClose: () => void
  onCreated: (id: string) => void
  parentWorkOrderId?: string
  prefill?: Prefill
}) {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const [dir, setDir] = useState<DirUser[]>([])
  const [cats, setCats] = useState<WorkOrderCategory[]>([])
  const [allVendors, setAllVendors] = useState<Vendor[]>([])

  // If the modal opened with a prefill from a Part or Asset's "Use in New
  // Work Order" CTA, seed the title + description so the user has context.
  const seededTitle = prefill?.equipment_name
    ? prefill.equipment_name + ' - '
    : ''
  const seededDescription = prefill?.part_name
    ? 'Part needed: ' + prefill.part_name
    : ''
  const [title, setTitle] = useState(seededTitle)
  const [description, setDescription] = useState(seededDescription)
  const [photos, setPhotos] = useState<File[]>([])
  const [locationId, setLocationId] = useState(activeLocation?.id ?? '')
  // Track which Asset (equipment) this WO is for, if any. Pre-filled from a
  // prefill so creating-from-asset auto-attaches the asset.
  const [equipmentId, setEquipmentId] = useState<string>(prefill?.equipment_id ?? '')
  // Track which Part to pre-attach so it shows up in Time & Cost Tracking >
  // Parts as soon as the WO is created.
  const prefillPartId = prefill?.part_id ?? null
  const prefillPartName = prefill?.part_name ?? null
  const [priority, setPriority] = useState<WorkOrderPriority>('none')
  const [workType, setWorkType] = useState<WorkOrderWorkType>('reactive')
  const [recurrence, setRecurrence] = useState<WorkOrderRecurrence>('none')
  const [estHours, setEstHours] = useState('')
  const [estMins, setEstMins] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [startDate, setStartDate] = useState('')
  const [assignees, setAssignees] = useState<DirUser[]>([])
  const [categoryIds, setCategoryIds] = useState<string[]>([])
  const [vendorIds, setVendorIds] = useState<string[]>([])

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [{ data: u }, { data: c }, { data: v }] = await Promise.all([
        supabase.from('users').select('id, name, email').order('name'),
        workOrderCategories.list(),
        vendorsQ.list(),
      ])
      setDir((u as DirUser[] | null) ?? [])
      setCats((c as WorkOrderCategory[] | null) ?? [])
      setAllVendors((v as Vendor[] | null) ?? [])
    })()
  }, [])

  const totalEstMinutes = useMemo(() => {
    const h = Number(estHours) || 0
    const m = Number(estMins) || 0
    const total = h * 60 + m
    return total > 0 ? total : null
  }, [estHours, estMins])

  const submit = async () => {
    setError(null)
    if (!title.trim()) return setError('Enter a title')
    if (!locationId) return setError('Pick a location')
    if (!profile) return
    setBusy(true)

    const myName = (profile.name ?? '').trim() || profile.email
    const { data, error: err } = await workOrders.create({
      account_id: profile.account_id,
      location_id: locationId,
      title: title.trim(),
      description: description.trim() || null,
      priority,
      work_type: workType,
      recurrence,
      estimated_minutes: totalEstMinutes,
      due_at: dueDate ? new Date(dueDate).toISOString() : null,
      start_at: startDate ? new Date(startDate).toISOString() : null,
      equipment_id: equipmentId || null,
      created_by: profile.id,
      created_by_name: myName,
      requested_by: profile.id,
      requested_by_name: myName,
      parent_work_order_id: parentWorkOrderId ?? null,
    })
    if (err || !data) {
      setBusy(false)
      return setError(err?.message ?? 'Could not create the work order')
    }

    const woId = data.id

    // Set assignees / categories / vendors in parallel
    await Promise.all([
      assignees.length > 0
        ? workOrders.setAssignees(woId, assignees.map((a) => ({ user_id: a.id, user_name: (a.name ?? '').trim() || a.email })))
        : Promise.resolve(),
      categoryIds.length > 0 ? workOrders.setCategories(woId, categoryIds) : Promise.resolve(),
      vendorIds.length > 0 ? workOrders.setVendors(woId, vendorIds) : Promise.resolve(),
      prefillPartId
        ? workOrders.addPart({ work_order_id: woId, part_id: prefillPartId, part_name: prefillPartName ?? 'Part', quantity: 1 })
        : Promise.resolve(),
    ])

    // Upload any pending photos sequentially so we don't hammer storage
    for (const photo of photos) {
      await workOrders.uploadFile(profile.account_id, woId, photo, 'photo')
    }

    setBusy(false)
    onCreated(woId)
  }

  const onPickFiles = (files: FileList | null) => {
    if (!files) return
    const next: File[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i)
      if (f && f.type.startsWith('image/') && f.size <= 20 * 1024 * 1024) next.push(f)
    }
    setPhotos((prev) => [...prev, ...next])
  }

  return (
    <Modal open onClose={onClose} title="New Work Order" size="lg">
      <div className="flex flex-col gap-4">
        {/* Title */}
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="What needs to be done? (Required)"
          autoFocus
          className="w-full border-0 border-b border-border bg-transparent pb-2 text-lg font-medium text-ink placeholder:text-ink-subtle/70 focus:border-accent focus:outline-none focus:ring-0"
        />

        {/* Photos */}
        <PhotoPickerBlock photos={photos} onPick={onPickFiles} onRemove={(i) => setPhotos((arr) => arr.filter((_, j) => j !== i))} />

        {/* Description */}
        <Field label="Description">
          {(id) => (
            <textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Add a description"
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          )}
        </Field>

        {/* Location */}
        <Field label="Location" required>
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Choose a location...</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>

        {/* Prefill confirmation chips (from "Use in New Work Order" CTAs) */}
        {(equipmentId || prefillPartId) && (
          <div className="rounded-md border border-accent/30 bg-accent-soft/40 px-3 py-2 text-sm text-ink">
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-accent">Pre-attached</div>
            <div className="flex flex-wrap gap-1.5">
              {equipmentId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                  Asset: {prefill?.equipment_name ?? equipmentId.slice(0, 8)}
                  <button type="button" onClick={() => setEquipmentId('')} className="opacity-70 hover:opacity-100"><X className="size-3" /></button>
                </span>
              )}
              {prefillPartId && (
                <span className="inline-flex items-center gap-1 rounded-full bg-accent/15 px-2 py-0.5 text-[11px] text-accent">
                  Part: {prefillPartName}
                </span>
              )}
            </div>
          </div>
        )}

        {/* Assignees */}
        <MultiPicker
          label="Assign to"
          placeholder="Type name, email or phone number"
          options={dir.map((u) => ({ id: u.id, label: (u.name ?? '').trim() || u.email, sub: u.email }))}
          selectedIds={assignees.map((a) => a.id)}
          onChange={(ids) => setAssignees(dir.filter((u) => ids.includes(u.id)))}
        />

        {/* Estimated Time + dates */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Estimated time">
            {() => (
              <div className="flex items-center gap-1.5">
                <Input type="number" min="0" placeholder="Hrs" value={estHours} onChange={(e) => setEstHours(e.target.value)} className="w-20" />
                <span className="text-sm text-ink-subtle">h</span>
                <Input type="number" min="0" max="59" placeholder="Min" value={estMins} onChange={(e) => setEstMins(e.target.value)} className="w-20" />
                <span className="text-sm text-ink-subtle">m</span>
              </div>
            )}
          </Field>
          <div />
          <Field label="Due Date">{(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          <Field label="Start Date">{(id) => <Input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
        </div>

        {/* Recurrence + Work Type */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Recurrence">
            {(id) => (
              <Select id={id} value={recurrence} onChange={(e) => setRecurrence(e.target.value as WorkOrderRecurrence)}>
                {RECURRENCE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Work Type">
            {(id) => (
              <Select id={id} value={workType} onChange={(e) => setWorkType(e.target.value as WorkOrderWorkType)}>
                {WORK_TYPE_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </Select>
            )}
          </Field>
        </div>

        {/* Priority */}
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Priority</div>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {PRIORITY_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={cn(
                  'border-l border-border px-4 py-1.5 text-sm font-medium first:border-l-0',
                  priority === p.value
                    ? (p.tone === 'danger' ? 'bg-danger-soft text-danger' : p.tone === 'warn' ? 'bg-warn-soft text-warn' : p.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent')
                    : 'bg-card text-ink-muted hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Categories */}
        <MultiPicker
          label="Categories"
          placeholder="Start typing..."
          options={cats.map((c) => ({ id: c.id, label: c.name, color: c.color }))}
          selectedIds={categoryIds}
          onChange={setCategoryIds}
        />

        {/* Vendors */}
        <MultiPicker
          label="Vendors"
          placeholder="Start typing..."
          options={allVendors.map((v) => ({ id: v.id, label: v.name, sub: v.kind === 'parts_supplier' ? 'Parts supplier' : v.kind === 'service' ? 'Service' : v.kind }))}
          selectedIds={vendorIds}
          onChange={setVendorIds}
        />

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Create
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function PhotoPickerBlock({ photos, onPick, onRemove }: {
  photos: File[]
  onPick: (files: FileList | null) => void
  onRemove: (i: number) => void
}) {
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const urls = photos.map((p) => URL.createObjectURL(p))
    setPreviews(urls)
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)) }
  }, [photos])

  return (
    <div>
      <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-accent/30 bg-accent-soft/30 py-6 text-sm font-medium text-accent hover:bg-accent-soft/50">
        <Camera className="mb-1 size-5" />
        Add or drag pictures
        <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
      </label>
      {previews.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {previews.map((url, i) => (
            <div key={i} className="group relative aspect-square overflow-hidden rounded-md bg-content">
              <img src={url} alt="" className="size-full object-cover" />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-1 top-1 hidden rounded-full bg-card p-0.5 text-ink-muted hover:text-danger group-hover:block"
                aria-label="Remove"
              >
                <X className="size-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ---- Simple multi-select with chips --------------------------------------

function MultiPicker({
  label, placeholder, options, selectedIds, onChange,
}: {
  label: string
  placeholder: string
  options: Array<{ id: string; label: string; sub?: string; color?: string }>
  selectedIds: string[]
  onChange: (ids: string[]) => void
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')

  const filtered = options.filter((o) => {
    if (selectedIds.includes(o.id)) return false
    if (!q) return true
    return o.label.toLowerCase().includes(q.toLowerCase())
  })
  const selectedItems = options.filter((o) => selectedIds.includes(o.id))

  return (
    <Field label={label}>
      {() => (
        <div className="relative">
          <div
            onClick={() => setOpen((v) => !v)}
            className="flex min-h-[40px] cursor-text flex-wrap items-center gap-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm focus-within:border-accent focus-within:ring-1 focus-within:ring-accent"
          >
            {selectedItems.map((o) => (
              <span
                key={o.id}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium"
                style={o.color ? { backgroundColor: o.color + '20', color: o.color } : undefined}
              >
                {!o.color && <span className="grid size-4 place-items-center rounded-full bg-accent/15 text-[9px] font-semibold text-accent">{o.label[0]?.toUpperCase()}</span>}
                {o.label}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onChange(selectedIds.filter((id) => id !== o.id)) }}
                  className="opacity-70 hover:opacity-100"
                  aria-label="Remove"
                ><X className="size-3" /></button>
              </span>
            ))}
            <input
              type="text"
              value={q}
              onChange={(e) => { setQ(e.target.value); setOpen(true) }}
              onFocus={() => setOpen(true)}
              placeholder={selectedItems.length === 0 ? placeholder : ''}
              className="min-w-[6ch] flex-1 border-0 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-0"
            />
            <ChevronDown className="size-4 text-ink-subtle" />
          </div>
          {open && filtered.length > 0 && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-60 overflow-y-auto rounded-md border border-border bg-card shadow-md">
              {filtered.map((o) => (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange([...selectedIds, o.id]); setQ('') }}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-content"
                >
                  {o.color && <span className="size-2.5 rounded-full" style={{ backgroundColor: o.color }} />}
                  <span className="flex-1 truncate text-ink">{o.label}</span>
                  {o.sub && <span className="text-[11px] text-ink-subtle">{o.sub}</span>}
                  <Plus className="size-3.5 text-accent" />
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Field>
  )
}
