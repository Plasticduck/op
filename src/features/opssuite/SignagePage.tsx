import { useCallback, useEffect, useState } from 'react'
import { FileText, Plus, Signpost } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { timeAgo } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import {
  SIGN_CATEGORIES,
  flagSpec,
  signage,
  signTypeLabel,
  signTypeOptions,
  type SignageRequest,
} from '@/lib/queries/signage'

type Row = SignageRequest & { requested_by: { name: string } | null }

const STATUS_FLOW = ['pending', 'approved', 'ordered', 'received'] as const
const STATUS_TONE = { pending: 'warn', approved: 'accent', ordered: 'neutral', received: 'ok' } as const

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const isManagerPlus = profile?.role !== 'employee'
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await signage.list(locationId)
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const advance = async (r: Row) => {
    const next = STATUS_FLOW[STATUS_FLOW.indexOf(r.status as (typeof STATUS_FLOW)[number]) + 1]
    if (next) { await signage.update(r.id, { status: next }); void load() }
  }

  const openArtwork = async (path: string) => {
    const { url } = await signage.artworkUrl(path)
    if (url) window.open(url, '_blank', 'noopener')
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Signage"
        subtitle="Order signage and printed products for your site."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New request</Button>}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Signpost}
          title="No signage requests"
          description="Submit a signage order and track it through to received."
          action={<Button onClick={() => setCreating(true)}>New request</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[820px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Sign</th>
                <th className="px-3 py-2.5 font-medium">Size</th>
                <th className="px-3 py-2.5 font-medium numeric">Qty</th>
                <th className="px-3 py-2.5 font-medium">Artwork</th>
                <th className="px-3 py-2.5 font-medium">Requested by</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{r.sign_category}</div>
                    {r.sign_type && <div className="text-xs text-ink-muted">{r.sign_type}</div>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.size_option
                      ? `${r.size_option}${r.sided ? ` · ${r.sided === 'double' ? 'Double' : 'Single'} sided` : ''}`
                      : r.width && r.height
                        ? `${r.width} x ${r.height} ${r.size_unit === 'ft' ? 'ft' : 'in'}`
                        : '—'}
                  </td>
                  <td className="px-3 py-2.5 numeric tabular text-ink-muted">{r.quantity}</td>
                  <td className="px-3 py-2.5">
                    {r.artwork_path ? (
                      <button
                        type="button"
                        onClick={() => void openArtwork(r.artwork_path as string)}
                        className="inline-flex items-center gap-1 text-accent hover:underline"
                      >
                        <FileText className="size-3.5" /> PDF
                      </button>
                    ) : (
                      <span className="text-xs text-ink-subtle">none</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.first_name || r.last_name
                      ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
                      : r.requested_by?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={STATUS_TONE[r.status as keyof typeof STATUS_TONE]}>{r.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{timeAgo(r.created_at)}</td>
                  <td className="px-3 py-2.5 text-right">
                    {isManagerPlus && r.status !== 'received' && (
                      <Button variant="secondary" size="sm" onClick={() => advance(r)}>
                        {r.status === 'pending' ? 'Approve' : r.status === 'approved' ? 'Mark ordered' : 'Mark received'}
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && (
        <RequestModal
          locationId={locationId}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load() }}
        />
      )}
    </div>
  )
}

function RequestModal({ locationId, onClose, onSaved }: { locationId: string; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const { activeLocation } = useLocations()
  const [pf, ...pl] = (profile?.name ?? '').trim().split(' ')
  const [firstName, setFirstName] = useState(pf ?? '')
  const [lastName, setLastName] = useState(pl.join(' '))
  const firstType = signTypeOptions(SIGN_CATEGORIES[0])[0] ?? ''
  const [category, setCategory] = useState<string>(SIGN_CATEGORIES[0])
  const [signType, setSignType] = useState<string>(firstType)
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [unit, setUnit] = useState<'in' | 'ft'>('in')
  const [sizeOption, setSizeOption] = useState('')
  const [sided, setSided] = useState<'single' | 'double'>('single')
  const [quantity, setQuantity] = useState('1')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live preview of the selected PDF, cleaned up when it changes or unmounts.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  const typeOptions = signTypeOptions(category)
  const spec = flagSpec(signType) // present only for flag types

  const applyType = (t: string) => {
    setSignType(t)
    const s = flagSpec(t)
    setSizeOption(s?.sizes[0] ?? '')
    setSided('single')
  }
  const onCategory = (c: string) => {
    setCategory(c)
    applyType(signTypeOptions(c)[0] ?? '')
  }

  const onFile = (f: File | null) => {
    setError(null)
    if (f && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Artwork must be a PDF file.')
      setFile(null)
      return
    }
    setFile(f)
  }

  const save = async () => {
    setError(null)
    if (!firstName.trim() || !lastName.trim()) return setError('Enter your first and last name')
    if (!signType) return setError('Choose a sign type')
    setBusy(true)

    let artworkPath: string | null = null
    let artworkName: string | null = null
    if (file) {
      const { error: upErr, path } = await signage.uploadArtwork(profile?.account_id ?? '', file)
      if (upErr) { setBusy(false); return setError(`Artwork upload failed: ${upErr.message}`) }
      artworkPath = path
      artworkName = file.name
    }

    const { error: err } = await signage.create({
      account_id: profile?.account_id ?? '',
      location_id: locationId,
      requested_by: profile?.id ?? null,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      sign_category: category,
      sign_type: signType,
      // Flags use a preset size + sided; other categories use width x height.
      width: spec ? null : width ? Number(width) : null,
      height: spec ? null : height ? Number(height) : null,
      size_unit: unit,
      size_option: spec ? sizeOption : null,
      sided: spec ? (spec.sided ? sided : 'single') : null,
      quantity: Number(quantity) || 1,
      artwork_path: artworkPath,
      artwork_name: artworkName,
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New signage request" size="md">
      <div className="flex flex-col gap-4">
        <Field label="Site">
          {(id) => <Input id={id} value={activeLocation?.name ?? ''} readOnly className="bg-content text-ink-muted" />}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name" required>{(id) => <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}</Field>
          <Field label="Last name" required>{(id) => <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} />}</Field>
        </div>
        <Field label="Sign category" required>
          {(id) => (
            <Select id={id} value={category} onChange={(e) => onCategory(e.target.value)}>
              {SIGN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
        </Field>
        <Field label={signTypeLabel(category)} required>
          {(id) => (
            <Select id={id} value={signType} onChange={(e) => applyType(e.target.value)}>
              {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
            </Select>
          )}
        </Field>
        {spec ? (
          <>
            <Field label="Size" required>
              {(id) => (
                <Select id={id} value={sizeOption} onChange={(e) => setSizeOption(e.target.value)}>
                  {spec.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Sided">
              {(id) =>
                spec.sided ? (
                  <Select id={id} value={sided} onChange={(e) => setSided(e.target.value as 'single' | 'double')}>
                    <option value="single">Single sided</option>
                    <option value="double">Double sided</option>
                  </Select>
                ) : (
                  <Input id={id} value="Single sided only" readOnly className="bg-content text-ink-muted" />
                )
              }
            </Field>
          </>
        ) : (
          <Field label="Size">
            {() => (
              <div className="flex items-center gap-2">
                <Input type="number" min="0" step="0.1" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="Width" />
                <span className="text-ink-muted">x</span>
                <Input type="number" min="0" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Height" />
                <Select value={unit} onChange={(e) => setUnit(e.target.value as 'in' | 'ft')} className="w-28">
                  <option value="in">Inches</option>
                  <option value="ft">Feet</option>
                </Select>
              </div>
            )}
          </Field>
        )}
        <Field label="Quantity" required>{(id) => <Input id={id} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
        <Field label="Upload artwork (PDF only)">
          {(id) => (
            <div>
              <input
                id={id}
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover"
              />
              {file && <p className="mt-1 text-xs text-ink-muted">{file.name}</p>}
            </div>
          )}
        </Field>
        {previewUrl && (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-muted">Artwork preview</p>
            <iframe
              title="Artwork preview"
              src={previewUrl}
              className="h-80 w-full rounded-md border border-border bg-content"
            />
          </div>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Submitting…' : 'Submit request'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function SignagePage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
