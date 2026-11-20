// deno test supabase/functions/_shared/flexwash_pages_test.ts
// deno-lint-ignore-file no-explicit-any
import { assertEquals, assertRejects } from 'jsr:@std/assert@1'
import { dateWindows, flexAllRows, flexPages, flexRowsByCarWash, type FlexPoster } from './flexwash_pages.ts'

const PATH = '/external/accounting/get-line-items-detail'

// A fake FlexWash: `n` rows per car wash per day, served `per` to a page.
function fake(n: number, per = 1000, opts: { failFor?: string; flaky?: number } = {}) {
  const calls: any[] = []
  let flaky = opts.flaky ?? 0
  const post: FlexPoster = async (_path, body: any) => {
    calls.push(body)
    if (flaky > 0) { flaky--; return { ok: false, status: 503, data: { error: 'busy' } } }
    if (body.limit == null) return { ok: false, status: 400, data: { error: 'limit must be a number (was missing)' } }
    const id = body.carWashIds[0] ?? 'all'
    if (id === opts.failFor) return { ok: false, status: 400, data: { error: 'bad car wash' } }
    const days = dateWindows(body.dateRange.start, body.dateRange.end, 1).map((w) => w.start)
    const all = days.flatMap((d) => Array.from({ length: n }, (_, i) => ({ id: `${id}-${d}-${i}`, carWash: id, day: d })))
    const from = body.cursor ? Number(body.cursor) : 0
    const page = all.slice(from, from + Math.min(body.limit, per))
    const next = from + page.length < all.length ? String(from + page.length) : null
    return { ok: true, status: 200, data: { lineItemsDetail: page, nextCursor: next, prevCursor: null } }
  }
  return { post, calls }
}

Deno.test('dateWindows cuts a range into whole weeks, inclusive', () => {
  assertEquals(dateWindows('2026-11-01', '2026-11-01'), [{ start: '2026-11-01', end: '2026-11-01' }])
  assertEquals(dateWindows('2026-11-01', '2026-11-19'), [
    { start: '2026-11-01', end: '2026-11-07' },
    { start: '2026-11-08', end: '2026-11-14' },
    { start: '2026-11-15', end: '2026-11-19' },
  ])
  assertEquals(dateWindows('2026-02-26', '2026-03-02', 2).map((w) => w.start), ['2026-02-26', '2026-02-28', '2026-03-02'])
})

Deno.test('flexPages follows the cursor to the last page and always sends a limit', async () => {
  const f = fake(2500)
  const rows = await flexPages(f.post, PATH, { carWashIds: ['a'], dateRange: { start: '2026-11-01', end: '2026-11-01' } })
  assertEquals(rows.length, 2500)
  assertEquals(new Set(rows.map((r) => r.id)).size, 2500)
  assertEquals(f.calls.length, 3)
  assertEquals(f.calls.every((c) => c.limit === 1000), true)
  assertEquals(f.calls[0].cursor, undefined)
  assertEquals(f.calls[1].cursor, '1000')
})

Deno.test('flexPages retries a busy answer, then reports a real error', async () => {
  const f = fake(5, 1000, { flaky: 1 })
  assertEquals((await flexPages(f.post, PATH, { carWashIds: ['a'], dateRange: { start: '2026-11-01', end: '2026-11-01' } })).length, 5)
  const g = fake(5, 1000, { failFor: 'a' })
  await assertRejects(() => flexPages(g.post, PATH, { carWashIds: ['a'], dateRange: { start: '2026-11-01', end: '2026-11-01' } }), Error, 'bad car wash')
})

Deno.test('flexRowsByCarWash returns every row by car wash, split by week', async () => {
  const f = fake(700, 300)
  const { rows, failed } = await flexRowsByCarWash(f.post, PATH, ['a', 'b'], { start: '2026-11-01', end: '2026-11-19' }, { concurrency: 4 })
  assertEquals(failed.size, 0)
  assertEquals(rows.get('a')!.length, 700 * 19)
  assertEquals(rows.get('b')!.length, 700 * 19)
  assertEquals(rows.get('a')!.every((r) => r.carWash === 'a'), true)
  assertEquals(new Set(rows.get('a')!.map((r) => r.id)).size, 700 * 19)
  // Each request names one car wash and stays inside one week.
  assertEquals(f.calls.every((c) => c.carWashIds.length === 1 && dateWindows(c.dateRange.start, c.dateRange.end).length === 1), true)
})

Deno.test('a car wash that fails is left out and named; flexAllRows throws for it', async () => {
  const f = fake(10, 1000, { failFor: 'b' })
  const { rows, failed } = await flexRowsByCarWash(f.post, PATH, ['a', 'b'], { start: '2026-11-01', end: '2026-11-03' })
  assertEquals(rows.get('a')!.length, 30)
  assertEquals(rows.has('b'), false)
  assertEquals([...failed.keys()], ['b'])
  await assertRejects(() => flexAllRows(fake(10, 1000, { failFor: 'b' }).post, PATH, ['a', 'b'], { start: '2026-11-01', end: '2026-11-03' }), Error, 'bad car wash')
})

Deno.test('no car washes is passed through as one request per week', async () => {
  const f = fake(3)
  const rows = await flexAllRows(f.post, PATH, [], { start: '2026-11-01', end: '2026-11-02' })
  assertEquals(rows.length, 6)
  assertEquals(f.calls.length, 1)
  assertEquals(f.calls[0].carWashIds, [])
})
