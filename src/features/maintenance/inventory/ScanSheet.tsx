import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ArrowLeft, ClipboardList, Hash, Loader2, NotebookPen, PackageMinus, PackagePlus, Repeat, ScanLine, TriangleAlert, Wrench, X } from 'lucide-react'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { mi, type AssetDetail, type ScanResult, type StockRow } from '@/lib/queries/maintenanceInventory'
import { parseScan } from '@/features/it/inventory/scan'
import { useMi, type ScanContext } from './context'
import { errText, money, qty } from './format'
import { resolveOffline } from './offline'
import { ConsumePanel, CountPanel, ReceivePanel, TransferRequestPanel } from './StockActions'
import { ToolActions } from './ToolActions'
import { ErrorNote, Loading, Muted, RowButton, SearchBox, StockFacts, Thumb, WarnNote } from './ui'

// The scan screen. A sticker's QR, its Code 128, a typed tag or the UPC on a box all land
// here, and what was scanned decides the menu: bin, tool, asset, location, part or PO.

type StockAction = 'consume' | 'receive' | 'count' | 'transfer'

export function ScanSheet({ initial, onClose }: { initial: ScanContext; onClose: (changed: boolean) => void }) {
  const { notify, me } = useMi()
  const navigate = useNavigate()
  const [context, setContext] = useState<ScanContext>(initial)
  const [result, setResult] = useState<ScanResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [typed, setTyped] = useState('')
  const [picked, setPicked] = useState<StockRow | null>(null)
  const [action, setAction] = useState<StockAction | null>(null)
  const [changed, setChanged] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(changed) }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose, changed])

  const resolve = useCallback(async (raw: string) => {
    setError(null)
    setPicked(null)
    setAction(null)
    const parsed = parseScan(raw)
    // Anything that isn't one of our links is still worth trying: a retail barcode, a part number.
    const code = parsed?.tag ?? raw.trim()
    if (!code) return
    setBusy(true)
    try {
      setResult(await mi.resolveScan(code))
    } catch (e) {
      if (/fetch|network|load failed|connection/i.test(errText(e)) || !navigator.onLine) setResult(await resolveOffline(code))
      else setError(errText(e))
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    if (initial.code) void resolve(initial.code)
  }, [initial.code, resolve])

  // One part in the bin goes straight to its menu.
  const stockChoices = result && (result.kind === 'bin' || result.kind === 'part') ? result.stock : []
  useEffect(() => {
    if (!result) return
    if (result.kind === 'bin' && result.stock.length === 1) setPicked(result.stock[0])
    if (result.kind === 'part') {
      const mine = result.stock.filter((s) => s.can_act)
      if (mine.length === 1) setPicked(mine[0])
    }
    if (result.kind === 'po') {
      navigate(`/app/maintenance-inventory/pos/${result.id}`)
      onClose(false)
    }
  }, [result, navigate, onClose])

  const done = (message: string) => {
    notify(message)
    setChanged(true)
    setResult(null)
    setPicked(null)
    setAction(null)
    setContext((c) => ({ ...c, code: null }))
  }
  const again = () => {
    setResult(null)
    setPicked(null)
    setAction(null)
    setError(null)
  }
  const back = () => {
    if (action) setAction(null)
    else if (picked && stockChoices.length > 1) setPicked(null)
    else again()
  }

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-content">
      <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-card px-3">
        {result || action ? (
          <Button variant="ghost" size="icon" aria-label="Back" onClick={back}><ArrowLeft className="size-5" /></Button>
        ) : (
          <ScanLine className="ml-2 size-5 text-accent" />
        )}
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold text-ink">{action ? ACTION_TITLE[action] : 'Scan'}</h2>
          {(context.workOrder || context.asset) && (
            <p className="truncate text-xs text-ink-muted">
              For {context.workOrder ? `#${context.workOrder.number} ${context.workOrder.title}` : context.asset?.name}
            </p>
          )}
        </div>
        {(context.workOrder || context.asset) && (
          <Button variant="ghost" size="sm" onClick={() => setContext((c) => ({ source: c.source }))}>Clear</Button>
        )}
        <Button variant="ghost" size="icon" aria-label="Close" onClick={() => onClose(changed)}><X className="size-5" /></Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!result ? (
          <div className="flex h-full flex-col">
            <BarcodeScanner retail onDetect={resolve} className="min-h-0 flex-1" />
            <form className="flex shrink-0 gap-2 border-t border-border bg-card p-3" onSubmit={(e) => { e.preventDefault(); void resolve(typed); setTyped('') }}>
              <Input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Or type a tag, part number or PO" autoCapitalize="characters" />
              <Button type="submit" variant="secondary" disabled={!typed.trim() || busy}>Go</Button>
            </form>
            {(busy || error) && (
              <div className="shrink-0 bg-card px-3 pb-3">
                {busy ? <p className="flex items-center gap-2 text-sm text-ink-muted"><Loader2 className="size-4 animate-spin" /> Looking it up...</p> : <ErrorNote>{error}</ErrorNote>}
              </div>
            )}
          </div>
        ) : (
          <div className="mx-auto flex w-full max-w-lg flex-col gap-4 p-4">
            {result.kind === 'unknown' && <UnknownScan raw={result.raw} onAgain={again} onDone={done} />}
            {result.kind === 'other_site' && (
              <>
                <WarnNote>{result.message}</WarnNote>
                <Button variant="secondary" onClick={again}>Scan something else</Button>
              </>
            )}
            {result.kind === 'tool' && <ToolActions toolId={result.id} onDone={done} />}
            {result.kind === 'asset' && <AssetMenu id={result.id} onConsume={(asset) => { setContext((c) => ({ asset, source: c.source })); again() }} onClose={() => onClose(changed)} />}
            {result.kind === 'location' && <LocationMenu id={result.id} onPick={setPicked} picked={picked} />}

            {(result.kind === 'bin' || result.kind === 'part') && !picked && (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-ink-muted">{result.kind === 'bin' ? `Bin ${result.name} at ${result.location_name}` : result.name}. Which one?</p>
                {result.stock.length === 0 && (
                  result.kind === 'bin'
                    ? <Muted>Nothing is assigned to this bin yet. Set a part's bin on its Parts page.</Muted>
                    : <Muted>This part isn't stocked anywhere you can see. A manager sets it up from its Parts page.</Muted>
                )}
                {result.stock.map((s) => (
                  <RowButton key={`${s.part_id}${s.location_id}`} onClick={() => setPicked(s)}>
                    <Thumb path={s.photo_path} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-ink">{s.part_name}</div>
                      <div className="truncate text-xs text-ink-muted">{s.location_name}{s.site_name ? ` (${s.site_name})` : ''}: <StockFacts onHand={s.on_hand} available={s.available} reserved={s.reserved} /></div>
                    </div>
                  </RowButton>
                ))}
              </div>
            )}

            {picked && !action && (
              <>
                <div className="flex items-start gap-3 rounded-lg border border-border bg-card p-3">
                  <Thumb path={picked.photo_path} className="size-14" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-semibold text-ink">{picked.part_name}</span>
                      {picked.is_critical && <Badge tone="danger">Critical</Badge>}
                    </div>
                    <p className="text-sm text-ink-muted">{picked.location_name}{picked.bin_name ? `, bin ${picked.bin_name}` : ''}</p>
                    <p className="text-sm tabular-nums text-ink">
                      <StockFacts onHand={picked.on_hand} available={picked.available} reserved={picked.reserved} uom={picked.uom} />
                      {me.rank >= 2 ? <span className="text-ink-muted"> at {money(picked.avg_cost)}</span> : null}
                    </p>
                    {picked.min_qty != null && Number(picked.on_hand) < Number(picked.min_qty) && <p className="text-sm text-warn">Below the minimum of {qty(picked.min_qty)}.</p>}
                  </div>
                </div>
                {!picked.can_act && <WarnNote>This is at a location you can look at but can't change.</WarnNote>}
                <div className="grid grid-cols-2 gap-2">
                  <ActionButton icon={PackageMinus} label="Consume" primary onClick={() => setAction('consume')} disabled={!picked.can_act} />
                  <ActionButton icon={PackagePlus} label="Receive" onClick={() => setAction('receive')} disabled={!picked.can_act} />
                  <ActionButton icon={Hash} label="Count" onClick={() => setAction('count')} disabled={!picked.can_act} />
                  <ActionButton icon={Repeat} label="Transfer" onClick={() => setAction('transfer')} />
                </div>
                <Link to={`/app/maintenance-inventory/parts/${picked.part_id}`} onClick={() => onClose(changed)} className="text-center text-sm text-accent hover:underline">Open this part</Link>
              </>
            )}

            {picked && action === 'consume' && <PartLine s={picked}><ConsumePanel stock={picked} context={context} onDone={done} onTransfer={() => setAction('transfer')} /></PartLine>}
            {picked && action === 'receive' && <PartLine s={picked}><ReceivePanel stock={picked} onDone={done} /></PartLine>}
            {picked && action === 'count' && <PartLine s={picked}><CountPanel stock={picked} onDone={done} /></PartLine>}
            {picked && action === 'transfer' && <PartLine s={picked}><TransferRequestPanel stock={picked} onDone={done} /></PartLine>}
          </div>
        )}
      </div>
    </div>
  )
}

const ACTION_TITLE: Record<StockAction, string> = { consume: 'Consume', receive: 'Receive', count: 'Count', transfer: 'Request a transfer' }

function PartLine({ s, children }: { s: StockRow; children: React.ReactNode }) {
  return (
    <>
      <div>
        <div className="font-semibold text-ink">{s.part_name}</div>
        <div className="text-sm text-ink-muted">{s.location_name}{s.bin_name ? `, bin ${s.bin_name}` : ''}</div>
      </div>
      {children}
    </>
  )
}

function ActionButton({ icon: Icon, label, onClick, primary, disabled }: { icon: typeof Wrench; label: string; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <Button size="lg" variant={primary ? 'primary' : 'secondary'} className="h-16 flex-col gap-1 text-sm" onClick={onClick} disabled={disabled}>
      <Icon className="size-5" />
      {label}
    </Button>
  )
}

function UnknownScan({ raw, onAgain, onDone }: { raw: string; onAgain: () => void; onDone: (m: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isNumber = /^[0-9]{6,14}$/.test(raw.trim())
  const propose = async () => {
    setBusy(true)
    setError(null)
    try {
      await mi.requestPart({ name: name.trim(), barcode: isNumber ? raw.trim() : undefined, mpn: isNumber ? undefined : raw.trim() })
      onDone(`Asked for ${name.trim()} to be added to the catalog.`)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="flex items-start gap-2 text-sm text-ink"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> We don't know "{raw}".</p>
      <Button variant="secondary" onClick={onAgain}>Scan again</Button>
      <div className="rounded-lg border border-border bg-card p-3">
        <p className="mb-2 text-sm font-medium text-ink">Is this a part we should carry?</p>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="What is it called?" />
        {error && <div className="mt-2"><ErrorNote>{error}</ErrorNote></div>}
        <Button className="mt-2 w-full" disabled={busy || !name.trim()} onClick={() => void propose()}>Propose this part</Button>
      </div>
    </div>
  )
}

function AssetMenu({ id, onConsume, onClose }: { id: string; onConsume: (a: { id: string; name: string; site_id: string }) => void; onClose: () => void }) {
  const [d, setD] = useState<AssetDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    let alive = true
    mi.assetDetail(id).then((r) => { if (alive) setD(r) }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [id])
  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  if (d.hidden) return <WarnNote>{d.message}</WarnNote>
  const a = d.asset
  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-lg font-semibold text-ink">{a.name}</div>
        <p className="text-sm text-ink-muted">{a.site_name}{a.area_name ? `, ${a.area_name}` : ''}. Parts so far: {money(d.parts_cost)}.</p>
      </div>
      <Button size="lg" className="h-14 text-lg" onClick={() => onConsume({ id: a.id, name: a.name, site_id: a.location_id })}>
        <PackageMinus className="size-5" /> Consume a part on this
      </Button>
      <Link to={`/app/maintenance-log?new=1&asset=${a.id}`} onClick={onClose}
        className="flex h-12 items-center justify-center gap-2 rounded-md border border-border bg-card text-base font-medium text-ink hover:bg-content">
        <NotebookPen className="size-5" /> Log maintenance on this
      </Link>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-ink">Open work orders</h3>
        {d.open_work_orders.length === 0 ? <Muted>None.</Muted> : d.open_work_orders.map((w) => (
          <Link key={w.id} onClick={onClose} to={`/app/maintenance-inventory/work-orders/${w.id}`} className="block truncate py-1.5 text-sm text-accent hover:underline">#{w.number} {w.title}</Link>
        ))}
      </div>
      <div>
        <h3 className="mb-1 text-sm font-semibold text-ink">Takes these parts</h3>
        {d.bom.length === 0 ? <Muted>No parts listed yet.</Muted> : d.bom.map((b) => (
          <div key={b.part_id} className="flex justify-between gap-3 py-1 text-sm">
            <span className="truncate text-ink">{b.part_name} x{qty(b.qty_per)}</span>
            <span className={Number(b.on_hand_at_site) <= 0 ? 'text-danger' : 'text-ink-muted'}>{qty(b.on_hand_at_site)} here</span>
          </div>
        ))}
      </div>
      <Link to={`/app/maintenance-inventory/assets/${a.id}`} onClick={onClose} className="flex items-center justify-center gap-1 text-sm text-accent hover:underline"><ClipboardList className="size-4" /> History and details</Link>
    </div>
  )
}

function LocationMenu({ id, onPick, picked }: { id: string; onPick: (s: StockRow) => void; picked: StockRow | null }) {
  const { refs } = useMi()
  const loc = refs.locations.find((l) => l.id === id)
  const [rows, setRows] = useState<StockRow[] | null>(null)
  const [q, setQ] = useState('')
  useEffect(() => {
    let alive = true
    mi.locationStock(id).then((r) => { if (alive) setRows(r) }).catch(() => { if (alive) setRows([]) })
    return () => { alive = false }
  }, [id])
  if (picked) return null
  if (!rows) return <Loading />
  const shown = rows.filter((r) => !q || r.part_name.toLowerCase().includes(q.toLowerCase()) || (r.sku ?? '').toLowerCase().includes(q.toLowerCase()))
  return (
    <div className="flex flex-col gap-2">
      <div className="text-lg font-semibold text-ink">{loc?.name ?? 'Location'}</div>
      <SearchBox value={q} onChange={setQ} placeholder="Find a part here" />
      {shown.length === 0 && <Muted>Nothing matches.</Muted>}
      {shown.slice(0, 60).map((s) => (
        <RowButton key={s.part_id} onClick={() => onPick(s)}>
          <Thumb path={s.photo_path} />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-ink">{s.part_name}</div>
            <div className="text-xs text-ink-muted"><StockFacts onHand={s.on_hand} available={s.available} reserved={s.reserved} /></div>
          </div>
        </RowButton>
      ))}
    </div>
  )
}
