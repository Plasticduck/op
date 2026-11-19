// The FP&A Model page's arithmetic: periods, the report lines in order, KPI
// formulas (the workbook Dashboard's), and number formats. No React here.
import type { FpaForecastRow, FpaMetricRow } from '@/lib/queries/fpa'

// ---- Months ----------------------------------------------------------------

export const addMonths = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1))
  return d.toISOString().slice(0, 10)
}
export const monthLabel = (month: string, style: 'short' | 'long' = 'short') => {
  const [y, m] = month.split('-').map(Number)
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: style === 'long' ? 'long' : 'short', year: 'numeric' }).format(new Date(Date.UTC(y, m - 1, 1)))
}
export const daysIn = (month: string) => {
  const [y, m] = month.split('-').map(Number)
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}
export function monthRange(from: string, to: string): string[] {
  const out: string[] = []
  for (let m = from; m <= to; m = addMonths(m, 1)) out.push(m)
  return out
}

export type Periods = { month: string; pm: string; py: string; ytd: string[]; pyYtd: string[]; ttm: string[] }
export function periods(month: string): Periods {
  const jan = `${month.slice(0, 4)}-01-01`
  const py = addMonths(month, -12)
  return {
    month,
    pm: addMonths(month, -1),
    py,
    ytd: monthRange(jan, month),
    pyYtd: monthRange(`${py.slice(0, 4)}-01-01`, py),
    ttm: monthRange(addMonths(month, -11), month),
  }
}

// ---- Values ----------------------------------------------------------------

// metric -> month -> value, for one entity.
export type Series = Map<string, Map<string, number>>
export function toSeries(rows: FpaMetricRow[]): Series {
  const s: Series = new Map()
  for (const r of rows) {
    let m = s.get(r.metric)
    if (!m) s.set(r.metric, (m = new Map()))
    m.set(r.month, r.value)
  }
  return s
}
// A month with no row is a month the model has no value for (before a site
// opened, say): null, not zero, so comparisons can say "n/a".
export const at = (s: Series, metric: string, month: string): number | null => s.get(metric)?.get(month) ?? null
export const sumOf = (s: Series, metric: string, months: string[]): number | null => {
  let any = false
  let t = 0
  for (const m of months) {
    const v = at(s, metric, m)
    if (v != null) {
      any = true
      t += v
    }
  }
  return any ? t : null
}
export const ratio = (num: number | null, den: number | null) => (num == null || den == null || den === 0 ? null : num / den)
// Change vs a base, as the workbook shows it: n/a with no base, "n.m." past ±999%.
export function change(cur: number | null, base: number | null): number | null {
  if (cur == null || base == null || base === 0) return null
  return (cur - base) / Math.abs(base)
}

// ---- The P&L lines (the model's management roll-up of the QuickBooks accounts) ----

export type PlRow =
  | { kind: 'line'; metric: string; drill: boolean }
  | { kind: 'total'; metric: string; label?: string }
  | { kind: 'memo'; metric: string; label: string }
  | { kind: 'header'; label: string }

// The order the workbook rolls them up in. Subtotals are the model's own values;
// EBITDAR follows the model's own definition, so it's shown as a memo line
// rather than a step the lines above would add up to.
export const PL_ROWS: PlRow[] = [
  { kind: 'header', label: 'Revenue' },
  { kind: 'line', metric: 'Wash Sales', drill: true },
  { kind: 'line', metric: 'House/Fleet Sales', drill: true },
  { kind: 'line', metric: 'Lube & Accessories', drill: true },
  { kind: 'line', metric: 'Other Operating Income', drill: true },
  { kind: 'line', metric: 'Discounts, Chargebacks & Adjustments', drill: true },
  { kind: 'total', metric: 'Net Revenue' },
  { kind: 'header', label: 'Cost of goods sold' },
  { kind: 'line', metric: 'Chemical (CPC)', drill: true },
  { kind: 'line', metric: 'Labor – Hourly (COGS)', drill: true },
  { kind: 'line', metric: 'Lube Product Cost', drill: true },
  { kind: 'line', metric: 'Other COGS', drill: true },
  { kind: 'total', metric: 'Total COGS' },
  { kind: 'total', metric: 'Gross Profit' },
  { kind: 'header', label: 'Operating expenses' },
  ...[
    'Salaried Site Managers', 'Corporate Salaries & Bonuses', 'Payroll Taxes, Benefits & Services', 'Electricity', 'Water / Storm / Sewer',
    'Other Utilities', 'Repairs & Maintenance', 'Backroom Chemical', 'Sales & Marketing', 'Merchant Fees', 'Insurance (P&C)',
    'Technology & Software', 'Property & Other Taxes', 'Startup / Pre-Opening', 'Other Operating Expenses', 'Guarantee Payments', 'Corporate Allocation',
  ].map((metric): PlRow => ({ kind: 'line', metric, drill: true })),
  { kind: 'total', metric: 'Total Operating Expenses' },
  { kind: 'line', metric: 'Other Non-Operating Income', drill: true },
  { kind: 'line', metric: 'Other Non-Operating Expense', drill: true },
  { kind: 'header', label: 'Rent' },
  { kind: 'line', metric: 'Rent – MW Properties', drill: true },
  { kind: 'line', metric: 'Rent – MW Holdings', drill: true },
  { kind: 'line', metric: 'Rent – Other Leases', drill: true },
  { kind: 'total', metric: 'Total Rent' },
  { kind: 'total', metric: 'EBITDA' },
  { kind: 'memo', metric: 'EBITDAR', label: 'EBITDAR (memo, model definition)' },
  { kind: 'header', label: 'Below EBITDA' },
  { kind: 'line', metric: 'Depreciation & Amortization', drill: true },
  { kind: 'line', metric: 'Interest Expense', drill: true },
  { kind: 'line', metric: 'Interest Income', drill: true },
  { kind: 'line', metric: 'Franchise (Income) Tax', drill: true },
  { kind: 'line', metric: 'ASC 842 Lease Reclass', drill: true },
  { kind: 'line', metric: 'Year-End Adjustment – Unexplained', drill: false },
  { kind: 'total', metric: 'Net Income' },
]

// ---- Operating KPIs (the workbook Dashboard's formulas) ----------------------

type Val = (s: Series, months: string[]) => number | null
export type Kpi = { label: string; hint?: string; fmt: 'int' | 'money' | 'money2' | 'pct' | 'dec'; value: Val; stock?: boolean; diffPts?: boolean }

const days = (months: string[]) => months.reduce((n, m) => n + daysIn(m), 0)
const perCar = (metric: string): Val => (s, ms) => ratio(sumOf(s, metric, ms), sumOf(s, 'KPI Qualifying Cars', ms))
// Month-end counts take the period's last month.
const last = (metric: string): Val => (s, ms) => at(s, metric, ms[ms.length - 1])

export const KPIS: Kpi[] = [
  { label: 'Cars washed', fmt: 'int', value: (s, ms) => sumOf(s, 'Cars Washed', ms) },
  { label: 'Cars per day', fmt: 'dec', value: (s, ms) => ratio(sumOf(s, 'Cars Washed', ms), days(ms)) },
  { label: 'Net revenue per day', fmt: 'money', value: (s, ms) => ratio(sumOf(s, 'Net Revenue', ms), days(ms)) },
  { label: 'Net revenue per car', fmt: 'money2', value: perCar('KPI Net Revenue') },
  { label: 'Chemical per car', hint: 'GL 65000', fmt: 'money2', value: perCar('KPI Chemical') },
  { label: 'Labor (COGS) per car', hint: 'GL 65007-65011', fmt: 'money2', value: perCar('KPI Labor') },
  { label: 'Backroom chemical per car', hint: 'GL 70058', fmt: 'money2', value: perCar('KPI Backroom Chemical') },
  { label: 'Water per car', hint: 'GL 70091', fmt: 'money2', value: perCar('KPI Water') },
  { label: 'Electricity per car', hint: 'GL 70088', fmt: 'money2', value: perCar('KPI Electric') },
  { label: 'EBITDA margin', fmt: 'pct', diffPts: true, value: (s, ms) => ratio(sumOf(s, 'EBITDA', ms), sumOf(s, 'Net Revenue', ms)) },
  { label: 'Active members (POS, month-end)', fmt: 'int', stock: true, value: last('Active Members (POS)') },
  { label: 'Membership conversion', hint: 'sold ÷ eligible retail', fmt: 'pct', diffPts: true, value: (s, ms) => ratio(sumOf(s, 'Memberships Sold (POS)', ms), sumOf(s, 'Eligible Retail (POS)', ms)) },
  {
    label: 'Monthly churn', hint: '1 − recharges ÷ prior-month members', fmt: 'pct', diffPts: true,
    value: (s, ms) => {
      const r = ratio(sumOf(s, 'Churn Recharges', ms), sumOf(s, 'Churn Base Members', ms))
      return r == null ? null : 1 - r
    },
  },
  { label: 'Average revenue per member', hint: 'recharge $ ÷ recharges', fmt: 'money2', value: (s, ms) => ratio(sumOf(s, 'Recharge Revenue (POS)', ms), sumOf(s, 'Recharges (POS)', ms)) },
  { label: 'Memberships sold (POS)', fmt: 'int', value: (s, ms) => sumOf(s, 'Memberships Sold (POS)', ms) },
  { label: 'Membership revenue (est.)', fmt: 'money', value: (s, ms) => sumOf(s, 'Est. Membership Revenue', ms) },
  { label: 'Retail revenue (est.)', fmt: 'money', value: (s, ms) => sumOf(s, 'Est. Retail Revenue', ms) },
]

// ---- Forecast roll-up --------------------------------------------------------

export const FORECAST_ROWS: { metric: string; label: string; stock?: boolean; bold?: boolean; fmt: 'int' | 'money' }[] = [
  { metric: 'Members', label: 'Members (month-end)', stock: true, fmt: 'int' },
  { metric: 'Memberships Sold', label: 'Memberships sold', fmt: 'int' },
  { metric: 'Membership Revenue', label: 'Membership revenue', fmt: 'money' },
  { metric: 'Retail Revenue', label: 'Retail revenue', fmt: 'money' },
  { metric: 'Wash Sales', label: 'Wash sales (60001)', fmt: 'money' },
  { metric: 'Discounts', label: 'Discounts', fmt: 'money' },
  { metric: 'Fleet Revenue', label: 'House / fleet sales', fmt: 'money' },
  { metric: 'Other Revenue', label: 'Other revenue (lube, Spotless fee, other)', fmt: 'money' },
  { metric: 'Net Revenue', label: 'Net revenue', bold: true, fmt: 'money' },
  { metric: 'Member & Fleet Washes', label: 'Member & fleet washes', fmt: 'int' },
  { metric: 'Retail Cars', label: 'Retail cars', fmt: 'int' },
  { metric: 'Total Cars', label: 'Total cars', bold: true, fmt: 'int' },
  { metric: 'Variable Costs', label: 'Variable costs (chem, labor, water, electric, backroom)', fmt: 'money' },
  { metric: 'Fixed Costs', label: 'Fixed & other costs', fmt: 'money' },
  { metric: 'EBITDA', label: 'EBITDA', bold: true, fmt: 'money' },
]

// The forecast rows that belong to an entity, the way the workbook filters them.
export function inEntity(r: Pick<FpaForecastRow, 'entity_key' | 'region' | 'segment' | 'same_store'>, field: string | null, value: string | null): boolean {
  switch (field) {
    case 'site_key': return r.entity_key === value
    case 'region': return r.region === value
    case 'segment': return r.segment === value
    case 'same_store': return r.same_store === true
    case 'all': return true
    default: return r.entity_key === value
  }
}

// ---- Formats ---------------------------------------------------------------

const usd0 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
const usd2 = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const int = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 })
const dec1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 })

// Money in accounting style: negatives in parentheses.
export const money = (n: number | null | undefined, cents = false) => {
  if (n == null) return '—'
  const s = (cents ? usd2 : usd0).format(Math.abs(n))
  return n < 0 && Math.abs(n) >= (cents ? 0.005 : 0.5) ? `(${s})` : s
}
export const moneyShort = (n: number | null | undefined) => {
  if (n == null) return '—'
  const a = Math.abs(n)
  const s = a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e4 ? `$${Math.round(a / 1e3)}K` : usd0.format(a)
  return n < 0 ? `(${s})` : s
}
export const pct = (n: number | null | undefined, signed = false) => {
  if (n == null) return 'n/a'
  if (Math.abs(n) > 9.99) return 'n.m.'
  const s = `${(n * 100).toFixed(1)}%`
  return signed && n > 0 ? `+${s}` : s
}
export const pts = (n: number | null | undefined) => (n == null ? 'n/a' : `${n > 0 ? '+' : ''}${(n * 100).toFixed(1)} pts`)
export function fmtKpi(fmt: Kpi['fmt'], n: number | null) {
  if (n == null) return 'n/a'
  if (fmt === 'int') return int.format(n)
  if (fmt === 'dec') return dec1.format(n)
  if (fmt === 'money') return money(n)
  if (fmt === 'money2') return money(n, true)
  return pct(n)
}
export const intFmt = (n: number | null | undefined) => (n == null ? '—' : int.format(n))
