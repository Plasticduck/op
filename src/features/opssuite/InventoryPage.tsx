import { useEffect, useMemo, useState } from 'react'
import { Boxes, ClipboardList, FileSpreadsheet, FileText, Pencil, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { currency, shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { inventory, type InventoryItem, type InventoryCount, type InventoryCountSession, type InventoryCountLine } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { exportCountSheet } from '@/lib/countSheet'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'

type CountRow = InventoryCount & { location: { name: string } | null }
type SessionRow = InventoryCountSession & { location: { name: string } | null }
type Tab = 'catalog' | 'counts' | 'sessions'
type DateRange = 'all' | '7d' | '30d' | 'month' | 'year'
type Division = 'lube' | 'wash' | 'maintenance' | 'chemical'

const DIVISIONS: { key: Division; label: string }[] = [
  { key: 'lube', label: 'Lube' },
  { key: 'wash', label: 'Wash' },
  { key: 'maintenance', label: 'Maintenance' },
  { key: 'chemical', label: 'Chemical' },
]
const divisionLabel = (key: string | null) =>
  DIVISIONS.find((d) => d.key === key)?.label ?? (key ?? '—')
const fmtValue = (v: number | null) => (v == null ? '—' : currency(Number(v)))

const ITEM_COLUMNS: ExportColumn<InventoryItem>[] = [
  { header: 'Division', value: (r) => divisionLabel(r.division) },
  { header: 'Category', value: (r) => r.category },
  { header: 'Brand', value: (r) => r.brand },
  { header: 'Item', value: (r) => r.item },
  { header: 'Value', value: (r) => (r.value == null ? '' : currency(Number(r.value))) },
]
const COUNT_COLUMNS: ExportColumn<CountRow>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Division', value: (r) => divisionLabel(r.division) },
  { header: 'Item', value: (r) => r.item },
  { header: 'Brand', value: (r) => r.brand },
  { header: 'Qty', value: (r) => r.quantity },
  { header: 'Counted by', value: (r) => r.submitted_by_name },
  { header: 'Date', value: (r) => shortDate(r.created_at) },
]

export default function InventoryPage() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const [tab, setTab] = useState<Tab>('catalog')
  const [items, setItems] = useState<InventoryItem[]>([])
  const [counts, setCounts] = useState<CountRow[]>([])
  const [sessions, setSessions] = useState<SessionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [division, setDivision] = useState<Division | ''>('')
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('')
  const [countsSiteId, setCountsSiteId] = useState('')
  const [countsDivision, setCountsDivision] = useState<Division | ''>('')
  const [countsRange, setCountsRange] = useState<DateRange>('all')
  const [countsQuery, setCountsQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null)
  // A New Count / reopened count session. `division` is the division being counted.
  const [countSession, setCountSession] = useState<{ session: SessionRow | null; division: Division } | null>(null)

  const load = () =>
    Promise.all([inventory.items(), inventory.counts(), inventory.sessions()]).then(([i, c, s]) => {
      setItems((i.data as InventoryItem[]) ?? [])
      setCounts((c.data as unknown as CountRow[]) ?? [])
      setSessions((s.data as unknown as SessionRow[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])

  // Catalog is split by division and never shows everything at once: nothing is
  // listed until a division (Lube, Wash, or Maintenance) is picked.
  const divisionItemCounts = useMemo(() => {
    const m: Record<Division, number> = { lube: 0, wash: 0, maintenance: 0, chemical: 0 }
    for (const it of items) if (it.division in m) m[it.division as Division]++
    return m
  }, [items])

  const divisionItems = useMemo(
    () => (division ? items.filter((it) => it.division === division) : []),
    [items, division],
  )

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const it of divisionItems) if (it.category) set.add(it.category)
    return [...set].sort()
  }, [divisionItems])

  const q = query.trim().toLowerCase()
  const matches = (...vals: (string | null)[]) =>
    (!q || vals.some((v) => v?.toLowerCase().includes(q))) && (!category || vals.includes(category))

  const visibleItems = divisionItems.filter((it) => matches(it.category, it.brand, it.item))

  const countsQ = countsQuery.trim().toLowerCase()
  const countsFiltersActive = countsSiteId !== '' && (countsRange !== 'all' || countsQ !== '')
  const rangeStart = useMemo(() => {
    const now = new Date()
    if (countsRange === '7d') return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    if (countsRange === '30d') return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    if (countsRange === 'month') return new Date(now.getFullYear(), now.getMonth(), 1)
    if (countsRange === 'year') return new Date(now.getFullYear(), 0, 1)
    return null
  }, [countsRange])
  const visibleCounts = countsFiltersActive
    ? counts.filter((c) => {
        if (c.location_id !== countsSiteId) return false
        if (countsDivision && c.division !== countsDivision) return false
        if (rangeStart && new Date(c.created_at) < rangeStart) return false
        if (countsQ && ![c.category, c.brand, c.item].some((v) => v?.toLowerCase().includes(countsQ))) return false
        return true
      })
    : []
  const countsTable = useOpsTable(visibleCounts, (c) => c.created_at)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Inventory"
        subtitle="Product catalog and per-site counts."
        actions={
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => setAddingItem(true)}><Plus className="size-4" /> Add item</Button>
            <Button onClick={() => setAdding(true)}><Plus className="size-4" /> Log count</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(['catalog', 'counts', 'sessions'] as Tab[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={
                'rounded-md px-3 py-1.5 text-sm font-medium transition ' +
                (tab === t ? 'bg-accent text-white' : 'bg-card border border-border text-ink-muted hover:bg-content')
              }
            >
              {t === 'sessions' ? 'Saved Counts' : t === 'catalog' ? 'Catalog' : 'Counts'}{' '}
              <span className="ml-1 opacity-70">
                {t === 'catalog' ? items.length : t === 'counts' ? counts.length : sessions.length}
              </span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex flex-wrap gap-2">
          {tab === 'catalog' ? (
            division && (
              <>
                <Select value={category} onChange={(e) => setCategory(e.target.value)} className="w-48">
                  <option value="">All categories</option>
                  {categories.map((c) => <option key={c} value={c}>{c}</option>)}
                </Select>
                <Input placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} className="w-56" />
              </>
            )
          ) : tab === 'counts' ? (
            <>
              <Select value={countsSiteId} onChange={(e) => setCountsSiteId(e.target.value)} className="w-56" aria-label="Site">
                <option value="">Pick a site…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
              <Select value={countsDivision} onChange={(e) => setCountsDivision(e.target.value as Division | '')} className="w-44" aria-label="Division">
                <option value="">All divisions</option>
                {DIVISIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
              </Select>
              <Select value={countsRange} onChange={(e) => setCountsRange(e.target.value as DateRange)} className="w-44" aria-label="Date range">
                <option value="all">All dates</option>
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="month">This month</option>
                <option value="year">This year</option>
              </Select>
              <Input placeholder="Search category, brand, item…" value={countsQuery} onChange={(e) => setCountsQuery(e.target.value)} className="w-64" />
            </>
          ) : null}
        </div>
      </div>

      {tab === 'catalog' && (
        <div className="flex flex-wrap gap-1.5">
          {DIVISIONS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => { setDivision(d.key); setCategory(''); setQuery('') }}
              className={
                'rounded-md border px-3 py-1.5 text-sm font-medium transition ' +
                (division === d.key
                  ? 'border-accent bg-accent-soft text-accent'
                  : 'border-border bg-card text-ink-muted hover:bg-content')
              }
            >
              {d.label} <span className="ml-1 opacity-70">{divisionItemCounts[d.key]}</span>
            </button>
          ))}
        </div>
      )}

      {tab === 'catalog' ? (
        division && (
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" disabled={!division} onClick={() => division && setCountSession({ session: null, division })}>
              <Plus className="size-4" /> New Count
            </Button>
            <Button variant="secondary" size="sm" disabled={visibleItems.length === 0} onClick={() => exportCountSheet(divisionLabel(division), visibleItems, division === 'chemical', profile?.brand_logo_url)}>
              <ClipboardList className="size-4" /> Count sheet
            </Button>
            <Button variant="secondary" size="sm" disabled={visibleItems.length === 0} onClick={() => exportPdf(`Inventory Catalog - ${divisionLabel(division)}`, ITEM_COLUMNS, visibleItems)}>
              <FileText className="size-4" /> PDF
            </Button>
            <Button variant="secondary" size="sm" disabled={visibleItems.length === 0} onClick={() => exportExcel(`inventory-${division}`, ITEM_COLUMNS, visibleItems)}>
              <FileSpreadsheet className="size-4" /> Excel
            </Button>
          </div>
        )
      ) : countsFiltersActive ? (
        <OpsToolbar
          range={countsTable.range} onRange={countsTable.setRange} sort={countsTable.sort} onSort={countsTable.setSort} count={countsTable.rows.length}
          onExportPdf={() => exportPdf('Inventory Counts', COUNT_COLUMNS, countsTable.rows)}
          onExportExcel={() => exportExcel('inventory-counts', COUNT_COLUMNS, countsTable.rows)}
        />
      ) : null}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : tab === 'catalog' ? (
        !division ? (
          <EmptyState
            icon={Boxes}
            title="Pick a division"
            description="Inventory is organized into Lube, Wash, and Maintenance. Choose a division above to view its items."
          />
        ) : visibleItems.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title={`No ${divisionLabel(division)} items`}
            description="No catalog items match your filters."
            action={<Button onClick={() => setAddingItem(true)}><Plus className="size-4" /> Add item</Button>}
          />
        ) : (
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Category</th>
                  <th className="px-3 py-2.5 font-medium">Brand</th>
                  <th className="px-3 py-2.5 font-medium">Item</th>
                  <th className="px-3 py-2.5 font-medium text-right">Value</th>
                  <th className="px-3 py-2.5 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {visibleItems.map((it) => (
                  <tr key={it.id} className="border-t border-border hover:bg-content">
                    <td className="px-3 py-2.5 text-ink-muted">{it.category ?? '—'}</td>
                    <td className="px-3 py-2.5 text-ink-muted">{it.brand ?? '—'}</td>
                    <td className="px-3 py-2.5 font-medium text-ink">{it.item ?? '—'}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums text-ink-muted">{fmtValue(it.value)}</td>
                    <td className="px-3 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditingItem(it)} aria-label="Edit item">
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={async () => {
                            if (!window.confirm(`Delete ${it.item ?? 'item'}?`)) return
                            await inventory.deleteItem(it.id)
                            await load()
                          }}
                          aria-label="Delete item"
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      ) : tab === 'counts' ? (
        !countsFiltersActive ? (
        <EmptyState
          icon={Boxes}
          title="Pick a site to view counts"
          description="Counts are not shown by default. Pick a site and an optional date range to see only the counts that matter to you."
        />
      ) : countsTable.rows.length === 0 ? (
        <EmptyState icon={Boxes} title="No counts" description="No inventory counts match your filters." />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Division</th>
                <th className="px-3 py-2.5 font-medium">Item</th>
                <th className="px-3 py-2.5 font-medium">Brand</th>
                <th className="px-3 py-2.5 font-medium text-right">Qty</th>
                <th className="px-3 py-2.5 font-medium">Counted by</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {countsTable.rows.map((c) => (
                <tr key={c.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{c.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{divisionLabel(c.division)}</td>
                  <td className="px-3 py-2.5 text-ink">{c.item ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{c.brand ?? '—'}</td>
                  <td className="px-3 py-2.5 text-right tabular-nums text-ink">{c.quantity}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{c.submitted_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(c.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )
      ) : (
        <SessionsList
          sessions={sessions}
          onOpen={(s) => setCountSession({ session: s, division: (s.division as Division) ?? 'lube' })}
          onDelete={async (id) => {
            if (!window.confirm('Delete this saved count?')) return
            await inventory.deleteSession(id)
            await load()
          }}
        />
      )}

      {countSession && (
        <CountSession
          accountId={profile?.account_id ?? ''}
          submitterId={profile?.id ?? null}
          submitterName={profile?.name ?? null}
          division={countSession.division}
          items={items.filter((it) => it.division === countSession.division)}
          session={countSession.session}
          onClose={() => setCountSession(null)}
          onSaved={() => { setCountSession(null); void load() }}
        />
      )}

      {adding && (
        <AddCount
          accountId={profile?.account_id ?? ''}
          items={items}
          submitterId={profile?.id ?? null}
          submitterName={profile?.name ?? null}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load() }}
        />
      )}

      {addingItem && (
        <AddItem
          accountId={profile?.account_id ?? ''}
          defaultDivision={division || 'lube'}
          onClose={() => setAddingItem(false)}
          onSaved={() => { setAddingItem(false); void load() }}
        />
      )}

      {editingItem && (
        <EditItem
          item={editingItem}
          onClose={() => setEditingItem(null)}
          onSaved={() => { setEditingItem(null); void load() }}
        />
      )}
    </div>
  )
}

function AddItem({ accountId, defaultDivision, onClose, onSaved }: {
  accountId: string
  defaultDivision: Division
  onClose: () => void
  onSaved: () => void
}) {
  const [divisionValue, setDivisionValue] = useState<Division>(defaultDivision)
  const [category, setCategory] = useState('')
  const [brand, setBrand] = useState('')
  const [item, setItem] = useState('')
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError(null)
    const cat = category.trim()
    const it = item.trim()
    const br = brand.trim()
    if (!cat) return setError('Enter a category')
    if (!it) return setError('Enter an item name')
    if (value.trim() !== '' && isNaN(Number(value))) return setError('Enter a valid value')
    setBusy(true)
    const { error: err } = await inventory.createItem({
      account_id: accountId,
      division: divisionValue,
      category: cat,
      brand: br || null,
      item: it,
      value: value.trim() === '' ? null : Number(value),
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Add catalog item">
      <div className="flex flex-col gap-4">
        <Field label="Division" required>
          {(id) => (
            <Select id={id} value={divisionValue} onChange={(e) => setDivisionValue(e.target.value as Division)}>
              {DIVISIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Category" required>
            {(id) => <Input id={id} value={category} onChange={(e) => setCategory(e.target.value)} />}
          </Field>
          <Field label="Brand">
            {(id) => <Input id={id} value={brand} onChange={(e) => setBrand(e.target.value)} />}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Item" required>
            {(id) => <Input id={id} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Product name" />}
          </Field>
          <Field label="Value" hint="Unit cost or price. Optional.">
            {(id) => <Input id={id} type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />}
          </Field>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save item'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function EditItem({ item, onClose, onSaved }: {
  item: InventoryItem
  onClose: () => void
  onSaved: () => void
}) {
  const [divisionValue, setDivisionValue] = useState<Division>((item.division as Division) ?? 'lube')
  const [category, setCategory] = useState(item.category ?? '')
  const [brand, setBrand] = useState(item.brand ?? '')
  const [itemName, setItemName] = useState(item.item ?? '')
  const [value, setValue] = useState(item.value != null ? String(item.value) : '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError(null)
    const cat = category.trim()
    const it = itemName.trim()
    const br = brand.trim()
    if (!cat) return setError('Enter a category')
    if (!it) return setError('Enter an item name')
    if (value.trim() !== '' && isNaN(Number(value))) return setError('Enter a valid value')
    setBusy(true)
    const { error: err } = await inventory.updateItem(item.id, {
      division: divisionValue,
      category: cat,
      brand: br || null,
      item: it,
      value: value.trim() === '' ? null : Number(value),
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Edit catalog item">
      <div className="flex flex-col gap-4">
        <Field label="Division" required>
          {(id) => (
            <Select id={id} value={divisionValue} onChange={(e) => setDivisionValue(e.target.value as Division)}>
              {DIVISIONS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Category" required>
            {(id) => <Input id={id} value={category} onChange={(e) => setCategory(e.target.value)} />}
          </Field>
          <Field label="Brand">
            {(id) => <Input id={id} value={brand} onChange={(e) => setBrand(e.target.value)} />}
          </Field>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Item" required>
            {(id) => <Input id={id} value={itemName} onChange={(e) => setItemName(e.target.value)} placeholder="Product name" />}
          </Field>
          <Field label="Value" hint="Unit cost or price. Optional.">
            {(id) => <Input id={id} type="number" min="0" step="0.01" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />}
          </Field>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function SessionsList({ sessions, onOpen, onDelete }: {
  sessions: SessionRow[]
  onOpen: (s: SessionRow) => void
  onDelete: (id: string) => void
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        icon={Boxes}
        title="No saved counts"
        description="Start a New Count from a division on the Catalog tab. Saved counts appear here to reopen."
      />
    )
  }
  return (
    <div className="overflow-x-auto rounded-md border border-border bg-card">
      <table className="w-full min-w-[720px] text-sm">
        <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
          <tr>
            <th className="px-3 py-2.5 font-medium">Site</th>
            <th className="px-3 py-2.5 font-medium">Division</th>
            <th className="px-3 py-2.5 font-medium">Note</th>
            <th className="px-3 py-2.5 font-medium">Started by</th>
            <th className="px-3 py-2.5 font-medium">Updated</th>
            <th className="px-3 py-2.5 font-medium text-right"></th>
          </tr>
        </thead>
        <tbody>
          {sessions.map((s) => (
            <tr key={s.id} className="border-t border-border hover:bg-content">
              <td className="px-3 py-2.5 font-medium text-ink">{s.location?.name ?? '—'}</td>
              <td className="px-3 py-2.5 text-ink-muted">{divisionLabel(s.division)}</td>
              <td className="px-3 py-2.5 text-ink-muted">{s.note || '—'}</td>
              <td className="px-3 py-2.5 text-ink-muted">{s.created_by_name ?? '—'}</td>
              <td className="px-3 py-2.5 text-ink-muted">{shortDate(s.updated_at)}</td>
              <td className="px-3 py-2.5 text-right">
                <div className="flex items-center justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => onOpen(s)}>Open</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    onClick={() => onDelete(s.id)}
                    aria-label="Delete saved count"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CountSession({ accountId, submitterId, submitterName, division, items, session, onClose, onSaved }: {
  accountId: string
  submitterId: string | null
  submitterName: string | null
  division: Division
  items: InventoryItem[]
  session: SessionRow | null
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  const sortedItems = useMemo(
    () =>
      [...items].sort(
        (a, b) =>
          (a.category ?? '').localeCompare(b.category ?? '') || (a.item ?? '').localeCompare(b.item ?? ''),
      ),
    [items],
  )
  // Chemicals also record an online (OL) reading alongside the physical count.
  const withOnline = division === 'chemical'
  const [locationId, setLocationId] = useState(session?.location_id ?? '')
  const [note, setNote] = useState(session?.note ?? '')
  const [qty, setQty] = useState<Record<string, string>>({})
  const [ol, setOl] = useState<Record<string, string>>({})
  const [initialLines, setInitialLines] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [loadingLines, setLoadingLines] = useState(!!session)

  useEffect(() => {
    if (!session) return
    let active = true
    void inventory.sessionLines(session.id).then(({ data }) => {
      if (!active) return
      const map: Record<string, string> = {}
      const olMap: Record<string, string> = {}
      const init: Record<string, boolean> = {}
      ;((data as InventoryCountLine[] | null) ?? []).forEach((l) => {
        if (l.quantity != null) map[l.item_id] = String(l.quantity)
        if (l.online_quantity != null) olMap[l.item_id] = String(l.online_quantity)
        if (l.quantity != null || l.online_quantity != null) init[l.item_id] = true
      })
      setQty(map)
      setOl(olMap)
      setInitialLines(init)
      setLoadingLines(false)
    })
    return () => { active = false }
  }, [session])

  const save = async () => {
    setError(null)
    if (!locationId) return setError('Pick a site')
    setBusy(true)
    let sid = session?.id
    if (!sid) {
      const { data, error: err } = await inventory.createSession({
        account_id: accountId,
        location_id: locationId,
        division,
        note: note.trim() || null,
        created_by: submitterId,
        created_by_name: submitterName,
      })
      if (err || !data) {
        setBusy(false)
        return setError(err?.message ?? 'Failed to create count')
      }
      sid = (data as { id: string }).id
    } else {
      await inventory.updateSession(sid, { note: note.trim() || null })
    }
    // Write a line for every item that has a number, plus any that had one before
    // and were cleared (so clearing a value persists as blank).
    const lines = sortedItems
      .filter(
        (it) =>
          (qty[it.id] ?? '').trim() !== '' || (ol[it.id] ?? '').trim() !== '' || initialLines[it.id],
      )
      .map((it) => {
        const v = (qty[it.id] ?? '').trim()
        const o = (ol[it.id] ?? '').trim()
        return {
          session_id: sid as string,
          item_id: it.id,
          quantity: v === '' ? null : Number(v),
          online_quantity: withOnline && o !== '' ? Number(o) : null,
        }
      })
    const { error: lerr } = await inventory.saveLines(lines)
    setBusy(false)
    if (lerr) return setError(lerr.message)
    onSaved()
  }

  const filledCount = Object.values(qty).filter((v) => v.trim() !== '').length

  return (
    <Modal open onClose={onClose} title={`${session ? 'Count' : 'New count'} · ${divisionLabel(division)}`} size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Site" required>
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)} disabled={!!session}>
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Note">
            {(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional label" />}
          </Field>
        </div>

        {loadingLines ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : sortedItems.length === 0 ? (
          <p className="text-sm text-ink-muted">No items in this division yet.</p>
        ) : (
          <div className="max-h-[50vh] overflow-y-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Item</th>
                  <th className="w-28 px-3 py-2 text-right font-medium">Count</th>
                  {withOnline && <th className="w-28 px-3 py-2 text-right font-medium">OL Count</th>}
                </tr>
              </thead>
              <tbody>
                {sortedItems.map((it) => (
                  <tr key={it.id} className="border-t border-border">
                    <td className="px-3 py-1.5 text-ink">
                      <div className="font-medium">{it.item ?? '—'}</div>
                      <div className="text-xs text-ink-muted">{[it.category, it.brand].filter(Boolean).join(' · ')}</div>
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <Input
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="1"
                        value={qty[it.id] ?? ''}
                        onChange={(e) => setQty((m) => ({ ...m, [it.id]: e.target.value }))}
                        className="h-9 w-24 text-right"
                        aria-label={`Count for ${it.item ?? 'item'}`}
                      />
                    </td>
                    {withOnline && (
                      <td className="px-3 py-1.5 text-right">
                        <Input
                          type="number"
                          inputMode="decimal"
                          min="0"
                          step="1"
                          value={ol[it.id] ?? ''}
                          onChange={(e) => setOl((m) => ({ ...m, [it.id]: e.target.value }))}
                          className="h-9 w-24 text-right"
                          aria-label={`Online count for ${it.item ?? 'item'}`}
                        />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-ink-subtle">{filledCount} of {sortedItems.length} filled</span>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save count'}</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function AddCount({ accountId, items, submitterId, submitterName, onClose, onSaved }: {
  accountId: string
  items: InventoryItem[]
  submitterId: string | null
  submitterName: string | null
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [itemId, setItemId] = useState('')
  const [quantity, setQuantity] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    setError(null)
    if (!locationId) return setError('Pick a site')
    if (!itemId) return setError('Pick an item')
    if (!quantity || isNaN(Number(quantity))) return setError('Enter a valid quantity')
    const it = items.find((x) => x.id === itemId)
    setBusy(true)
    const { error: err } = await inventory.createCount({
      account_id: accountId,
      location_id: locationId,
      division: it?.division ?? null,
      category: it?.category ?? null,
      brand: it?.brand ?? null,
      item: it?.item ?? null,
      quantity: Number(quantity),
      submitted_by: submitterId,
      submitted_by_name: submitterName,
    })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Log inventory count">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Site" required>
            {(id) => (
              <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
                <option value="">Select…</option>
                {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Quantity" required>{(id) => <Input id={id} type="number" min="0" step="1" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
        </div>
        <Field label="Item" required>
          {(id) => (
            <Select id={id} value={itemId} onChange={(e) => setItemId(e.target.value)}>
              <option value="">Select an item from the catalog…</option>
              {items.map((it) => (
                <option key={it.id} value={it.id}>
                  {[it.category, it.brand, it.item].filter(Boolean).join(' · ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save count'}</Button>
        </div>
      </div>
    </Modal>
  )
}
