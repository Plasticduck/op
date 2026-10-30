import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { endOfDay, parseISO } from 'date-fns'
import { Camera, Loader2, X } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { SignaturePad, type SignaturePadHandle } from '@/components/forms/SignaturePad'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import { cn } from '@/lib/utils'
import { itInventory, type BulkItem, type ItAssetRow } from '@/lib/queries/itInventory'
import type { ItRefs } from './useItRefs'
import { friendlyError, statusTone } from './format'

// Check out, check in, change status and move: for one item or a selection.
// The database decides what's allowed (deployable-only check-out, one
// check-out at a time, your sites only); these dialogs explain the outcome per
// item, so a partly successful batch says exactly what didn't go and why.

type Done = (message: string) => void

const label = (a: ItAssetRow) => `${a.asset_tag} ${a.name}`

// "Checked out 3. 1 couldn't be: MW-000004 Pay station: it's Broken."
function summarize(items: BulkItem[], assets: ItAssetRow[], verb: string): { ok: number; message: string; failures: string[] } {
  const byId = new Map(assets.map((a) => [a.id, a]))
  const ok = items.filter((i) => i.ok).length
  const failures = items.filter((i) => !i.ok).map((i) => {
    const a = byId.get(i.asset_id)
    return `${a ? label(a) : 'An item'}: ${friendlyError(i.error ?? 'failed')}`
  })
  const head = ok ? `${verb} ${ok === 1 && assets.length === 1 ? label(assets[0]) : ok}.` : ''
  const tail = failures.length ? ` ${failures.length} couldn't be: ${failures.join(' ')}` : ''
  return { ok, message: (head + tail).trim(), failures }
}

function Footer({ busy, onClose, children }: { busy: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className="mt-5 flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
      {children}
    </div>
  )
}

function NoteField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Field label="Note" hint="Optional. Kept on the item's history.">
      {(id) => (
        <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={2} placeholder={placeholder}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
      )}
    </Field>
  )
}

function PhotoField({ file, onChange, label: text }: { file: File | null; onChange: (f: File | null) => void; label: string }) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <div>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      {file ? (
        <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm text-ink">
          <Camera className="size-4 text-ink-muted" /><span className="min-w-0 flex-1 truncate">{file.name}</span>
          <button type="button" onClick={() => onChange(null)} aria-label="Remove photo" className="text-ink-muted hover:text-ink"><X className="size-4" /></button>
        </div>
      ) : (
        <Button variant="secondary" size="sm" onClick={() => input.current?.click()}><Camera className="size-4" /> {text}</Button>
      )}
    </div>
  )
}

function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { key: T; label: string; disabled?: boolean }[] }) {
  return (
    <div className="inline-flex flex-wrap rounded-lg border border-border bg-card p-0.5">
      {options.map((o) => (
        <button key={o.key} type="button" disabled={o.disabled} onClick={() => onChange(o.key)}
          className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-40',
            value === o.key ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

// ---- Check out ---------------------------------------------------------------------

type TargetType = 'user' | 'area' | 'asset' | 'site'
type Person = { id: string; first_name: string; last_name: string | null; role_title: string | null }

export function CheckOutDialog({
  refs, assets, onClose, onDone, onChangeStatus,
}: {
  refs: ItRefs
  assets: ItAssetRow[]
  onClose: () => void
  onDone: Done
  // For a single item that can't go out because of its status.
  onChangeStatus?: () => void
}) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const ready = assets.filter((a) => refs.status.get(a.status_label_id)?.type === 'deployable' && !a.assigned_type)
  const blocked = assets.filter((a) => !ready.includes(a))
  const sites = [...new Set(ready.map((a) => a.location_id))]
  const site = sites.length === 1 ? sites[0] : null
  const [type, setType] = useState<TargetType>(site ? 'user' : 'site')
  const [target, setTarget] = useState('')
  const [search, setSearch] = useState('')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [devices, setDevices] = useState<{ id: string; asset_tag: string; name: string }[] | null>(null)
  const [due, setDue] = useState('')
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [sign, setSign] = useState(false)
  const pad = useRef<SignaturePadHandle>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!site) return
    if (type === 'user' && people === null) void itInventory.roster(site).then(({ data }) => setPeople((data as Person[] | null) ?? []))
    if (type === 'asset' && devices === null) void itInventory.assetsAtSite(site).then(({ data }) => setDevices(data ?? []))
  }, [type, site, people, devices])

  const pick = (t: TargetType) => { setType(t); setTarget(''); setSearch('') }
  const q = search.trim().toLowerCase()
  const peopleShown = (people ?? []).filter((p) => !q || `${p.first_name} ${p.last_name ?? ''} ${p.role_title ?? ''}`.toLowerCase().includes(q))
  const readyIds = new Set(ready.map((a) => a.id))
  const devicesShown = (devices ?? []).filter((d) => !readyIds.has(d.id) && (!q || `${d.asset_tag} ${d.name}`.toLowerCase().includes(q)))
  const areas = refs.areas.filter((a) => a.location_id === site)

  const submit = async () => {
    if (!profile || !target) { setError('Pick who or where it goes to.'); return }
    setBusy(true)
    setError(null)
    let signaturePath: string | null = null
    if (sign && pad.current && !pad.current.isEmpty()) {
      const blob = await pad.current.toBlob()
      if (blob) {
        const up = await itInventory.uploadSignature(profile.account_id, ready[0].id, blob)
        if (up.error) { setBusy(false); setError(up.error); return }
        signaturePath = up.path
      }
    }
    const { items, error: err } = await itInventory.checkOut(ready.map((a) => a.id), { type, id: target }, {
      expected: due ? endOfDay(parseISO(due)).toISOString() : null, note, signaturePath,
    })
    if (err) { setBusy(false); setError(friendlyError(err)); return }
    const s = summarize(items, ready, 'Checked out')
    if (photo && ready.length === 1 && s.ok) {
      const a = ready[0]
      await itInventory.addPhoto(profile.account_id, a.id, a.location_id, await shrinkPhoto(photo), 'At check-out')
    }
    setBusy(false)
    if (!s.ok) { setError(s.failures.join(' ')); return }
    onDone(s.message)
  }

  if (!ready.length) {
    const one = assets.length === 1 ? assets[0] : null
    const st = one ? refs.status.get(one.status_label_id) : undefined
    return (
      <Modal open onClose={onClose} title="Can't check out" size="md">
        <p className="text-sm text-ink">
          {one
            ? one.assigned_type
              ? `${label(one)} is already checked out to ${one.assigned_label}. Check it in first.`
              : `${label(one)} is ${st?.name ?? 'not ready'}, so it can't be checked out. Only items that are In Service or Spare can go out.`
            : 'None of these can go out right now: they are already checked out, or their status (like Broken or Out for Repair) keeps them in.'}
        </p>
        <Footer busy={false} onClose={onClose}>
          {one && !one.assigned_type && onChangeStatus && <Button onClick={onChangeStatus}>Change status</Button>}
        </Footer>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} title={ready.length === 1 ? `Check out ${ready[0].asset_tag}` : `Check out ${ready.length} items`}
      description={ready.length === 1 ? ready[0].name : undefined} size="lg">
      <div className="space-y-4">
        {blocked.length > 0 && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            {blocked.length} of the selected can't go out (already checked out, or their status keeps them in) and will be skipped.
          </p>
        )}
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">To</div>
          <Segmented value={type} onChange={pick} options={[
            { key: 'user', label: 'A person', disabled: !site },
            { key: 'area', label: 'An area', disabled: !site },
            { key: 'asset', label: 'Another device', disabled: !site },
            { key: 'site', label: 'Another site' },
          ]} />
          {!site && <p className="mt-1.5 text-xs text-ink-muted">These are at different sites. Pick items from one site to check them out to a person, area or device.</p>}
        </div>

        {(type === 'user' || type === 'asset') && (
          <div>
            <Input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder={type === 'user' ? 'Search the crew at this site' : 'Search by tag or name'} aria-label="Search" />
            <div className="mt-2 max-h-56 overflow-y-auto rounded-md border border-border">
              {(type === 'user' ? people : devices) === null ? (
                <div className="grid place-items-center py-6 text-ink-muted"><Loader2 className="size-4 animate-spin" /></div>
              ) : (type === 'user' ? peopleShown.length : devicesShown.length) === 0 ? (
                <p className="px-3 py-4 text-center text-sm text-ink-muted">{type === 'user' ? 'Nobody matches at this site.' : 'No matching devices at this site.'}</p>
              ) : type === 'user' ? (
                peopleShown.map((p) => (
                  <Choice key={p.id} on={target === p.id} onClick={() => setTarget(p.id)}
                    title={`${p.first_name} ${p.last_name ?? ''}`.trim()} sub={p.role_title} />
                ))
              ) : (
                devicesShown.map((d) => (
                  <Choice key={d.id} on={target === d.id} onClick={() => setTarget(d.id)} title={d.name} sub={d.asset_tag} mono />
                ))
              )}
            </div>
          </div>
        )}
        {type === 'area' && (
          <Field label="Area">
            {(id) => (
              <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Pick an area</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        {type === 'site' && (
          <Field label="Site">
            {(id) => (
              <Select id={id} value={target} onChange={(e) => setTarget(e.target.value)}>
                <option value="">Pick a site</option>
                {locations.filter((l) => l.id !== site).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Due back" hint="Optional. Shows as overdue after this day.">
            {(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}
          </Field>
        </div>
        <NoteField value={note} onChange={setNote} placeholder="e.g. Morning shift, Pay Lane 2" />
        {ready.length === 1 && <PhotoField file={photo} onChange={setPhoto} label="Photo of its condition" />}
        {type === 'user' && (
          <div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" checked={sign} onChange={(e) => setSign(e.target.checked)}
                className="size-4 rounded border-border text-accent focus:ring-accent" />
              Have them sign for it
            </label>
            {sign && <div className="mt-2"><SignaturePad ref={pad} /></div>}
          </div>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void submit()} disabled={busy || !target}>
          {busy && <Loader2 className="size-4 animate-spin" />} Check out{ready.length > 1 ? ` ${ready.length}` : ''}
        </Button>
      </Footer>
    </Modal>
  )
}

function Choice({ on, onClick, title, sub, mono }: { on: boolean; onClick: () => void; title: string; sub?: string | null; mono?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2.5 text-left last:border-b-0',
        on ? 'bg-accent-soft' : 'hover:bg-content')}>
      <span className="min-w-0">
        <span className={cn('block truncate text-sm', on ? 'font-medium text-accent' : 'text-ink')}>{title}</span>
        {sub && <span className={cn('block truncate text-xs text-ink-muted', mono && 'font-mono')}>{sub}</span>}
      </span>
      <span className={cn('size-4 shrink-0 rounded-full border', on ? 'border-accent bg-accent' : 'border-border-strong')} />
    </button>
  )
}

// ---- Check in ------------------------------------------------------------------------

export function CheckInDialog({ refs, assets, onClose, onDone }: { refs: ItRefs; assets: ItAssetRow[]; onClose: () => void; onDone: Done }) {
  const { profile } = useAuth()
  const out = assets.filter((a) => a.assigned_type)
  const [status, setStatus] = useState('') // '' = leave it as it is
  const [note, setNote] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const current = out.length === 1 ? refs.status.get(out[0].status_label_id) : undefined

  const submit = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    const { items, error: err } = await itInventory.checkIn(out.map((a) => a.id), status || null, note)
    if (err) { setBusy(false); setError(friendlyError(err)); return }
    const s = summarize(items, out, 'Checked in')
    if (photo && out.length === 1 && s.ok) {
      const a = out[0]
      await itInventory.addPhoto(profile.account_id, a.id, a.location_id, await shrinkPhoto(photo), 'At check-in')
    }
    setBusy(false)
    if (!s.ok) { setError(s.failures.join(' ')); return }
    onDone(s.message)
  }

  if (!out.length) {
    return (
      <Modal open onClose={onClose} title="Nothing to check in" size="md">
        <p className="text-sm text-ink">None of these are checked out.</p>
        <Footer busy={false} onClose={onClose}>{null}</Footer>
      </Modal>
    )
  }

  return (
    <Modal open onClose={onClose} size="md"
      title={out.length === 1 ? `Check in ${out[0].asset_tag}` : `Check in ${out.length} items`}
      description={out.length === 1 ? `${out[0].name}, from ${out[0].assigned_label}` : undefined}>
      <div className="space-y-4">
        {assets.length > out.length && (
          <p className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">{assets.length - out.length} of the selected aren't checked out and will be skipped.</p>
        )}
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">How did it come back?</div>
          <div className="flex flex-wrap gap-2">
            <StatusChip on={status === ''} onClick={() => setStatus('')}>{current ? `Still ${current.name}` : 'Leave status as is'}</StatusChip>
            {refs.statuses.filter((s) => s.type !== 'archived' && s.id !== current?.id).map((s) => (
              <StatusChip key={s.id} on={status === s.id} onClick={() => setStatus(s.id)}>{s.name}</StatusChip>
            ))}
          </div>
        </div>
        <NoteField value={note} onChange={setNote} placeholder="e.g. Screen cracked, charger missing" />
        {out.length === 1 && <PhotoField file={photo} onChange={setPhoto} label="Photo of its condition" />}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void submit()} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} Check in{out.length > 1 ? ` ${out.length}` : ''}
        </Button>
      </Footer>
    </Modal>
  )
}

function StatusChip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('rounded-full border px-3 py-1.5 text-sm transition',
        on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink hover:bg-content')}>
      {children}
    </button>
  )
}

// ---- Change status --------------------------------------------------------------------------

export function StatusDialog({
  refs, assets, initialStatusId, onClose, onDone,
}: {
  refs: ItRefs
  assets: ItAssetRow[]
  initialStatusId?: string
  onClose: () => void
  onDone: Done
}) {
  const one = assets.length === 1 ? assets[0] : null
  const [statusId, setStatusId] = useState(initialStatusId ?? '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const chosen = refs.status.get(statusId)
  const outCount = assets.filter((a) => a.assigned_type).length

  const submit = async () => {
    if (!chosen) return
    setBusy(true)
    setError(null)
    const { items, error: err } = await itInventory.setStatus(assets.map((a) => a.id), chosen.id, note)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    const s = summarize(items, assets, chosen.type === 'archived' ? 'Retired' : `Status set to ${chosen.name} for`)
    if (!s.ok) { setError(s.failures.join(' ')); return }
    onDone(s.message)
  }

  return (
    <Modal open onClose={onClose} size="md" title={one ? `Status for ${one.asset_tag}` : `Status for ${assets.length} items`}
      description={one ? one.name : undefined}>
      <div className="space-y-4">
        <div className="divide-y divide-border overflow-hidden rounded-md border border-border">
          {refs.statuses.map((s) => {
            const isCurrent = one?.status_label_id === s.id
            return (
              <button key={s.id} type="button" onClick={() => setStatusId(s.id)} disabled={isCurrent}
                className={cn('flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left',
                  statusId === s.id ? 'bg-accent-soft' : 'hover:bg-content', isCurrent && 'opacity-60')}>
                <span className="flex items-center gap-2">
                  <Badge tone={statusTone(s)}>{s.name}</Badge>
                  <span className="text-xs text-ink-muted">{STATUS_HELP[s.type]}</span>
                </span>
                {isCurrent ? <span className="text-xs text-ink-subtle">Now</span>
                  : <span className={cn('size-4 shrink-0 rounded-full border', statusId === s.id ? 'border-accent bg-accent' : 'border-border-strong')} />}
              </button>
            )
          })}
        </div>
        {chosen?.type === 'archived' && (
          <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            Retiring takes it off your lists and retires its sticker tag for good.{outCount ? ' Anything checked out is checked in first.' : ''} You can restore it later.
          </p>
        )}
        {chosen && chosen.type !== 'deployable' && chosen.type !== 'archived' && outCount > 0 && (
          <p className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">
            {outCount === 1 && one ? `It stays checked out to ${one.assigned_label}` : `${outCount} stay checked out`} until checked in.
          </p>
        )}
        <NoteField value={note} onChange={setNote} placeholder={chosen?.type === 'undeployable' ? 'e.g. Sent to the vendor, ticket 4471' : 'Why the change'} />
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void submit()} disabled={busy || !chosen} variant={chosen?.type === 'archived' ? 'danger' : 'primary'}>
          {busy && <Loader2 className="size-4 animate-spin" />} {chosen?.type === 'archived' ? 'Retire' : 'Save'}
        </Button>
      </Footer>
    </Modal>
  )
}

const STATUS_HELP: Record<string, string> = {
  deployable: 'Can be checked out',
  pending: 'Not ready yet',
  undeployable: "Can't be checked out",
  archived: 'Off the lists for good',
}

// ---- Move --------------------------------------------------------------------------------------

export function MoveDialog({ refs, assets, onClose, onDone }: { refs: ItRefs; assets: ItAssetRow[]; onClose: () => void; onDone: Done }) {
  const { locations } = useLocations()
  const sites = [...new Set(assets.map((a) => a.location_id))]
  const [site, setSite] = useState(sites.length === 1 ? sites[0] : '')
  const [area, setArea] = useState(assets.length === 1 ? assets[0].area_id ?? '' : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const areas = useMemo(() => refs.areas.filter((a) => a.location_id === site), [refs, site])
  const out = assets.filter((a) => a.assigned_type).length

  const submit = async () => {
    if (!site) { setError('Pick the site.'); return }
    setBusy(true)
    setError(null)
    const { items, error: err } = await itInventory.move(assets.map((a) => a.id), site, area || null, note)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    const s = summarize(items, assets, 'Moved')
    if (!s.ok) { setError(s.failures.join(' ')); return }
    onDone(s.message)
  }

  return (
    <Modal open onClose={onClose} size="md" title={assets.length === 1 ? `Move ${assets[0].asset_tag}` : `Move ${assets.length} items`}
      description={assets.length === 1 ? assets[0].name : undefined}>
      <div className="space-y-4">
        {out > 0 && <p className="rounded-md bg-content px-3 py-2 text-sm text-ink-muted">{out === 1 ? 'One is' : `${out} are`} checked out and won't move until checked in.</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Site" required>
            {(id) => (
              <Select id={id} value={site} onChange={(e) => { setSite(e.target.value); setArea('') }}>
                <option value="">Pick a site</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Area">
            {(id) => (
              <Select id={id} value={area} onChange={(e) => setArea(e.target.value)} disabled={!site}>
                <option value="">No area</option>
                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </Select>
            )}
          </Field>
        </div>
        <NoteField value={note} onChange={setNote} placeholder="e.g. Swapped in for the broken one at Pay Lane 2" />
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>
      <Footer busy={busy} onClose={onClose}>
        <Button onClick={() => void submit()} disabled={busy || !site}>{busy && <Loader2 className="size-4 animate-spin" />} Move</Button>
      </Footer>
    </Modal>
  )
}
