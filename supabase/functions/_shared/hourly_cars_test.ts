// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/_shared/hourly_cars_test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { addDays, centralToday, moveWall, siteZone } from './hourly_cars.ts'

Deno.test('FlexWash hours move from the car wash zone FlexWash has to the real one', () => {
  // MW #24 is set to New York in FlexWash; its 8 AM bucket is 7 AM in Texas.
  assertEquals(moveWall('2026-11-11', 8, 'America/New_York', 'America/Chicago'), { date: '2026-11-11', hour: 7 })
  assertEquals(moveWall('2026-11-11', 19, 'America/New_York', 'America/Chicago'), { date: '2026-11-11', hour: 18 })
  // Summer (daylight time) too.
  assertEquals(moveWall('2026-07-01', 9, 'America/New_York', 'America/Chicago'), { date: '2026-07-01', hour: 8 })
  // To Mountain, and across midnight.
  assertEquals(moveWall('2026-11-11', 8, 'America/New_York', 'America/Denver'), { date: '2026-11-11', hour: 6 })
  assertEquals(moveWall('2026-11-11', 0, 'America/New_York', 'America/Chicago'), { date: '2026-11-10', hour: 23 })
  // Same zone: unchanged.
  assertEquals(moveWall('2026-11-11', 7, 'America/Chicago', 'America/Chicago'), { date: '2026-11-11', hour: 7 })
})

Deno.test('site zones: New Mexico sites Mountain, the rest Central', () => {
  for (const n of [16, 17, 18, 19, 20, 21, 23, 26]) assertEquals(siteZone(n), 'America/Denver')
  for (const n of [1, 14, 15, 22, 24, 27, 34]) assertEquals(siteZone(n), 'America/Chicago')
})

Deno.test('date helpers', () => {
  assertEquals(addDays('2026-12-31', 1), '2027-01-01')
  assertEquals(addDays('2026-03-01', -1), '2026-02-28')
  assertEquals(centralToday(new Date('2026-11-13T05:30:00Z')), '2026-11-12')
})
