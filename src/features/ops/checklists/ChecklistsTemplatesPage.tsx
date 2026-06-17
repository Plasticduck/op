import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Clock, MapPin, Plus, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { useLocations } from '@/lib/locations'
import { useAuth } from '@/lib/auth'
import { timeOfDay } from '@/lib/format'
import { checklists, type Checklist } from '@/lib/queries/ops'
import { compareLocationName, cn } from '@/lib/utils'

type Template = Checklist & { locations: { location_id: string }[] }

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function resetTone(p: string): 'accent' | 'warn' | 'neutral' {
  if (p === 'daily') return 'accent'
  if (p === 'weekly') return 'warn'
  return 'neutral'
}

function formatDays(days: number[]): string {
  if (!days || days.length === 0) return 'No days'
  if (days.length === 7) return 'Every day'
  const sorted = [...days].sort((a, b) => a - b)
  return sorted.map((d) => DAY_NAMES[d] ?? '?').join(', ')
}

export default function ChecklistsTemplatesPage() {
  const { locations } = useLocations()
  const { profile } = useAuth()
  const [rows, setRows] = useState<Template[]>([])
  const [itemCounts, setItemCounts] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)

  const load = async () => {
    setLoading(true)
    const { data } = await checklists.templatesForAccount()
    const list = (data as Template[] | null) ?? []
    setRows(list)
    setLoading(false)
    const counts: Record<string, number> = {}
    await Promise.all(
      list.map(async (t) => {
        const res = await checklists.items(t.id)
        counts[t.id] = (res.data as { id: string }[] | null)?.length ?? 0
      }),
    )
    setItemCounts(counts)
  }

  useEffect(() => {
    void load()
  }, [])

  const locName = (id: string) => locations.find((l) => l.id === id)?.name ?? 'Unknown'

  const onArchive = async (id: string, name: string) => {
    if (!window.confirm(`Archive "${name}"? It will stop appearing in today's checklists. History is preserved.`)) return
    await checklists.archiveTemplate(id)
    void load()
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/app/checklists" className="text-sm text-ink-muted hover:text-ink">
        Back to today's checklists
      </Link>

      <PageHeader
        title="Checklist templates"
        subtitle="Define schedules and items. Assign each template to one or many locations."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add checklist
          </Button>
        }
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="No checklist templates yet"
          description="Create a template to define a recurring routine for one or more locations."
          action={<Button onClick={() => setAdding(true)}>Add checklist</Button>}
        />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Sites</th>
                <th className="px-4 py-2 font-medium">Schedule</th>
                <th className="px-4 py-2 font-medium">Reset</th>
                <th className="px-4 py-2 font-medium">Items</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((t) => {
                const siteIds = t.locations.map((l) => l.location_id)
                const siteNames = siteIds
                  .map(locName)
                  .sort(compareLocationName)
                const visible = siteNames.slice(0, 3)
                const overflow = siteNames.length - visible.length
                const closesText = t.closes_at_local
                  ? `until ${timeOfDay(t.closes_at_local)}`
                  : 'stays open all day'
                return (
                  <tr key={t.id} className="hover:bg-content/60">
                    <td className="px-4 py-3">
                      <Link
                        to={`/app/checklists/templates/${t.id}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {t.name}
                      </Link>
                      {t.description && (
                        <p className="mt-0.5 text-xs text-ink-muted">{t.description}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-1">
                        <span className="inline-flex items-center gap-1 text-xs text-ink-muted">
                          <MapPin className="size-3" />
                          {siteIds.length}
                        </span>
                        {visible.map((n) => (
                          <Badge key={n} tone="neutral">{n}</Badge>
                        ))}
                        {overflow > 0 && <Badge tone="neutral">+{overflow} more</Badge>}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-start gap-1 text-xs text-ink-muted">
                        <Clock className="mt-0.5 size-3 shrink-0" />
                        <div>
                          <div className="text-ink">
                            Opens {timeOfDay(t.opens_at_local)}; {closesText}
                          </div>
                          <div>{formatDays(t.days_of_week)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={resetTone(t.reset_policy)}>{t.reset_policy}</Badge>
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {itemCounts[t.id] ?? '…'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Archive ${t.name}`}
                        onClick={() => onArchive(t.id, t.name)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {adding && profile && (
        <AddTemplateModal
          accountId={profile.account_id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function AddTemplateModal({
  accountId,
  onClose,
  onSaved,
}: {
  accountId: string
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  const sortedLocations = [...locations].sort((a, b) => compareLocationName(a.name, b.name))
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [locationIds, setLocationIds] = useState<string[]>([])
  const [itemsText, setItemsText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const toggleLocation = (id: string) => {
    setLocationIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    )
  }

  const save = async () => {
    setError(null)
    const cleanName = name.trim()
    if (!cleanName) return setError('Enter a name.')
    if (locationIds.length === 0) return setError('Select at least one location.')
    const itemLines = itemsText
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean)
    if (itemLines.length === 0) return setError('Add at least one item.')

    setSaving(true)
    const { data, error: createErr } = await checklists.createTemplate({
      account_id: accountId,
      name: cleanName,
      description: description.trim() || null,
      frequency: 'daily',
    })
    if (createErr || !data) {
      setSaving(false)
      return setError(createErr?.message ?? 'Failed to create template.')
    }
    const newId = (data as Checklist).id

    const locRes = await checklists.setLocations(newId, locationIds)
    if (locRes && 'error' in locRes && locRes.error) {
      setSaving(false)
      return setError(locRes.error.message ?? 'Failed to assign locations.')
    }

    for (let i = 0; i < itemLines.length; i++) {
      const { error: itemErr } = await checklists.addItem({
        checklist_id: newId,
        label: itemLines[i],
        order_index: i,
      })
      if (itemErr) {
        setSaving(false)
        return setError(itemErr.message ?? 'Failed to add items.')
      }
    }

    setSaving(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="New checklist template" size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Name" required>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Morning open"
            />
          )}
        </Field>

        <Field label="Description">
          {(id) => (
            <Input
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          )}
        </Field>

        <Field label="Locations" required hint="Choose every site this template applies to.">
          {() => (
            <div className="flex flex-wrap gap-2">
              {sortedLocations.length === 0 ? (
                <p className="text-sm text-ink-muted">No locations available.</p>
              ) : (
                sortedLocations.map((loc) => {
                  const on = locationIds.includes(loc.id)
                  return (
                    <button
                      key={loc.id}
                      type="button"
                      onClick={() => toggleLocation(loc.id)}
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition',
                        on
                          ? 'border-accent bg-accent-soft text-accent'
                          : 'border-border bg-card text-ink hover:bg-content',
                      )}
                      aria-pressed={on}
                    >
                      {loc.name}
                    </button>
                  )
                })
              )}
            </div>
          )}
        </Field>

        <Field label="Initial items" required hint="One per line. You can reorder and add more later.">
          {(id) => (
            <textarea
              id={id}
              value={itemsText}
              onChange={(e) => setItemsText(e.target.value)}
              rows={6}
              placeholder={'Unlock front gate\nStart wash cycle\nTest pay station'}
              className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent"
            />
          )}
        </Field>

        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Creating…' : 'Create template'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
