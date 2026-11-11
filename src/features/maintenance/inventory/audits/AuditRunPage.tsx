import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Loader2, ScanLine, X } from 'lucide-react'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { parseScan } from '@/features/it/inventory/scan'
import { miEquipment, type AuditDetail, type AuditItem, type AuditScanResult, type TagCondition } from '@/lib/queries/miEquipment'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { day, errText } from '../format'
import { ErrorNote, Loading, Muted } from '../ui'
import { EQUIPMENT_BASE, shortName, TAG_CONDITION } from '../equipment/format'

// One audit. Pick the zone you're standing in, then scan stickers as you walk (or type
// them, or tap a machine with no sticker). Each scan says what it found. Finish when
// everything's checked, or count what's left as missing.

const RESULT: Record<AuditItem['result'], { label: string; tone: 'neutral' | 'ok' | 'warn' | 'danger' | 'accent' }> = {
  not_checked: { label: 'Not checked', tone: 'neutral' },
  found: { label: 'Found', tone: 'ok' },
  missing: { label: 'Missing', tone: 'danger' },
  wrong_site: { label: 'Wrong site', tone: 'warn' },
  unregistered: { label: 'Unknown sticker', tone: 'warn' },
}

export default function AuditRunPage() {
  const { runId = '' } = useParams()
  const navigate = useNavigate()
  const { notify } = useMi()
  const [d, setD] = useState<AuditDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [area, setArea] = useState('')
  const [scanning, setScanning] = useState(false)
  const [typed, setTyped] = useState('')
  const [last, setLast] = useState<{ text: string; tone: 'ok' | 'warn' | 'danger' } | null>(null)
  const [open, setOpen] = useState<string | null>(null)
  const [blank, setBlank] = useState<string | null>(null)
  const [finishing, setFinishing] = useState(false)
  const [cancelling, setCancelling] = useState(false)

  const load = useCallback(async () => {
    try {
      setD(await miEquipment.auditDetail(runId))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [runId])
  useEffect(() => { void load() }, [load])

  const areaName = useMemo(() => new Map((d?.areas ?? []).map((a) => [a.id, a.name])), [d])
  const expected = useMemo(() => (d?.items ?? []).filter((i) => i.expected), [d])
  const extras = useMemo(() => (d?.items ?? []).filter((i) => !i.expected), [d])
  const checked = expected.filter((i) => i.result !== 'not_checked').length
  const groups = useMemo(() => {
    const m = new Map<string, AuditItem[]>()
    for (const i of expected) {
      const k = i.listed_area_id ? areaName.get(i.listed_area_id) ?? 'No zone' : 'No zone'
      m.set(k, [...(m.get(k) ?? []), i])
    }
    return [...m.entries()]
  }, [expected, areaName])

  const scan = useCallback(async (raw: string) => {
    const code = parseScan(raw)?.tag ?? raw.trim().toUpperCase()
    if (!code) return
    try {
      const r: AuditScanResult = await miEquipment.auditScan(runId, code, area || null)
      if (r.result === 'found') setLast({ text: `${shortName(r.name)}: ${r.again ? 'already found' : r.unlisted ? 'found (wasn\'t on the list)' : 'found'}${r.moved ? ', in a different zone' : ''}.`, tone: r.unlisted || r.moved ? 'warn' : 'ok' })
      else if (r.result === 'wrong_site') setLast({ text: `${shortName(r.name)} belongs at ${r.other_site}.`, tone: 'warn' })
      else if (r.result === 'unregistered') setLast({ text: `${r.code} isn't on any machine. Noted.`, tone: 'warn' })
      else if (r.result === 'retired') setLast({ text: `${r.code} was replaced. Peel it off.`, tone: 'danger' })
      else { setBlank(r.code); setScanning(false) }
      void load()
    } catch (e) {
      setLast({ text: errText(e), tone: 'danger' })
    }
  }, [runId, area, load])

  const mark = async (i: AuditItem, result: 'found' | 'missing' | 'not_checked', condition?: TagCondition) => {
    try {
      await miEquipment.auditMark(i.id, result, { condition: condition ?? null, area: result === 'found' && area ? area : null })
      void load()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  const run = d.run
  const live = run.status === 'in_progress'

  return (
    <div className="flex flex-col gap-3">
      <Link to="/app/maintenance-inventory/audits" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Audits</Link>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">Audit of {run.site_name}</h2>
          <p className="text-xs text-ink-muted">Started {day(run.started_at)} by {run.started_by_name ?? 'someone'}{run.scope === 'stickered' ? ' · machines with stickers' : ''}</p>
        </div>
        {live ? (
          <div className="flex gap-2">
            {run.can_cancel && <Button variant="ghost" size="sm" onClick={() => setCancelling(true)}>Cancel audit</Button>}
            <Button size="sm" onClick={() => setFinishing(true)}><Check className="size-4" /> Finish</Button>
          </div>
        ) : <Badge tone={run.status === 'completed' ? 'ok' : 'neutral'}>{run.status === 'completed' ? `Finished ${day(run.completed_at)}` : 'Cancelled'}</Badge>}
      </div>

      <div className="h-2 overflow-hidden rounded-full bg-border">
        <div className="h-full bg-ok transition-all" style={{ width: `${expected.length ? (checked / expected.length) * 100 : 0}%` }} />
      </div>
      <p className="text-xs text-ink-muted">{checked} of {expected.length} checked</p>

      {run.summary && (
        <div className="flex flex-wrap gap-1.5">
          <Badge tone="ok">{run.summary.found} found</Badge>
          <Badge tone={run.summary.missing ? 'danger' : 'neutral'}>{run.summary.missing} missing</Badge>
          {run.summary.moved > 0 && <Badge tone="accent">{run.summary.moved} moved zones</Badge>}
          {run.summary.wrong_site > 0 && <Badge tone="warn">{run.summary.wrong_site} from other sites</Badge>}
          {run.summary.unregistered > 0 && <Badge tone="warn">{run.summary.unregistered} unknown stickers</Badge>}
          {run.summary.stickers_bad > 0 && <Badge tone="warn">{run.summary.stickers_bad} stickers to replace</Badge>}
          {run.summary.no_sticker > 0 && <Badge>{run.summary.no_sticker} found without a sticker</Badge>}
        </div>
      )}

      {live && (
        <div className="flex flex-col gap-2 rounded-md border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2">
            <Select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Zone you're in" className="w-full sm:w-56">
              <option value="">Zone: wherever it's listed</option>
              {d.areas.map((a) => <option key={a.id} value={a.id}>I'm in {a.name}</option>)}
            </Select>
            <Button variant={scanning ? 'secondary' : 'primary'} onClick={() => { primeScanSound(); setScanning((v) => !v) }}>
              <ScanLine className="size-4" /> {scanning ? 'Stop scanning' : 'Scan stickers'}
            </Button>
            <form className="flex flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void scan(typed); setTyped('') }}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a sticker" autoCapitalize="characters" className="min-w-[140px] flex-1 font-mono" />
              <Button type="submit" variant="secondary" disabled={!typed.trim()}>Check</Button>
            </form>
          </div>
          {scanning && <BarcodeScanner continuous onDetect={scan} className="aspect-[4/3] w-full max-w-md overflow-hidden rounded-md" />}
          {last && <p className={cn('rounded-md px-3 py-2 text-sm', last.tone === 'ok' ? 'bg-ok-soft text-ok' : last.tone === 'warn' ? 'bg-warn-soft text-warn' : 'bg-danger-soft text-danger')}>{last.text}</p>}
        </div>
      )}

      {groups.map(([zone, items]) => (
        <section key={zone}>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{zone} ({items.filter((i) => i.result !== 'not_checked').length}/{items.length})</h3>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {items.map((i) => (
              <li key={i.id}>
                <button type="button" onClick={() => setOpen(open === i.id ? null : i.id)} className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-content">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{i.name ? shortName(i.name) : i.tag}</span>
                    <span className="block truncate text-xs text-ink-muted">
                      {[i.tag ?? 'no sticker', i.found_area_id && i.found_area_id !== i.listed_area_id ? `found in ${areaName.get(i.found_area_id)}` : null,
                        i.sticker_condition && i.sticker_condition !== 'ok' ? `sticker ${TAG_CONDITION[i.sticker_condition].label.toLowerCase()}` : null].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Badge tone={RESULT[i.result].tone}>{RESULT[i.result].label}</Badge>
                </button>
                {open === i.id && live && (
                  <div className="flex flex-wrap items-center gap-1.5 border-t border-border bg-content px-3 py-2">
                    <Button size="sm" onClick={() => void mark(i, 'found')}>Found</Button>
                    <Button size="sm" variant="secondary" onClick={() => void mark(i, 'missing')}>Missing</Button>
                    {i.result !== 'not_checked' && <Button size="sm" variant="ghost" onClick={() => void mark(i, 'not_checked')}>Undo</Button>}
                    {i.tag && (
                      <span className="ml-auto flex flex-wrap gap-1">
                        {(Object.keys(TAG_CONDITION) as TagCondition[]).map((c) => (
                          <button key={c} type="button" onClick={() => void mark(i, i.result === 'missing' ? 'missing' : 'found', c)}
                            className={cn('rounded-full border px-2 py-0.5 text-xs', i.sticker_condition === c ? 'border-accent bg-accent-soft text-accent' : 'border-border text-ink-muted hover:text-ink')}>
                            {TAG_CONDITION[c].label}
                          </button>
                        ))}
                      </span>
                    )}
                    {i.equipment_id && <Link to={`${EQUIPMENT_BASE}/${i.equipment_id}`} className="w-full text-xs text-accent hover:underline">Open the machine</Link>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
      {expected.length === 0 && <Muted>Nothing on the list for this audit.</Muted>}

      {extras.length > 0 && (
        <section>
          <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Found along the way</h3>
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {extras.map((i) => (
              <li key={i.id} className="flex items-center gap-2 px-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ink">{i.name ? shortName(i.name) : <span className="font-mono">{i.tag}</span>}</span>
                  <span className="block truncate text-xs text-ink-muted">{i.result === 'wrong_site' ? `Belongs at ${i.other_site}` : i.result === 'unregistered' ? 'Not on any machine' : 'Not on the list'}</span>
                </span>
                <Badge tone={RESULT[i.result].tone}>{RESULT[i.result].label}</Badge>
              </li>
            ))}
          </ul>
        </section>
      )}

      {blank && <ClaimBlank code={blank} items={expected.filter((i) => !i.tag && i.equipment_id)} onClose={() => setBlank(null)}
        onClaimed={(name) => { setBlank(null); setLast({ text: `${blank} is on ${shortName(name)} now.`, tone: 'ok' }); void scan(blank) }} />}
      {finishing && <FinishDialog left={expected.length - checked} onClose={() => setFinishing(false)} onFinish={async (note, rest) => {
        await miEquipment.auditComplete(runId, note, rest)
        setFinishing(false)
        notify('Audit finished.')
        void load()
      }} />}
      <ConfirmDialog open={cancelling} title="Cancel this audit?" description="What's been checked so far is thrown away. Machines aren't changed." confirmLabel="Cancel audit" destructive
        onCancel={() => setCancelling(false)}
        onConfirm={() => { setCancelling(false); void miEquipment.auditCancel(runId).then(() => navigate('/app/maintenance-inventory/audits')).catch((e) => notify(errText(e), 'danger')) }} />
    </div>
  )
}

// A blank sticker scanned during the walk: put it on a machine that has none, then it counts.
function ClaimBlank({ code, items, onClose, onClaimed }: { code: string; items: AuditItem[]; onClose: () => void; onClaimed: (name: string) => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal open onClose={onClose} title={`${code} is a blank sticker`} description="Which machine are you putting it on? Machines here without a sticker:">
      <div className="flex max-h-[50vh] flex-col gap-1 overflow-y-auto">
        {error && <ErrorNote>{error}</ErrorNote>}
        {items.length === 0 && <Muted>Every machine on this audit already has a sticker. Use the machine's page to replace one.</Muted>}
        {items.map((i) => (
          <button key={i.id} type="button" disabled={!!busy} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-content"
            onClick={() => {
              setBusy(i.id)
              void miEquipment.claimTag(code, i.equipment_id!).then(() => onClaimed(i.name ?? code)).catch((e) => { setError(errText(e)); setBusy(null) })
            }}>
            <span className="truncate text-ink">{i.name ? shortName(i.name) : i.equipment_id}</span>
            {busy === i.id && <Loader2 className="size-4 animate-spin" />}
          </button>
        ))}
      </div>
      <div className="mt-3 flex justify-end"><Button variant="secondary" onClick={onClose}><X className="size-4" /> Not now</Button></div>
    </Modal>
  )
}

function FinishDialog({ left, onClose, onFinish }: { left: number; onClose: () => void; onFinish: (note: string, restMissing: boolean) => Promise<void> }) {
  const [note, setNote] = useState('')
  const [rest, setRest] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal open onClose={onClose} title="Finish the audit?" size="sm"
      description="Found machines are marked audited today and moved to the zone they were found in. Stickers marked faded, missing or damaged go in the print queue.">
      <div className="flex flex-col gap-3">
        {left > 0 && (
          <label className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            <input type="checkbox" checked={rest} onChange={(e) => setRest(e.target.checked)} className="mt-0.5 size-4 rounded border-border" />
            {left} not checked yet. Count {left === 1 ? 'it' : 'them'} as missing.
          </label>
        )}
        <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional)" />
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Keep going</Button>
          <Button disabled={busy || (left > 0 && !rest)} onClick={() => { setBusy(true); void onFinish(note, rest).catch((e) => { setError(errText(e)); setBusy(false) }) }}>
            {busy && <Loader2 className="size-4 animate-spin" />} Finish
          </Button>
        </div>
      </div>
    </Modal>
  )
}
