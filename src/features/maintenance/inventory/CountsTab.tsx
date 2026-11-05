import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowLeft, Check, Plus, ScanLine } from 'lucide-react'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { parseScan } from '@/features/it/inventory/scan'
import { mi, type CountDetail, type CountRow } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { COUNT_STATUS, day, errText, money, qty, REASON_CODES } from './format'
import { act } from './offline'
import { Chips, ErrorNote, Loading, Muted, WarnNote } from './ui'

const BASE = '/app/maintenance-inventory'

export default function CountsTab() {
  const { id } = useParams()
  return id ? <CountPage id={id} /> : <CountList />
}

function CountList() {
  const { me } = useMi()
  const navigate = useNavigate()
  const [filter, setFilter] = useState('open')
  const [rows, setRows] = useState<CountRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  useEffect(() => {
    let alive = true
    mi.counts(filter === 'all' ? null : filter).then((r) => { if (alive) { setRows(r); setError(null) } }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [filter])
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chips value={filter} onChange={setFilter} options={[{ value: 'open', label: 'Open' }, { value: 'posted', label: 'Posted' }, { value: 'all', label: 'All' }]} />
        {me.rank >= 2 && <Button className="sm:ml-auto" onClick={() => setAdding(true)}><Plus className="size-4" /> New count</Button>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && <Muted>No counts here.</Muted>}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
          {rows.map((c) => (
            <li key={c.id}>
              <Link to={`${BASE}/counts/${c.id}`} className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-content">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-medium text-ink">Count {c.number}</span>
                    {c.blind && <Badge>Blind</Badge>}
                    {c.forced && <Badge tone="danger">Stock went negative</Badge>}
                    {c.scheduled && <Badge>Scheduled</Badge>}
                  </div>
                  <p className="truncate text-xs text-ink-muted">{c.location_name}, {c.counted} of {c.lines} counted{c.due_date ? `, due ${day(c.due_date)}` : ''}</p>
                </div>
                <Badge tone={COUNT_STATUS[c.status].tone}>{COUNT_STATUS[c.status].label}</Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {adding && <NewCount onClose={() => setAdding(false)} onCreated={(cid) => navigate(`${BASE}/counts/${cid}`)} />}
    </div>
  )
}

function NewCount({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const { refs } = useMi()
  const locations = refs.locations.filter((l) => l.can_manage && l.active)
  const [location, setLocation] = useState(locations[0]?.id ?? '')
  const [scope, setScope] = useState('location')
  const [value, setValue] = useState('')
  const [blind, setBlind] = useState(true)
  const [due, setDue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    try {
      const r = await mi.createCount({ location, scopeType: scope, scopeValue: value || null, blind, due: due || null })
      onCreated(r.count_id)
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title="New count">
      <div className="flex flex-col gap-3">
        <Field label="Location" required>
          {(id) => <Select id={id} value={location} onChange={(e) => setLocation(e.target.value)}>{locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</Select>}
        </Field>
        <Field label="What to count">
          {(id) => (
            <Select id={id} value={scope} onChange={(e) => { setScope(e.target.value); setValue('') }}>
              <option value="location">Everything here</option>
              <option value="critical">Critical parts only</option>
              <option value="abc">By ABC class</option>
              <option value="category">By category</option>
            </Select>
          )}
        </Field>
        {scope === 'abc' && (
          <Field label="Class">
            {(id) => <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}><option value="">Pick one</option><option value="A">A</option><option value="B">B</option><option value="C">C</option></Select>}
          </Field>
        )}
        {scope === 'category' && (
          <Field label="Category">
            {(id) => <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}><option value="">Pick one</option>{refs.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</Select>}
          </Field>
        )}
        <Field label="Due">{(id) => <Input id={id} type="date" value={due} onChange={(e) => setDue(e.target.value)} />}</Field>
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4" checked={blind} onChange={(e) => setBlind(e.target.checked)} /> Blind: the person counting doesn't see what the system expects</label>
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!location || ((scope === 'abc' || scope === 'category') && !value)} onClick={() => void create()}>Create</Button></div>
      </div>
    </Modal>
  )
}

function CountPage({ id }: { id: string }) {
  const { me, refs, notify } = useMi()
  const [d, setD] = useState<CountDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [entries, setEntries] = useState<Record<string, string>>({})
  const [reasons, setReasons] = useState<Record<string, string>>({})
  const [scanning, setScanning] = useState(false)
  const [busy, setBusy] = useState(false)
  const rowsRef = useRef<Record<string, HTMLInputElement | null>>({})

  const load = useCallback(async () => {
    try {
      const r = await mi.countDetail(id)
      setD(r)
      setEntries(Object.fromEntries(r.lines.filter((l) => l.counted_qty != null).map((l) => [l.id, String(l.counted_qty)])))
      setReasons(Object.fromEntries(r.lines.filter((l) => l.reason_code).map((l) => [l.id, l.reason_code as string])))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [id])
  useEffect(() => { void load() }, [load])

  const canManage = useMemo(() => !!d && !!refs.locations.find((l) => l.id === d.count.location_id)?.can_manage, [d, refs.locations])

  // Scanning a bin or part jumps to its line, ready to type.
  const scanned = async (raw: string) => {
    if (!d) return
    try {
      const res = await mi.resolveScan(parseScan(raw)?.tag ?? raw)
      const partIds = res.kind === 'bin' ? res.stock.map((s) => s.part_id) : res.kind === 'part' ? [res.id] : []
      const line = d.lines.find((l) => partIds.includes(l.part_id))
      if (!line) { notify('That isn\'t on this count.', 'warn'); return }
      setScanning(false)
      window.setTimeout(() => {
        rowsRef.current[line.id]?.focus()
        rowsRef.current[line.id]?.scrollIntoView({ block: 'center' })
      }, 100)
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  const c = d.count
  const open = c.status === 'open'

  const save = async (lineId: string) => {
    const v = entries[lineId]
    if (v === undefined || v === '') return
    try {
      await act('mi_enter_count', { p_line: lineId, p_qty: Number(v) }, 'Count entry')
      setD((cur) => cur && { ...cur, lines: cur.lines.map((l) => (l.id === lineId ? { ...l, counted_qty: Number(v) } : l)) })
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const submit = async () => {
    setBusy(true)
    try {
      for (const l of d.lines) if (entries[l.id] !== undefined && Number(entries[l.id]) !== Number(l.counted_qty)) await save(l.id)
      const r = await mi.submitCount(c.id)
      notify(r.needs_review ? 'Turned in. A manager needs to review the differences.' : 'Turned in.')
      await load()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const post = async () => {
    setBusy(true)
    try {
      const r = await mi.postCount(c.id, Object.entries(reasons).filter(([, v]) => v).map(([line_id, reason_code]) => ({ line_id, reason_code })))
      notify(r.held ? `Posted ${r.posted}. ${r.held} still need a manager and a reason.` : `Posted ${r.posted} line${r.posted === 1 ? '' : 's'}.`, r.held ? 'warn' : 'ok')
      await load()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const counted = d.lines.filter((l) => l.counted_qty != null || (entries[l.id] ?? '') !== '').length

  return (
    <div className="flex flex-col gap-4">
      <Link to={`${BASE}/counts`} className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink"><ArrowLeft className="size-4" /> Counts</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold text-ink">Count {c.number}</h1>
        <Badge tone={COUNT_STATUS[c.status].tone}>{COUNT_STATUS[c.status].label}</Badge>
        {c.blind && <Badge>Blind</Badge>}
        <span className="w-full text-sm text-ink-muted">{c.location_name}{c.notes ? `. ${c.notes}` : ''}</span>
      </div>

      {open && (
        <div className="flex flex-wrap gap-2">
          <Button size="lg" variant="secondary" onClick={() => setScanning((v) => !v)}><ScanLine className="size-5" /> {scanning ? 'Hide the camera' : 'Scan a bin'}</Button>
          <Button size="lg" disabled={busy || counted < d.lines.length} onClick={() => void submit()}><Check className="size-5" /> Turn in ({counted} of {d.lines.length})</Button>
        </div>
      )}
      {scanning && <BarcodeScanner continuous retail onDetect={scanned} className="h-64 rounded-lg" />}

      {c.status === 'in_review' && (
        <WarnNote>
          {canManage ? `Differences over ${money(d.threshold)} need a reason before they post.` : `Differences over ${money(d.threshold)} wait for a manager.`}
        </WarnNote>
      )}

      <ul className="flex flex-col divide-y divide-border rounded-lg border border-border bg-card">
        {d.lines.map((l) => {
          const big = Math.abs(Number(l.variance_value ?? 0)) > Number(d.threshold)
          return (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-ink">{l.part_name}</div>
                <p className="text-xs text-ink-muted">
                  {[l.bin_name && `Bin ${l.bin_name}`, l.sku].filter(Boolean).join(' · ')}
                  {l.expected_qty != null && `${l.bin_name || l.sku ? '. ' : ''}Expected ${qty(l.expected_qty)}`}
                </p>
                {!open && l.variance_qty != null && Number(l.variance_qty) !== 0 && (
                  <p className={big ? 'text-xs font-medium text-danger' : 'text-xs text-warn'}>Off by {qty(l.variance_qty)} ({money(l.variance_value)})</p>
                )}
              </div>
              {open ? (
                <Input ref={(el) => { rowsRef.current[l.id] = el }} aria-label={`Count of ${l.part_name}`} inputMode="decimal" className="h-12 w-24 text-center text-lg" value={entries[l.id] ?? ''}
                  onChange={(e) => setEntries((p) => ({ ...p, [l.id]: e.target.value }))} onBlur={() => void save(l.id)} />
              ) : (
                <span className="text-sm font-semibold tabular-nums text-ink">{qty(l.counted_qty)}</span>
              )}
              {c.status === 'in_review' && !l.posted && canManage && l.variance_qty != null && Number(l.variance_qty) !== 0 && (
                <Select aria-label="Reason" className="w-full sm:w-52" value={reasons[l.id] ?? ''} onChange={(e) => setReasons((p) => ({ ...p, [l.id]: e.target.value }))}>
                  <option value="">Reason{big ? ' (required)' : ''}</option>
                  {REASON_CODES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                </Select>
              )}
              {l.posted && <Badge tone="ok">Posted</Badge>}
            </li>
          )
        })}
      </ul>

      {c.status === 'in_review' && (
        <div className="flex flex-wrap gap-2">
          <Button size="lg" disabled={busy} onClick={() => void post()}>Post to stock</Button>
          {me.rank >= 2 && <Button size="lg" variant="ghost" disabled={busy} onClick={() => { void mi.cancelCount(c.id).then(load).catch((e) => notify(errText(e), 'danger')) }}>Cancel the count</Button>}
        </div>
      )}
    </div>
  )
}
