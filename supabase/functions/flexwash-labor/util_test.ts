// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/flexwash-labor/util_test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { centralToday, ranges, siteOf } from './util.ts'

Deno.test('FlexWash car wash names -> Operator site codes', () => {
  assertEquals(siteOf('MW #15'), 'MW15')
  assertEquals(siteOf('MW #1'), 'MW01')
  assertEquals(siteOf('Mighty Wash #7'), 'MW07')
  assertEquals(siteOf('MightyWash 029'), 'MW29')
  assertEquals(siteOf('MW#34'), 'MW34')
  assertEquals(siteOf('Sandbox - HQ'), null)
  assertEquals(siteOf('MW #0'), null)
  assertEquals(siteOf(''), null)
})

Deno.test('pay week (Mon-Sun) and bi-weekly pay period from Mon 2026-10-19', () => {
  // Thursday in the second week of the 11-02 period.
  assertEquals(ranges('2026-11-12'), { today: '2026-11-12', weekStart: '2026-11-09', periodStart: '2026-11-02', periodEnd: '2026-11-15' })
  // A Monday that starts a period: week and period start together.
  assertEquals(ranges('2026-11-16'), { today: '2026-11-16', weekStart: '2026-11-16', periodStart: '2026-11-16', periodEnd: '2026-11-29' })
  // A Sunday ends both.
  assertEquals(ranges('2026-11-15'), { today: '2026-11-15', weekStart: '2026-11-09', periodStart: '2026-11-02', periodEnd: '2026-11-15' })
  // Across a year end.
  assertEquals(ranges('2027-01-01').periodStart, '2026-12-28')
})

Deno.test('today is the Central date', () => {
  // 03:30 UTC on Nov 13 is still Nov 12 in Central (CST, UTC-6).
  assertEquals(centralToday(new Date('2026-11-13T03:30:00Z')), '2026-11-12')
  assertEquals(centralToday(new Date('2026-11-13T06:30:00Z')), '2026-11-13')
})
