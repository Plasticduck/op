// FlexWash pages two of its reports (found 2026-11-20): get-line-items-detail and
// get-payments-detail now require `limit` (1 to 1000) and answer one page plus a
// `nextCursor`. Before, one call returned every row, so a call without `limit` now
// fails with "limit must be a number". These helpers get every row again: the
// request is split by car wash and week so the pieces load side by side, and each
// piece follows its cursor to the last page. Rows come back grouped by car wash
// and week, not newest first across all of them.
// deno-lint-ignore-file no-explicit-any
type Any = any

export const FLEX_PAGED: Record<string, string> = {
  '/external/accounting/get-line-items-detail': 'lineItemsDetail',
  '/external/accounting/get-payments-detail': 'paymentsDetail',
}

// One POST to FlexWash: the caller supplies auth and the base URL.
export type FlexPoster = (path: string, body: Record<string, unknown>) => Promise<{ ok: boolean; status: number; data: Any; retryAfter?: number }>

const PAGE = 1000
const MAX_PAGES = 400
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function postOnce(post: FlexPoster, path: string, body: Record<string, unknown>): Promise<Any> {
  for (let attempt = 0; ; attempt++) {
    let res: Awaited<ReturnType<FlexPoster>>
    try {
      res = await post(path, body)
    } catch (e) {
      if (attempt >= 2) throw e
      await sleep(1000 * (attempt + 1))
      continue
    }
    if (res.ok) return res.data
    const retry = res.status === 429 || res.status >= 500
    if (!retry || attempt >= 2) {
      const msg = res.data?.error ?? res.data?.message ?? JSON.stringify(res.data)?.slice(0, 200)
      throw new Error(`FlexWash answered ${res.status}: ${msg}`)
    }
    await sleep(Math.min(30_000, (res.retryAfter ?? attempt + 1) * 1000))
  }
}

// Every page of one request, following nextCursor until it's null.
export async function flexPages(post: FlexPoster, path: string, body: Record<string, unknown>): Promise<Any[]> {
  const key = FLEX_PAGED[path]
  if (!key) throw new Error(`${path} is not a paged FlexWash report.`)
  const rows: Any[] = []
  let cursor: string | null = null
  for (let i = 0; i < MAX_PAGES; i++) {
    const data = await postOnce(post, path, { ...body, limit: PAGE, ...(cursor ? { cursor } : {}) })
    const page = data?.[key]
    if (!Array.isArray(page)) throw new Error(`FlexWash answered without ${key}: ${JSON.stringify(data)?.slice(0, 200)}`)
    for (const r of page) rows.push(r)
    cursor = typeof data.nextCursor === 'string' && data.nextCursor ? data.nextCursor : null
    if (!cursor) return rows
  }
  throw new Error(`FlexWash kept paging past ${MAX_PAGES} pages.`)
}

// [start, end] (YYYY-MM-DD, inclusive) cut into windows of `days` days.
export function dateWindows(start: string, end: string, days = 7): { start: string; end: string }[] {
  const out: { start: string; end: string }[] = []
  const day = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10))
  const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
  const last = day(end)
  for (let t = day(start); t <= last; t += days * 86_400_000) {
    out.push({ start: iso(t), end: iso(Math.min(last, t + (days - 1) * 86_400_000)) })
  }
  return out
}

async function pool<T>(items: T[], n: number, fn: (x: T) => Promise<void>) {
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) await fn(items[i++])
  }))
}

// Every row for these car washes over the range, by car wash. A car wash whose
// rows couldn't all be read is left out of `rows` and named in `failed`.
// An empty carWashIds list is passed through as one request (FlexWash reads it
// as every car wash the key can see), keyed by ''.
export async function flexRowsByCarWash(
  post: FlexPoster,
  path: string,
  carWashIds: string[],
  range: { start: string; end: string },
  opts: { concurrency?: number; windowDays?: number; extra?: Record<string, unknown> } = {},
): Promise<{ rows: Map<string, Any[]>; failed: Map<string, string> }> {
  const ids = carWashIds.length ? [...new Set(carWashIds)] : ['']
  const pieces = ids.flatMap((id) => dateWindows(range.start, range.end, opts.windowDays ?? 7).map((w) => ({ id, w })))
  const rows = new Map<string, Any[]>(ids.map((id) => [id, []]))
  const failed = new Map<string, string>()
  await pool(pieces, opts.concurrency ?? 6, async ({ id, w }) => {
    if (failed.has(id)) return
    try {
      const got = await flexPages(post, path, { ...(opts.extra ?? {}), carWashIds: id ? [id] : [], dateRange: w })
      const list = rows.get(id)!
      for (const r of got) list.push(r)
    } catch (e) {
      failed.set(id, e instanceof Error ? e.message : String(e))
    }
  })
  for (const id of failed.keys()) rows.delete(id)
  return { rows, failed }
}

// Every row for these car washes over the range; throws if any piece failed.
export async function flexAllRows(
  post: FlexPoster,
  path: string,
  carWashIds: string[],
  range: { start: string; end: string },
  opts: { concurrency?: number; windowDays?: number; extra?: Record<string, unknown> } = {},
): Promise<Any[]> {
  const { rows, failed } = await flexRowsByCarWash(post, path, carWashIds, range, opts)
  if (failed.size) throw new Error([...failed.values()][0])
  return [...rows.values()].flat()
}
