import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Printer, Sticker } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { miEquipment, type BlankBatch, type StickerQueueRow } from '@/lib/queries/miEquipment'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { day, errText } from '../format'
import { LabelsDialog, type LabelItem } from '../LabelsDialog'
import { Card, ErrorNote, Loading, Muted } from '../ui'
import { EQUIPMENT_BASE, shortName, TAG_CONDITION } from '../equipment/format'

// Stickers for machines: what needs printing (no sticker yet, never printed, or marked
// faded, missing or damaged) and blank stickers printed ahead of time, which are put on
// a machine by scanning them. Sizes, printer setup and calibration are shared with IT
// Inventory's Stickers screen.

const REASON: Record<StickerQueueRow['reason'], { label: string; tone: 'neutral' | 'warn' | 'danger' }> = {
  none: { label: 'No sticker', tone: 'neutral' },
  never_printed: { label: 'Never printed', tone: 'neutral' },
  faded: { label: TAG_CONDITION.faded.label, tone: 'warn' },
  missing: { label: TAG_CONDITION.missing.label, tone: 'danger' },
  damaged: { label: TAG_CONDITION.damaged.label, tone: 'danger' },
}

export default function StickersPage() {
  const { refs, me, notify } = useMi()
  const [site, setSite] = useState('')
  const [queue, setQueue] = useState<StickerQueueRow[] | null>(null)
  const [batches, setBatches] = useState<BlankBatch[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [labels, setLabels] = useState<LabelItem[] | null>(null)
  const [count, setCount] = useState('50')
  const [blankSite, setBlankSite] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [q, b] = await Promise.all([miEquipment.stickerQueue(site || null), miEquipment.blankTags(site || null)])
      setQueue(q)
      setBatches(b)
      setPicked(new Set(q.map((r) => r.id)))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [site])
  useEffect(() => { void load() }, [load])

  const shown = queue ?? []
  const bySite = useMemo(() => {
    const m = new Map<string, StickerQueueRow[]>()
    for (const r of shown) m.set(r.site_name, [...(m.get(r.site_name) ?? []), r])
    return [...m.entries()]
  }, [shown])

  const printQueue = () => setLabels(shown.filter((r) => picked.has(r.id)).map((r) => ({ type: 'asset', id: r.id, name: shortName(r.name), site: r.site_name })))
  const makeBlanks = async () => {
    const n = Number(count)
    if (!n || n < 1) return
    setBusy(true)
    try {
      const r = await miEquipment.generateBlankTags(n, blankSite || null)
      const siteName = refs.sites.find((s) => s.id === blankSite)?.name ?? null
      setLabels(r.codes.map((code) => ({ type: 'asset', code, site: siteName })))
      void load()
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => setSite(e.target.value)} aria-label="Site" className="w-full sm:w-56">
          <option value="">All my sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        <p className="text-xs text-ink-muted">Sticker sizes, printer setup and calibration are shared with <Link to="/app/it-inventory/stickers" className="text-accent hover:underline">IT Inventory &gt; Stickers</Link>.</p>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}

      <Card title={<span className="inline-flex items-center gap-1.5"><Sticker className="size-4 text-warn" /> Machines that need a sticker{queue ? ` (${queue.length})` : ''}</span>}
        actions={shown.length > 0 ? (
          <div className="flex items-center gap-2">
            <button type="button" className="text-xs text-accent hover:underline" onClick={() => setPicked(picked.size === shown.length ? new Set() : new Set(shown.map((r) => r.id)))}>
              {picked.size === shown.length ? 'None' : 'All'}
            </button>
            <Button size="sm" disabled={picked.size === 0} onClick={printQueue}><Printer className="size-4" /> Print {picked.size}</Button>
          </div>
        ) : undefined}>
        {!queue ? <Loading /> : queue.length === 0 ? <Muted>Every machine has a readable sticker.</Muted> : (
          <div className="flex flex-col gap-3">
            {bySite.map(([name, rows]) => (
              <div key={name}>
                <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{name} ({rows.length})</div>
                <div className="divide-y divide-border rounded-md border border-border">
                  {rows.map((r) => (
                    <label key={r.id} className={cn('flex cursor-pointer items-center gap-3 px-3 py-2 text-sm', picked.has(r.id) ? 'bg-accent-soft/40' : 'hover:bg-content')}>
                      <input type="checkbox" checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="size-4 rounded border-border text-accent focus:ring-accent" />
                      <span className="min-w-0 flex-1">
                        <Link to={`${EQUIPMENT_BASE}/${r.id}`} className="block truncate text-ink hover:underline" onClick={(e) => e.stopPropagation()}>{shortName(r.name)}</Link>
                        <span className="block truncate text-xs text-ink-muted">{[r.area_name, r.tag].filter(Boolean).join(' · ')}</span>
                      </span>
                      <Badge tone={REASON[r.reason].tone}>{REASON[r.reason].label}</Badge>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Blank stickers">
        <p className="mb-3 text-sm text-ink-muted">
          Print a roll ahead of time and take it to the site. Scanning a blank sticker asks which machine it's going on, and from then on it opens that machine.
        </p>
        {me.rank >= 2 && (
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <label className="flex flex-col gap-1 text-sm text-ink">How many
              <Input type="number" min={1} max={2000} value={count} onChange={(e) => setCount(e.target.value)} className="w-28" />
            </label>
            <label className="flex flex-col gap-1 text-sm text-ink">For (printed on the sticker)
              <Select value={blankSite} onChange={(e) => setBlankSite(e.target.value)} className="w-52">
                <option value="">No site</option>
                {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </label>
            <Button disabled={busy || !Number(count)} onClick={() => void makeBlanks()}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Printer className="size-4" />} Make and print</Button>
          </div>
        )}
        {!batches ? <Loading /> : batches.length === 0 ? <Muted>No unused blank stickers.</Muted> : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {batches.map((b) => (
              <li key={b.batch_id ?? b.first} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-ink">{b.first}{b.count > 1 ? ` to ${b.last}` : ''}</span>
                  <span className="block text-xs text-ink-muted">{b.count} unused · {b.site_name ?? 'No site'} · made {day(b.created_at)}{b.printed ? '' : ' · not printed yet'}</span>
                </span>
                <Button size="sm" variant="secondary" onClick={() => setLabels(b.codes.map((code) => ({ type: 'asset', code, site: b.site_name })))}><Printer className="size-3.5" /> Print again</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {labels && <LabelsDialog items={labels} onClose={() => setLabels(null)} onPrinted={() => void load()} />}
    </div>
  )
}
