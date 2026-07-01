import { useRef, useState } from 'react'
import { Camera, Loader2, Trash2, Upload } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { useCompany } from '@/lib/company'
import { groupByRegions, resolveRegions } from '@/lib/regions'
import { supabase } from '@/lib/supabase'
import { siteViolations } from '@/lib/queries/opsSuite'
import { DEPARTMENTS, VIOLATION_TYPES, type Department } from './config'

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export function AddViolationModal({
  onClose,
  onSaved,
}: {
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const { settings } = useCompany()
  const groups = groupByRegions(locations, resolveRegions(locations, settings.regions))

  const [locationId, setLocationId] = useState('')
  const [department, setDepartment] = useState<Department | ''>('')
  const [violationType, setViolationType] = useState('')
  const [notes, setNotes] = useState('')
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const cameraRef = useRef<HTMLInputElement | null>(null)
  const uploadRef = useRef<HTMLInputElement | null>(null)

  const addFiles = (list: FileList | null) => {
    const picked = Array.from(list ?? [])
    if (picked.length) setFiles((prev) => [...prev, ...picked])
  }

  const submit = async () => {
    setError(null)
    if (!profile) return
    if (!locationId) return setError('Select a site.')
    if (!department) return setError('Select a department.')
    if (!violationType) return setError('Select a Violation Type.')
    setBusy(true)
    const { data, error: err } = await siteViolations.create({
      account_id: profile.account_id,
      location_id: locationId,
      department,
      violation_type: violationType,
      description: notes.trim() || null,
      reported_by: profile.id,
      reported_by_name: profile.name,
    })
    if (err) {
      setBusy(false)
      return setError(err.message)
    }
    const newId = (data as { id?: string } | null)?.id
    if (newId && files.length) {
      for (const file of files) {
        const dataUri = await fileToDataUri(file)
        const { error: upErr } = await supabase.from('ops_attachments').insert({
          account_id: profile.account_id,
          entity_type: 'violation',
          entity_id: newId,
          file_name: file.name,
          file_type: file.type,
          data_uri: dataUri,
        })
        if (upErr) {
          setBusy(false)
          return setError(upErr.message)
        }
      }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Add Site Violation"
      description={`Submitting as: ${profile?.name ?? ''}`}
    >
      <div className="flex flex-col gap-4">
        <Field label="Site" required>
          {(id) => (
            <Select
              id={id}
              value={locationId}
              onChange={(e) => setLocationId(e.target.value)}
            >
              <option value="">Select a site...</option>
              {groups.map((g) => (
                <optgroup key={g.region} label={g.region}>
                  {g.locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Department" required>
          {(id) => (
            <Select
              id={id}
              value={department}
              onChange={(e) => {
                setDepartment(e.target.value as Department | '')
                setViolationType('')
              }}
            >
              <option value="">Select a department...</option>
              {DEPARTMENTS.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {department && (
          <Field label="Violation Type" required>
            {(id) => (
              <Select
                id={id}
                value={violationType}
                onChange={(e) => setViolationType(e.target.value)}
              >
                <option value="">Select a Violation Type...</option>
                {VIOLATION_TYPES[department].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}

        <Field label="Additional notes">
          {(id) => (
            <textarea
              id={id}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Enter any additional details..."
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
            />
          )}
        </Field>

        <Field label="Add photo or PDF (optional)">
          {() => (
            <div className="flex flex-col gap-2">
              <input
                ref={cameraRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <input
                ref={uploadRef}
                type="file"
                multiple
                accept="image/*,application/pdf"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files)
                  e.target.value = ''
                }}
              />
              <div className="grid grid-cols-2 gap-2">
                <Button variant="secondary" onClick={() => cameraRef.current?.click()}>
                  <Camera className="size-4" /> Take Photo
                </Button>
                <Button variant="secondary" onClick={() => uploadRef.current?.click()}>
                  <Upload className="size-4" /> Upload Photo/PDF
                </Button>
              </div>
              {files.length > 0 && (
                <ul className="flex flex-col gap-1 rounded-md border border-border bg-content px-3 py-2 text-sm">
                  {files.map((f, i) => (
                    <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                      <span className="truncate text-ink">{f.name}</span>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setFiles((prev) => prev.filter((_, idx) => idx !== i))}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>

        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <Button onClick={submit} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Submitting…
            </>
          ) : (
            'Submit Violation'
          )}
        </Button>
      </div>
    </Modal>
  )
}
