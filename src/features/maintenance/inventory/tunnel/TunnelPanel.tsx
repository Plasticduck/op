import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ExternalLink, Link2, Link2Off, Loader2, NotebookPen, Pencil, Plus, RefreshCw, Wrench, X } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { mi, type AssetRow } from '@/lib/queries/maintenanceInventory'
import { miTunnel, type TunnelItem } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { errText } from '../format'
import { ErrorNote, Loading, SearchBox } from '../ui'
import { BulkDialog, type BulkKind } from '../equipment/BulkActions'
import { EquipmentOverview, useEquipmentDetail } from '../equipment/EquipmentBody'
import { EquipmentForm, type FormMode } from '../equipment/EquipmentForm'
import { CRIT, EQUIPMENT_BASE, shortName, STATUS } from '../equipment/format'
import { UsageCard } from '../equipment/UsageCard'
import { shapeFor } from './shapes'

// What opens beside the drawing (below it on a phone) when a shape is picked: the machine,
// how hard it has worked, what's due and open on it, and the everyday actions. A shape
// that isn't linked yet offers the site's machines to link, or adds one.

type Props = { item: TunnelItem; siteId: string; canEdit: boolean; onClose: () => void; onChanged: () => void }

export function TunnelPanel({ item, siteId, canEdit, onClose, onChanged }: Props) {
  return (
    <aside aria-label="Selected equipment"
      className="fixed inset-x-0 bottom-0 z-50 flex max-h-[78vh] flex-col rounded-t-xl border-t border-border bg-card shadow-xl lg:static lg:z-auto lg:max-h-none lg:rounded-md lg:border lg:shadow-none">
      <div className="mx-auto mt-2 h-1.5 w-10 shrink-0 rounded-full bg-border lg:hidden" />
      {item.asset_id
        ? <LinkedPanel key={item.asset_id} item={item} assetId={item.asset_id} siteId={siteId} canEdit={canEdit} onClose={onClose} onChanged={onChanged} />
        : <UnlinkedPanel item={item} siteId={siteId} canEdit={canEdit} onClose={onClose} onChanged={onChanged} />}
    </aside>
  )
}

function Header({ title, sub, onClose, children }: { title: string; sub?: string; onClose: () => void; children?: ReactNode }) {
  return (
    <div className="flex items-start gap-2 border-b border-border px-3 py-2.5">
      <div className="min-w-0 flex-1">
        {sub && <div className="truncate text-[11px] text-ink-subtle">{sub}</div>}
        <h2 className="truncate text-[17px] font-semibold text-ink">{title}</h2>
        {children}
      </div>
      <button type="button" onClick={onClose} aria-label="Close" className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-content"><X className="size-5" /></button>
    </div>
  )
}

function LinkedPanel({ item, assetId, siteId, canEdit, onClose, onChanged }: Props & { assetId: string }) {
  const { notify } = useMi()
  const { d, error, reload } = useEquipmentDetail(assetId)
  const [form, setForm] = useState<FormMode | null>(null)
  const [bulk, setBulk] = useState<BulkKind | null>(null)
  const [relinking, setRelinking] = useState(false)
  const [busy, setBusy] = useState(false)

  if (relinking) return <UnlinkedPanel item={item} siteId={siteId} canEdit={canEdit} onClose={() => setRelinking(false)} onChanged={() => { setRelinking(false); onChanged() }} relink />
  if (error) return <div className="p-3"><Header title={item.label || 'Equipment'} onClose={onClose} /><ErrorNote>{error}</ErrorNote></div>
  if (!d) return <Loading />
  if (d.hidden) return <div className="p-3"><Header title={item.label || 'Equipment'} onClose={onClose} /><p className="text-sm text-ink-muted">{d.message}</p></div>
  const a = d.asset
  const s = STATUS[a.status]
  const changed = () => { void reload(); onChanged() }

  const openWo = async () => {
    setBusy(true)
    try {
      const w = await mi.createWorkOrder({ site: a.location_id, title: `Work on ${shortName(a.name)}`, asset: a.id, parts: d.bom.map((b) => ({ part_id: b.part_id, qty: Number(b.qty_per) })) })
      notify(`Work order #${w.number} opened.`)
      changed()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const unlink = async () => {
    try {
      await miTunnel.linkItem(item.id, null)
      onChanged()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }

  return (
    <>
      <Header title={shortName(a.name)} sub={[item.label && item.label !== shortName(a.name) ? item.label : null, a.tag, a.area_name].filter(Boolean).join(' · ')} onClose={onClose}>
        <div className="mt-1 flex flex-wrap gap-1">
          <Badge tone={s.tone}>{s.label}</Badge>
          {a.crit_class && <Badge tone={CRIT[a.crit_class as 'A' | 'B' | 'C'].tone}>Criticality {a.crit_class}</Badge>}
          {d.open_work_orders.length > 0 && <Badge tone="warn">{d.open_work_orders.length} open WO{d.open_work_orders.length === 1 ? '' : 's'}</Badge>}
        </div>
      </Header>
      <div className="flex flex-wrap gap-1.5 border-b border-border px-3 py-2">
        <Link to={`${EQUIPMENT_BASE}/${a.id}`} className="inline-flex h-8 items-center gap-1 rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover"><ExternalLink className="size-3.5" /> Full page</Link>
        {a.can_manage && a.status !== 'retired' && <Button size="sm" variant="secondary" onClick={() => setBulk('status')}><RefreshCw className="size-3.5" /> Status</Button>}
        {a.can_manage && a.status !== 'retired' && <Button size="sm" variant="secondary" onClick={() => setForm({ mode: 'edit', detail: d })}><Pencil className="size-3.5" /> Edit</Button>}
        <Link to={`/app/maintenance-log?new=1&asset=${a.id}`} className="inline-flex h-8 items-center gap-1 rounded-md border border-border px-3 text-sm text-ink hover:bg-content"><NotebookPen className="size-3.5" /> Log work</Link>
        {a.status !== 'retired' && <Button size="sm" variant="secondary" disabled={busy} onClick={() => void openWo()}><Wrench className="size-3.5" /> Work order</Button>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        <div className="flex flex-col gap-4">
          <UsageCard d={d} onChanged={changed} />
          <EquipmentOverview d={d} reload={changed} compact />
          {canEdit && (
            <div className="flex flex-wrap gap-2 border-t border-border pt-3 text-sm">
              <Button size="sm" variant="ghost" onClick={() => setRelinking(true)}><Link2 className="size-3.5" /> Link a different machine</Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => void unlink()}><Link2Off className="size-3.5" /> Unlink</Button>
            </div>
          )}
        </div>
      </div>
      {form && <EquipmentForm m={form} onClose={() => setForm(null)} onSaved={() => { setForm(null); changed() }} />}
      {bulk && <BulkDialog kind={bulk} ids={[a.id]} label={shortName(a.name)} areas={[]} onClose={() => setBulk(null)} onDone={(m) => { setBulk(null); notify(m); changed() }} />}
    </>
  )
}

function UnlinkedPanel({ item, siteId, canEdit, onClose, onChanged, relink }: Props & { relink?: boolean }) {
  const { notify } = useMi()
  const [rows, setRows] = useState<AssetRow[] | null>(null)
  const [q, setQ] = useState('')
  const [adding, setAdding] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const shape = shapeFor(item.kind)

  useEffect(() => {
    if (!canEdit) return
    let alive = true
    void mi.assets(siteId).then((r) => { if (alive) setRows(r.filter((x) => x.status !== 'retired')) }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [siteId, canEdit])

  // The likeliest machines first: same type as the shape stands for, then machines, then components.
  const shown = useMemo(() => {
    if (!rows) return []
    const want = (item.match_type ?? item.label).toLowerCase()
    const needle = q.trim().toLowerCase()
    return rows
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || (r.type ?? '').toLowerCase().includes(needle))
      .map((r) => ({ r, score: ((r.type ?? '').toLowerCase() === want ? 0 : shortName(r.name).toLowerCase().includes(want) ? 1 : 2) * 2 + (r.parent_id ? 1 : 0) }))
      .sort((a, b) => a.score - b.score || a.r.name.localeCompare(b.r.name))
      .slice(0, 60)
  }, [rows, q, item.match_type, item.label])

  const link = async (assetId: string) => {
    setBusy(assetId)
    try {
      await miTunnel.linkItem(item.id, assetId)
      onChanged()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <Header title={item.label || shape.label} sub={relink ? 'Link a different machine' : `${shape.label}${item.zone ? ` · ${item.zone}` : ''}`} onClose={onClose} />
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {!relink && (
          <p className="mb-3 text-sm text-ink-muted">
            This shape isn't linked to a machine{item.match_type ? <>, and this site has no <b>{item.match_type}</b></> : ''}.
            {canEdit ? ' Pick the machine it is, or add it.' : ' A manager can link it.'}
          </p>
        )}
        {canEdit && (
          <div className="flex flex-col gap-2">
            <div className="flex gap-2">
              <SearchBox value={q} onChange={setQ} placeholder="Find a machine at this site" className="flex-1" />
              <Button variant="secondary" onClick={() => setAdding(true)}><Plus className="size-4" /> New</Button>
            </div>
            {error && <ErrorNote>{error}</ErrorNote>}
            {!rows && !error && <Loading />}
            {shown.map(({ r, score }) => (
              <button key={r.id} type="button" disabled={!!busy} onClick={() => void link(r.id)}
                className={cn('flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 py-2 text-left text-sm hover:bg-content', score < 2 ? 'border-accent/50' : 'border-border')}>
                <span className="min-w-0">
                  <span className="block truncate text-ink">{shortName(r.name)}</span>
                  <span className="block truncate text-xs text-ink-muted">{[r.type, r.parent_id ? 'component' : null, r.area_name].filter(Boolean).join(' · ')}</span>
                </span>
                {busy === r.id ? <Loader2 className="size-4 animate-spin" /> : score < 2 ? <Badge tone="accent">Likely</Badge> : null}
              </button>
            ))}
          </div>
        )}
      </div>
      {adding && (
        <EquipmentForm m={{ mode: 'add', siteId, preset: { name: item.label || shape.label, type: item.match_type ?? item.label, area_name: item.zone } }}
          onClose={() => setAdding(false)}
          onSaved={(s) => { setAdding(false); void link(s.ids[0].id) }} />
      )}
    </>
  )
}
