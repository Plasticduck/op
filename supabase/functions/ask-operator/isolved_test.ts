// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/ask-operator/isolved_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { siteKey, summarizeLabor, summarizeLive } from './isolved.ts'

Deno.test('sites by number, code or name', () => {
  assertEquals(['5', 'MW5', 'mw05', '#05', 'Mighty Wash 5', 'Corporate', 'corp', 'Spotless', 'spotless car wash'].map(siteKey),
    ['MW05', 'MW05', 'MW05', 'MW05', 'MW05', 'Corporate', 'Corporate', 'Spotless', 'Spotless'])
})

const emp = (name: string, site: string, hours: number, cost: number) => ({
  employeeNumber: name.slice(0, 3), name, payType: 'Hourly', rate: 12, rated: true, totalHours: hours, cost, byPayType: { Hourly: hours }, sites: [site],
})
const LABOR = {
  range: { startDate: '2026-11-17', endDate: '2026-11-17' },
  includesToday: false,
  regions: ['Lubbock Region'],
  region: { names: [], locked: false },
  salariedScope: 'none',
  sites: [
    { code: '05', site: 'MW05', totalHours: 30, cost: 400, byPayType: { Hourly: 30 }, employees: 3, onClock: 0 },
    { code: '12', site: 'MW12', totalHours: 8, cost: 100, byPayType: { Hourly: 8 }, employees: 2, onClock: 0 },
  ],
  employees: [
    emp('Ana Lopez', 'MW05', 10, 150), emp('Ben Ruiz', 'MW05', 20, 250), emp('Cal Moss', 'MW05', 0, 0),
    emp('Dee Park', 'MW12', 8, 100), emp('Eve Shaw', 'MW12', 0, 0),
    ...Array.from({ length: 60 }, (_, i) => emp(`Extra ${i}`, 'MW12', 1, i)),
  ],
  totals: { totalHours: 38, totalCost: 500, employees: 65 },
  assumptions: { note: 'Base-rate estimate, not payroll gross.' },
}

Deno.test('labor: every site, the top people by cost, and plain names for the scope', () => {
  const s = summarizeLabor(LABOR, {})
  assertEquals(s.sites.length, 2)
  assertEquals(s.salaried, 'exclude')
  assertEquals(s.employees.length, 40)
  assertEquals(s.employees[0].name, 'Ben Ruiz')
  // Nobody who didn't work in the default list.
  assert(!s.employees.some((e) => e.hours === 0 && e.cost === 0))
  assert(s.employees_note.includes('63 employees worked'))
})

Deno.test('labor: one site lists all its people, worked or not', () => {
  const s = summarizeLabor(LABOR, { site: '5' })
  assertEquals(s.sites.map((x) => x.site), ['MW05'])
  assertEquals(s.employees.map((e) => e.name).sort(), ['Ana Lopez', 'Ben Ruiz', 'Cal Moss'])
})

Deno.test('labor: find people by part of a name', () => {
  assertEquals(summarizeLabor(LABOR, { employee: 'park' }).employees.map((e) => e.name), ['Dee Park'])
})

const liveEmp = (name: string, onClock: boolean) => ({
  employeeNumber: name, name, salaried: false, onClock, clockInAt: null, clockInTime: onClock ? '06:58' : null, elapsedHours: onClock ? 3.1 : 0,
  siteDayHours: 3, siteDayCost: 40, siteWeekHours: 20, siteWeekCost: 260, siteWeekPTO: 0, siteDayPTO: 0, totalWeekHours: 20,
})
const LIVE = {
  ok: true,
  generatedAt: '2026-11-19T16:00:00Z',
  central: { today: '2026-11-19', weekStart: '2026-11-16' },
  totals: { clockedIn: 3, weekHours: 100, weekCost: 2000 },
  sites: [
    { site: 'MW05', clockedIn: 2, weekHours: 60, weekCost: 1200, weekCostSalary: 500, weekCostHourly: 700, weekPTO: 4, employeeCount: 3, employees: [liveEmp('Ana', true), liveEmp('Ben', true), liveEmp('Cal', false)] },
    { site: 'MW12', clockedIn: 1, weekHours: 40, weekCost: 800, weekCostSalary: 300, weekCostHourly: 500, weekPTO: 0, employeeCount: 1, employees: [liveEmp('Dee', true)] },
  ],
}

Deno.test('on the clock: everyone sees every site, with who is on now', () => {
  const s = summarizeLive(LIVE, null, {}) as { sites: { site: string; on_clock: { name: string }[] }[]; totals: unknown; scope: string }
  assertEquals(s.scope, 'every site')
  assertEquals(s.totals, LIVE.totals)
  assertEquals(s.sites.find((x) => x.site === 'MW05')!.on_clock.map((e) => e.name), ['Ana', 'Ben'])
})

Deno.test("on the clock: a Regional Manager only sees their region, totals recounted", () => {
  const s = summarizeLive(LIVE, new Set(['MW12']), {}) as { sites: { site: string }[]; totals: { clocked_in: number; week_cost: number }; scope: string }
  assertEquals(s.sites.map((x) => x.site), ['MW12'])
  assertEquals([s.totals.clocked_in, s.totals.week_cost, s.scope], [1, 800, 'your region'])
  // Asking for a site outside the region gives nothing from it.
  const other = summarizeLive(LIVE, new Set(['MW12']), { site: 'MW05' }) as { employees?: unknown; error?: string }
  assertEquals(other.employees, undefined)
  assert(other.error?.includes('not one you can see'))
})

Deno.test('on the clock: one site lists its people', () => {
  const s = summarizeLive(LIVE, null, { site: '5' }) as { employees: { name: string; on_clock: boolean; hours_so_far?: number }[] }
  assertEquals(s.employees.map((e) => [e.name, e.on_clock, e.hours_so_far]), [['Ana', true, 3.1], ['Ben', true, 3.1], ['Cal', false, undefined]])
})
