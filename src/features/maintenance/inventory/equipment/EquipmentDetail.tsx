import { useEffect, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Archive, ArchiveRestore, ArrowLeft, CopyPlus, EllipsisVertical, Layers, Loader2, MapPin, PackageMinus, Pencil, Plus, Printer, RefreshCw, ShieldAlert, Wrench, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { QrCodeImage } from '@/components/data/QrCodeImage'
import { tagUrl } from '@/features/it/inventory/format'
import { mi } from '@/lib/queries/maintenanceInventory'
import { miEquipment } from '@/lib/queries/miEquipment'
import { primeScanSound } from '@/lib/scan/feedback'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { errText } from '../format'
import { LabelsDialog, type LabelItem } from '../LabelsDialog'
import { BulkDialog, type BulkKind } from './BulkActions'
import { EquipmentOverview, useEquipmentDetail } from './EquipmentBody'
import { EquipmentForm, type FormMode } from './EquipmentForm'
import { CRIT, EQUIPMENT_BASE, shortName, STATUS } from './format'
import { Timeline } from './Timeline'
import { UsageCard } from './UsageCard'

// One machine, full screen. Answers, top to bottom: is it running, how hard has it
// worked, where is it, what's due on it, what's open on it, and what happened to it.

type Tab = 'overview' | 'timeline'

export function EquipmentDetailPage({ id }: { id: string }) {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const [params, setParams] = useSearchParams()
  const { notify, openScan } = useMi()
  const { d, error, reload } = useEquipmentDetail(id)
  const routeState = routerLocation.state as { back?: string; flash?: string } | null
  const backTo = EQUIPMENT_BASE + (routeState?.back ?? '')
  const [flash, setFlash] = useState<string | null>(routeState?.flash ?? null)
  const [menu, setMenu] = useState(false)
  const [form, setForm] = useState<FormMode | null>(null)
  const [bulk, setBulk] = useState<BulkKind | null>(null)
  const [labels, setLabels] = useState<LabelItem[] | null>(null)
  const [shortCode, setShortCode] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const tab: Tab = params.get('tab') === 'timeline' ? 'timeline' : 'overview'
  // The sticker's QR link needs the account's short code (shared with IT Inventory).
  const hasTag = !!d?.asset?.tag
  useEffect(() => {
    if (!hasTag) return
    let alive = true
    void mi.labelSetup().then((x) => { if (alive) setShortCode(x.settings?.short_code ?? null) }).catch(() => {})
    return () => { alive = false }
  }, [hasTag])

  if (error && !d) {
    return (
      <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
        <div><p>{error}</p><Button variant="link" className="mt-2" onClick={() => navigate(backTo)}>Back to equipment</Button></div>
      </div>
    )
  }
  if (!d) return <div className="grid h-full place-items-center text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  if (d.hidden) {
    return (
      <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
        <div><p>{d.message}</p><Button variant="link" className="mt-2" onClick={() => navigate(backTo)}>Back to equipment</Button></div>
      </div>
    )
  }

  const a = d.asset
  const retired = a.status === 'retired'
  const canEdit = a.can_manage
  const s = STATUS[a.status]

  const setTab = (t: Tab) => setParams((p) => {
    const next = new URLSearchParams(p)
    if (t === 'overview') next.delete('tab')
    else next.set('tab', t)
    return next
  }, { replace: true })

  const openWo = async () => {
    setBusy(true)
    try {
      const w = await mi.createWorkOrder({ site: a.location_id, title: `Work on ${shortName(a.name)}`, asset: a.id, parts: d.bom.map((b) => ({ part_id: b.part_id, qty: Number(b.qty_per) })) })
      setFlash(`Work order #${w.number} opened${d.bom.length ? ' with its parts list as planned parts' : ''}.`)
      void reload()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const restore = async () => {
    try {
      const r = await miEquipment.restore([a.id])
      setFlash(`Restored ${r.restored}.`)
      void reload()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-4xl lg:px-8 lg:py-4">
      <div className="flex min-h-0 flex-1 flex-col bg-card lg:rounded-md lg:border lg:border-border">
        <div className="flex items-start gap-2 border-b border-border px-2 py-2.5 sm:px-3">
          <button type="button" onClick={() => navigate(backTo)} aria-label="Back to equipment" className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-content">
            <ArrowLeft className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-subtle">
              {a.tag && <span className="font-mono">{a.tag}</span>}
              <span>{a.site_name}{a.area_name ? ` · ${a.area_name}` : ''}</span>
            </div>
            <h1 className="truncate text-[17px] font-semibold text-ink">{shortName(a.name)}</h1>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone={s.tone}>{s.label}</Badge>
              {a.crit_class && <Badge tone={CRIT[a.crit_class as 'A' | 'B' | 'C'].tone}>Criticality {a.crit_class}</Badge>}
              {d.open_work_orders.length > 0 && <Badge tone="warn">{d.open_work_orders.length} open work order{d.open_work_orders.length === 1 ? '' : 's'}</Badge>}
              {a.type && a.type !== shortName(a.name) && <Badge tone="neutral">{a.type}</Badge>}
            </div>
          </div>
          {a.tag && shortCode && <div className="hidden shrink-0 sm:block" title={tagUrl(shortCode, a.tag)}><QrCodeImage value={tagUrl(shortCode, a.tag)} size={64} /></div>}
          {canEdit && !retired && <Button variant="secondary" size="sm" onClick={() => setForm({ mode: 'edit', detail: d })}><Pencil className="size-3.5" /> Edit</Button>}
          {canEdit && (
            <div className="relative">
              <button type="button" onClick={() => setMenu(!menu)} aria-label="More" className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content">
                <EllipsisVertical className="size-4" />
              </button>
              {menu && (
                <>
                  <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default" onClick={() => setMenu(false)} />
                  <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card py-1 shadow-md">
                    {!retired ? (
                      <>
                        <MenuItem icon={Plus} onClick={() => { setMenu(false); setForm({ mode: 'add', siteId: a.location_id, parentId: a.id, preset: { area_name: a.area_name } }) }}>Add a component</MenuItem>
                        <MenuItem icon={CopyPlus} onClick={() => { setMenu(false); setForm({ mode: 'clone', detail: d }) }}>Clone</MenuItem>
                        <MenuItem icon={Layers} onClick={() => { setMenu(false); setBulk('zone') }}>Change zone</MenuItem>
                        <MenuItem icon={ShieldAlert} onClick={() => { setMenu(false); setBulk('crit') }}>Set criticality</MenuItem>
                        {a.can_move_site && <MenuItem icon={MapPin} onClick={() => { setMenu(false); setBulk('site') }}>Move to another site</MenuItem>}
                        <MenuItem icon={Archive} danger onClick={() => { setMenu(false); setBulk('retire') }}>Retire</MenuItem>
                      </>
                    ) : (
                      <MenuItem icon={ArchiveRestore} onClick={() => { setMenu(false); void restore() }}>Restore</MenuItem>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {!retired && (
          <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
            <Button size="sm" onClick={() => { primeScanSound(); openScan({ asset: { id: a.id, name: a.name, site_id: a.location_id } }) }}><PackageMinus className="size-3.5" /> Consume a part</Button>
            {canEdit && <Button size="sm" variant="secondary" onClick={() => setBulk('status')}><RefreshCw className="size-3.5" /> Status</Button>}
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void openWo()}><Wrench className="size-3.5" /> Open a work order</Button>
            <Button size="sm" variant="secondary" onClick={() => setLabels([{ type: 'asset', id: a.id, name: shortName(a.name), site: a.site_name }])}><Printer className="size-3.5" /> Sticker</Button>
          </div>
        )}

        <div className="flex border-b border-border bg-card">
          {(['overview', 'timeline'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn('flex-1 border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition', tab === t ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink')}>
              {t}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-[calc(5.5rem+env(safe-area-inset-bottom))] sm:px-4 lg:pb-4">
          {flash && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
              <span>{flash}</span>
              <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
            </div>
          )}
          {tab === 'overview' ? (
            <div className="flex flex-col gap-5">
              <UsageCard d={d} onChanged={() => { setFlash('Logged. The use count starts again from that day.'); void reload() }} />
              <EquipmentOverview d={d} reload={() => void reload()} />
            </div>
          ) : (
            <Timeline assetId={a.id} />
          )}
        </div>
      </div>

      {form && (
        <EquipmentForm m={form} onClose={() => setForm(null)} onSaved={(r) => {
          setForm(null)
          if (form.mode === 'edit') { setFlash(r.message); void reload() }
          else navigate(`${EQUIPMENT_BASE}/${r.ids[0].id}`, { state: { flash: r.message } })
        }} />
      )}
      {bulk && <BulkDialog kind={bulk} ids={[a.id]} label={shortName(a.name)} areas={[]} onClose={() => setBulk(null)} onDone={(m) => { setBulk(null); setFlash(m); void reload() }} />}
      {labels && <LabelsDialog items={labels} onClose={() => { setLabels(null); void reload() }} />}
    </div>
  )
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof Plus; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={cn('flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-content', danger ? 'text-danger' : 'text-ink')}>
      <Icon className="size-4" /> {children}
    </button>
  )
}
