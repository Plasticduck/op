// Dates and site names for flexwash-labor (kept apart so they can be tested).

// Bi-weekly pay periods, Monday to Sunday (matches Labor Data's PAY_PERIOD_ANCHOR).
const PAY_PERIOD_ANCHOR = '2026-10-19'
const PAY_PERIOD_DAYS = 14

export function centralToday(d = new Date()): string {
  const p: Record<string, string> = {}
  for (const x of new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(d)) p[x.type] = x.value
  return `${p.year}-${p.month}-${p.day}`
}
const dayMs = 86400_000
const addDays = (date: string, n: number) => new Date(Date.parse(date + 'T00:00:00Z') + n * dayMs).toISOString().slice(0, 10)
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / dayMs)
export function ranges(today: string) {
  const dow = new Date(today + 'T12:00:00Z').getUTCDay() // 0 = Sunday
  const weekStart = addDays(today, -((dow + 6) % 7))
  const periodStart = addDays(PAY_PERIOD_ANCHOR, Math.floor(daysBetween(PAY_PERIOD_ANCHOR, today) / PAY_PERIOD_DAYS) * PAY_PERIOD_DAYS)
  return { today, weekStart, periodStart, periodEnd: addDays(periodStart, PAY_PERIOD_DAYS - 1) }
}

// "MW #15", "Mighty Wash #7", "MightyWash 029" -> "MW15", "MW07", "MW29".
export function siteOf(name: string): string | null {
  const m = String(name ?? '').match(/^\s*mighty\s*wash\s*#?\s*0*(\d{1,3})\s*$|^\s*mw\s*#?\s*0*(\d{1,3})\s*$/i)
  const n = m ? Number(m[1] ?? m[2]) : NaN
  return Number.isFinite(n) && n > 0 ? 'MW' + String(n).padStart(2, '0') : null
}
