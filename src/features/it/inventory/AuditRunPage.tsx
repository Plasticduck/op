import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import {
  ArrowLeft,
  Camera,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  EllipsisVertical,
  Flag,
  Loader2,
  MapPin,
  Printer,
  ScanLine,
  X,
} from 'lucide-react'
import { StatCardRow } from '@/components/data/StatCardRow'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { primeScanSound } from '@/lib/scan/feedback'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import { cn } from '@/lib/utils'
import {
  itInventory,
  type AuditScan,
  type AuditSummary,
  type ItAssetRow,
  type ItAuditItem,
  type ItAuditRun,
  type ItCustomField,
} from '@/lib/queries/itInventory'
import { fieldsFor } from './customFields'
import { friendlyError } from './format'
import { Footer, NoteField, StatusDialog } from './ItemActions'
import { PrintDialog } from './PrintDialog'
import { parseScan } from './scan'
import { useItRefs, type ItRefs } from './useItRefs'

// One site audit. While it's open: walk the site in area order with the
// camera scanning continuously; each sticker marks its item found. Tap an
// item to mark it missing or damaged, note a faded sticker, say where it
// really is, update the fields an audit may change, or add a photo. Finishing
// applies it all to the equipment (it_complete_audit). Once finished, the
// same page is the report, with the follow-ups: lost items, damaged items,
// stickers to reprint, stickers that aren't in the inventory yet.

type Result = ItAuditItem['result']
const RESULT: Record<Result, { label: string; tone: 'ok' | 'danger' | 'warn' | 'neutral' | 'accent'; icon: typeof CircleCheck }> = {
  not_checked: { label: 'Not checked', tone: 'neutral', icon: CircleDashed },
  found: { label: 'Found', tone: 'ok', icon: CircleCheck },
  missing: { label: 'Missing', tone: 'danger', icon: CircleX },
  damaged: { label: 'Damaged', tone: 'warn', icon: CircleAlert },
  wrong_location: { label: 'Wrong site', tone: 'warn', icon: MapPin },
  unregistered: { label: 'Not in inventory', tone: 'accent', icon: Flag },
}
const STICKER = [
  { key: 'ok', label: 'Readable' },
  { key: 'faded', label: 'Faded' },
  { key: 'missing', label: 'Missing' },
] as const

export function AuditRunPage({ runId }: { runId: string }) {
  const { refs } = useItRefs()
  const [run, setRun] = useState<ItAuditRun | null>(null)
  const [items, setItems] = useState<ItAuditItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [r, i] = await Promise.all([itInventory.auditRun(runId), itInventory.auditItems(runId)])
    if (r.error || i.error) setError((r.error ?? i.error)!.message)
    setRun(r.data ?? null)
    setItems(i.data)
  }, [runId])
  useEffect(() => { void load() }, [load])
  // Someone else may be walking the other end of the site.
  useEffect(() => {
    const onFocus = () => { if (document.visibilityState === 'visible') void load() }
    document.addEventListener('visibilitychange', onFocus)
    return () => document.removeEventListener('visibilitychange', onFocus)
  }, [load])

  if (error && !run) return <p className="m-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{friendlyError(error)}</p>
  if (!run || !items || !refs) return <div className="grid h-full place-items-center text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  return run.status === 'in_progress'
    ? <Walk run={run} items={items} refs={refs} reload={load} />
    : <Report run={run} items={items} refs={refs} />
}

// ---- The walk -------------------------------------------------------------------------

function Walk({ run, items, refs, reload }: { run: ItAuditRun; items: ItAuditItem[]; refs: ItRefs; reload: () => Promise<void> }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations } = useLocations()
  const site = locations.find((l) => l.id === run.location_id)?.name ?? 'this site'
  const areas = useMemo(() => refs.areas.filter((a) => a.location_id === run.location_id), [refs, run.location_id])
  const [area, setArea] = useState('')
  const [scanning, setScanning] = useState(false)
  const [typed, setTyped] = useState('')
  const [last, setLast] = useState<{ scan: AuditScan } | { message: string; tone: 'danger' | 'neutral' } | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [onlyLeft, setOnlyLeft] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const [menu, setMenu] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busyScan = useRef(false)

  const expected = items.filter((i) => i.expected)
  const left = expected.filter((i) => i.result === 'not_checked').length
  const checked = expected.length - left
  const extras = items.filter((i) => i.result === 'wrong_location' || i.result === 'unregistered')
  const groups = useMemo(() => {
    const here = items.filter((i) => i.result !== 'wrong_location' && i.result !== 'unregistered')
      .filter((i) => !onlyLeft || i.result === 'not_checked')
    const out = areas.map((a) => ({ id: a.id, name: a.name, items: here.filter((i) => i.listed_area_id === a.id) }))
    const known = new Set(areas.map((a) => a.id))
    out.push({ id: '', name: 'No area set', items: here.filter((i) => !i.listed_area_id || !known.has(i.listed_area_id)) })
    return out.filter((g) => g.items.length)
  }, [items, areas, onlyLeft])

  // The area you're in starts as the first one with something left to check.
  useEffect(() => {
    if (area) return
    const next = areas.find((a) => items.some((i) => i.listed_area_id === a.id && i.result === 'not_checked'))
    if (next) setArea(next.id)
  }, [area, areas, items])

  const scan = useCallback(async (raw: string) => {
    if (busyScan.current) return
    const p = parseScan(raw)
    if (!p) { setLast({ message: "That isn't one of our stickers.", tone: 'danger' }); return }
    if (p.short && p.short !== refs.settings.short_code) { setLast({ message: "That sticker is from another company's inventory.", tone: 'danger' }); return }
    busyScan.current = true
    let res: Awaited<ReturnType<typeof itInventory.auditScan>>
    try {
      res = await itInventory.auditScan(run.id, p.tag, area || null)
    } catch {
      res = { data: null, error: "That scan didn't save. Check your signal and try again." }
    } finally {
      busyScan.current = false
    }
    const { data, error: err } = res
    if (err || !data) { setLast({ message: friendlyError(err ?? "That scan didn't save. Try again."), tone: 'danger' }); return }
    setLast({ scan: data })
    void reload()
  }, [run.id, area, refs.settings.short_code, reload])

  const patch = async (id: string, change: Parameters<typeof itInventory.updateAuditItem>[1]) => {
    setError(null)
    const { error: err } = await itInventory.updateAuditItem(id, change)
    if (err) setError(friendlyError(err.message))
    await reload()
  }

  const finish = async (markRestMissing: boolean, note: string) => {
    setBusy(true)
    setError(null)
    if (markRestMissing) {
      const { error: err } = await itInventory.markUnchecked(run.id, 'missing')
      if (err) { setBusy(false); setError(friendlyError(err.message)); return }
    }
    const { error: err } = await itInventory.completeAudit(run.id, note)
    setBusy(false)
    if (err) { setError(friendlyError(err)); return }
    setFinishing(false)
    await reload()
  }

  const cancel = async () => {
    setBusy(true)
    const { error: err } = await itInventory.cancelAudit(run.id)
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); setCanceling(false); return }
    navigate('/app/it-inventory/audits')
  }

  const areaName = (id: string | null) => (id ? refs.area.get(id)?.name ?? 'another area' : 'no area')

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-3xl lg:px-8 lg:py-4">
      <div className="flex min-h-0 flex-1 flex-col bg-card lg:rounded-md lg:border lg:border-border">
        {/* Header */}
        <div className="border-b border-border px-2 py-2.5 sm:px-3">
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => navigate('/app/it-inventory/audits')} aria-label="Back to audits"
              className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-content">
              <ArrowLeft className="size-5" />
            </button>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] text-ink-subtle">Audit · started {format(new Date(run.started_at), 'MMM d, h:mm a')}</div>
              <h1 className="truncate text-[17px] font-semibold text-ink">{site}</h1>
            </div>
            <Button size="sm" onClick={() => setFinishing(true)}>Finish</Button>
            <div className="relative">
              <button type="button" onClick={() => setMenu(!menu)} aria-label="More"
                className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content">
                <EllipsisVertical className="size-4" />
              </button>
              {menu && (
                <div className="absolute right-0 top-full z-20 mt-1 w-48 rounded-md border border-border bg-card py-1 shadow-md">
                  <button type="button" onClick={() => { setMenu(false); setCanceling(true) }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-content">
                    <X className="size-4" /> Stop this audit
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 flex items-center gap-3 px-1">
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-border/60" role="progressbar" aria-valuemin={0} aria-valuemax={expected.length} aria-valuenow={checked}>
              <div className="h-full rounded-full bg-ok transition-all" style={{ width: `${expected.length ? (checked / expected.length) * 100 : 100}%` }} />
            </div>
            <span className="shrink-0 text-xs tabular-nums text-ink-muted">{checked} of {expected.length} checked</span>
          </div>
        </div>

        {/* Scanner */}
        <div className="border-b border-border px-3 py-2.5">
          <div className="flex items-center gap-2">
            <Select value={area} onChange={(e) => setArea(e.target.value)} aria-label="The area you're in" className="h-10 flex-1">
              <option value="">Area: not sure</option>
              {areas.map((a) => <option key={a.id} value={a.id}>In: {a.name}</option>)}
            </Select>
            <Button variant={scanning ? 'secondary' : 'primary'} onClick={() => { primeScanSound(); setScanning(!scanning) }}>
              <ScanLine className="size-4" /> {scanning ? 'Stop' : 'Scan'}
            </Button>
          </div>
          {scanning && <BarcodeScanner continuous onDetect={scan} className="mt-2 h-[38vh] min-h-[220px] rounded-md" />}
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (typed.trim()) { void scan(typed); setTyped('') } }}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a tag" aria-label="Type a tag"
              className="font-mono uppercase placeholder:font-sans placeholder:normal-case" autoCapitalize="characters" autoComplete="off" />
            <Button type="submit" variant="secondary" disabled={!typed.trim()}>Check</Button>
          </form>
          {last && <LastScan last={last} run={run} area={area} areaName={areaName} items={items} patch={patch} rescan={scan} onClose={() => setLast(null)} />}
        </div>

        {/* The list */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(2rem+env(safe-area-inset-bottom))]">
          {error && <p className="mb-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <label className="mb-3 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={onlyLeft} onChange={(e) => setOnlyLeft(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent" />
            Only what's left ({left})
          </label>
          {expected.length === 0 && <p className="text-sm text-ink-muted">Nothing is registered at this site. Scan anything you find; it's noted for after the audit.</p>}
          <div className="space-y-4">
            {groups.map((g) => {
              const done = g.items.filter((i) => i.result !== 'not_checked').length
              return (
                <section key={g.id || 'none'}>
                  <div className="mb-1.5 flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
                    <span>{g.name}</span>
                    <span className="tabular-nums">{done} of {g.items.length}</span>
                  </div>
                  <ul className="divide-y divide-border rounded-md border border-border">
                    {g.items.map((i) => (
                      <ItemRow key={i.id} item={i} refs={refs} areas={areas} open={openId === i.id}
                        onToggle={() => setOpenId(openId === i.id ? null : i.id)} patch={patch}
                        accountId={profile?.account_id ?? ''} runId={run.id} onError={setError} />
                    ))}
                  </ul>
                </section>
              )
            })}
            {extras.length > 0 && (
              <section>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Turned up during the walk</div>
                <ul className="divide-y divide-border rounded-md border border-border">
                  {extras.map((i) => (
                    <li key={i.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                      <ResultIcon result={i.result} />
                      <span className="min-w-0 flex-1">
                        <span className="text-ink">{i.asset?.name ?? (i.result === 'unregistered' ? 'Not in IT Inventory' : 'Registered at another site')}</span>
                        <span className="ml-2 font-mono text-[11px] text-ink-subtle">{i.tag}</span>
                      </span>
                      <Badge tone={RESULT[i.result].tone}>{RESULT[i.result].label}</Badge>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        </div>
      </div>

      {finishing && (
        <FinishDialog left={left} busy={busy} error={error} onClose={() => { setFinishing(false); setError(null) }} onFinish={finish} />
      )}
      <ConfirmDialog
        open={canceling}
        title="Stop this audit?"
        description="Nothing about the equipment changes, and what you've scanned is set aside. You can start a new audit any time."
        confirmLabel="Stop audit"
        destructive
        loading={busy}
        onCancel={() => setCanceling(false)}
        onConfirm={() => void cancel()}
      />
    </div>
  )
}

function ResultIcon({ result }: { result: Result }) {
  const r = RESULT[result]
  return (
    <r.icon className={cn('size-5 shrink-0',
      r.tone === 'ok' ? 'text-ok' : r.tone === 'danger' ? 'text-danger' : r.tone === 'warn' ? 'text-warn' : r.tone === 'accent' ? 'text-accent' : 'text-ink-subtle')} />
  )
}

// What the last scan did, with the follow-up right there.
function LastScan({ last, run, area, areaName, items, patch, rescan, onClose }: {
  last: { scan: AuditScan } | { message: string; tone: 'danger' | 'neutral' }
  run: ItAuditRun
  area: string
  areaName: (id: string | null) => string
  items: ItAuditItem[]
  patch: (id: string, change: Parameters<typeof itInventory.updateAuditItem>[1]) => Promise<void>
  rescan: (tag: string) => Promise<void>
  onClose: () => void
}) {
  const [moving, setMoving] = useState(false)
  const [moveError, setMoveError] = useState<string | null>(null)
  let body: ReactNode = null
  let tone = 'bg-content'
  if ('message' in last) {
    tone = last.tone === 'danger' ? 'bg-danger-soft text-danger' : 'bg-content'
    body = <span>{last.message}</span>
  } else {
    const s = last.scan
    if (s.result === 'found' || s.result === 'damaged') {
      const item = items.find((i) => i.id === s.item_id)
      tone = 'bg-ok-soft'
      body = (
        <div className="space-y-2">
          <div className="text-ok">
            <span className="font-semibold">{s.again ? 'Already checked' : 'Found'}:</span> <span className="font-mono">{s.tag}</span> {s.name}
          </div>
          {s.found_area_id && (
            <div className="text-xs text-ink">Listed in {areaName(s.listed_area_id)}. It moves to {areaName(s.found_area_id)} when you finish.</div>
          )}
          {item && (
            <div className="flex flex-wrap items-center gap-2 text-xs text-ink">
              Sticker:
              <span className="inline-flex rounded-lg border border-border bg-card p-0.5">
                {STICKER.map((o) => (
                  <button key={o.key} type="button" onClick={() => void patch(item.id, { sticker_condition: o.key })}
                    className={cn('rounded-md px-2 py-1 font-medium transition',
                      item.sticker_condition === o.key ? (o.key === 'ok' ? 'bg-ok-soft text-ok' : 'bg-warn-soft text-warn') : 'text-ink-muted')}>
                    {o.label}
                  </button>
                ))}
              </span>
            </div>
          )}
        </div>
      )
    } else if (s.result === 'wrong_location') {
      tone = 'bg-warn-soft'
      body = (
        <div className="space-y-2 text-ink">
          <div>
            <span className="font-semibold text-warn">Wrong site:</span> <span className="font-mono">{s.tag}</span>{s.name ? ` ${s.name}` : ''} is registered at {s.site}.
          </div>
          {s.can_move ? (
            <Button size="sm" variant="secondary" disabled={moving} onClick={() => {
              setMoving(true)
              setMoveError(null)
              void itInventory.move([s.asset_id], run.location_id, area || null, `Found here during an audit`).then(async (res) => {
                const failed = res.error ?? res.items.find((x) => !x.ok)?.error
                if (failed) { setMoving(false); setMoveError(friendlyError(failed)); return }
                await rescan(s.tag)
                setMoving(false)
              })
            }}>
              {moving ? <Loader2 className="size-3.5 animate-spin" /> : <MapPin className="size-3.5" />} Move it here
            </Button>
          ) : <div className="text-xs text-ink-muted">Someone who manages {s.site} can move it here. It's noted on the audit.</div>}
          {moveError && <div className="text-xs text-danger">{moveError}</div>}
        </div>
      )
    } else if (s.result === 'unregistered') {
      tone = 'bg-accent-soft'
      body = (
        <div className="text-ink">
          <span className="font-semibold text-accent">Not in IT Inventory:</span> <span className="font-mono">{s.tag}</span>.{' '}
          {s.unused ? "It's a blank sticker from your tag pool." : "We don't know this sticker."} It's noted so you can add it after the audit.
        </div>
      )
    }
  }
  return (
    <div className={cn('mt-2 flex items-start gap-2 rounded-md px-3 py-2 text-sm', tone)} role="status">
      <div className="min-w-0 flex-1">{body}</div>
      <button type="button" onClick={onClose} aria-label="Dismiss" className="shrink-0 text-ink-subtle hover:text-ink"><X className="size-4" /></button>
    </div>
  )
}

function ItemRow({ item, refs, areas, open, onToggle, patch, accountId, runId, onError }: {
  item: ItAuditItem
  refs: ItRefs
  areas: ItRefs['areas']
  open: boolean
  onToggle: () => void
  patch: (id: string, change: Parameters<typeof itInventory.updateAuditItem>[1]) => Promise<void>
  accountId: string
  runId: string
  onError: (message: string) => void
}) {
  const a = item.asset
  const fields = a ? fieldsFor(refs, a.category_id, a.model_id).filter((f) => f.editable_during_audit) : []
  const [note, setNote] = useState(item.note ?? '')
  const [uploading, setUploading] = useState(false)
  const photo = useRef<HTMLInputElement>(null)
  const values = { ...((a?.custom_values as Record<string, unknown> | null) ?? {}), ...((item.custom_values as Record<string, unknown>) ?? {}) }

  const addPhoto = async (file: File) => {
    setUploading(true)
    const { path, error } = await itInventory.uploadAuditPhoto(accountId, runId, await shrinkPhoto(file))
    if (path) await patch(item.id, { photo_path: path })
    setUploading(false)
    if (error) onError(friendlyError(error))
  }

  return (
    <li>
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-content">
        <ResultIcon result={item.result} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink">{a?.name ?? item.tag}</span>
          <span className="block truncate text-xs text-ink-muted">
            <span className="font-mono">{item.tag}</span>
            {a?.assigned_label && ` · checked out to ${a.assigned_label}`}
            {item.found_area_id && ` · moving to ${refs.area.get(item.found_area_id)?.name ?? 'another area'}`}
            {!item.expected && ' · not on the list'}
          </span>
        </span>
        {(item.sticker_condition === 'faded' || item.sticker_condition === 'missing') && <Badge tone="warn">Sticker {item.sticker_condition}</Badge>}
        {item.result !== 'not_checked' && <Badge tone={RESULT[item.result].tone}>{RESULT[item.result].label}</Badge>}
      </button>
      {open && (
        <div className="space-y-3 border-t border-border bg-content/40 px-3 py-3">
          <Choice label="It's" value={item.result} onChange={(v) => void patch(item.id, { result: v as Result })}
            options={[['found', 'Here'], ['missing', 'Missing'], ['damaged', 'Damaged']]} />
          {item.result !== 'missing' && (
            <Choice label="Sticker" value={item.sticker_condition ?? ''} onChange={(v) => void patch(item.id, { sticker_condition: v as 'ok' })}
              options={STICKER.map((s) => [s.key, s.label] as const)} />
          )}
          {item.result !== 'missing' && (
            <div className="flex items-center gap-3 text-sm">
              <span className="w-16 shrink-0 text-ink-muted">Where</span>
              <Select value={item.found_area_id ?? item.listed_area_id ?? ''} className="h-9"
                onChange={(e) => void patch(item.id, { found_area_id: e.target.value && e.target.value !== item.listed_area_id ? e.target.value : null })}>
                {!item.listed_area_id && <option value="">No area set</option>}
                {areas.map((ar) => <option key={ar.id} value={ar.id}>{ar.name}{ar.id === item.listed_area_id ? ' (listed)' : ''}</option>)}
              </Select>
            </div>
          )}
          {item.result !== 'missing' && fields.map((f) => (
            <AuditField key={f.id} field={f} value={values[f.key]}
              onSave={(v) => void patch(item.id, { custom_values: { ...((item.custom_values as Record<string, unknown>) ?? {}), [f.key]: v } as never })} />
          ))}
          <div className="flex items-start gap-3 text-sm">
            <span className="w-16 shrink-0 pt-2 text-ink-muted">Note</span>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2}
              onBlur={() => { if (note.trim() !== (item.note ?? '')) void patch(item.id, { note: note.trim() || null }) }}
              placeholder={item.result === 'damaged' ? "What's damaged" : 'Optional'}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className="w-16 shrink-0 text-ink-muted">Photo</span>
            <Button size="sm" variant="secondary" disabled={uploading} onClick={() => photo.current?.click()}>
              {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Camera className="size-3.5" />} {item.photo_path ? 'Replace photo' : 'Add a photo'}
            </Button>
            {item.photo_path && (
              <button type="button" className="text-xs font-medium text-accent hover:underline"
                onClick={() => { void itInventory.photoUrl(item.photo_path!).then((u) => { if (u) window.open(u, '_blank', 'noopener') }) }}>
                View
              </button>
            )}
            <input ref={photo} type="file" accept="image/*" capture="environment" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f); e.target.value = '' }} />
          </div>
          {a && <Link to={`/app/it-inventory/${a.id}`} className="inline-block text-xs font-medium text-accent hover:underline">Open its page</Link>}
        </div>
      )}
    </li>
  )
}

function Choice({ label, value, options, onChange }: { label: string; value: string; options: readonly (readonly [string, string])[]; onChange: (v: string) => void }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 text-ink-muted">{label}</span>
      <span className="inline-flex rounded-lg border border-border bg-card p-0.5">
        {options.map(([k, l]) => (
          <button key={k} type="button" onClick={() => onChange(k)}
            className={cn('rounded-md px-2.5 py-1 text-xs font-medium transition', value === k ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
            {l}
          </button>
        ))}
      </span>
    </div>
  )
}

// A custom field the audit may update (marked "editable during audit").
function AuditField({ field, value, onSave }: { field: ItCustomField; value: unknown; onSave: (v: unknown) => void }) {
  const [v, setV] = useState(value == null ? '' : String(value))
  const options = Array.isArray(field.options) ? (field.options as string[]) : []
  const save = (next: string) => {
    if (next === (value == null ? '' : String(value))) return
    onSave(field.field_type === 'number' ? (next === '' ? null : Number(next)) : next || null)
  }
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-16 shrink-0 truncate text-ink-muted" title={field.name}>{field.name}</span>
      {field.field_type === 'boolean' ? (
        <Select value={v} className="h-9" onChange={(e) => { setV(e.target.value); onSave(e.target.value === '' ? null : e.target.value === 'true') }}>
          <option value="">–</option><option value="true">Yes</option><option value="false">No</option>
        </Select>
      ) : field.field_type === 'select' ? (
        <Select value={v} className="h-9" onChange={(e) => { setV(e.target.value); save(e.target.value) }}>
          <option value="">–</option>
          {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </Select>
      ) : (
        <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => save(v.trim())} className="h-9"
          type={field.field_type === 'number' ? 'number' : field.field_type === 'date' ? 'date' : 'text'} />
      )}
    </div>
  )
}

function FinishDialog({ left, busy, error, onClose, onFinish }: {
  left: number
  busy: boolean
  error: string | null
  onClose: () => void
  onFinish: (markRestMissing: boolean, note: string) => void
}) {
  const [note, setNote] = useState('')
  return (
    <Modal open onClose={onClose} size="md" title={left ? `${left} ${left === 1 ? "item hasn't" : "items haven't"} been checked` : 'Finish the audit?'}
      description={left
        ? 'Keep looking, or mark them missing and finish. Missing items stay on the books; the report lets you mark them lost.'
        : 'Audit dates, sticker condition, areas and details update for everything you checked.'}>
      <NoteField value={note} onChange={setNote} placeholder="Anything worth knowing about this audit" />
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      <Footer busy={busy} onClose={onClose}>
        {left > 0 && <Button variant="secondary" onClick={onClose} disabled={busy}>Keep looking</Button>}
        <Button onClick={() => onFinish(left > 0, note)} disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />} {left ? `Mark ${left} missing and finish` : 'Finish audit'}
        </Button>
      </Footer>
    </Modal>
  )
}

// ---- The report ------------------------------------------------------------------------

function Report({ run, items, refs }: { run: ItAuditRun; items: ItAuditItem[]; refs: ItRefs }) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { locations } = useLocations()
  const siteName = (id: string | null) => (id ? locations.find((l) => l.id === id)?.name ?? 'another site' : '')
  const staff = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'
  const sum = run.summary as Partial<AuditSummary>
  const [action, setAction] = useState<null | { kind: 'lost' | 'damaged' | 'print'; assets: ItAssetRow[] }>(null)
  const [flash, setFlash] = useState<string | null>(null)
  const [loading, setLoading] = useState<string | null>(null)
  const by = (r: Result) => items.filter((i) => i.result === r)
  const stickers = items.filter((i) => (i.result === 'found' || i.result === 'damaged') && (i.sticker_condition === 'faded' || i.sticker_condition === 'missing'))

  // Follow-ups work on the current equipment rows.
  const follow = async (kind: 'lost' | 'damaged' | 'print', list: ItAuditItem[]) => {
    setLoading(kind)
    const { data } = await itInventory.assetsByIdsFull(list.map((i) => i.asset_id).filter((x): x is string => !!x))
    setLoading(null)
    const assets = ((data as unknown as ItAssetRow[] | null) ?? []).filter((a) => !a.deleted_at)
    if (assets.length) setAction({ kind, assets })
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 lg:px-8">
      <button type="button" onClick={() => navigate('/app/it-inventory/audits')} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Audits
      </button>
      <h1 className="mt-3 text-xl font-semibold tracking-tight text-ink">Audit: {siteName(run.location_id)}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {run.status === 'canceled' ? 'Stopped' : 'Finished'} {run.completed_at ? format(new Date(run.completed_at), 'MMM d, yyyy h:mm a') : ''}
        {' · started '}{format(new Date(run.started_at), 'MMM d, h:mm a')}
      </p>
      {run.note && <p className="mt-2 rounded-md bg-content px-3 py-2 text-sm text-ink">"{run.note}"</p>}
      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}

      {run.status === 'canceled' ? (
        <p className="mt-5 rounded-md border border-border bg-card p-4 text-sm text-ink-muted">This audit was stopped before it was finished, so nothing about the equipment changed.</p>
      ) : (
        <>
          <StatCardRow
            className="mt-5 grid-cols-2 sm:grid-cols-3"
            items={[
              { label: 'Found', value: sum.found ?? 0 },
              { label: 'Missing', value: sum.missing ?? 0 },
              { label: 'Damaged', value: sum.damaged ?? 0 },
              { label: 'Wrong site', value: sum.wrong_location ?? 0 },
              { label: 'Not in inventory', value: sum.unregistered ?? 0 },
              { label: 'Stickers to reprint', value: sum.stickers ?? 0 },
            ]}
          />
          <div className="mt-6 space-y-5">
            <ReportList title="Missing" items={by('missing')} refs={refs}
              action={staff && by('missing').length > 0 ? (
                <Button size="sm" variant="secondary" disabled={!!loading} onClick={() => void follow('lost', by('missing'))}>
                  {loading === 'lost' && <Loader2 className="size-3.5 animate-spin" />} Mark lost
                </Button>
              ) : undefined} />
            <ReportList title="Damaged" items={by('damaged')} refs={refs}
              action={staff && by('damaged').length > 0 ? (
                <Button size="sm" variant="secondary" disabled={!!loading} onClick={() => void follow('damaged', by('damaged'))}>
                  {loading === 'damaged' && <Loader2 className="size-3.5 animate-spin" />} Change status
                </Button>
              ) : undefined} />
            <ReportList title="Stickers to reprint" items={stickers} refs={refs}
              action={staff && stickers.length > 0 ? (
                <Button size="sm" variant="secondary" disabled={!!loading} onClick={() => void follow('print', stickers)}>
                  {loading === 'print' ? <Loader2 className="size-3.5 animate-spin" /> : <Printer className="size-3.5" />} Print
                </Button>
              ) : undefined} />
            <ReportList title="Wrong site" items={by('wrong_location')} refs={refs}
              detail={(i) => (i.other_site_id ? `Registered at ${siteName(i.other_site_id)}` : null)} />
            <ReportList title="Not in IT Inventory" items={by('unregistered')} refs={refs}
              rowAction={staff ? (i) => (
                <Button size="sm" variant="ghost" onClick={() => navigate(`/app/it-inventory?add=1&tag=${encodeURIComponent(i.tag ?? '')}`)}>Add it</Button>
              ) : undefined} />
            <ReportList title="Found" items={by('found')} refs={refs} collapsed />
          </div>
        </>
      )}

      {action?.kind === 'lost' && (
        <StatusDialog refs={refs} assets={action.assets} onClose={() => setAction(null)}
          initialStatusId={refs.statuses.find((s) => s.name.toLowerCase().startsWith('lost'))?.id}
          onDone={(m) => { setAction(null); setFlash(m) }} />
      )}
      {action?.kind === 'damaged' && (
        <StatusDialog refs={refs} assets={action.assets} onClose={() => setAction(null)}
          onDone={(m) => { setAction(null); setFlash(m) }} />
      )}
      {action?.kind === 'print' && (
        <PrintDialog refs={refs} assets={action.assets} onClose={() => setAction(null)}
          onPrinted={(m) => { setAction(null); setFlash(m) }} />
      )}
    </div>
  )
}

function ReportList({ title, items, refs, action, detail, rowAction, collapsed }: {
  title: string
  items: ItAuditItem[]
  refs: ItRefs
  action?: ReactNode
  detail?: (i: ItAuditItem) => string | null
  rowAction?: (i: ItAuditItem) => ReactNode
  collapsed?: boolean
}) {
  const [open, setOpen] = useState(!collapsed)
  if (!items.length) return null
  return (
    <section>
      <div className="mb-2 flex items-center justify-between gap-2">
        <button type="button" onClick={() => setOpen(!open)} className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle hover:text-ink">
          {title} ({items.length}){collapsed && !open ? ' · show' : ''}
        </button>
        {action}
      </div>
      {open && (
        <ul className="divide-y divide-border rounded-md border border-border bg-card">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
              <ResultIcon result={i.result} />
              <span className="min-w-0 flex-1">
                {i.asset ? (
                  <Link to={`/app/it-inventory/${i.asset.id}`} className="text-ink hover:underline">{i.asset.name}</Link>
                ) : <span className="text-ink">{i.result === 'unregistered' ? 'Sticker not in the inventory' : 'At a site you can\'t see'}</span>}
                <span className="ml-2 font-mono text-[11px] text-ink-subtle">{i.tag}</span>
                {(detail?.(i) || i.note || i.found_area_id) && (
                  <span className="block text-xs text-ink-muted">
                    {[detail?.(i), i.found_area_id && `Moved to ${refs.area.get(i.found_area_id)?.name ?? 'another area'}`, i.note && `"${i.note}"`].filter(Boolean).join(' · ')}
                  </span>
                )}
              </span>
              {i.photo_path && (
                <button type="button" className="text-xs font-medium text-accent hover:underline"
                  onClick={() => { void itInventory.photoUrl(i.photo_path!).then((u) => { if (u) window.open(u, '_blank', 'noopener') }) }}>
                  Photo
                </button>
              )}
              {rowAction?.(i)}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
