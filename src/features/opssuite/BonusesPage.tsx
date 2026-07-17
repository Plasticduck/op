import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, RotateCcw, Save, X } from 'lucide-react'
import { format, parseISO, subMonths } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { compareLocationName } from '@/lib/utils'
import { currency } from '@/lib/format'
import { gmBonus, type GmBonusBase, type GmBonusMonth } from '@/lib/queries/gmBonus'
import { computeGmBonus, type BaseSnapshot, type MonthInputs, type PrevCounts } from '@/lib/gmBonus'

const num = (s: string) => {
  const n = Number(s)
  return Number.isFinite(n) ? n : 0
}
const pct = (frac: number) => `${(frac * 100).toFixed(1)}%`
const pts = (frac: number | null) =>
  frac === null ? '—' : `${frac >= 0 ? '+' : ''}${(frac * 100).toFixed(1)} pts`

const emptyForm = { mighty: '', super: '', wonder: '', avgMos: '', churn: '', conversion: '' }
type Form = typeof emptyForm

const monthOf = (period: string) => format(parseISO(period), 'MMMM yyyy')
const toPeriod = (monthInput: string) => `${monthInput}-01`
const prevPeriod = (period: string) => format(subMonths(parseISO(period), 1), 'yyyy-MM-01')

export default function BonusesPage() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const sortedLocations = useMemo(
    () => [...locations].sort((a, b) => compareLocationName(a.name, b.name)),
    [locations],
  )

  const [locationId, setLocationId] = useState('')
  const [period, setPeriod] = useState(format(new Date(), 'yyyy-MM-01'))
  const [months, setMonths] = useState<GmBonusMonth[]>([])
  const [base, setBase] = useState<GmBonusBase | null>(null)
  const [form, setForm] = useState<Form>(emptyForm)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId && sortedLocations.length > 0) setLocationId(sortedLocations[0].id)
  }, [sortedLocations, locationId])

  const load = useCallback(async () => {
    if (!locationId) return
    setLoading(true)
    setError(null)
    const [b, m] = await Promise.all([gmBonus.base(locationId), gmBonus.months(locationId)])
    setBase((b.data as GmBonusBase | null) ?? null)
    setMonths((m.data as GmBonusMonth[] | null) ?? [])
    setLoading(false)
  }, [locationId])
  useEffect(() => { void load() }, [load])

  const monthRow = useMemo(() => months.find((m) => m.period === period) ?? null, [months, period])
  const prevRow = useMemo(
    () => months.find((m) => m.period === prevPeriod(period)) ?? null,
    [months, period],
  )

  // Prefill the form from a saved month whenever the site/month/data changes.
  useEffect(() => {
    if (monthRow) {
      setForm({
        mighty: String(monthRow.mighty_count),
        super: String(monthRow.super_count),
        wonder: String(monthRow.wonder_count),
        avgMos: String(monthRow.avg_mos),
        churn: String(monthRow.churn_pct),
        conversion: String(monthRow.conversion_pct),
      })
    } else {
      setForm(emptyForm)
    }
    setNotice(null)
  }, [monthRow, locationId, period])

  const current: MonthInputs = {
    mighty_count: num(form.mighty),
    super_count: num(form.super),
    wonder_count: num(form.wonder),
    avg_mos: num(form.avgMos),
    churn_pct: num(form.churn),
    conversion_pct: num(form.conversion),
  }
  const previous: PrevCounts = prevRow
    ? { mighty_count: prevRow.mighty_count, super_count: prevRow.super_count, wonder_count: prevRow.wonder_count }
    : null
  const baseSnap: BaseSnapshot = base
    ? {
        base_date: base.base_date,
        mighty_count: base.mighty_count,
        super_count: base.super_count,
        wonder_count: base.wonder_count,
        avg_mos: Number(base.avg_mos),
      }
    : null

  const result = computeGmBonus({ current, previous, base: baseSnap })

  const saveMonth = async () => {
    if (!profile || !locationId) return
    setSaving(true)
    setError(null)
    const { error: err } = await gmBonus.upsertMonth({
      account_id: profile.account_id,
      location_id: locationId,
      period,
      mighty_count: current.mighty_count,
      super_count: current.super_count,
      wonder_count: current.wonder_count,
      avg_mos: current.avg_mos,
      churn_pct: current.churn_pct,
      conversion_pct: current.conversion_pct,
      source: 'manual',
      submitted_by: profile.id,
    })
    setSaving(false)
    if (err) return setError(err.message)
    setNotice(`Saved ${monthOf(period)}.`)
    await load()
  }

  // The two one-time goals reset their baselines independently, matching the
  // sheet: membership resets the level counts/date; lifetime resets only the
  // average-months figure. With no baseline yet, either reset seeds both.
  const resetBase = async (which: 'membership' | 'avg') => {
    if (!profile || !locationId) return
    const label = which === 'membership' ? 'membership baseline' : 'average-months baseline'
    if (!window.confirm(`Reset the ${label} to ${monthOf(period)}'s numbers?`)) return
    setSaving(true)
    setError(null)
    const row = {
      account_id: profile.account_id,
      location_id: locationId,
      base_date: which === 'membership' || !base ? period : base.base_date,
      mighty_count: which === 'membership' || !base ? current.mighty_count : base.mighty_count,
      super_count: which === 'membership' || !base ? current.super_count : base.super_count,
      wonder_count: which === 'membership' || !base ? current.wonder_count : base.wonder_count,
      avg_mos: which === 'avg' || !base ? current.avg_mos : Number(base.avg_mos),
    }
    const { error: err } = await gmBonus.upsertBase(row)
    setSaving(false)
    if (err) return setError(err.message)
    setNotice(`Reset ${label} to ${monthOf(period)}.`)
    await load()
  }

  const set = (k: keyof Form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }))

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Bonuses"
        subtitle="GM and AGM monthly bonus calculator. Admin only."
        actions={
          <Button onClick={saveMonth} disabled={saving || !locationId}>
            <Save className="size-4" /> {saving ? 'Saving…' : `Save ${format(parseISO(period), 'MMM yyyy')}`}
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Site
          <Select value={locationId} onChange={(e) => setLocationId(e.target.value)} className="h-9 w-64">
            {sortedLocations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </Select>
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
          Month
          <Input
            type="month"
            value={format(parseISO(period), 'yyyy-MM')}
            onChange={(e) => e.target.value && setPeriod(toPeriod(e.target.value))}
            className="h-9 w-44"
          />
        </label>
        <span className="pb-2 text-xs text-ink-subtle">
          {monthRow ? 'Saved' : 'Not yet saved'} · prior month {prevRow ? 'on file' : 'missing'}
        </span>
      </div>

      {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {notice && <p className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ink">{notice}</p>}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {/* Inputs */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">This month's numbers</h2>
            <div className="grid grid-cols-2 gap-3">
              <NumField label="Mighty Protector" value={form.mighty} onChange={set('mighty')} />
              <NumField label="Super Shine" value={form.super} onChange={set('super')} />
              <NumField label="Wonder Clean" value={form.wonder} onChange={set('wonder')} />
              <NumField label="Total members" value={String(result.currentTotal)} readOnly />
              <NumField label="Avg months active" value={form.avgMos} onChange={set('avgMos')} step="0.1" />
              <div />
              <NumField label="Churn %" value={form.churn} onChange={set('churn')} step="0.1" />
              <NumField label="Conversion %" value={form.conversion} onChange={set('conversion')} step="0.1" />
            </div>

            <div className="mt-4 rounded-md border border-border bg-content p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Baseline</h3>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => resetBase('membership')} disabled={saving}>
                    <RotateCcw className="size-3.5" /> Reset membership
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => resetBase('avg')} disabled={saving}>
                    <RotateCcw className="size-3.5" /> Reset avg months
                  </Button>
                </div>
              </div>
              {base ? (
                <p className="mt-2 text-xs text-ink-muted">
                  Set {monthOf(base.base_date)} · Mighty {base.mighty_count}, Super {base.super_count}, Wonder{' '}
                  {base.wonder_count} · Avg {Number(base.avg_mos)} mo
                </p>
              ) : (
                <p className="mt-2 text-xs text-warn">
                  No baseline set. One-time bonuses need a baseline. Use "Reset to this month" to set one.
                </p>
              )}
            </div>
          </section>

          {/* Membership breakdown */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Membership</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="py-1.5 font-medium">Level</th>
                    <th className="py-1.5 text-right font-medium">Members</th>
                    <th className="py-1.5 text-right font-medium">Share</th>
                    <th className="py-1.5 text-right font-medium">Δ Prev</th>
                    <th className="py-1.5 text-right font-medium">Δ Base</th>
                  </tr>
                </thead>
                <tbody>
                  {result.levels.map((l) => (
                    <tr key={l.key} className="border-t border-border">
                      <td className="py-1.5 text-ink">{l.label}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink">{l.count}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">{pct(l.pct)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">{pts(l.pctChange)}</td>
                      <td className="py-1.5 text-right tabular-nums text-ink-muted">{pts(l.pctChangeSinceBase)}</td>
                    </tr>
                  ))}
                  <tr className="border-t border-border font-medium">
                    <td className="py-1.5 text-ink">Total</td>
                    <td className="py-1.5 text-right tabular-nums text-ink">{result.currentTotal}</td>
                    <td colSpan={3} className="py-1.5 text-right text-xs text-ink-subtle">
                      prev {result.previousTotal ?? '—'}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {/* One-time bonuses */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">One-time bonuses</h2>
            <BonusRow
              label="Lifetime Value (Avg months +1 vs base)"
              detail={`base ${result.avgMos.base ?? '—'} → now ${result.avgMos.current} (${result.avgMos.delta === null ? '—' : `${result.avgMos.delta >= 0 ? '+' : ''}${result.avgMos.delta.toFixed(1)}`} mo)`}
              earned={result.lifetimeValue.earned}
              amount={result.lifetimeValue.amount}
            />
            <BonusRow
              label="Membership (Mighty + Super +10 pts vs base)"
              detail={`combined change ${pts(result.membership.combinedChangeSinceBase)}`}
              earned={result.membership.earned}
              amount={result.membership.amount}
            />
            <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm font-semibold">
              <span className="text-ink">One-time total</span>
              <span className="tabular-nums text-ink">{currency(result.oneTimeTotal)}</span>
            </div>
            {(result.lifetimeValue.goalReached || result.membership.goalReached) && (
              <p className="mt-2 text-xs text-warn">
                Goal reached. Reset the baseline once this bonus is paid so future months measure from here.
              </p>
            )}
          </section>

          {/* Monthly rewards + totals */}
          <section className="rounded-md border border-border bg-card p-4">
            <h2 className="mb-3 text-sm font-semibold text-ink">Monthly rewards</h2>
            <BonusRow
              label={`Churn reward (${result.churn.bracket})`}
              detail={`churn ${result.churn.pct}%`}
              amount={result.churn.amount}
            />
            <BonusRow
              label="Conversion reward"
              detail={`conversion ${result.conversion.pct}%${result.conversion.capped ? ' · capped (churn ≥ 15%)' : ''}`}
              amount={result.conversion.amount}
            />
            <div className="mt-3 flex items-center justify-between rounded-md bg-accent-soft px-3 py-2">
              <span className="text-sm font-semibold text-accent">Total GM monthly bonus</span>
              <span className="text-lg font-bold tabular-nums text-accent">{currency(result.gmTotal)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between rounded-md border border-border px-3 py-2">
              <span className="text-sm font-semibold text-ink">Total AGM monthly bonus</span>
              <span className="text-lg font-bold tabular-nums text-ink">{currency(result.agmTotal)}</span>
            </div>
            <p className="mt-1 text-right text-xs text-ink-subtle">AGM = 1/2 of GM total</p>
          </section>
        </div>
      )}
    </div>
  )
}

function NumField({
  label,
  value,
  onChange,
  readOnly,
  step,
}: {
  label: string
  value: string
  onChange?: (e: React.ChangeEvent<HTMLInputElement>) => void
  readOnly?: boolean
  step?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
      {label}
      <Input
        type="number"
        inputMode="decimal"
        step={step ?? '1'}
        value={value}
        onChange={onChange}
        readOnly={readOnly}
        className={readOnly ? 'h-9 bg-content' : 'h-9'}
      />
    </label>
  )
}

function BonusRow({
  label,
  detail,
  earned,
  amount,
}: {
  label: string
  detail: string
  earned?: boolean | null
  amount: number
}) {
  return (
    <div className="flex items-center justify-between border-t border-border py-2 first:border-t-0">
      <div className="min-w-0">
        <p className="text-sm text-ink">{label}</p>
        <p className="text-xs text-ink-muted">{detail}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {earned === true && <Badge tone="ok"><Check className="size-3" /> Earned</Badge>}
        {earned === false && <Badge tone="neutral"><X className="size-3" /> No</Badge>}
        <span className="w-16 text-right text-sm font-semibold tabular-nums text-ink">{currency(amount)}</span>
      </div>
    </div>
  )
}
