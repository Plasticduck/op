// Offline tests of Operator AI's hourly_cars result shaping (stub database).
// Run from op/: DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/ask-operator/hourly_test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'
import { hourlyCars } from './hourly.ts'

// Every query chain resolves to `data`; rpc calls are recorded.
function stubs(rpcRows: Record<string, unknown>[], tableRows: Record<string, unknown>[] = []) {
  const calls: Record<string, unknown>[] = []
  const chain = (data: unknown): unknown => new Proxy(() => {}, {
    get: (_t, p) => (p === 'then' ? (ok: (v: unknown) => void) => ok({ data, error: null }) : () => chain(data)),
  })
  const svc = { from: () => chain(tableRows) } as unknown as SupabaseClient
  const userClient = {
    rpc: (_name: string, args: Record<string, unknown>) => {
      calls.push(args)
      return { range: () => Promise.resolve({ data: rpcRows, error: null }) }
    },
  } as unknown as SupabaseClient
  return { svc, userClient, calls }
}

Deno.test('one site, a few days: each day hour by hour, zero hours dropped', async () => {
  const s = stubs([
    { site_number: null, date: '2026-11-11', weekday: 3, hour: 7, cars: 6, days: 1, avg_cars: 6 },
    { site_number: null, date: '2026-11-11', weekday: 3, hour: 15, cars: 67, days: 1, avg_cars: 67 },
    { site_number: null, date: '2026-11-11', weekday: 3, hour: 21, cars: 0, days: 1, avg_cars: 0 },
  ])
  const out = JSON.parse(await hourlyCars({ start: '2026-11-11', end: '2026-11-11' }, [16], s))
  assertEquals(out.view, 'hours')
  assertEquals(out.combine, false)
  assertEquals(out.sites, ['MW16'])
  assertEquals(s.calls[0], { p_start: '2026-11-11', p_end: '2026-11-11', p_sites: [16], p_view: 'hours', p_combine: false })
  assertEquals(out.columns, ['site', 'date', 'weekday', 'hour', 'cars'])
  assertEquals(out.rows, [['all', '2026-11-11', 'Wed', 7, 6], ['all', '2026-11-11', 'Wed', 15, 67]])
  assertStringIncludes(out.notes.join(' '), 'local time')
})

Deno.test('all sites over a month: by hour, combined', async () => {
  const s = stubs([{ site_number: null, date: null, weekday: null, hour: 15, cars: 1200, days: 30, avg_cars: 40 }])
  const out = JSON.parse(await hourlyCars({ start: '2026-10-01', end: '2026-10-31' }, null, s))
  assertEquals(out.view, 'by_hour')
  assertEquals(out.combine, true)
  assertEquals(out.sites, 'every site the user can see')
  assertEquals(out.columns, ['hour', 'total_cars', 'days_with_cars', 'avg_cars_per_day'])
  assertEquals(out.rows, [[15, 1200, 30, 40]])
})

Deno.test('typical week, sites apart', async () => {
  const s = stubs([{ site_number: 23, date: null, weekday: 6, hour: 11, cars: 300, days: 4, avg_cars: 75 }])
  const out = JSON.parse(await hourlyCars({ start: '2026-10-01', end: '2026-10-31', view: 'typical_week', combine: false }, [16, 23], s))
  assertEquals(out.columns, ['site', 'weekday', 'hour', 'total_cars', 'days_with_cars', 'avg_cars_per_day'])
  assertEquals(out.rows, [['MW23', 'Sat', 11, 300, 4, 75]])
})

Deno.test('more than a month before the stored history: says so, no live read', async () => {
  const s = stubs([])
  const out = JSON.parse(await hourlyCars({ start: '2025-06-01', end: '2025-08-31' }, [16], s))
  assertStringIncludes(out.notes.join(' '), 'before 2026-01-01 is not stored')
  assertStringIncludes(out.notes.join(' '), 'No hourly car counts')
})

Deno.test('bad input', async () => {
  const s = stubs([])
  await assertRejects(() => hourlyCars({ start: '11/11/2026', end: '2026-11-11' }, null, s), Error, 'YYYY-MM-DD')
  await assertRejects(() => hourlyCars({ start: '2026-11-12', end: '2026-11-01' }, null, s), Error, 'on or before')
  await assertRejects(() => hourlyCars({ start: '2024-01-01', end: '2026-01-01' }, null, s), Error, '400 days')
})

Deno.test('row cap', async () => {
  const many = Array.from({ length: 700 }, (_, i) => ({ site_number: 1 + (i % 30), date: '2026-10-01', weekday: 4, hour: i % 24, cars: 5, days: 1, avg_cars: 5 }))
  const out = JSON.parse(await hourlyCars({ start: '2026-10-01', end: '2026-10-03', combine: false }, null, stubs(many)))
  assertEquals(out.rows.length, 600)
  assert(out.notes.some((n: string) => n.includes('first 600 of 700')))
})
