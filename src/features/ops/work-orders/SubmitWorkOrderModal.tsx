import { useEffect, useState } from 'react'
import { Camera, Loader2, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { workOrders, PRIORITY_OPTIONS, type WorkOrderPriority } from '@/lib/queries/workOrders'
import { DEPARTMENT_OPTIONS, provisionalTitle, type Department } from '@/lib/workOrderIntake'

// Staff-facing ticket submission. The submitter only describes the problem;
// assignee, dates, and work type are set by the department's reviewers (work
// type is pre-filled by AI after submit).

const MAX_IMAGE_BYTES = 20 * 1024 * 1024
const MAX_VIDEO_BYTES = 100 * 1024 * 1024

export function SubmitWorkOrderModal({ onClose, onCreated }: {
  onClose: () => void
  onCreated: (id: string) => void
}) {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()

  const [media, setMedia] = useState<File[]>([])
  const [description, setDescription] = useState('')
  const [locationId, setLocationId] = useState(activeLocation?.id ?? '')
  const [department, setDepartment] = useState<Department | ''>('')
  const [priority, setPriority] = useState<WorkOrderPriority>('none')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rejected, setRejected] = useState<string[]>([])

  const onPickFiles = (files: FileList | null) => {
    if (!files) return
    const next: File[] = []
    const bad: string[] = []
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i)
      if (!f) continue
      const isImage = f.type.startsWith('image/')
      const isVideo = f.type.startsWith('video/')
      if (isImage && f.size <= MAX_IMAGE_BYTES) next.push(f)
      else if (isVideo && f.size <= MAX_VIDEO_BYTES) next.push(f)
      else bad.push(f.name)
    }
    setMedia((prev) => [...prev, ...next])
    setRejected(bad)
  }

  const submit = async () => {
    setError(null)
    if (!description.trim()) return setError('Add a description')
    if (!locationId) return setError('Pick a location')
    if (!department) return setError('Choose a department')
    if (!profile) return
    setBusy(true)

    const myName = (profile.name ?? '').trim() || profile.email
    const { data, error: err } = await workOrders.submitTicket({
      account_id: profile.account_id,
      location_id: locationId,
      title: provisionalTitle(description),
      description: description.trim(),
      priority,
      department,
      requested_by: profile.id,
      requested_by_name: myName,
      created_by: profile.id,
      created_by_name: myName,
    })
    if (err || !data) {
      setBusy(false)
      return setError(err?.message ?? 'Could not submit the work order')
    }

    // Upload before classifying so the AI can see the first photo.
    for (const f of media) {
      await workOrders.uploadFile(profile.account_id, data.id, f, f.type.startsWith('video/') ? 'video' : 'photo')
    }
    void workOrders.classifyTicket(data.id).catch(() => { /* reviewers set the type if this fails */ })

    setBusy(false)
    onCreated(data.id)
  }

  return (
    <Modal open onClose={onClose} title="Submit a Work Order" size="lg">
      <div className="flex flex-col gap-4">
        <MediaPicker
          files={media}
          onPick={onPickFiles}
          onRemove={(i) => setMedia((arr) => arr.filter((_, j) => j !== i))}
        />
        {rejected.length > 0 && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-xs text-warn">
            Skipped {rejected.join(', ')}. Photos can be up to 20 MB and videos up to 100 MB.
          </p>
        )}

        <Field label="Description" required>
          {(id) => (
            <textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={4}
              autoFocus
              placeholder="What's wrong or what needs to be done? Include where it is."
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          )}
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Location" required>
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Choose a location...</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Department" required>
            {(id) => (
              <Select id={id} value={department} onChange={(e) => setDepartment(e.target.value as Department | '')}>
                <option value="">Choose a department...</option>
                {DEPARTMENT_OPTIONS.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select>
            )}
          </Field>
        </div>

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
          <p className="mt-1.5 text-xs text-ink-subtle">Reviewers may adjust the priority after triage.</p>
        </div>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={busy}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Submit
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function MediaPicker({ files, onPick, onRemove }: {
  files: File[]
  onPick: (files: FileList | null) => void
  onRemove: (i: number) => void
}) {
  const [previews, setPreviews] = useState<string[]>([])
  useEffect(() => {
    const urls = files.map((f) => URL.createObjectURL(f))
    setPreviews(urls)
    return () => { urls.forEach((u) => URL.revokeObjectURL(u)) }
  }, [files])

  return (
    <div>
      <label className="flex w-full cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed border-accent/30 bg-accent-soft/30 py-6 text-sm font-medium text-accent hover:bg-accent-soft/50">
        <Camera className="mb-1 size-5" />
        Add photos or a video
        <input type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => onPick(e.target.files)} />
      </label>
      {previews.length > 0 && (
        <div className="mt-2 grid grid-cols-4 gap-2 sm:grid-cols-6">
          {previews.map((url, i) => (
            <div key={url} className="group relative aspect-square overflow-hidden rounded-md bg-content">
              {files[i]?.type.startsWith('video/')
                ? <video src={url} muted playsInline className="size-full object-cover" />
                : <img src={url} alt="" className="size-full object-cover" />}
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="absolute right-1 top-1 rounded-full bg-card p-0.5 text-ink-muted hover:text-danger"
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
