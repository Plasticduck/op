import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, Download, Loader2, Printer, Save, Sticker, Tags, Trash2, X } from 'lucide-react'
import { PdfPagePreview } from '@/components/data/PdfPagePreview'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { EmptyState } from '@/components/ui/EmptyState'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { buildCalibrationPdf, buildLabelsPdf } from '@/lib/labels/labelPdf'
import { useLocations } from '@/lib/locations'
import { cn } from '@/lib/utils'
import { itInventory, type ItAssetRow, type ItConsumable, type ItLabelTemplate, type ItTag } from '@/lib/queries/itInventory'
import { PrintDialog } from './PrintDialog'
import { needsSticker, tagUrl } from './format'
import { accountDefaultTemplate, isOutdoorAsset, toPrintTemplate, walkOrder } from './stickers'
import { useItRefs, type ItRefs } from './useItRefs'

// Stickers: the site print queue (everything without a good sticker), the
// blank tag pool for pre-printed sticker orders, and printer calibration.

type Tab = 'queue' | 'blank' | 'setup'
const TABS: { key: Tab; label: string }[] = [
  { key: 'queue', label: 'Print queue' },
  { key: 'blank', label: 'Blank tags' },
  { key: 'setup', label: 'Printer setup' },
]
const TAG_RE = /^[A-Z0-9][A-Z0-9-]{1,31}$/

export function StickersPage() {
  const [params, setParams] = useSearchParams()
  const { refs, error, reload } = useItRefs()
  const [flash, setFlash] = useState<string | null>(null)
  const tab: Tab = params.get('tab') === 'blank' ? 'blank' : params.get('tab') === 'setup' ? 'setup' : 'queue'

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/app/it-inventory" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> IT Inventory
      </Link>
      <div className="mt-3">
        <PageHeader title="Stickers" subtitle="Print stickers for your gear, keep a pool of blank tags, and line up your printer." />
      </div>

      <div className="mt-5 inline-flex rounded-lg border border-border bg-card p-0.5">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => { setFlash(null); setParams(t.key === 'queue' ? {} : { tab: t.key }, { replace: true }) }}
            className={cn('rounded-md px-3 py-1.5 text-sm font-medium transition', tab === t.key ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink')}>
            {t.label}
          </button>
        ))}
      </div>

      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <div className="mt-4">
        {!refs ? (
          <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
        ) : tab === 'queue' ? (
          <PrintQueue refs={refs} onFlash={setFlash} />
        ) : tab === 'blank' ? (
          <BlankTags refs={refs} onFlash={setFlash} />
        ) : (
          <PrinterSetup refs={refs} onSaved={() => { void reload(); setFlash('Printer setup saved. New stickers use it.') }} />
        )}
      </div>
    </div>
  )
}

// ---- Print queue --------------------------------------------------------------

function PrintQueue({ refs, onFlash }: { refs: ItRefs; onFlash: (m: string) => void }) {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const [site, setSite] = useState(activeLocation?.id ?? 'all')
  const [rows, setRows] = useState<ItAssetRow[] | null>(null)
  const [stock, setStock] = useState<ItConsumable[]>([])
  const [skip, setSkip] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState<ItAssetRow[] | null>(null)
  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const load = useCallback(async () => {
    const [a, s] = await Promise.all([itInventory.listAssets(), itInventory.stickerStock()])
    setRows(a.data)
    setStock(s.data ?? [])
  }, [])
  useEffect(() => { void load() }, [load])

  const queue = useMemo(() => walkOrder(
    (rows ?? []).filter((r) => needsSticker(r) && refs.status.get(r.status_label_id)?.type !== 'archived'
      && (site === 'all' || r.location_id === site)),
    refs, siteName,
  ), [rows, site, refs, siteName])
  const groups = [
    { key: 'regular', title: 'Regular stickers', rows: queue.filter((r) => !isOutdoorAsset(r, refs)) },
    { key: 'outdoor', title: 'Weatherproof stickers', hint: 'Pay stations, cameras and tunnel gear. Print on polyester or vinyl stock.', rows: queue.filter((r) => isOutdoorAsset(r, refs)) },
  ].filter((g) => g.rows.length)

  const toggle = (id: string) => setSkip((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const siteStock = site !== 'all' ? stock.find((s) => s.location_id === site) : undefined

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Site" className="w-full sm:w-64">
          {(id) => (
            <Select id={id} value={site} onChange={(e) => { setSite(e.target.value); setSkip(new Set()) }}>
              <option value="all">All sites</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        {siteStock && profile && (
          <StockCount stock={siteStock} accountId={profile.account_id} onChanged={() => void load()} />
        )}
      </div>

      {rows === null ? (
        <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : groups.length === 0 ? (
        <EmptyState icon={Sticker} title="Nothing to print"
          description={site === 'all' ? 'Every item has a sticker.' : `Every item at ${siteName.get(site) ?? 'this site'} has a sticker.`} />
      ) : (
        groups.map((g) => {
          const picked = g.rows.filter((r) => !skip.has(r.id))
          const allOn = picked.length === g.rows.length
          return (
            <section key={g.key} className="overflow-hidden rounded-md border border-border bg-card">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3 py-2.5">
                <label className="flex items-center gap-2 text-sm font-medium text-ink">
                  <input type="checkbox" checked={allOn} className="size-4 rounded border-border text-accent focus:ring-accent"
                    onChange={() => setSkip((s) => { const n = new Set(s); for (const r of g.rows) { if (allOn) n.add(r.id); else n.delete(r.id) } return n })} />
                  {g.title} ({g.rows.length})
                </label>
                <Button size="sm" disabled={!picked.length} onClick={() => setPrinting(picked)}>
                  <Printer className="size-4" /> Print {picked.length}
                </Button>
              </div>
              {g.hint && <p className="border-b border-border bg-content px-3 py-1.5 text-xs text-ink-muted">{g.hint}</p>}
              <ul className="divide-y divide-border">
                {g.rows.map((r) => (
                  <li key={r.id}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:bg-content">
                      <input type="checkbox" checked={!skip.has(r.id)} onChange={() => toggle(r.id)}
                        className="size-4 rounded border-border text-accent focus:ring-accent" />
                      <span className="w-28 shrink-0 font-mono text-xs text-ink-muted">{r.asset_tag}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{r.name}</span>
                        <span className="block truncate text-xs text-ink-muted">
                          {[site === 'all' ? siteName.get(r.location_id) : null, r.area_id ? refs.area.get(r.area_id)?.name : 'No area'].filter(Boolean).join(' · ')}
                        </span>
                      </span>
                      <Badge tone={r.sticker_condition === 'missing' ? 'danger' : r.sticker_condition === 'faded' ? 'warn' : 'neutral'}>
                        {r.sticker_condition === 'missing' ? 'Missing' : r.sticker_condition === 'faded' ? 'Faded' : 'Never printed'}
                      </Badge>
                    </label>
                  </li>
                ))}
              </ul>
            </section>
          )
        })
      )}

      {printing && (
        <PrintDialog refs={refs} assets={printing} onClose={() => setPrinting(null)}
          onPrinted={(m) => { setPrinting(null); setSkip(new Set()); onFlash(m); void load() }} />
      )}
    </div>
  )
}

// The site's sticker count. Printing counts it down; set it when you count a
// roll or open a new box.
function StockCount({ stock, accountId, onChanged }: { stock: ItConsumable; accountId: string; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const low = stock.qty_on_hand <= stock.min_qty
  const save = async () => {
    const n = Number(value)
    if (!Number.isFinite(n) || n < 0) return
    setSaving(true)
    await itInventory.adjustStock({
      account_id: accountId, location_id: stock.location_id, consumable_id: stock.id,
      delta: Math.round(n) - stock.qty_on_hand, reason: 'adjustment', note: 'Counted',
    })
    setSaving(false)
    setEditing(false)
    onChanged()
  }
  if (editing) {
    return (
      <div className="flex items-end gap-2">
        <Field label="Stickers on hand">
          {(id) => <Input id={id} type="number" min={0} inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value)} className="w-32" autoFocus />}
        </Field>
        <Button size="md" onClick={() => void save()} disabled={saving || value === ''}>Save</Button>
        <Button size="md" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>
      </div>
    )
  }
  return (
    <div className={cn('flex items-center gap-3 rounded-md border px-3 py-2 text-sm', low ? 'border-warn bg-warn-soft text-warn' : 'border-border bg-card text-ink')}>
      <Sticker className="size-4" />
      <span><span className="font-semibold tabular-nums">{Math.max(0, stock.qty_on_hand)}</span> stickers on hand{low ? ', time to reorder' : ''}</span>
      <button type="button" className="font-medium text-accent hover:underline" onClick={() => { setValue(String(Math.max(0, stock.qty_on_hand))); setEditing(true) }}>
        Update count
      </button>
    </div>
  )
}

// ---- Blank tags -------------------------------------------------------------------

type Batch = { id: string; tags: ItTag[]; source: string; created: string; printed: number }

function BlankTags({ refs, onFlash }: { refs: ItRefs; onFlash: (m: string) => void }) {
  const { profile } = useAuth()
  const { locations, activeLocation } = useLocations()
  const [tags, setTags] = useState<ItTag[] | null>(null)
  const [count, setCount] = useState('50')
  const [site, setSite] = useState(activeLocation?.id ?? '')
  const [making, setMaking] = useState(false)
  const [paste, setPaste] = useState('')
  const [importing, setImporting] = useState(false)
  const [printing, setPrinting] = useState<{ tags: ItTag[]; site: string | null } | null>(null)
  const [deleting, setDeleting] = useState<Batch | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await itInventory.unusedTags()
    setTags(data)
  }, [])
  useEffect(() => { void load() }, [load])

  const batches = useMemo<Batch[]>(() => {
    const m = new Map<string, ItTag[]>()
    for (const t of tags ?? []) {
      const k = t.batch_id ?? 'none'
      m.set(k, [...(m.get(k) ?? []), t])
    }
    return [...m.entries()].map(([id, ts]) => ({
      id, tags: ts, source: ts[0].source, created: ts[0].created_at, printed: ts.filter((t) => t.printed_count > 0).length,
    })).sort((a, b) => b.created.localeCompare(a.created))
  }, [tags])

  const make = async () => {
    const n = Math.round(Number(count))
    if (!Number.isFinite(n) || n < 1 || n > 2000) { setError('Make between 1 and 2,000 at a time.'); return }
    setMaking(true)
    setError(null)
    const { data, error: err } = await itInventory.generateTags(n, refs.settings.use_site_prefix ? site || null : null)
    setMaking(false)
    if (err) { setError(err.message); return }
    void load()
    setPrinting({ tags: (data as ItTag[] | null) ?? [], site: site || null })
  }

  const doImport = async () => {
    if (!profile) return
    const raw = paste.split(/[\s,;]+/).map((t) => t.trim().toUpperCase()).filter(Boolean)
    const valid = [...new Set(raw.filter((t) => TAG_RE.test(t)))]
    const invalid = raw.filter((t) => !TAG_RE.test(t))
    if (!valid.length) { setError('No tags found. Paste one tag per line, like MW-000501.'); return }
    setImporting(true)
    setError(null)
    const batch = crypto.randomUUID()
    const { data, error: err } = await itInventory.importTags(valid.map((tag) => ({ account_id: profile.account_id, tag, batch_id: batch })))
    setImporting(false)
    if (err) { setError(err.message); return }
    const added = data?.length ?? 0
    onFlash([
      `Added ${added} tag${added === 1 ? '' : 's'}.`,
      valid.length - added ? `${valid.length - added} were already in the system and were left alone.` : '',
      invalid.length ? `${invalid.length} weren't valid tags (letters, numbers and dashes only): ${invalid.slice(0, 5).join(', ')}${invalid.length > 5 ? '...' : ''}.` : '',
    ].filter(Boolean).join(' '))
    setPaste('')
    void load()
  }

  const example = `${refs.settings.tag_prefix}-${'0'.repeat(refs.settings.tag_padding - 3)}501`

  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-muted">
        Blank tags are stickers printed before they go on anything. Stick one on a device, scan it, and Add opens with the tag filled in.
      </p>
      <div className="grid gap-4 md:grid-cols-2">
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Tags className="size-4 text-accent" /> Make blank tags</h2>
          <p className="mt-1 text-xs text-ink-muted">Takes the next numbers in sequence, then opens printing.</p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="How many">
              {(id) => <Input id={id} type="number" min={1} max={2000} inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} />}
            </Field>
            <Field label="For site" hint="Counts against its sticker stock.">
              {(id) => (
                <Select id={id} value={site} onChange={(e) => setSite(e.target.value)}>
                  <option value="">Any site</option>
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </Select>
              )}
            </Field>
          </div>
          <Button className="mt-3" onClick={() => void make()} disabled={making}>
            {making ? <Loader2 className="size-4 animate-spin" /> : <Tags className="size-4" />} Make tags
          </Button>
        </section>
        <section className="rounded-md border border-border bg-card p-4">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink"><Download className="size-4 text-accent" /> Add tags from a sticker vendor</h2>
          <p className="mt-1 text-xs text-ink-muted">Paste the tags printed on the stickers you ordered, one per line.</p>
          <textarea value={paste} onChange={(e) => setPaste(e.target.value)} rows={4} placeholder={`${example}\n${example.replace(/501$/, '502')}`}
            className="mt-3 w-full rounded-md border border-border bg-card px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
          <Button className="mt-2" variant="secondary" onClick={() => void doImport()} disabled={importing || !paste.trim()}>
            {importing && <Loader2 className="size-4 animate-spin" />} Add these tags
          </Button>
        </section>
      </div>
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      <section>
        <h2 className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Unused tags</h2>
        {tags === null ? (
          <div className="grid place-items-center py-10 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
        ) : batches.length === 0 ? (
          <p className="rounded-md border border-border bg-content/40 p-3 text-sm text-ink-muted">No blank tags waiting. Every tag is on a device.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[560px] text-sm">
              <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Made</th>
                  <th className="px-3 py-2 font-medium">Tags</th>
                  <th className="px-3 py-2 text-right font-medium">Unused</th>
                  <th className="px-3 py-2 text-right font-medium">Printed</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {batches.map((b) => (
                  <tr key={b.id}>
                    <td className="whitespace-nowrap px-3 py-2.5 text-ink-muted">
                      {format(new Date(b.created), 'MMM d, yyyy')}
                      <span className="block text-xs">{b.source === 'imported' ? 'From a vendor' : 'Made here'}</span>
                    </td>
                    <td className="px-3 py-2.5 font-mono text-xs text-ink">
                      {b.tags[0].tag}{b.tags.length > 1 ? ` to ${b.tags[b.tags.length - 1].tag}` : ''}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink">{b.tags.length}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{b.printed ? `${b.printed} printed` : 'Not yet'}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <Button size="sm" variant="secondary" onClick={() => setPrinting({ tags: b.tags, site: b.tags[0].location_id })}>
                        <Printer className="size-3.5" /> Print
                      </Button>
                      {profile?.role === 'owner' && b.id !== 'none' && (
                        <button type="button" onClick={() => setDeleting(b)} aria-label="Delete unused tags"
                          className="ml-1 inline-grid size-8 place-items-center rounded-md text-danger hover:bg-danger-soft align-middle">
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {printing && (
        <PrintDialog refs={refs} tags={printing.tags} siteId={printing.site} onClose={() => setPrinting(null)}
          onPrinted={(m) => { setPrinting(null); onFlash(m); void load() }} />
      )}
      <ConfirmDialog
        open={!!deleting}
        title={`Delete ${deleting?.tags.length ?? 0} unused tags?`}
        description="Only tags that were never stuck on anything are removed. Throw away any stickers you printed for them."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return
          void itInventory.deleteUnusedBatch(deleting.id).then(({ error: err }) => {
            setDeleting(null)
            if (err) setError(err.message)
            else { onFlash('Unused tags deleted.'); void load() }
          })
        }}
      />
    </div>
  )
}

// ---- Printer setup -------------------------------------------------------------------

function PrinterSetup({ refs, onSaved }: { refs: ItRefs; onSaved: () => void }) {
  const [id, setId] = useState(accountDefaultTemplate(refs)?.id ?? '')
  const row = refs.templates.find((t) => t.id === id)
  return (
    <div className="space-y-4">
      <Field label="Sticker stock" className="sm:max-w-md">
        {(fid) => (
          <Select id={fid} value={id} onChange={(e) => setId(e.target.value)}>
            {refs.templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </Select>
        )}
      </Field>
      {row && <Calibrate key={row.id} row={row} refs={refs} onSaved={onSaved} />}
    </div>
  )
}

const num = (v: string, lo: number, hi: number, d: number) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d
}

function Calibrate({ row, refs, onSaved }: { row: ItLabelTemplate; refs: ItRefs; onSaved: () => void }) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'
  const [ox, setOx] = useState(String(Number(row.offset_x_mm)))
  const [oy, setOy] = useState(String(Number(row.offset_y_mm)))
  const [pct, setPct] = useState(String(Math.round(Number(row.scale) * 1000) / 10))
  const [testPdf, setTestPdf] = useState<ArrayBuffer | null>(null)
  const [samplePdf, setSamplePdf] = useState<ArrayBuffer | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tpl = useMemo(() => ({
    ...toPrintTemplate(row),
    offset_x_mm: num(ox, -20, 20, 0),
    offset_y_mm: num(oy, -20, 20, 0),
    scale: num(pct, 50, 150, 100) / 100,
  }), [row, ox, oy, pct])
  const sheet = !!tpl.page_spec.page

  useEffect(() => {
    let alive = true
    const tag = `${refs.settings.tag_prefix}-${'0'.repeat(Math.max(0, refs.settings.tag_padding - 3))}123`
    const t = window.setTimeout(() => {
      void buildCalibrationPdf(tpl).then((d) => { if (alive) setTestPdf(d.output('arraybuffer')) })
      // One label on its own, so a sheet stock's sample isn't a whole page.
      const one = tpl.page_spec.page
        ? { ...tpl, page_spec: { ...tpl.page_spec, page: null }, offset_x_mm: 0, offset_y_mm: 0, scale: 1 }
        : tpl
      void buildLabelsPdf(one, [{
        tag, url: tagUrl(refs.settings.short_code, tag), name: 'Pay Lane 1 pay station',
        site: locations[0]?.name ?? 'Your site', phone: refs.settings.support_phone,
      }]).then(({ doc }) => { if (alive) setSamplePdf(doc.output('arraybuffer')) })
    }, 150)
    return () => { alive = false; window.clearTimeout(t) }
  }, [tpl, refs, locations])

  const dirty = tpl.offset_x_mm !== Number(row.offset_x_mm) || tpl.offset_y_mm !== Number(row.offset_y_mm) || tpl.scale !== Number(row.scale)

  const save = async () => {
    setSaving(true)
    setError(null)
    const { error: err } = await itInventory.updateTemplate(row.id, {
      offset_x_mm: tpl.offset_x_mm, offset_y_mm: tpl.offset_y_mm, scale: Math.round(tpl.scale * 1000) / 1000,
    })
    setSaving(false)
    if (err) setError(err.message)
    else onSaved()
  }

  const printTest = async () => {
    const doc = await buildCalibrationPdf(tpl)
    doc.save(`sticker-test-${row.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`)
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-4">
        <ol className="list-decimal space-y-1.5 pl-5 text-sm text-ink-muted">
          <li>Print the test page at 100% (Actual size), with "Fit to page" off.</li>
          <li>
            {sheet
              ? 'Hold it over a blank sheet of labels against a window. Each box should sit right on a label.'
              : 'Print it on a real label. The box should sit 1 mm inside the label edge, centered.'}
          </li>
          <li>If it's off, move it here and print again. Right and down are positive, in millimeters.</li>
          {sheet && <li>Measure the 50 mm line. If it comes out 49 mm, set size to 102%.</li>}
        </ol>
        <div className="grid grid-cols-3 gap-3 sm:max-w-md">
          <Field label="Move right">
            {(id) => <Input id={id} type="number" step={0.5} inputMode="decimal" value={ox} onChange={(e) => setOx(e.target.value)} disabled={!canEdit} />}
          </Field>
          <Field label="Move down">
            {(id) => <Input id={id} type="number" step={0.5} inputMode="decimal" value={oy} onChange={(e) => setOy(e.target.value)} disabled={!canEdit} />}
          </Field>
          <Field label="Size %">
            {(id) => <Input id={id} type="number" step={0.5} inputMode="decimal" value={pct} onChange={(e) => setPct(e.target.value)} disabled={!canEdit} />}
          </Field>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void printTest()}><Printer className="size-4" /> Print test page</Button>
          {canEdit && (
            <Button onClick={() => void save()} disabled={!dirty || saving}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save
            </Button>
          )}
        </div>
        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Sample sticker</div>
          <PdfPagePreview data={samplePdf} maxWidth={300} className="max-w-[300px]" />
        </div>
      </div>
      <div>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Test page</div>
        <PdfPagePreview data={testPdf} maxWidth={320} />
      </div>
    </div>
  )
}
