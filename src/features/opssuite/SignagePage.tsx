import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ClipboardList, CreditCard, Download, FileText, Gift, GripVertical, Images, Package, Plus, ShieldAlert, Signpost, Square, StickyNote, Trash2, Upload, Wind, type LucideIcon } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { EmptyState } from '@/components/ui/EmptyState'
import { timeAgo, shortDate } from '@/lib/format'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { useBrandLogoUrl } from '@/lib/brandLogo'
import { renderPdfThumb } from '@/lib/pdfThumb'
import { useArtworkThumbs } from './useArtworkThumbs'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import {
  SIGN_CATEGORIES,
  flagSpec,
  signage,
  signTypeLabel,
  signTypeOptions,
  type ArtworkItem,
  type SignageRequest,
} from '@/lib/queries/signage'

type Row = SignageRequest & { requested_by: { name: string } | null; location: { name: string } | null }

// Order tracker status -> label + badge classes.
// Steps: Ordered → In Production → Shipped → Completed.
function statusBadge(status: string | null | undefined): { label: string; cls: string } {
  const s = (status ?? 'ordered').toLowerCase()
  if (s === 'completed') return { label: 'Completed', cls: 'bg-ok text-white' }
  if (s === 'shipped') return { label: 'Shipped', cls: 'bg-ok-soft text-ok' }
  if (s === 'in_production') return { label: 'In Production', cls: 'bg-accent-soft text-accent' }
  return { label: 'Ordered', cls: 'bg-warn-soft text-warn' }
}

// Display helpers shared by the order table and the fulfillment report.
const siteLabelOf = (r: Row) => (r.location_id === null ? 'All sites' : r.location?.name ?? 'Unknown site')
const itemLabelOf = (r: Row) => r.title || r.artwork_name || r.sign_category || 'Untitled item'
const orderedByOf = (r: Row) =>
  r.first_name || r.last_name ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() : r.requested_by?.name ?? '—'
function sizeText(r: Row): string {
  if (r.size_option) return `${r.size_option}${r.sided ? ` · ${r.sided === 'double' ? 'Double' : 'Single'} sided` : ''}`
  if (r.width && r.height) return `${r.width} x ${r.height} ${r.size_unit === 'ft' ? 'ft' : 'in'}`
  return '—'
}

// Columns for the Fulfillment report export (Excel + PDF). Site, item, and date
// are all columns so a single export is useful regardless of the on-screen grouping.
const FULFILLMENT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Ordered on', value: (r) => shortDate(r.created_at) },
  { header: 'Site', value: (r) => siteLabelOf(r) },
  { header: 'Item', value: (r) => itemLabelOf(r) },
  { header: 'Category', value: (r) => r.sign_category },
  { header: 'Type', value: (r) => r.sign_type ?? '' },
  { header: 'Size', value: (r) => sizeText(r) },
  { header: 'Qty', value: (r) => r.quantity },
  { header: 'Ordered by', value: (r) => orderedByOf(r) },
  { header: 'Notes', value: (r) => r.notes ?? '' },
]

// Catalog tiles shown on the signage landing. Names must match SIGN_CATEGORIES so
// a tile can preset the order form's category. Placeholder icons for now.
const SIGNAGE_CATALOG: { name: string; icon: LucideIcon }[] = [
  { name: 'Aluminum Signs', icon: Square },
  { name: 'Safety Signs', icon: ShieldAlert },
  { name: 'Wind Signs and A-Frames', icon: Wind },
  { name: 'Business Cards', icon: CreditCard },
  { name: 'Menu Boards, Rack Cards, and Brochures', icon: Gift },
  { name: 'Note Pads', icon: StickyNote },
  { name: 'Other Items', icon: Package },
]

const CATALOG_NAMES = new Set<string>(SIGNAGE_CATALOG.map((c) => c.name))

// Static cover images for the catalog tiles: plain JPG/PNG files that load
// instantly (no client-side PDF rendering). Mighty Wash only (the artwork is
// theirs). A tile without an image falls back to a plain icon. To add one, drop
// the file in /public and map the category name to its path here.
const MW_ACCOUNT_ID = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const MW_TILE_IMAGES: Record<string, string> = {
  'Menu Boards, Rack Cards, and Brochures': '/signage-menu-rack-brochures.jpg',
  'Business Cards': '/signage-business-cards.jpg',
  'Note Pads': '/signage-note-pads.jpg',
  'Wind Signs and A-Frames': '/signage-wind-signs.jpg',
}
// Library artwork that belongs in a category's gallery (deduped by path). Other
// Items catches anything uncategorized or tagged to a name we no longer show.
function signsInCategory(items: ArtworkItem[], category: string): ArtworkItem[] {
  const byPath = new Map<string, ArtworkItem>()
  for (const i of items) {
    if (!i.artwork_path) continue
    const cat = i.sign_category
    const match = category === 'Other Items'
      ? (!cat || !CATALOG_NAMES.has(cat) || cat === 'Other Items')
      : cat === category
    if (!match) continue
    const existing = byPath.get(i.artwork_path)
    if (!existing) {
      byPath.set(i.artwork_path, i)
    } else if (existing.sort_order == null && i.sort_order != null) {
      // Same artwork can appear as both a library row and an order row; keep the
      // first-seen display fields but adopt the admin-arranged position.
      byPath.set(i.artwork_path, { ...existing, sort_order: i.sort_order })
    }
  }
  // Admin-arranged signs (sort_order set) come first in that order; the rest keep
  // the previous default (newest first).
  return [...byPath.values()].sort((a, b) => {
    if (a.sort_order != null && b.sort_order != null) return a.sort_order - b.sort_order
    if (a.sort_order != null) return -1
    if (b.sort_order != null) return 1
    return b.created_at > a.created_at ? 1 : -1
  })
}

async function openArtwork(path: string) {
  const { url } = await signage.artworkUrl(path)
  if (url) window.open(url, '_blank', 'noopener')
}

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [library, setLibrary] = useState<ArtworkItem[]>([])
  const [loading, setLoading] = useState(true)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  // Category chosen from a catalog tile, preselected in the order form.
  const [presetCategory, setPresetCategory] = useState<string | null>(null)
  const startOrder = (category: string | null) => { setPresetCategory(category); setCreating(true) }
  const [tab, setTab] = useState<'catalog' | 'library' | 'new' | 'production' | 'shipped' | 'completed' | 'fulfillment'>('catalog')
  // Catalog drill-down: a chosen category shows its gallery; picking a sign opens
  // the quantity-only order confirm.
  const [galleryCat, setGalleryCat] = useState<string | null>(null)
  const [pickedSign, setPickedSign] = useState<ArtworkItem | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [orders, art] = await Promise.all([signage.list(), signage.libraryList()])
    setRows((orders.data as unknown as Row[]) ?? [])
    setLibrary(art)
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  // The order tracker (status editing) is limited to a single admin; requesters
  // see the current status read-only. Changing status or tracking emails the
  // requester.
  const isAdmin = (profile?.email ?? '').toLowerCase() === 'kevan@washlyfe.com'
  const changeStatus = async (r: Row, status: string) => {
    await signage.updateStatus(r.id, { status, status_updated_at: new Date().toISOString() })
    await load()
    void signage.statusEmail(r.id)
  }
  const saveTracking = async (r: Row, value: string) => {
    const t = value.trim()
    if (t === (r.tracking_number ?? '')) return
    await signage.updateStatus(r.id, { tracking_number: t || null })
    await load()
    void signage.statusEmail(r.id)
  }
  const deleteOrder = async (r: Row) => {
    await signage.remove(r.id)
    setConfirmDeleteId(null)
    await load()
  }

  // Orders are split by status into their own tabs: New Orders (Ordered, not yet
  // in production), In Production, Shipped, and Completed.
  const statusOf = (r: Row) => (r.status ?? 'ordered').toLowerCase()
  const orderCounts = useMemo(() => {
    let neworders = 0, production = 0, shipped = 0, completed = 0
    for (const r of rows) {
      const s = statusOf(r)
      if (s === 'shipped') shipped++
      else if (s === 'completed') completed++
      else if (s === 'in_production') production++
      else neworders++
    }
    return { new: neworders, production, shipped, completed }
  }, [rows])
  const orderRows = useMemo(() => {
    if (tab === 'shipped') return rows.filter((r) => statusOf(r) === 'shipped')
    if (tab === 'completed') return rows.filter((r) => statusOf(r) === 'completed')
    if (tab === 'production') return rows.filter((r) => statusOf(r) === 'in_production')
    if (tab === 'new') return rows.filter((r) => { const s = statusOf(r); return s !== 'shipped' && s !== 'completed' && s !== 'in_production' })
    return []
  }, [rows, tab])
  const onOrdersTab = tab === 'new' || tab === 'production' || tab === 'shipped' || tab === 'completed'

  // Fulfillment report (admin only): the unfulfilled orders — anything not yet
  // shipped or completed — grouped by a chosen dimension so they're easy to
  // batch and work through. Toggle groups by site, item, or order date.
  const brandLogoUrl = useBrandLogoUrl()
  const [groupBy, setGroupBy] = useState<'site' | 'item' | 'date'>('site')
  const unfulfilled = useMemo(
    () => rows.filter((r) => { const s = statusOf(r); return s !== 'shipped' && s !== 'completed' }),
    [rows],
  )
  const totalQty = useMemo(() => unfulfilled.reduce((sum, r) => sum + r.quantity, 0), [unfulfilled])
  const groups = useMemo(() => {
    const map = new Map<string, { key: string; label: string; rows: Row[]; qty: number }>()
    for (const r of unfulfilled) {
      let key: string, label: string
      if (groupBy === 'site') { label = siteLabelOf(r); key = label.toLowerCase() }
      else if (groupBy === 'item') { label = itemLabelOf(r); key = label.toLowerCase() }
      else { key = r.created_at.slice(0, 10); label = shortDate(r.created_at) }
      let g = map.get(key)
      if (!g) { g = { key, label, rows: [], qty: 0 }; map.set(key, g) }
      g.rows.push(r)
      g.qty += r.quantity
    }
    const arr = [...map.values()]
    for (const g of arr) g.rows.sort((a, b) => (a.created_at < b.created_at ? -1 : 1)) // oldest first
    if (groupBy === 'date') arr.sort((a, b) => (a.key < b.key ? 1 : -1)) // newest day first
    else if (groupBy === 'item') arr.sort((a, b) => b.qty - a.qty || a.label.localeCompare(b.label))
    else arr.sort((a, b) => a.label.localeCompare(b.label))
    return arr
  }, [unfulfilled, groupBy])
  const exportRows = useMemo(() => groups.flatMap((g) => g.rows), [groups])
  const groupWord = groupBy === 'date' ? 'day' : groupBy
  const runExport = (kind: 'pdf' | 'excel') => {
    if (kind === 'excel') { void exportExcel('unfulfilled-signage-orders', FULFILLMENT_COLUMNS, exportRows); return }
    void exportPdf('Unfulfilled Signage Orders', FULFILLMENT_COLUMNS, exportRows, {
      subtitle: `Grouped by ${groupBy}`,
      logoUrl: brandLogoUrl,
    })
  }

  const TABS: [typeof tab, string][] = [
    ['catalog', 'Catalog'],
    ['library', 'Artwork Library'],
    ['new', `New Orders${orderCounts.new ? ` (${orderCounts.new})` : ''}`],
    ['production', `In Production${orderCounts.production ? ` (${orderCounts.production})` : ''}`],
    ['shipped', `Shipped${orderCounts.shipped ? ` (${orderCounts.shipped})` : ''}`],
    ['completed', `Completed${orderCounts.completed ? ` (${orderCounts.completed})` : ''}`],
    ...(isAdmin ? [['fulfillment', `Fulfillment${orderCounts.new ? ` (${orderCounts.new})` : ''}`]] as [typeof tab, string][] : []),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Signage"
        subtitle="Order signage and printed products for your site."
        actions={<Button variant="secondary" onClick={() => startOrder(null)}><Plus className="size-4" /> Custom order</Button>}
      />

      {/* Tabs */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-border">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              '-mb-px border-b-2 pb-2 pt-1 text-sm font-medium transition',
              tab === key ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Catalog: pick a category, then pick a sign from its gallery. */}
      {tab === 'catalog' && (galleryCat ? (
        <SignGallery
          category={galleryCat}
          items={library}
          accountId={profile?.account_id ?? ''}
          canDelete={isAdmin}
          canReorder={isAdmin}
          onBack={() => setGalleryCat(null)}
          onChanged={load}
          onPick={setPickedSign}
        />
      ) : (
        <section>
          <h2 className="mb-3 text-sm font-semibold text-ink">Choose a category</h2>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {SIGNAGE_CATALOG.map((c) => {
              const tileImg = profile?.account_id === MW_ACCOUNT_ID ? MW_TILE_IMAGES[c.name] : undefined
              return (
              <button
                key={c.name}
                type="button"
                onClick={() => setGalleryCat(c.name)}
                className="group flex flex-col items-center gap-2.5"
              >
                {tileImg ? (
                  <div className="flex aspect-square w-full items-center justify-center overflow-hidden rounded-xl border border-border bg-card p-2.5 shadow-sm transition group-hover:shadow-md group-active:scale-[0.98]">
                    <img
                      src={tileImg}
                      alt={c.name}
                      loading="lazy"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>
                ) : (
                  <div className="flex aspect-square w-full items-center justify-center rounded-xl border border-border bg-content text-ink-muted transition group-hover:bg-card group-active:scale-[0.98]">
                    <c.icon className="size-12" strokeWidth={1.5} />
                  </div>
                )}
                <span className="text-center text-sm font-semibold text-ink">{c.name}</span>
              </button>
              )
            })}
          </div>
        </section>
      ))}

      {onOrdersTab && (loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : orderRows.length === 0 ? (
        <EmptyState
          icon={Signpost}
          title={
            tab === 'shipped' ? 'No shipped orders'
              : tab === 'completed' ? 'No completed orders'
                : tab === 'production' ? 'Nothing in production'
                  : 'No new orders'
          }
          description={
            tab === 'shipped' ? 'Orders marked Shipped will appear here.'
              : tab === 'completed' ? 'Orders marked Completed will appear here.'
                : tab === 'production' ? 'Orders marked In Production will appear here.'
                  : 'New orders that have not been placed into production yet show here. Pick a category on the Catalog tab to submit one.'
          }
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Order</th>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Size</th>
                <th className="px-3 py-2.5 font-medium numeric">Qty</th>
                <th className="px-3 py-2.5 font-medium">Ordered by</th>
                <th className="px-3 py-2.5 font-medium">When</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium text-center">Artwork</th>
                {isAdmin && <th className="px-3 py-2.5 font-medium text-center">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {orderRows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-ink">{r.title || r.sign_category}</span>
                      {r.location_id === null && (
                        <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-medium text-accent">All sites</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-muted">
                      {r.sign_category}{r.sign_type ? ` · ${r.sign_type}` : ''}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.location_id === null ? 'All sites' : r.location?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.size_option
                      ? `${r.size_option}${r.sided ? ` · ${r.sided === 'double' ? 'Double' : 'Single'} sided` : ''}`
                      : r.width && r.height
                        ? `${r.width} x ${r.height} ${r.size_unit === 'ft' ? 'ft' : 'in'}`
                        : '—'}
                  </td>
                  <td className="px-3 py-2.5 numeric tabular text-ink-muted">{r.quantity}</td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {r.first_name || r.last_name
                      ? `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim()
                      : r.requested_by?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{timeAgo(r.created_at)}</td>
                  <td className="px-3 py-2.5">
                    {isAdmin ? (
                      <div className="flex flex-col gap-1">
                        <select
                          value={(r.status ?? 'ordered').toLowerCase()}
                          onChange={(e) => void changeStatus(r, e.target.value)}
                          className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-ink"
                        >
                          <option value="ordered">Ordered</option>
                          <option value="in_production">In Production</option>
                          <option value="shipped">Shipped</option>
                          <option value="completed">Completed</option>
                        </select>
                        {(r.status ?? '').toLowerCase() === 'shipped' && (
                          <input
                            type="text"
                            defaultValue={r.tracking_number ?? ''}
                            placeholder="Tracking #"
                            onBlur={(e) => void saveTracking(r, e.target.value)}
                            onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                            className="w-32 rounded-md border border-border bg-card px-2 py-1 text-xs text-ink"
                          />
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        <span className={cn('inline-block w-fit rounded-full px-2 py-0.5 text-[11px] font-medium', statusBadge(r.status).cls)}>{statusBadge(r.status).label}</span>
                        {(r.status ?? '').toLowerCase() === 'shipped' && r.tracking_number && (
                          <span className="text-xs text-ink-muted">Tracking: {r.tracking_number}</span>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {r.artwork_path ? (
                      <button
                        type="button"
                        onClick={() => void openArtwork(r.artwork_path as string)}
                        title={`View artwork${r.artwork_name ? `: ${r.artwork_name}` : ''}`}
                        className="mx-auto grid size-8 place-items-center rounded-md border border-border text-accent hover:bg-accent-soft"
                      >
                        <FileText className="size-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-ink-subtle">none</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2.5 text-center">
                      {confirmDeleteId === r.id ? (
                        <div className="flex items-center justify-center gap-1">
                          <Button variant="danger" size="sm" onClick={() => void deleteOrder(r)}>Delete</Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmDeleteId(null)}>Cancel</Button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmDeleteId(r.id)}
                          title="Delete order"
                          className="mx-auto grid size-8 place-items-center rounded-md border border-border text-danger hover:bg-danger-soft"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      {isAdmin && tab === 'fulfillment' && (loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : unfulfilled.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Nothing to fulfill"
          description="Every order has been shipped or completed. New orders will collect here to work through."
        />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-3 rounded-md border border-border bg-card p-3">
            <span className="text-xs font-medium text-ink-subtle">Group by</span>
            <div className="flex rounded-md border border-border p-0.5">
              {(['site', 'item', 'date'] as const).map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGroupBy(g)}
                  className={cn(
                    'rounded px-3 py-1 text-sm font-medium capitalize transition',
                    groupBy === g ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink',
                  )}
                >
                  {g}
                </button>
              ))}
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => runExport('pdf')}><Download className="size-4" /> PDF</Button>
              <Button variant="secondary" size="sm" onClick={() => runExport('excel')}><Download className="size-4" /> Excel</Button>
            </div>
          </div>
          <p className="text-xs text-ink-muted">
            {unfulfilled.length} unfulfilled order{unfulfilled.length === 1 ? '' : 's'} · {totalQty} item{totalQty === 1 ? '' : 's'} total · {groups.length} {groupWord}{groups.length === 1 ? '' : 's'}
          </p>
          {groups.map((g) => (
            <FulfillmentGroup key={g.key} group={g} groupBy={groupBy} isAdmin={isAdmin} onChangeStatus={changeStatus} />
          ))}
        </div>
      ))}

      {tab === 'library' && !loading && (
        <ArtworkLibrary
          items={library}
          accountId={profile?.account_id ?? ''}
          canDelete={(profile?.email ?? '').toLowerCase() === 'kevan@washlyfe.com'}
          onChanged={load}
        />
      )}

      {pickedSign && galleryCat === 'Business Cards' && (
        <BusinessCardOrderModal
          sign={pickedSign}
          locationId={locationId}
          onClose={() => setPickedSign(null)}
          onPlaced={() => { setPickedSign(null); setTab('new'); void load() }}
        />
      )}

      {pickedSign && galleryCat && galleryCat !== 'Business Cards' && (
        <PlaceOrderModal
          category={galleryCat}
          sign={pickedSign}
          locationId={locationId}
          onClose={() => setPickedSign(null)}
          onPlaced={() => { setPickedSign(null); setTab('new'); void load() }}
        />
      )}

      {creating && (
        <OrderModal
          locationId={locationId}
          library={library}
          presetCategory={presetCategory}
          onClose={() => { setCreating(false); setPresetCategory(null) }}
          onSaved={() => { setCreating(false); setPresetCategory(null); void load() }}
        />
      )}
    </div>
  )
}

// One collapsible group in the Fulfillment report. The column that matches the
// active grouping is dropped (redundant), and admins can mark an order shipped or
// completed right here — which removes it from the report on the next refresh.
function FulfillmentGroup({
  group, groupBy, isAdmin, onChangeStatus,
}: {
  group: { key: string; label: string; rows: Row[]; qty: number }
  groupBy: 'site' | 'item' | 'date'
  isAdmin: boolean
  onChangeStatus: (r: Row, status: string) => void
}) {
  const [open, setOpen] = useState(true)
  const showItem = groupBy !== 'item'
  const showSite = groupBy !== 'site'
  const showWhen = groupBy !== 'date'
  return (
    <section className="overflow-hidden rounded-md border border-border bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 bg-content px-4 py-2.5 text-left"
      >
        <ChevronDown className={cn('size-4 shrink-0 text-ink-muted transition', !open && '-rotate-90')} />
        <span className="min-w-0 truncate font-semibold text-ink">{group.label}</span>
        <span className="ml-auto shrink-0 rounded-full bg-card px-2 py-0.5 text-xs font-medium text-ink-muted">
          {group.rows.length} order{group.rows.length === 1 ? '' : 's'} · {group.qty} qty
        </span>
      </button>
      {open && (
        <div className="overflow-x-auto border-t border-border">
          <table className="w-full min-w-[640px] text-sm">
            <thead className="bg-content/50 text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                {showItem && <th className="px-3 py-2 font-medium">Item</th>}
                {showSite && <th className="px-3 py-2 font-medium">Site</th>}
                <th className="px-3 py-2 font-medium">Size</th>
                <th className="px-3 py-2 font-medium numeric">Qty</th>
                <th className="px-3 py-2 font-medium">Ordered by</th>
                {showWhen && <th className="px-3 py-2 font-medium">When</th>}
                <th className="px-3 py-2 font-medium text-center">Artwork</th>
                {isAdmin && <th className="px-3 py-2 font-medium">Fulfill</th>}
              </tr>
            </thead>
            <tbody>
              {group.rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  {showItem && (
                    <td className="px-3 py-2">
                      <span className="font-medium text-ink">{itemLabelOf(r)}</span>
                      <div className="text-xs text-ink-muted">{r.sign_category}{r.sign_type ? ` · ${r.sign_type}` : ''}</div>
                    </td>
                  )}
                  {showSite && <td className="px-3 py-2 text-ink-muted">{siteLabelOf(r)}</td>}
                  <td className="px-3 py-2 text-ink-muted">{sizeText(r)}</td>
                  <td className="px-3 py-2 numeric tabular text-ink-muted">{r.quantity}</td>
                  <td className="px-3 py-2 text-ink-muted">{orderedByOf(r)}</td>
                  {showWhen && <td className="px-3 py-2 text-ink-muted">{timeAgo(r.created_at)}</td>}
                  <td className="px-3 py-2 text-center">
                    {r.artwork_path ? (
                      <button
                        type="button"
                        onClick={() => void openArtwork(r.artwork_path as string)}
                        title={`View artwork${r.artwork_name ? `: ${r.artwork_name}` : ''}`}
                        className="mx-auto grid size-8 place-items-center rounded-md border border-border text-accent hover:bg-accent-soft"
                      >
                        <FileText className="size-4" />
                      </button>
                    ) : (
                      <span className="text-xs text-ink-subtle">none</span>
                    )}
                  </td>
                  {isAdmin && (
                    <td className="px-3 py-2">
                      <select
                        value={(r.status ?? 'ordered').toLowerCase()}
                        onChange={(e) => onChangeStatus(r, e.target.value)}
                        className="rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-ink"
                      >
                        <option value="ordered">Ordered</option>
                        <option value="in_production">In Production</option>
                        <option value="shipped">Shipped</option>
                        <option value="completed">Completed</option>
                      </select>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

// Every artwork, reusable on a new order. Direct uploads (no order) plus artwork
// from past orders. Deduped by file path.
function ArtworkLibrary({
  items, accountId, canDelete, onChanged,
}: {
  items: ArtworkItem[]
  accountId: string
  canDelete: boolean
  onChanged: () => void
}) {
  const unique = useMemo(() => {
    const seen = new Set<string>()
    return items.filter((i) => i.artwork_path && !seen.has(i.artwork_path) && seen.add(i.artwork_path))
  }, [items])

  // Small rendered preview (first PDF page) per artwork, so users can see the
  // whole sign without opening it. Rendered on demand and cached across visits.
  const thumbs = useArtworkThumbs(useMemo(() => unique.map((u) => u.artwork_path), [unique]))

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const upload = async (f: File | null) => {
    setError(null)
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      return setError('Artwork must be a PDF file.')
    }
    setBusy(true)
    const { error: err } = await signage.addArtwork(accountId, f)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (err) return setError(err.message)
    onChanged()
  }

  const [removing, setRemoving] = useState<string | null>(null)
  const remove = async (path: string, name: string | null) => {
    if (!window.confirm(`Remove "${name ?? 'this artwork'}" from the library? This cannot be undone.`)) return
    setError(null)
    setRemoving(path)
    const { error: err } = await signage.removeArtwork(path)
    setRemoving(null)
    if (err) return setError(err.message)
    onChanged()
  }

  return (
    <section className="rounded-md border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-4">
        <Images className="size-4 text-ink-muted" />
        <h2 className="text-sm font-semibold text-ink">Artwork library</h2>
        <span className="text-xs text-ink-subtle">Reuse any of these on a new order</span>
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => void upload(e.target.files?.[0] ?? null)}
        />
        <Button
          variant="secondary"
          size="sm"
          className="ml-auto"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-4" /> {busy ? 'Uploading…' : 'Upload artwork'}
        </Button>
      </div>
      {error && <p className="border-b border-border bg-danger-soft px-4 py-2 text-sm text-danger">{error}</p>}
      {unique.length === 0 ? (
        <p className="p-4 text-sm text-ink-muted">Artwork you upload on orders will collect here.</p>
      ) : (
        <ul className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4 lg:grid-cols-6">
          {unique.map((a) => (
            <li key={a.artwork_path} className="flex flex-col bg-card">
              <button
                type="button"
                onClick={() => void openArtwork(a.artwork_path)}
                title={`View artwork${a.artwork_name ? `: ${a.artwork_name}` : ''}`}
                className="flex h-56 w-full items-center justify-center overflow-hidden border-b border-border bg-content p-2"
              >
                {thumbs[a.artwork_path] ? (
                  <img
                    src={thumbs[a.artwork_path]}
                    alt={a.artwork_name ?? 'Artwork preview'}
                    className="max-h-full max-w-full object-contain"
                  />
                ) : (
                  <FileText className="size-7 text-ink-subtle" />
                )}
              </button>
              <div className="flex items-center justify-between gap-2 p-2.5">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-ink">{a.artwork_name ?? 'Artwork.pdf'}</p>
                  <p className="truncate text-[11px] text-ink-subtle">
                    {a.sign_category ?? 'Signage'}{a.sign_type ? ` · ${a.sign_type}` : ''} · {shortDate(a.created_at)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={() => void openArtwork(a.artwork_path)}
                    className="rounded-md border border-border px-2 py-1 text-xs text-ink-muted hover:text-accent"
                  >
                    View
                  </button>
                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => void remove(a.artwork_path, a.artwork_name)}
                      disabled={removing === a.artwork_path}
                      title="Remove from library"
                      className="rounded-md border border-border p-1 text-ink-muted hover:border-danger hover:text-danger disabled:opacity-50"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Pick existing library artwork to add to a category's gallery.
function AddFromLibraryModal({
  category, items, accountId, onClose, onChanged,
}: {
  category: string
  items: ArtworkItem[]
  accountId: string
  onClose: () => void
  onChanged: () => void
}) {
  // Candidates: unique library artwork not already in this category.
  const candidates = useMemo(() => {
    const inCat = new Set(signsInCategory(items, category).map((s) => s.artwork_path))
    const seen = new Set<string>()
    return items.filter((i) => i.artwork_path && !inCat.has(i.artwork_path) && !seen.has(i.artwork_path) && seen.add(i.artwork_path))
  }, [items, category])

  const thumbs = useArtworkThumbs(useMemo(() => candidates.map((s) => s.artwork_path), [candidates]))

  const [added, setAdded] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const add = async (item: ArtworkItem) => {
    setError(null)
    setBusy(item.artwork_path)
    const { error: err } = await signage.assignToCategory(accountId, item.artwork_path, item.artwork_name, category)
    setBusy(null)
    if (err) { setError(err.message); return }
    setAdded((prev) => new Set(prev).add(item.artwork_path))
    onChanged()
  }

  return (
    <Modal open onClose={onClose} title={`Add to ${category}`} size="lg">
      <div className="flex flex-col gap-4">
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {candidates.length === 0 ? (
          <p className="py-6 text-center text-sm text-ink-muted">Every library artwork is already in this category.</p>
        ) : (
          <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3">
            {candidates.map((s) => (
              <div key={s.artwork_path} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-2">
                <div className="flex h-32 items-center justify-center overflow-hidden rounded-md bg-content p-1.5">
                  {thumbs[s.artwork_path] ? (
                    <img src={thumbs[s.artwork_path]} alt={s.artwork_name ?? 'Sign'} className="max-h-full max-w-full object-contain" />
                  ) : (
                    <FileText className="size-7 text-ink-subtle" />
                  )}
                </div>
                <p className="truncate text-center text-xs font-medium text-ink">{s.artwork_name ?? 'Sign.pdf'}</p>
                <Button
                  variant={added.has(s.artwork_path) ? 'secondary' : 'primary'}
                  size="sm"
                  disabled={busy === s.artwork_path || added.has(s.artwork_path)}
                  onClick={() => void add(s)}
                >
                  {added.has(s.artwork_path) ? 'Added' : busy === s.artwork_path ? 'Adding…' : 'Add'}
                </Button>
              </div>
            ))}
          </div>
        )}
        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Done</Button>
        </div>
      </div>
    </Modal>
  )
}

// The gallery of signs in one category. Pick a sign to order it (quantity only).
function SignGallery({
  category, items, accountId, canDelete, canReorder, onBack, onChanged, onPick,
}: {
  category: string
  items: ArtworkItem[]
  accountId: string
  canDelete: boolean
  canReorder: boolean
  onBack: () => void
  onChanged: () => void
  onPick: (sign: ArtworkItem) => void
}) {
  const signs = useMemo(() => signsInCategory(items, category), [items, category])
  const thumbs = useArtworkThumbs(useMemo(() => signs.map((s) => s.artwork_path), [signs]))

  // Local, drag-reorderable copy of the gallery (admin only). Resets whenever the
  // underlying signs change (reload, category switch).
  const [ordered, setOrdered] = useState<ArtworkItem[]>(signs)
  useEffect(() => { setOrdered(signs) }, [signs])
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dirty, setDirty] = useState(false)
  const [savingOrder, setSavingOrder] = useState(false)
  const reorderTo = (i: number) => {
    if (dragIndex === null || dragIndex === i) return
    setOrdered((prev) => {
      const next = [...prev]
      const [moved] = next.splice(dragIndex, 1)
      next.splice(i, 0, moved)
      return next
    })
    setDragIndex(i)
    setDirty(true)
  }
  const saveOrder = async () => {
    setDragIndex(null)
    if (!dirty) return
    setDirty(false)
    setSavingOrder(true)
    const { error: err } = await signage.reorderCategory(
      category,
      ordered.map((s) => ({ path: s.artwork_path, name: s.artwork_name })),
    )
    setSavingOrder(false)
    if (err) { setError(err.message); return }
    onChanged()
  }

  const fileRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [picking, setPicking] = useState(false)
  const upload = async (f: File | null) => {
    setError(null)
    if (!f) return
    if (f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) return setError('Artwork must be a PDF file.')
    setBusy(true)
    const { error: err } = await signage.addArtwork(accountId, f, category)
    setBusy(false)
    if (fileRef.current) fileRef.current.value = ''
    if (err) return setError(err.message)
    onChanged()
  }

  const [removing, setRemoving] = useState<string | null>(null)
  const removeSign = async (s: ArtworkItem) => {
    if (!window.confirm(`Delete "${s.artwork_name ?? 'this sign'}"? This cannot be undone.`)) return
    setError(null)
    setRemoving(s.artwork_path)
    const { error: err } = await signage.removeArtwork(s.artwork_path)
    setRemoving(null)
    if (err) return setError(err.message)
    onChanged()
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={onBack} className="text-sm text-ink-muted hover:text-ink">← All categories</button>
        <h2 className="text-base font-semibold text-ink">{category}</h2>
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void upload(e.target.files?.[0] ?? null)} />
        <div className="ml-auto flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setPicking(true)}>
            <Images className="size-4" /> Add from library
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-4" /> {busy ? 'Uploading…' : 'Upload a sign'}
          </Button>
        </div>
      </div>
      {canReorder && signs.length > 1 && (
        <p className="text-xs text-ink-muted">
          {savingOrder ? 'Saving order…' : 'Drag any sign to rearrange the gallery. Your order is saved automatically.'}
        </p>
      )}
      {picking && (
        <AddFromLibraryModal
          category={category}
          items={items}
          accountId={accountId}
          onClose={() => setPicking(false)}
          onChanged={onChanged}
        />
      )}
      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {signs.length === 0 ? (
        <EmptyState
          icon={Images}
          title="No signs in this category yet"
          description="Upload a sign to this category, then anyone can order it in a couple taps."
          action={<Button onClick={() => fileRef.current?.click()}>Upload a sign</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ordered.map((s, i) => (
            <div
              key={s.artwork_path}
              draggable={canReorder}
              onDragStart={canReorder ? (e) => { setDragIndex(i); e.dataTransfer.effectAllowed = 'move' } : undefined}
              onDragOver={canReorder ? (e) => { e.preventDefault(); reorderTo(i) } : undefined}
              onDragEnd={canReorder ? () => void saveOrder() : undefined}
              className={cn(
                'group relative flex flex-col gap-2 rounded-xl border border-border bg-card p-2 transition hover:border-accent',
                canReorder && 'cursor-move',
                dragIndex === i && 'opacity-50 ring-2 ring-accent',
              )}
            >
              <button type="button" onClick={() => onPick(s)} className="flex flex-col gap-2 text-left">
                <div className="flex h-60 items-center justify-center overflow-hidden rounded-lg bg-content p-2">
                  {thumbs[s.artwork_path] ? (
                    <img src={thumbs[s.artwork_path]} alt={s.artwork_name ?? 'Sign'} className="max-h-full max-w-full object-contain" draggable={false} />
                  ) : (
                    <FileText className="size-8 text-ink-subtle" />
                  )}
                </div>
                <p className="truncate px-1 text-center text-sm font-medium text-ink group-hover:text-accent">{s.artwork_name ?? 'Sign.pdf'}</p>
              </button>
              {canReorder && (
                <div className="absolute left-2 top-2 z-10 rounded-md border border-border bg-card/90 p-1.5 text-ink-muted shadow-sm" title="Drag to rearrange">
                  <GripVertical className="size-4" />
                </div>
              )}
              {canDelete && (
                <button
                  type="button"
                  onClick={() => void removeSign(s)}
                  disabled={removing === s.artwork_path}
                  title="Delete sign"
                  className="absolute right-2 top-2 z-10 rounded-md border border-border bg-card/90 p-1.5 text-ink-muted shadow-sm hover:border-danger hover:text-danger disabled:opacity-50"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// Confirm a picked sign: choose the site and quantity, then place the order.
function PlaceOrderModal({
  category, sign, locationId, onClose, onPlaced,
}: {
  category: string
  sign: ArtworkItem
  locationId: string
  onClose: () => void
  onPlaced: () => void
}) {
  const { profile } = useAuth()
  const { activeLocation, locations } = useLocations()
  const [siteId, setSiteId] = useState<string>(activeLocation?.id ?? locationId)
  const [quantity, setQuantity] = useState('1')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void signage.artworkUrl(sign.artwork_path).then(async ({ url }) => {
      if (!url || !active) return
      const img = await renderPdfThumb(url, sign.artwork_path)
      if (active) setPreview(img)
    })
    return () => { active = false }
  }, [sign.artwork_path])

  const place = async () => {
    setError(null)
    const [pf, ...pl] = (profile?.name ?? '').trim().split(' ')
    setBusy(true)
    const { data: created, error: err } = await signage.create({
      account_id: profile?.account_id ?? '',
      location_id: siteId === 'all' ? null : siteId,
      requested_by: profile?.id ?? null,
      first_name: pf || null,
      last_name: pl.join(' ') || null,
      title: sign.artwork_name ?? category,
      sign_category: category,
      quantity: Number(quantity) || 1,
      artwork_path: sign.artwork_path,
      artwork_name: sign.artwork_name,
    })
    setBusy(false)
    if (err) return setError(err.message)
    if (created?.id) void signage.emailRequest(created.id)
    onPlaced()
  }

  return (
    <Modal open onClose={onClose} title="Order sign" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex h-48 items-center justify-center overflow-hidden rounded-lg border border-border bg-content p-2">
          {preview ? (
            <img src={preview} alt={sign.artwork_name ?? 'Sign'} className="max-h-full max-w-full object-contain" />
          ) : (
            <FileText className="size-8 text-ink-subtle" />
          )}
        </div>
        <div>
          <p className="text-sm font-medium text-ink">{sign.artwork_name ?? 'Sign.pdf'}</p>
          <p className="text-xs text-ink-muted">{category}</p>
        </div>
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="all">ALL SITES</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Quantity" required>
          {(id) => <Input id={id} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void place()} disabled={busy}>{busy ? 'Placing…' : 'Place order'}</Button>
        </div>
      </div>
    </Modal>
  )
}

// Business cards need the card owner's name and a quantity in multiples of 500.
function BusinessCardOrderModal({
  sign, locationId, onClose, onPlaced,
}: {
  sign: ArtworkItem
  locationId: string
  onClose: () => void
  onPlaced: () => void
}) {
  const { profile } = useAuth()
  const { activeLocation, locations } = useLocations()
  const [pf, ...pl] = (profile?.name ?? '').trim().split(' ')
  const [siteId, setSiteId] = useState<string>(activeLocation?.id ?? locationId)
  const [firstName, setFirstName] = useState(pf ?? '')
  const [lastName, setLastName] = useState(pl.join(' '))
  const [jobTitle, setJobTitle] = useState('')
  const [quantity, setQuantity] = useState('500')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    void signage.artworkUrl(sign.artwork_path).then(async ({ url }) => {
      if (!url || !active) return
      const img = await renderPdfThumb(url, sign.artwork_path)
      if (active) setPreview(img)
    })
    return () => { active = false }
  }, [sign.artwork_path])

  const place = async () => {
    setError(null)
    if (!firstName.trim() || !lastName.trim() || !jobTitle.trim()) return setError('Enter the first name, last name, and title for the card.')
    const qty = Number(quantity) || 0
    if (qty <= 0 || qty % 500 !== 0) return setError('Quantity must be in increments of 500.')
    setBusy(true)
    const { data: created, error: err } = await signage.create({
      account_id: profile?.account_id ?? '',
      location_id: siteId === 'all' ? null : siteId,
      requested_by: profile?.id ?? null,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      notes: `Title: ${jobTitle.trim()}`,
      title: `Business Cards - ${firstName.trim()} ${lastName.trim()} - ${jobTitle.trim()}`,
      sign_category: 'Business Cards',
      quantity: qty,
      artwork_path: sign.artwork_path,
      artwork_name: sign.artwork_name,
    })
    setBusy(false)
    if (err) return setError(err.message)
    if (created?.id) void signage.emailRequest(created.id)
    onPlaced()
  }

  return (
    <Modal open onClose={onClose} title="Order business cards" size="sm">
      <div className="flex flex-col gap-4">
        <div className="flex h-40 items-center justify-center overflow-hidden rounded-lg border border-border bg-content p-2">
          {preview ? (
            <img src={preview} alt={sign.artwork_name ?? 'Business card'} className="max-h-full max-w-full object-contain" />
          ) : (
            <FileText className="size-8 text-ink-subtle" />
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name" required>{(id) => <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}</Field>
          <Field label="Last name" required>{(id) => <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} />}</Field>
        </div>
        <Field label="Title" required>
          {(id) => <Input id={id} value={jobTitle} onChange={(e) => setJobTitle(e.target.value)} placeholder="e.g. General Manager" />}
        </Field>
        <Field label="Quantity (cards)" required>
          {(id) => (
            <Select id={id} value={quantity} onChange={(e) => setQuantity(e.target.value)}>
              {[500, 1000, 1500, 2000, 2500, 3000, 3500, 4000, 4500, 5000].map((q) => (
                <option key={q} value={q}>{q.toLocaleString('en-US')}</option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="all">ALL SITES</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void place()} disabled={busy}>{busy ? 'Placing…' : 'Place order'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function OrderModal({
  locationId, library, presetCategory, onClose, onSaved,
}: {
  locationId: string
  library: ArtworkItem[]
  presetCategory?: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { profile } = useAuth()
  const { activeLocation, locations } = useLocations()
  const [pf, ...pl] = (profile?.name ?? '').trim().split(' ')
  // 'all' targets every site (location_id null); otherwise a specific site id.
  const [siteId, setSiteId] = useState<string>(activeLocation?.id ?? locationId)
  const initCategory = presetCategory ?? SIGN_CATEGORIES[0]
  const [orderTitle, setOrderTitle] = useState(presetCategory ?? '')
  const [firstName, setFirstName] = useState(pf ?? '')
  const [lastName, setLastName] = useState(pl.join(' '))
  const [category, setCategory] = useState<string>(initCategory)
  const [signType, setSignType] = useState<string>(signTypeOptions(initCategory)[0] ?? '')
  const [width, setWidth] = useState('')
  const [height, setHeight] = useState('')
  const [unit, setUnit] = useState<'in' | 'ft'>('in')
  const [sizeOption, setSizeOption] = useState('')
  const [sided, setSided] = useState<'single' | 'double'>('single')
  const [quantity, setQuantity] = useState('1')

  // Artwork: upload a new PDF, or reuse one from the library.
  const uniqueLibrary = useMemo(() => {
    const seen = new Set<string>()
    return library.filter((i) => i.artwork_path && !seen.has(i.artwork_path) && seen.add(i.artwork_path))
  }, [library])
  const [artSource, setArtSource] = useState<'upload' | 'library'>('upload')
  const [file, setFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [libraryPath, setLibraryPath] = useState('')
  const [libraryPreview, setLibraryPreview] = useState<string | null>(null)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Live preview of a freshly selected PDF.
  useEffect(() => {
    if (!file) { setPreviewUrl(null); return }
    const url = URL.createObjectURL(file)
    setPreviewUrl(url)
    return () => URL.revokeObjectURL(url)
  }, [file])

  // Signed-URL preview for a chosen library artwork.
  useEffect(() => {
    if (artSource !== 'library' || !libraryPath) { setLibraryPreview(null); return }
    let active = true
    void signage.artworkUrl(libraryPath).then(({ url }) => { if (active) setLibraryPreview(url) })
    return () => { active = false }
  }, [artSource, libraryPath])

  const typeOptions = signTypeOptions(category)
  const spec = flagSpec(signType)

  const applyType = (t: string) => {
    setSignType(t)
    const s = flagSpec(t)
    setSizeOption(s?.sizes[0] ?? '')
    setSided('single')
  }
  const onCategory = (c: string) => {
    setCategory(c)
    applyType(signTypeOptions(c)[0] ?? '')
  }

  const onFile = (f: File | null) => {
    setError(null)
    if (f && f.type !== 'application/pdf' && !f.name.toLowerCase().endsWith('.pdf')) {
      setError('Artwork must be a PDF file.')
      setFile(null)
      return
    }
    setFile(f)
    // Choosing a file switches away from a library pick (the two are exclusive).
    if (f) { setArtSource('upload'); setLibraryPath('') }
  }

  const save = async () => {
    setError(null)
    if (!orderTitle.trim()) return setError('Give the order a title')
    if (!firstName.trim() || !lastName.trim()) return setError('Enter your first and last name')
    if (typeOptions.length > 0 && !signType) return setError('Choose a sign type')
    setBusy(true)

    let artworkPath: string | null = null
    let artworkName: string | null = null
    if (artSource === 'library' && libraryPath) {
      artworkPath = libraryPath
      artworkName = uniqueLibrary.find((i) => i.artwork_path === libraryPath)?.artwork_name ?? null
    } else if (file) {
      const { error: upErr, path } = await signage.uploadArtwork(profile?.account_id ?? '', file)
      if (upErr) { setBusy(false); return setError(`Artwork upload failed: ${upErr.message}`) }
      artworkPath = path
      artworkName = file.name
    }

    const { data: created, error: err } = await signage.create({
      account_id: profile?.account_id ?? '',
      location_id: siteId === 'all' ? null : siteId,
      requested_by: profile?.id ?? null,
      title: orderTitle.trim(),
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      sign_category: category,
      sign_type: signType || null,
      width: spec ? null : width ? Number(width) : null,
      height: spec ? null : height ? Number(height) : null,
      size_unit: unit,
      size_option: spec ? sizeOption : null,
      sided: spec ? (spec.sided ? sided : 'single') : null,
      quantity: Number(quantity) || 1,
      artwork_path: artworkPath,
      artwork_name: artworkName,
    })
    setBusy(false)
    if (err) return setError(err.message)
    // Email the order (with the artwork PDF) to info@washlyfe.com. Best-effort.
    if (created?.id) void signage.emailRequest(created.id)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New Signage Order" size="md">
      <div className="flex flex-col gap-4">
        <Field label="Order title" required>
          {(id) => <Input id={id} value={orderTitle} onChange={(e) => setOrderTitle(e.target.value)} placeholder="e.g. Front entrance A-frame" />}
        </Field>
        <Field label="Site" required>
          {(id) => (
            <Select id={id} value={siteId} onChange={(e) => setSiteId(e.target.value)}>
              <option value="all">ALL SITES</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label="First name" required>{(id) => <Input id={id} value={firstName} onChange={(e) => setFirstName(e.target.value)} />}</Field>
          <Field label="Last name" required>{(id) => <Input id={id} value={lastName} onChange={(e) => setLastName(e.target.value)} />}</Field>
        </div>
        <Field label="Sign category" required>
          {(id) => (
            <Select id={id} value={category} onChange={(e) => onCategory(e.target.value)}>
              {SIGN_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </Select>
          )}
        </Field>
        {typeOptions.length > 0 && (
          <Field label={signTypeLabel(category)} required>
            {(id) => (
              <Select id={id} value={signType} onChange={(e) => applyType(e.target.value)}>
                {typeOptions.map((o) => <option key={o} value={o}>{o}</option>)}
              </Select>
            )}
          </Field>
        )}
        {spec ? (
          <>
            <Field label="Size" required>
              {(id) => (
                <Select id={id} value={sizeOption} onChange={(e) => setSizeOption(e.target.value)}>
                  {spec.sizes.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Sided">
              {(id) =>
                spec.sided ? (
                  <Select id={id} value={sided} onChange={(e) => setSided(e.target.value as 'single' | 'double')}>
                    <option value="single">Single sided</option>
                    <option value="double">Double sided</option>
                  </Select>
                ) : (
                  <Input id={id} value="Single sided only" readOnly className="bg-content text-ink-muted" />
                )
              }
            </Field>
          </>
        ) : (
          <Field label="Size">
            {() => (
              <div className="flex items-center gap-2">
                <Input type="number" min="0" step="0.1" value={width} onChange={(e) => setWidth(e.target.value)} placeholder="Width" />
                <span className="text-ink-muted">x</span>
                <Input type="number" min="0" step="0.1" value={height} onChange={(e) => setHeight(e.target.value)} placeholder="Height" />
                <Select value={unit} onChange={(e) => setUnit(e.target.value as 'in' | 'ft')} className="w-28">
                  <option value="in">Inches</option>
                  <option value="ft">Feet</option>
                </Select>
              </div>
            )}
          </Field>
        )}
        <Field label="Quantity" required>{(id) => <Input id={id} type="number" min="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>

        <Field label="Artwork (PDF)">
          {() => (
            <div className="flex flex-col gap-2">
              <div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={uniqueLibrary.length === 0}
                  className={artSource === 'library' ? 'border-accent text-accent' : undefined}
                  onClick={() => setArtSource('library')}
                >
                  Upload From Library
                </Button>
              </div>
              {artSource === 'library' && (
                <Select value={libraryPath} onChange={(e) => { setLibraryPath(e.target.value); setFile(null) }}>
                  <option value="">Choose existing artwork…</option>
                  {uniqueLibrary.map((a) => (
                    <option key={a.artwork_path} value={a.artwork_path}>
                      {(a.artwork_name ?? 'Artwork.pdf') + ' (' + shortDate(a.created_at) + ')'}
                    </option>
                  ))}
                </Select>
              )}
              <input
                type="file"
                accept="application/pdf,.pdf"
                onChange={(e) => onFile(e.target.files?.[0] ?? null)}
                className="block w-full text-sm text-ink-muted file:mr-3 file:rounded-md file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover"
              />
            </div>
          )}
        </Field>

        {(previewUrl || libraryPreview) && (
          <div>
            <p className="mb-1 text-xs font-medium text-ink-muted">Artwork preview</p>
            <iframe
              title="Artwork preview"
              src={(artSource === 'library' ? libraryPreview : previewUrl) ?? ''}
              className="h-80 w-full rounded-md border border-border bg-content"
            />
          </div>
        )}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Submitting…' : 'Submit order'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function SignagePage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
