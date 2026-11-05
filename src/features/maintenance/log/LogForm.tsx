import { useEffect, useRef, useState } from 'react'
import { Camera, ChevronDown, Trash2, X } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi, type MiRefs, type StockRow } from '@/lib/queries/maintenanceInventory'
import type { EntryResult, EntryType, LogAddResult, LogInput, TaskType } from '@/lib/queries/maintenanceLog'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import { cn } from '@/lib/utils'
import { useMi } from '../inventory/context'
import { errText, qty } from '../inventory/format'
import { act } from '../inventory/offline'
import { Chips, ErrorNote, WarnNote } from '../inventory/ui'
import type { AssetRef, LogFormInit } from './context'
import { ASSET_STATUS, dueText, ENTRY_TYPE, ENTRY_TYPES, everyText, localInputValue, RESULT } from './labels'
import { AssetPicker, PartSearch, Textarea } from './pickers'

type Line = { key: string; part_id: string; part_name: string; uom: string | null; qty: string; location_id: string; options: StockRow[] }

const SITE_KEY = 'ml.site'

function savedSite(refs: MiRefs): string {
  try {
    const s = localStorage.getItem(SITE_KEY)
    if (s && refs.sites.some((x) => x.id === s)) return s
  } catch {
    // private window: fall back to the first site
  }
  return refs.sites[0]?.id ?? ''
}

function taskToEntry(t: TaskType): EntryType {
  switch (t) {
    case 'inspect':
    case 'test': return 'inspection'
    case 'lubricate': return 'lubrication'
    case 'clean': return 'cleaning'
    case 'replace': return 'replacement'
    case 'adjust': return 'adjustment'
    default: return 'preventive'
  }
}

const usable = (rows: StockRow[]) => rows.filter((r) => r.can_act)
const pickLocation = (rows: StockRow[], need: number) => (rows.find((o) => Number(o.available) >= need) ?? rows.find((o) => Number(o.available) > 0) ?? rows[0])?.location_id ?? ''

// One form for every job: a repair, a quick inspection, or a scheduled task being done
// (or skipped). Parts come off the shelf through the same stock functions as anywhere,
// and the whole thing queues on the phone when there's no signal.
export default function LogForm({ init, onClose, onSaved }: { init: LogFormInit; onClose: () => void; onSaved: (r: LogAddResult | null) => void }) {
  const { refs, accountId, notify } = useMi()
  const sched = init.schedule ?? null
  const skip = !!init.skip && !!sched
  const [site, setSite] = useState(() => sched?.site_id ?? init.asset?.site_id ?? init.site_id ?? savedSite(refs))
  const [asset, setAsset] = useState<AssetRef | null>(() =>
    sched?.asset_id ? { id: sched.asset_id, name: sched.asset_name ?? 'Machine', site_id: sched.site_id } : init.asset ?? null)
  const [etype, setEtype] = useState<EntryType>(sched ? taskToEntry(sched.task_type) : 'repair')
  const [title, setTitle] = useState(sched?.title ?? '')
  const [result, setResult] = useState<EntryResult>(skip ? 'skipped' : 'ok')
  const [notes, setNotes] = useState('')
  const [when, setWhen] = useState(localInputValue())
  const [lines, setLines] = useState<Line[]>([])
  const [photos, setPhotos] = useState<Array<{ file: File; url: string }>>([])
  const [more, setMore] = useState(false)
  const [labor, setLabor] = useState('')
  const [downtime, setDowntime] = useState('')
  const [vendor, setVendor] = useState('')
  const [outside, setOutside] = useState('')
  const [assetStatus, setAssetStatus] = useState('')
  const [followUp, setFollowUp] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const photoUrls = useRef<string[]>([])

  useEffect(() => () => { photoUrls.current.forEach((u) => URL.revokeObjectURL(u)) }, [])

  // A scheduled task's parts come pre-filled, from wherever at the site has enough.
  useEffect(() => {
    if (!sched || skip || sched.parts.length === 0) return
    let alive = true
    void Promise.all(sched.parts.map(async (p): Promise<Line> => {
      const opts = usable(await mi.partStockForSite(p.part_id, sched.site_id).catch(() => [] as StockRow[]))
      return { key: p.part_id, part_id: p.part_id, part_name: p.part_name, uom: p.uom, qty: String(Number(p.qty)), location_id: pickLocation(opts, Number(p.qty)), options: opts }
    })).then((ls) => { if (alive) setLines(ls) })
    return () => { alive = false }
  }, [sched, skip])

  const changeSite = (s: string) => {
    setSite(s)
    setAsset(null)
    setLines([])
    try { localStorage.setItem(SITE_KEY, s) } catch { /* not saved, fine */ }
  }

  const addPart = async (p: { id: string; name: string; uom: string | null }) => {
    if (!site) return
    const opts = usable(await mi.partStockForSite(p.id, site).catch(() => [] as StockRow[]))
    setLines((ls) => [...ls, { key: `${p.id}-${Date.now()}`, part_id: p.id, part_name: p.name, uom: p.uom, qty: '1', location_id: pickLocation(opts, 1), options: opts }])
  }
  const setLine = (key: string, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const next: Array<{ file: File; url: string }> = []
    for (const f of Array.from(files)) {
      const small = await shrinkPhoto(f, 1600).catch(() => f)
      const url = URL.createObjectURL(small)
      photoUrls.current.push(url)
      next.push({ file: small, url })
    }
    setPhotos((p) => [...p, ...next])
  }

  const save = async () => {
    setError(null)
    if (!site) { setError('Pick the site.'); return }
    if (!sched && !title.trim()) { setError('Say what was done.'); return }
    if (skip && !notes.trim()) { setError('Say why it\'s being skipped.'); return }
    const used = skip ? [] : lines.filter((l) => Number(l.qty) > 0)
    const bad = used.find((l) => !l.location_id)
    if (bad) { setError(`Pick where the ${bad.part_name} came from, or take it off the list.`); return }
    setBusy(true)
    try {
      let paths: string[] = []
      let photoNote = ''
      if (photos.length && !skip) {
        if (navigator.onLine) paths = await Promise.all(photos.map((p) => mi.upload(accountId, 'log', p.file, p.file.name || 'photo.jpg')))
        else photoNote = ' Photos need signal, so they weren\'t saved.'
      }
      const input: LogInput = {
        site_id: site,
        asset_id: asset?.id ?? null,
        schedule_id: sched?.id ?? null,
        entry_type: etype,
        title: title.trim() || undefined,
        notes: notes.trim(),
        result,
        performed_at: new Date(when).toISOString(),
        labor_minutes: labor.trim() ? Math.round(Number(labor)) : null,
        downtime_minutes: downtime.trim() ? Math.round(Number(downtime)) : null,
        vendor_id: vendor || null,
        outside_cost: outside.trim() ? Number(outside) : null,
        asset_status: assetStatus || null,
        follow_up: (result === 'follow_up' || result === 'failed') && followUp,
        parts: used.map((l) => ({ part_id: l.part_id, location_id: l.location_id, qty: Number(l.qty) })),
        photos: paths,
      }
      const r = await act<LogAddResult>('mi_log_add', { p: input, p_source: window.innerWidth >= 1024 ? 'web' : 'mobile' }, `Log: ${input.title ?? sched?.title ?? 'job'}`)
      if (r.queued) {
        notify(`Saved on this phone. It goes into the log when there's signal.${photoNote}`, 'warn')
        onSaved(null)
        return
      }
      const d = r.data
      const bits = [skip ? 'Skipped. The schedule moved on.' : 'Logged.']
      if (d.work_order_number) bits.push(`Work order #${d.work_order_number} closed.`)
      if (d.follow_up) bits.push(`Follow-up work order #${d.follow_up.number} opened.`)
      notify(bits.join(' ') + photoNote, photoNote ? 'warn' : 'ok')
      if (used.length) window.dispatchEvent(new Event('mi-changed'))
      onSaved(d)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const heading = skip ? 'Skip this time' : sched ? 'Mark it done' : 'Log work'

  return (
    <Modal open onClose={onClose} title={heading} size="lg">
      <div className="flex flex-col gap-4">
        {sched ? (
          <div className="rounded-lg border border-border bg-content p-3">
            <div className="font-medium text-ink">{sched.title}</div>
            <p className="text-sm text-ink-muted">{[sched.site_name, sched.asset_name].filter(Boolean).join(' · ')}</p>
            <p className="mt-1 text-xs text-ink-muted">{everyText(sched)}. {dueText(sched)}</p>
            {sched.instructions && <p className="mt-2 whitespace-pre-wrap text-sm text-ink">{sched.instructions}</p>}
            {sched.open_work_order && !skip && <p className="mt-2 text-xs text-ink-muted">Saving this closes work order #{sched.open_work_order.number}.</p>}
          </div>
        ) : (
          <>
            <Field label="Site">
              {(id) => (
                <Select id={id} value={site} onChange={(e) => changeSite(e.target.value)}>
                  {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Machine <span className="font-normal text-ink-muted">(optional)</span></span>
              {site ? <AssetPicker siteId={site} value={asset} onChange={setAsset} /> : <p className="text-sm text-ink-muted">Pick a site first.</p>}
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink">Kind of work</span>
              <Chips value={etype} onChange={setEtype} options={ENTRY_TYPES.map((t) => ({ value: t, label: ENTRY_TYPE[t] }))} />
            </div>
            <Field label="What was done" required>
              {(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Replaced the chain roller on the conveyor" />}
            </Field>
          </>
        )}

        {skip ? (
          <WarnNote>Skipping moves the schedule on without doing the work. It shows in the log as skipped.</WarnNote>
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium text-ink">How it went</span>
            <div className="grid grid-cols-3 gap-1.5">
              {(['ok', 'follow_up', 'failed'] as EntryResult[]).map((r) => (
                <button key={r} type="button" onClick={() => setResult(r)}
                  className={cn('min-h-11 rounded-lg border px-2 text-sm font-medium transition',
                    result === r ? (r === 'ok' ? 'border-ok bg-ok-soft text-ok' : r === 'failed' ? 'border-danger bg-danger-soft text-danger' : 'border-warn bg-warn-soft text-warn') : 'border-border bg-card text-ink-muted')}>
                  {RESULT[r].label}
                </button>
              ))}
            </div>
            {(result === 'follow_up' || result === 'failed') && (
              <label className="mt-1 flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} className="size-4" />
                Open a follow-up work order{asset ? ` on ${asset.name}` : ''}
              </label>
            )}
          </div>
        )}

        <Field label={skip ? 'Why' : 'Notes'} required={skip}>
          {(id) => <Textarea id={id} value={notes} onChange={setNotes} placeholder={skip ? 'Cloth was changed last week during the rebuild' : 'What you found, what you did, anything the next person should know'} />}
        </Field>

        {!skip && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Parts used</span>
            {lines.length === 0 && <p className="text-xs text-ink-muted">{sched && sched.parts.length > 0 ? 'Loading this task\'s parts...' : 'None yet. Parts added here come off the shelf, like Consume.'}</p>}
            {lines.map((l) => (
              <div key={l.key} className="flex flex-col gap-1.5 rounded-lg border border-border p-2">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{l.part_name}</span>
                  <div className="w-20 shrink-0">
                    <Input aria-label={`How many ${l.part_name}`} inputMode="decimal" value={l.qty} onFocus={(e) => e.target.select()}
                      onChange={(e) => setLine(l.key, { qty: e.target.value })} className="text-center" />
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`Take ${l.part_name} off`} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}><Trash2 className="size-4" /></Button>
                </div>
                {l.options.length === 0 ? (
                  <p className="text-xs text-danger">None stocked anywhere you can take it from at this site.</p>
                ) : (
                  <Select aria-label={`Where the ${l.part_name} came from`} value={l.location_id} onChange={(e) => setLine(l.key, { location_id: e.target.value })}>
                    {l.options.map((o) => <option key={o.location_id} value={o.location_id}>{o.location_name}{o.site_name && o.site_id !== site ? ` (${o.site_name})` : ''}: {qty(o.available)} free</option>)}
                  </Select>
                )}
              </div>
            ))}
            {site && <PartSearch onPick={(p) => void addPart(p)} exclude={lines.map((l) => l.part_id)} />}
          </div>
        )}

        {!skip && (
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium text-ink">Photos</span>
            <div className="flex flex-wrap gap-2">
              {photos.map((p, i) => (
                <div key={p.url} className="relative size-20 overflow-hidden rounded-lg border border-border">
                  <img src={p.url} alt={`Photo ${i + 1}`} className="size-full object-cover" />
                  <button type="button" aria-label="Remove photo" onClick={() => setPhotos((ps) => ps.filter((x) => x.url !== p.url))}
                    className="absolute right-1 top-1 grid size-6 place-items-center rounded-full bg-shell/70 text-white"><X className="size-3.5" /></button>
                </div>
              ))}
              <label className="grid size-20 cursor-pointer place-items-center rounded-lg border border-dashed border-border text-ink-muted hover:bg-content">
                <span className="flex flex-col items-center gap-1 text-xs"><Camera className="size-5" /> Add</span>
                <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => { void addPhotos(e.target.files); e.target.value = '' }} />
              </label>
            </div>
          </div>
        )}

        <Field label="When">
          {(id) => <Input id={id} type="datetime-local" value={when} max={localInputValue()} onChange={(e) => setWhen(e.target.value)} />}
        </Field>

        {!skip && (
          <div className="rounded-lg border border-border">
            <button type="button" onClick={() => setMore((m) => !m)} className="flex min-h-11 w-full items-center justify-between px-3 text-sm font-medium text-ink">
              Time, downtime, vendor and machine status
              <ChevronDown className={cn('size-4 transition', more && 'rotate-180')} />
            </button>
            {more && (
              <div className="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2">
                <Field label="Time spent (minutes)">{(id) => <Input id={id} inputMode="numeric" value={labor} onChange={(e) => setLabor(e.target.value.replace(/[^0-9]/g, ''))} placeholder="45" />}</Field>
                <Field label="Machine down (minutes)">{(id) => <Input id={id} inputMode="numeric" value={downtime} onChange={(e) => setDowntime(e.target.value.replace(/[^0-9]/g, ''))} placeholder="0" />}</Field>
                <Field label="Done by a vendor">
                  {(id) => (
                    <Select id={id} value={vendor} onChange={(e) => setVendor(e.target.value)}>
                      <option value="">No, our team</option>
                      {refs.vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                    </Select>
                  )}
                </Field>
                <Field label="Vendor or outside cost ($)">{(id) => <Input id={id} inputMode="decimal" value={outside} onChange={(e) => setOutside(e.target.value.replace(/[^0-9.]/g, ''))} placeholder="0.00" />}</Field>
                {asset && (
                  <Field label={`After this, ${asset.name} is`} className="sm:col-span-2">
                    {(id) => (
                      <Select id={id} value={assetStatus} onChange={(e) => setAssetStatus(e.target.value)}>
                        <option value="">No change</option>
                        {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                      </Select>
                    )}
                  </Field>
                )}
              </div>
            )}
          </div>
        )}

        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="sticky bottom-0 -mx-5 -mb-4 flex justify-end gap-2 border-t border-border bg-card px-5 py-3">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button size="lg" onClick={() => void save()} disabled={busy}>{busy ? 'Saving...' : skip ? 'Skip it' : 'Save to the log'}</Button>
        </div>
      </div>
    </Modal>
  )
}
