import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Images, Plus, Signpost, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { timeAgo, shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import {
  SIGN_CATEGORIES,
  flagSpec,
  signage,
  signTypeLabel,
  signTypeOptions,
  type ArtworkItem,
  type SignageRequest,
} from '@/lib/queries/signage'

type Row = SignageRequest & { requested_by: { name: string } | null }

async function openArtwork(path: string) {
  const { url } = await signage.artworkUrl(path)
  if (url) window.open(url, '_blank', 'noopener')
}

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [library, setLibrary] = useState<ArtworkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [orders, art] = await Promise.all([signage.list(locationId), signage.libraryList()])
    setRows((orders.data as unknown as Row[]) ?? [])
    setLibrary(art)
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Signage"
        subtitle="Order signage and printed products for your site."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Order</Button>}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={Signpost}
          title="No signage orders"
          description="Submit a signage order and it goes straight to the print team."
          action={<Button onClick={() => setCreating(true)}>New Order</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Order</th>
                <th className="px-3 py-2.5 font-medium">Size</th>
                <th className="px-3 py-2.5 font-medium numeric">Qty</th>
                <th className="px-3 py-2.5 font-medium">Ordered by</th>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium text-center">Artwork</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{r.title || r.sign_category}</span>
                      {r.location_id === null && (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">All sites</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {r.sign_category}{r.sign_type ? ` · ${r.sign_type}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.size_option
                      ? `${r.size_option}${r.sided ? ` · ${r.sided === 'double' ? 'Double' : 'Single'} sided` : ''}`
                      : r.width && r.height
                        ? `${r.width} x ${r.height} ${r.size_unit === 'ft' ? 'ft' : 'in'}`
                        : '—'}
                  </td>
                  <td className="px-3 py-2.5 numeric tabular text-ink-muted">{r.quantity}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.first_name || r.last_name
                      ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
                      : r.requested_by?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{timeAgo(r.created_at)}</td>
                  <td className="px-3 py-2.5 text-center">
                    {r.artwork_path ? (
                      <button
                        type="button"
                        onClick={() => void openArtwork(r.artwork_path as string)}
                        title={`View artwork${r.artwork_name ? `: ${r.artwork_name}` : ''}`}
                        className="mx-auto grid size-8 place-items-center rounded-md border border-border text-accent hover:bg-accent-soft"
                      >
                        <FileText className="size-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-ink-subtle">none</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {!loading && (
        <ArtworkLibrary items={library} accountId={profile?.account_id ?? ''} onChanged={load} />
      )}

      {creating && (
        <OrderModal
          locationId={locationId}
          library={library}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); void load() }}
        />
      )}
    </div>
  )
}

// Every artwork, reusable on a new order. Direct uploads (no order) plus artwork
// from past orders. Deduped by file path.
function ArtworkLibrary({
  items, accountId, onChanged,
}: {
  items: ArtworkItem[]
  accountId: string
  onChanged: () => void
}) {
  const unique = useMemo(() => {
    const seen = new Set<string>()
    return items.filter((i) => i.artwork_path && !seen.has(i.artwork_path) && seen.add(i.artwork_path))
  }, [items])

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (f: File | null) => {
    setError(null)
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      return setError('Artwork must be a PDF file.')
    }
    setBusy(true)
    const { error: err } = await signage.addArtwork(accountId, f)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (err) return setError(err.message)
    onChanged()
  }

  return (
    <section className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <Images className="size-4 text-ink-muted" />
        <h2 className="text-sm font-semibold text-ink">Artwork library</h2>
        <span className="text-xs text-ink-subtle">Reuse any of these on a new order</span>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0] ?? null)}
        />
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-4" /> {busy ? 'Uploading…' : 'Upload artwork'}
        </Button>
      </div>
      {error && <p className="border-b border-border bg-danger-soft px-4 py-2 text-sm text-danger">{error}</p>}
      {unique.length === 0 ? (
        <p className="p-4 text-sm text-ink-muted">Artwork you upload on orders will collect here.</p>
      ) : (
        <ul className="grid grid-cols-1 gap-px bg-border sm:grid-cols-2 lg:grid-cols-3">
          {unique.map((a) => (
            <li key={a.artwork_path} className="flex items-center justify-between gap-3 bg-card p-3">
              <div className="flex min-w-0 items-center gap-2">
                <FileText className="size-4 shrink-0 text-accent" />
                <div className="min-w-0">
                  <p className="truncate text-sm text-ink">{a.artwork_name ?? 'Artwork.pdf'}</p>
                  <p className="truncate text-xs text-ink-subtle">
                    {a.sign_category ?? 'Signage'}{a.sign_type ? ` · ${a.sign_type}` : ''} · {shortDate(a.created_at)}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void openArtwork(a.artwork_path)}
                className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-ink-muted hover:text-accent"
              >
                View
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function OrderModal({
  locationId, library, onClose, onSaved,
}: {
  locationId: string
  library: ArtworkItem[]
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const { activeLocation, locations } = useLocations()
  const [pf, ...pl] = (profile?.name ?? '').trim().split(' ')
  // 'all' targets every site (location_id null); otherwise a specific site id.
  const [siteId, setSiteId] = useState<string>(activeLocation?.id ?? locationId)
  const [orderTitle, setOrderTitle] = useState('')
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

  // Artwork: upload a new PDF, or reuse one from the library.
  const uniqueLibrary = useMemo(() => {
    const seen = new Set<string>()
    return library.filter((i) => i.artwork_path && !seen.has(i.artwork_path) && seen.add(i.artwork_path))
  }, [library])
  const [artSource, setArtSource] = useState<'upload' | 'library'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [libraryPath, setLibraryPath] = useState('')
  const [libraryPreview, setLibraryPreview] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live preview of a freshly selected PDF.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Signed-URL preview for a chosen library artwork.
  useEffect(() => {
    if (artSource !== 'library' || !libraryPath) { setLibraryPreview(null); return }
    let active = true
    void signage.artworkUrl(libraryPath).then(({ url }) => { if (active) setLibraryPreview(url) })
    return () => { active = false }
  }, [artSource, libraryPath])

  const typeOptions = signTypeOptions(category)
  const spec = flagSpec(signType)

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
    if (!orderTitle.trim()) return setError('Give the order a title')
    if (!firstName.trim() || !lastName.trim()) return setError('Enter your first and last name')
    if (!signType) return setError('Choose a sign type')
    setBusy(true)

    let artworkPath: string | null = null
    let artworkName: string | null = null
    if (artSource === 'library' && libraryPath) {
      artworkPath = libraryPath
      artworkName = uniqueLibrary.find((i) => i.artwork_path === libraryPath)?.artwork_name ?? null
    } else if (file) {
      const { error: upErr, path } = await signage.uploadArtwork(profile?.account_id ?? '', file)
      if (upErr) { setBusy(false); return setError(`Artwork upload failed: ${upErr.message}`) }
      artworkPath = path
      artworkName = file.name
    }

    const { data: created, error: err } = await signage.create({
      account_id: profile?.account_id ?? '',
      location_id: siteId === 'all' ? null : siteId,
      requested_by: profile?.id ?? null,
      title: orderTitle.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      sign_category: category,
      sign_type: signType,
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
    // Email the order (with the artwork PDF) to info@washlyfe.com. Best-effort.
    if (created?.id) void signage.emailRequest(created.id)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New Signage Order" size="md">
      <div className="flex flex-col gap-4">
        <Field label="Order title" required>
          {(id) => <Input id={id} value={orderTitle} onChange={(e) => setOrderTitle(e.target.value)} placeholder="e.g. Front entrance A-frame" />}
        </Field>
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="all">ALL SITES</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
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

        <Field label="Artwork (PDF)">
          {() => (
            <div className="flex flex-col gap-2">
              <div className="inline-flex gap-1 rounded-lg border border-border bg-content p-1">
                {(['upload', 'library'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setArtSource(s)}
                    disabled={s === 'library' && uniqueLibrary.length === 0}
                    className={
                      'rounded-md px-3 py-1 text-xs font-medium transition disabled:opacity-40 ' +
                      (artSource === s ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink')
                    }
                  >
                    {s === 'upload' ? 'Upload new' : 'From library'}
                  </button>
                ))}
              </div>
              {artSource === 'upload' ? (
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover"
                />
              ) : (
                <Select value={libraryPath} onChange={(e) => setLibraryPath(e.target.value)}>
                  <option value="">Choose existing artwork…</option>
                  {uniqueLibrary.map((a) => (
                    <option key={a.artwork_path} value={a.artwork_path}>
                      {(a.artwork_name ?? 'Artwork.pdf') + ' (' + shortDate(a.created_at) + ')'}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
        </Field>

        {(previewUrl || libraryPreview) && (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-muted">Artwork preview</p>
            <iframe
              title="Artwork preview"
              src={(artSource === 'library' ? libraryPreview : previewUrl) ?? ''}
              className="h-80 w-full rounded-md border border-border bg-content"
            />
          </div>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Submitting…' : 'Submit order'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function SignagePage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
