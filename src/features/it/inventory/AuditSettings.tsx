import { useState } from 'react'
import { Loader2, Save, X } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { itInventory } from '@/lib/queries/itInventory'
import { friendlyError } from './format'
import type { ItRefs } from './useItRefs'

// Settings > Audits: how often equipment is due for an audit (from its last
// one), how early it shows as due, and kinds of gear checked more often (like
// LPR cameras every 3 months). A change applies from each item's next audit.

export function AuditSettings({ refs, admin, onSaved }: { refs: ItRefs; admin: boolean; onSaved: (m: string) => void }) {
  const s = refs.settings
  const kinds = refs.categories.filter((c) => c.kind === 'asset')
  const [months, setMonths] = useState(String(s.audit_interval_months))
  const [warn, setWarn] = useState(String(s.audit_warning_days))
  const [overrides, setOverrides] = useState<Record<string, string>>(() =>
    Object.fromEntries(kinds.filter((c) => c.audit_interval_months != null).map((c) => [c.id, String(c.audit_interval_months)])))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const m = Number(months)
    const w = Number(warn)
    if (!Number.isInteger(m) || m < 1 || m > 60) { setError('Every 1 to 60 months.'); return }
    if (!Number.isInteger(w) || w < 0 || w > 90) { setError('Warn 0 to 90 days ahead.'); return }
    for (const [id, v] of Object.entries(overrides)) {
      const n = Number(v)
      if (v !== '' && (!Number.isInteger(n) || n < 1 || n > 60)) { setError(`${refs.category.get(id)?.name}: 1 to 60 months.`); return }
    }
    setBusy(true)
    setError(null)
    try {
      if (m !== s.audit_interval_months || w !== s.audit_warning_days) {
        const { error: err } = await itInventory.updateSettings(s.id, { audit_interval_months: m, audit_warning_days: w })
        if (err) throw new Error(err.message)
      }
      for (const c of kinds) {
        const want = overrides[c.id] ? Number(overrides[c.id]) : null
        if (want !== c.audit_interval_months) {
          const { error: err } = await itInventory.updateCategory(c.id, { audit_interval_months: want })
          if (err) throw new Error(err.message)
        }
      }
      setBusy(false)
      onSaved('Saved. It applies from each item\'s next audit.')
    } catch (e) {
      setBusy(false)
      setError(friendlyError(e instanceof Error ? e.message : String(e)))
    }
  }

  const listed = kinds.filter((c) => c.id in overrides)
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-ink">Audits</h2>
      <p className="mt-1 text-xs text-ink-muted">Each item is due this long after its last audit. A site shows as due when anything there is.</p>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <Field label="Every (months)">
          {(id) => <Input id={id} type="number" min={1} max={60} value={months} onChange={(e) => setMonths(e.target.value)} disabled={!admin} />}
        </Field>
        <Field label="Show as due (days ahead)">
          {(id) => <Input id={id} type="number" min={0} max={90} value={warn} onChange={(e) => setWarn(e.target.value)} disabled={!admin} />}
        </Field>
      </div>
      <div className="mt-4">
        <div className="mb-1.5 text-sm font-medium text-ink">Some kinds more (or less) often</div>
        {listed.length > 0 && (
          <ul className="mb-2 divide-y divide-border rounded-md border border-border">
            {listed.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                <span className="min-w-0 flex-1 text-ink">{c.name}</span>
                <span className="text-xs text-ink-muted">every</span>
                <Input type="number" min={1} max={60} value={overrides[c.id]} disabled={!admin} className="h-8 w-20"
                  aria-label={`${c.name}: months`} onChange={(e) => setOverrides((o) => ({ ...o, [c.id]: e.target.value }))} />
                <span className="text-xs text-ink-muted">months</span>
                {admin && (
                  <button type="button" aria-label={`Use the usual schedule for ${c.name}`} className="text-ink-subtle hover:text-ink"
                    onClick={() => setOverrides((o) => { const n = { ...o }; delete n[c.id]; return n })}>
                    <X className="size-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
        {admin && (
          <Select value="" className="h-9 w-auto" aria-label="Add a kind of gear"
            onChange={(e) => { const id = e.target.value; if (id) setOverrides((o) => ({ ...o, [id]: '3' })) }}>
            <option value="">Add a kind of gear…</option>
            {kinds.filter((c) => !(c.id in overrides)).map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        )}
        {!admin && listed.length === 0 && <p className="text-sm text-ink-muted">Everything follows the usual schedule.</p>}
      </div>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {admin && (
        <div className="mt-3">
          <Button onClick={() => void save()} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
        </div>
      )}
    </section>
  )
}
