import { useEffect, useMemo, useState } from 'react'
import { Camera, Check, TriangleAlert } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { mi, type ConsumeContext, type Elsewhere, type StockRow } from '@/lib/queries/maintenanceInventory'
import { scanFeedback } from '@/lib/scan/feedback'
import { useMi, type ScanContext } from './context'
import { errText, money, qty } from './format'
import { act, readSnapshot } from './offline'
import { ErrorNote, Loading, Muted, Stepper, WarnNote } from './ui'

// The stock actions: Consume, Receive, Count, Transfer. Used from a scan, a part, a work
// order. Each defaults everything it can, so a scan is a couple of taps from done.

type DoneFn = (message: string) => void

const QUEUED = 'Saved on this phone. It will sync when you have signal.'

// Finished: buzz, say what happened.
function finish(onDone: DoneFn, text: string, queued: boolean) {
  scanFeedback()
  onDone(queued ? QUEUED : text)
}

export function ConsumePanel({ stock, context, onDone, onTransfer }: { stock: StockRow; context?: ScanContext; onDone: DoneFn; onTransfer?: () => void }) {
  const { me, accountId, userId } = useMi()
  const [ctx, setCtx] = useState<ConsumeContext | null>(null)
  const [woId, setWoId] = useState<string>(context?.workOrder?.id ?? '')
  const [count, setCount] = useState(1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [short, setShort] = useState(false)
  const [photo, setPhoto] = useState<File | null>(null)
  const assetId = context?.asset?.id ?? null

  useEffect(() => {
    let alive = true
    mi.consumeContext(stock.part_id, stock.location_id, assetId)
      .then((c) => {
        if (!alive) return
        setCtx(c)
        // Best guess first: the scanned asset, a job with this part planned, one whose BOM has it.
        setWoId((cur) => cur || (c.work_orders[0] && c.work_orders[0].rank <= 2 ? c.work_orders[0].id : ''))
      })
      .catch(async () => {
        // No signal: what the phone knows about this site's open work orders.
        const snap = await readSnapshot().catch(() => undefined)
        if (!alive) return
        setCtx({
          work_orders: (snap?.work_orders ?? []).filter((w) => w.location_id === stock.site_id).map((w) => ({ id: w.id, number: w.number, title: w.title, equipment_id: w.equipment_id, asset_name: null, rank: w.equipment_id === assetId ? 0 : 3 })),
          assets: [],
          elsewhere: [],
        })
      })
    return () => { alive = false }
  }, [stock.part_id, stock.location_id, stock.site_id, assetId])

  const chosen = ctx?.work_orders.find((w) => w.id === woId)
  const otherSite = (context?.asset?.site_id && stock.site_id && context.asset.site_id !== stock.site_id)
    || (context?.workOrder?.site_id && stock.site_id && context.workOrder.site_id !== stock.site_id)
  const lineCost = count * Number(stock.avg_cost)
  const photoLimit = me.settings.high_value_photo_cost
  const askPhoto = photoLimit != null && lineCost >= Number(photoLimit)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    setShort(false)
    try {
      const res = await act<{ ledger_id: string; on_hand: number; line_cost: number }>('mi_issue_part', {
        p_part: stock.part_id,
        p_location: stock.location_id,
        p_qty: count,
        p_work_order: woId || null,
        p_asset: assetId ?? chosen?.equipment_id ?? null,
        ...(context?.source ? { p_source: context.source } : {}),
      }, `Used ${qty(count)} ${stock.part_name}`)
      if (!res.queued && photo) {
        const path = await mi.upload(accountId, 'installed', photo, photo.name)
        await mi.addAttachment({ account_id: accountId, entity_type: 'ledger', entity_id: res.data.ledger_id, storage_path: path, file_name: photo.name, kind: 'installed_part', uploaded_by: userId })
      }
      finish(onDone, res.queued ? '' : `Used ${qty(count)} ${stock.part_name}. ${qty(res.data.on_hand)} left.`, res.queued)
    } catch (e) {
      const text = errText(e)
      if (/on hand/i.test(text)) setShort(true)
      setError(text)
    } finally {
      setBusy(false)
    }
  }

  const noteNeeded = async () => {
    if (!woId) return
    setBusy(true)
    try {
      await mi.notePartNeeded(woId, stock.part_id, count)
      onDone(`Noted on work order #${chosen?.number}: ${stock.part_name} needed.`)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {otherSite && (
        <WarnNote>This bin is at {stock.site_name ?? stock.location_name}, not the site of that {context?.workOrder ? 'work order' : 'asset'}.</WarnNote>
      )}
      <div className="flex items-center justify-between gap-3">
        <Stepper value={count} onChange={setCount} min={1} />
        <div className="text-right text-sm text-ink-muted">
          <div>{qty(stock.available)} free here</div>
          <div className="tabular-nums">{money(lineCost)}</div>
        </div>
      </div>
      {!ctx ? (
        <Muted>Finding work orders...</Muted>
      ) : (
        <Field label="Charge to">
          {(id) => (
            <Select id={id} value={woId} onChange={(e) => setWoId(e.target.value)}>
              <option value="">{context?.asset ? `No work order: ${context.asset.name}` : 'No work order'}</option>
              {ctx.work_orders.map((w) => (
                <option key={w.id} value={w.id}>#{w.number} {w.title}{w.asset_name ? ` (${w.asset_name})` : ''}</option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {askPhoto && (
        <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-ink-muted">
          <Camera className="size-5" />
          {photo ? photo.name : `Over ${money(photoLimit)}: photo of the installed part (optional)`}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      {short && (
        <div className="flex flex-wrap gap-2">
          {onTransfer && <Button variant="secondary" onClick={onTransfer}>Request a transfer</Button>}
          {woId && <Button variant="secondary" onClick={() => void noteNeeded()} disabled={busy}>Note it on the work order</Button>}
        </div>
      )}
      <Button size="lg" className="h-14 w-full text-lg" onClick={() => void confirm()} disabled={busy || count <= 0}>
        <Check className="size-5" /> Use {qty(count)}
      </Button>
    </div>
  )
}

export function ReceivePanel({ stock, onDone }: { stock: StockRow; onDone: DoneFn }) {
  const { accountId } = useMi()
  const [lines, setLines] = useState<Awaited<ReturnType<typeof mi.openPoLines>> | null>(null)
  const [lineId, setLineId] = useState('')
  const [count, setCount] = useState(1)
  const [cost, setCost] = useState('')
  const [slip, setSlip] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    mi.openPoLines(stock.part_id, stock.location_id).then((l) => {
      if (!alive) return
      setLines(l)
      if (l[0]) {
        setLineId(l[0].id)
        setCount(Number(l[0].qty_open))
      }
    }).catch(() => { if (alive) setLines([]) })
    return () => { alive = false }
  }, [stock.part_id, stock.location_id])

  const line = lines?.find((l) => l.id === lineId)

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      if (line) {
        const path = slip ? await mi.upload(accountId, 'packing-slips', slip, slip.name) : null
        const res = await act<{ on_hand: number; po_status: string }>('mi_receive_po_line', {
          p_line: line.id, p_qty: count, p_bin: stock.bin_id, p_packing_slip: path,
        }, `Received ${qty(count)} ${stock.part_name}`)
        finish(onDone, res.queued ? '' : `Received ${qty(count)} on PO ${line.number}. ${qty(res.data.on_hand)} on hand now.`, res.queued)
      } else {
        const res = await act<{ on_hand: number }>('mi_receive_stock', {
          p_part: stock.part_id, p_location: stock.location_id, p_qty: count, p_unit_cost: cost === '' ? null : Number(cost), p_bin: stock.bin_id,
        }, `Received ${qty(count)} ${stock.part_name}`)
        finish(onDone, res.queued ? '' : `Received ${qty(count)}. ${qty(res.data.on_hand)} on hand now.`, res.queued)
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!lines) return <Loading />
  return (
    <div className="flex flex-col gap-4">
      {lines.length > 0 ? (
        <Field label="Purchase order">
          {(id) => (
            <Select id={id} value={lineId} onChange={(e) => {
              setLineId(e.target.value)
              const l = lines.find((x) => x.id === e.target.value)
              if (l) setCount(Number(l.qty_open))
            }}>
              {lines.map((l) => <option key={l.id} value={l.id}>PO {l.number} {l.vendor_name}: {qty(l.qty_open)} due</option>)}
              <option value="">No PO (a local buy, found stock)</option>
            </Select>
          )}
        </Field>
      ) : (
        <Muted>No open purchase order for this part here. This goes in as a receipt with no PO.</Muted>
      )}
      <Stepper value={count} onChange={setCount} min={1} />
      {!line && (
        <Field label="Cost each" hint="Blank keeps the current average.">
          {(id) => <Input id={id} inputMode="decimal" value={cost} onChange={(e) => setCost(e.target.value)} placeholder={money(stock.avg_cost)} />}
        </Field>
      )}
      {line && (
        <label className="flex min-h-12 cursor-pointer items-center gap-2 rounded-lg border border-dashed border-border px-3 text-sm text-ink-muted">
          <Camera className="size-5" />
          {slip ? slip.name : 'Photo of the packing slip (optional)'}
          <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setSlip(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button size="lg" className="h-14 w-full text-lg" onClick={() => void confirm()} disabled={busy || count <= 0}>
        <Check className="size-5" /> Receive {qty(count)}
      </Button>
    </div>
  )
}

export function CountPanel({ stock, onDone }: { stock: StockRow; onDone: DoneFn }) {
  const { me } = useMi()
  const [line, setLine] = useState<Awaited<ReturnType<typeof mi.openCountLine>> | undefined>(undefined)
  const [count, setCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    mi.openCountLine(stock.part_id, stock.location_id).then((l) => {
      if (!alive) return
      setLine(l)
      if (l?.counted_qty != null) setCount(Number(l.counted_qty))
    }).catch(() => { if (alive) setLine(null) })
    return () => { alive = false }
  }, [stock.part_id, stock.location_id])

  const start = async () => {
    setBusy(true)
    setError(null)
    try {
      const c = await mi.createCount({ location: stock.location_id, scopeType: 'part', scopeValue: stock.part_id, blind: false })
      setLine(await mi.openCountLine(stock.part_id, stock.location_id) ?? { line_id: '', count_id: c.count_id, number: c.number, blind: false, counted_qty: null })
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    if (!line) return
    setBusy(true)
    setError(null)
    try {
      const res = await act('mi_enter_count', { p_line: line.line_id, p_qty: count }, `Counted ${qty(count)} ${stock.part_name}`)
      finish(onDone, `Counted ${qty(count)} on count ${line.number}. Finish it on the Counts tab.`, res.queued)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  if (line === undefined) return <Loading />
  if (!line) {
    return (
      <div className="flex flex-col gap-3">
        <Muted>No count is open for this part here.</Muted>
        {error && <ErrorNote>{error}</ErrorNote>}
        {me.rank >= 2 && stock.can_act ? (
          <Button size="lg" onClick={() => void start()} disabled={busy}>Start a count for this part</Button>
        ) : (
          <Muted>Ask your manager to start one.</Muted>
        )}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Muted>Count {line.number}. Enter what's physically here{line.blind ? '.' : `. The system says ${qty(stock.on_hand)}.`}</Muted>
      <Stepper value={count} onChange={setCount} min={0} />
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button size="lg" className="h-14 w-full text-lg" onClick={() => void confirm()} disabled={busy}>
        <Check className="size-5" /> Save count
      </Button>
    </div>
  )
}

// Ask for stock to come here from somewhere that has it.
export function TransferRequestPanel({ stock, defaultQty, onDone }: { stock: StockRow; defaultQty?: number; onDone: DoneFn }) {
  const [sources, setSources] = useState<Elsewhere[] | null>(null)
  const [from, setFrom] = useState('')
  const [count, setCount] = useState(defaultQty ?? 1)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    mi.stockElsewhere(stock.part_id, stock.location_id).then((s) => {
      if (!alive) return
      setSources(s)
      if (s[0]) setFrom(s[0].location_id)
    }).catch((e) => { if (alive) { setSources([]); setError(errText(e)) } })
    return () => { alive = false }
  }, [stock.part_id, stock.location_id])

  const source = useMemo(() => sources?.find((s) => s.location_id === from), [sources, from])

  const confirm = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await act<{ number: number }>('mi_start_transfer', {
        p_from: from, p_to: stock.location_id, p_lines: [{ part_id: stock.part_id, qty: count }],
      }, `Asked for ${qty(count)} ${stock.part_name}`)
      finish(onDone, res.queued ? '' : `Transfer #${res.data.number} requested. An approver will see it.`, res.queued)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  if (!sources) return <Loading />
  if (sources.length === 0) {
    return (
      <div className="flex flex-col gap-2">
        {error && <ErrorNote>{error}</ErrorNote>}
        <p className="flex items-center gap-2 text-sm text-ink-muted"><TriangleAlert className="size-4 text-warn" /> Nobody nearby has any. It will need ordering.</p>
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-4">
      <Field label={`Bring to ${stock.location_name} from`}>
        {(id) => (
          <Select id={id} value={from} onChange={(e) => setFrom(e.target.value)}>
            {sources.map((s) => <option key={s.location_id} value={s.location_id}>{s.site_name ? `${s.site_name}: ` : ''}{s.location_name} ({qty(s.available)} free)</option>)}
          </Select>
        )}
      </Field>
      <Stepper value={count} onChange={setCount} min={1} />
      {source && count > Number(source.available) && <WarnNote>{source.location_name} only has {qty(source.available)} free.</WarnNote>}
      {error && <ErrorNote>{error}</ErrorNote>}
      <Button size="lg" className="h-14 w-full text-lg" onClick={() => void confirm()} disabled={busy || !from}>
        <Check className="size-5" /> Request {qty(count)}
      </Button>
    </div>
  )
}
