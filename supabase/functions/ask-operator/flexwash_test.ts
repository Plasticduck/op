// Offline tests of Operator AI's FlexWash access rules (no network, no secrets).
// Run from the op folder:
//   DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/ask-operator/flexwash_test.ts
// (DENO_NO_PACKAGE_JSON keeps Deno from reading the app's package.json.)
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import { FlexWash, flexCatalog, flexPrompt, flexUserNote, type FlexAccess } from './flexwash.ts'
import { FLEX_ENDPOINTS } from './flexwash_catalog.ts'
import type { McpSession } from '../_shared/mcp.ts'

const site = (id: string, n: number) => ({ carWashId: id, siteNumber: n, label: `MW${n}` })
const ADMIN: FlexAccess = { sites: [site('352', 17), site('350', 18), site('441', 12)], all: true, noPay: false }
const MGR: FlexAccess = { sites: [site('352', 17)], all: false, noPay: false }
const MGR2: FlexAccess = { sites: [site('352', 17), site('350', 18)], all: false, noPay: false }
const OFFICE: FlexAccess = { sites: [site('352', 17), site('350', 18)], all: false, noPay: true }

// A fake FlexWash: records calls, answers by path.
function fake(answers: Record<string, unknown> = {}) {
  const calls: { path: string; body: any }[] = []
  const poster = async (path: string, body: unknown) => {
    calls.push({ path, body: structuredClone(body) })
    return path in answers ? structuredClone(answers[path]) : { ok: true, rows: [1, 2, 3] }
  }
  return { calls, poster }
}
const P = (n: string) => FLEX_ENDPOINTS[n].path
const svc = {} as any

Deno.test('catalog: only reads, no writes', () => {
  for (const n of Object.keys(FLEX_ENDPOINTS)) assert(!/create|update|submit|addVehicleTo|accessToken/i.test(n), n)
  assertEquals(Object.keys(FLEX_ENDPOINTS).length >= 100, true)
})

Deno.test('prompt: managers do not see admin-only endpoints in the catalog', () => {
  assertStringIncludes(flexPrompt(flexCatalog(ADMIN, null), false), 'orderList_getEmployeeSingleWashStatsOrders')
  assert(!flexPrompt(flexCatalog(MGR, null), false).includes('orderList_getEmployeeSingleWashStatsOrders'))
  assertStringIncludes(flexUserNote(MGR, false), 'MW17 = "352"')
  assertStringIncludes(flexUserNote(OFFICE, false), 'commission')
})

// ---- Their own FlexWash login (connected through Connect to FlexWash) ----

// A fake connected login: its tools answer from `tools`; an Error means it didn't answer.
function login(tools: Record<string, (args: any) => { text: string; isError?: boolean } | Error>) {
  const calls: { name: string; args: unknown }[] = []
  const list = Object.keys(tools).map((name) => ({
    name, apiName: 'flexwash_mcp_' + name, description: `FlexWash: ${name} from the login. More text here.`,
    inputSchema: { type: 'object', properties: { carWashIds: { type: 'array', items: { type: 'string' } }, limit: { type: 'integer' } }, required: ['carWashIds'] },
  }))
  const session = {
    label: 'FlexWash', tools: list, skipped: [],
    byName: new Map(list.map((t) => [t.name, t])), byApiName: new Map(list.map((t) => [t.apiName, t])),
    callByName: async (name: string, args: unknown) => {
      calls.push({ name, args })
      const r = tools[name](args)
      if (r instanceof Error) throw r
      return { text: r.text, isError: !!r.isError }
    },
    close: async () => {},
  }
  return { session: session as unknown as McpSession, calls }
}
const churn = { carWashIds: [], dateRange: { start: '2026-10-01', end: '2026-10-31' } }

Deno.test('own login: used first, input as given, company connection untouched', async () => {
  const api = fake()
  const l = login({ memberships_getChurnPercentages: () => ({ text: '{"churnRate":0.1}' }) })
  const r = await new FlexWash(svc, MGR, api.poster, l.session).call('memberships_getChurnPercentages', churn)
  assertEquals(r.via, 'login')
  assertEquals(r.text, '{"churnRate":0.1}')
  assertEquals(l.calls[0].args, churn) // FlexWash decides scope for their login; nothing filled in
  assertEquals(api.calls.length, 0)
})

Deno.test("own login doesn't answer: the company connection steps in, under Operator's rules", async () => {
  const api = fake()
  const l = login({ memberships_getChurnPercentages: () => new Error('Connecting to FlexWash timed out') })
  const r = await new FlexWash(svc, MGR2, api.poster, l.session).call('memberships_getChurnPercentages', churn)
  assertEquals(r.via, 'company')
  assertEquals(api.calls[0].body.carWashIds, ['352', '350'])
  assertStringIncludes(r.text, "Their FlexWash login didn't answer")
  // Without company access there's nothing to fall back to.
  await assertRejects(() => new FlexWash(svc, null, fake().poster, l.session).call('memberships_getChurnPercentages', churn), Error, 'timed out')
})

Deno.test('own login says the request is wrong: reported, not retried another way', async () => {
  const api = fake()
  const l = login({ memberships_getChurnPercentages: () => ({ text: 'carWashIds must not be empty', isError: true }) })
  await assertRejects(() => new FlexWash(svc, ADMIN, api.poster, l.session).call('memberships_getChurnPercentages', churn), Error, 'carWashIds must not be empty')
  assertEquals(api.calls.length, 0)
})

Deno.test("own login adds what the company connection can't do; the company covers what the login lacks", async () => {
  const l = login({ membershipRoster_getMembershipRoster: () => ({ text: '{"rows":[1,2],"totalCount":2}' }) })
  const roster = await new FlexWash(svc, MGR, fake().poster, l.session).call('membershipRoster_getMembershipRoster', { filters: {} })
  assertEquals(roster.via, 'login')
  assertEquals(roster.rows, 2)
  await assertRejects(() => new FlexWash(svc, MGR, fake().poster, null).call('membershipRoster_getMembershipRoster', {}), Error, 'no FlexWash endpoint')
  // Not in the login: the company connection answers it, with its own rules.
  const api = fake()
  const r = await new FlexWash(svc, ADMIN, api.poster, l.session).call('memberships_getChurnPercentages', churn)
  assertEquals(r.via, 'company')
  assertEquals(api.calls.length, 1)
  await assertRejects(() => new FlexWash(svc, MGR, fake().poster, l.session).call('orderList_getEmployeeSingleWashStatsOrders', {}), Error, 'only Admins')
})

Deno.test('own login with no company access (any Mighty Wash staff): only the login', async () => {
  const l = login({ memberships_getChurnPercentages: () => ({ text: '{}' }) })
  const fw = new FlexWash(svc, null, fake().poster, l.session)
  assertEquals((await fw.call('memberships_getChurnPercentages', churn)).via, 'login')
  await assertRejects(() => fw.call('accounting_getAccounting', churn), Error, "company connection isn't available")
  assert(fw.ownLogin)
  const cat = flexCatalog(null, l.session)
  assertEquals(cat.split('\n').length, 1)
})

Deno.test('catalog and notes with their own login', () => {
  const l = login({ memberships_getChurnPercentages: () => ({ text: '{}' }), tags_getTags: () => ({ text: '{}' }) })
  const cat = flexCatalog(MGR, l.session)
  // A tool in both uses the API catalog's line; a login-only tool gets one from its schema.
  assertStringIncludes(cat, `memberships_getChurnPercentages(${FLEX_ENDPOINTS.memberships_getChurnPercentages.signature})`)
  assertStringIncludes(cat, 'tags_getTags({carWashIds: string[], limit?: int}) - tags_getTags from the login.')
  assert(cat.includes('accounting_getAccounting(')) // company endpoints still listed
  assert(!cat.includes('orderList_getEmployeeSingleWashStatsOrders')) // Admin-only stays out for a manager
  assertStringIncludes(flexPrompt(cat, true), 'carWash_getCarWashes with carWashIds null')
  assertStringIncludes(flexPrompt(cat, false), 'Leave carWashIds as []')
  assertStringIncludes(flexUserNote(MGR, true), 'connected their own FlexWash login')
  assertStringIncludes(flexUserNote(MGR, true), 'steps in')
  assertStringIncludes(flexUserNote(null, true), 'connected their own FlexWash login')
  assert(!flexUserNote(null, true).includes('steps in'))
  const d = JSON.parse(new FlexWash(svc, MGR, fake().poster, l.session).describe('tags_getTags'))
  assertEquals(d.via, 'their own FlexWash login')
  assertStringIncludes(d.description, 'tags_getTags from the login.')
  // A login with no read-only tools isn't "their own login" in use.
  const empty = login({})
  assert(!new FlexWash(svc, MGR, fake().poster, empty.session).ownLogin)
})

Deno.test('unknown endpoint is refused', async () => {
  const f = fake()
  await assertRejects(() => new FlexWash(svc, ADMIN, f.poster).call('customers_updateCustomer', {}), Error, 'no FlexWash endpoint')
  assertEquals(f.calls.length, 0)
})

Deno.test('carWashIds: empty means all of the user\'s car washes', async () => {
  const f = fake()
  await new FlexWash(svc, MGR2, f.poster).call('memberships_getChurnPercentages', { carWashIds: [], dateRange: { start: '2026-10-01', end: '2026-10-31' } })
  assertEquals(f.calls[0].body.carWashIds, ['352', '350'])
  const g = fake()
  await new FlexWash(svc, ADMIN, g.poster).call('memberships_getChurnPercentages', { dateRange: { start: '2026-10-01', end: '2026-10-31' } })
  assertEquals(g.calls[0].body.carWashIds, ['352', '350', '441'])
})

Deno.test('carWashIds: a manager cannot name another site', async () => {
  const f = fake()
  await assertRejects(() => new FlexWash(svc, MGR, f.poster).call('accounting_getAccounting', { carWashIds: ['352', '441'], dateRange: { start: '2026-10-01', end: '2026-10-01' } }), Error, "isn't at this user's sites")
  assertEquals(f.calls.length, 0)
  // Numbers are accepted as IDs.
  const g = fake()
  await new FlexWash(svc, MGR, g.poster).call('accounting_getAccounting', { carWashIds: [352], dateRange: { start: '2026-10-01', end: '2026-10-01' } })
  assertEquals(g.calls[0].body.carWashIds, ['352'])
})

Deno.test('carWashIds: an admin can name any car wash', async () => {
  const f = fake()
  await new FlexWash(svc, ADMIN, f.poster).call('accounting_getAccounting', { carWashIds: ['999'], dateRange: { start: '2026-10-01', end: '2026-10-01' } })
  assertEquals(f.calls[0].body.carWashIds, ['999'])
})

Deno.test('endpoints the company key cannot use are left out', () => {
  for (const n of ['membershipRoster_getMembershipRoster', 'membershipRoster_getBillDayProjection', 'salesLeaderboard_getStatsForSalesLeaderboard']) assert(!(n in FLEX_ENDPOINTS), n)
})

Deno.test('no-body endpoints send no body', async () => {
  const f = fake()
  await new FlexWash(svc, MGR, f.poster).call('promotions_getPromotions', { anything: 1 })
  assertEquals(f.calls[0].body, undefined)
  assertEquals(FLEX_ENDPOINTS.promotions_getPromotions.noBody, true)
  assertEquals(FLEX_ENDPOINTS.accounting_getAccounting.noBody, false)
})

Deno.test('carWashId: filled for a one-site manager, checked otherwise', async () => {
  const f = fake()
  await new FlexWash(svc, MGR, f.poster).call('accounting_getCashSalesByEmployeeOnDate', { date: '2026-10-01' })
  assertEquals(f.calls[0].body.carWashId, '352')
  await assertRejects(() => new FlexWash(svc, MGR2, fake().poster).call('accounting_getCashSalesByEmployeeOnDate', { date: '2026-10-01' }), Error, 'Pass carWashId')
  await assertRejects(() => new FlexWash(svc, MGR2, fake().poster).call('accounting_getCashSalesByEmployeeOnDate', { carWashId: '441', date: '2026-10-01' }), Error, "isn't at this user's sites")
})

Deno.test('admin-only endpoints: refused for managers, fine for admins', async () => {
  const f = fake()
  const emp = { dateRange: { start: '2026-10-01', end: '2026-10-31' }, employeeId: 'e1', paginationOpts: { limit: 5, offset: 0 } }
  await assertRejects(() => new FlexWash(svc, MGR2, f.poster).call('orderList_getEmployeeSingleWashStatsOrders', emp), Error, 'only Admins')
  assertEquals(f.calls.length, 0)
  const g = fake()
  await new FlexWash(svc, ADMIN, g.poster).call('orderList_getEmployeeSingleWashStatsOrders', emp)
  assertEquals(g.calls.length, 1)
})

Deno.test('customer lookups check the home car wash first', async () => {
  const details = (cw: string) => ({ [P('customers_getCustomerDetails')]: { customer: { id: 'c1', carWashId: cw, carWash: { id: cw } } } })
  const ok = fake(details('352'))
  await new FlexWash(svc, MGR, ok.poster).call('customers_loadTimeline', { customerId: 'c1' })
  assertEquals(ok.calls.map((c) => c.path), [P('customers_getCustomerDetails'), P('customers_loadTimeline')])
  const no = fake(details('441'))
  await assertRejects(() => new FlexWash(svc, MGR, no.poster).call('giftCards_getForCustomer', { customerId: 'c1' }), Error, "home car wash isn't")
  assertEquals(no.calls.length, 1) // only the check, never the gift cards
  // Checked once per customer per question.
  const twice = fake(details('352'))
  const fw = new FlexWash(svc, MGR, twice.poster)
  await fw.call('customers_getCustomerFinancial', { customerId: 'c1' })
  await fw.call('customers_getMemberFinancial', { customerId: 'c1' })
  assertEquals(twice.calls.filter((c) => c.path === P('customers_getCustomerDetails')).length, 1)
  // Admins skip the check.
  const adm = fake()
  await new FlexWash(svc, ADMIN, adm.poster).call('customers_loadTimeline', { customerId: 'c1' })
  assertEquals(adm.calls.length, 1)
})

Deno.test('order lookups: the order must be from the user\'s car washes', async () => {
  const order = (cw: string) => ({ [P('orders_getOrder')]: { order: { id: 'o1', carWash: { id: cw, name: 'x' } } } })
  await new FlexWash(svc, MGR, fake(order('352')).poster).call('orders_getOrder', { orderId: 'o1' })
  await assertRejects(() => new FlexWash(svc, MGR, fake(order('441')).poster).call('orders_getOrder', { orderId: 'o1' }), Error, "isn't from this user's sites")
  await assertRejects(() => new FlexWash(svc, MGR, fake({ [P('orders_getOrder')]: { order: { id: 'o1' } } }).poster).call('orders_getOrder', { orderId: 'o1' }), Error, "isn't from")
})

Deno.test('vehicle lookups: the vehicle\'s customer is checked', async () => {
  const f = fake({
    [P('vehicles_getVehicle')]: { vehicle: { id: 'v1', customerId: 'c9' } },
    [P('customers_getCustomerDetails')]: { customer: { id: 'c9', carWashId: '441' } },
  })
  await assertRejects(() => new FlexWash(svc, MGR, f.poster).call('vehicles_getVehicle', { id: 'v1' }), Error, "home car wash isn't")
})

Deno.test('customer search drops other sites for managers only', async () => {
  const res = { [P('customers_searchCustomers')]: { customers: [{ id: 'a', carWashId: '352' }, { id: 'b', carWashId: '441' }, { id: 'c' }], totalCount: 3 } }
  const m = await new FlexWash(svc, MGR, fake(res).poster).call('customers_searchCustomers', { textFilter: { queryColumn: '*', query: 'x' } })
  assertEquals(JSON.parse(m.text.slice(0, m.text.indexOf(' ('))).customers.map((c: any) => c.id), ['a'])
  assertStringIncludes(m.text, '2 matching customer(s) at other sites were left out')
  const a = await new FlexWash(svc, ADMIN, fake(res).poster).call('customers_searchCustomers', {})
  assertEquals(JSON.parse(a.text).customers.length, 3)
})

Deno.test('office login cannot read commission detail', async () => {
  const f = fake()
  await assertRejects(() => new FlexWash(svc, OFFICE, f.poster).call('accounting_getCommissionDetail', { carWashId: '352', employeeId: 'e', dateRange: { start: '2026-10-01', end: '2026-10-31' } }), Error, 'pay')
  assertEquals(f.calls.length, 0)
  // But other employee sales reports are fine.
  await new FlexWash(svc, OFFICE, fake().poster).call('csaPerformance_getEmployeesWithSales', { carWashIds: [], dateRange: { start: '2026-10-01', end: '2026-10-31' } })
})

Deno.test('describe: full text for a valid endpoint, refused like a call otherwise', () => {
  const d = JSON.parse(new FlexWash(svc, ADMIN, fake().poster).describe('customers_searchCustomers'))
  assert(d.description.length > 100)
  assert(d.input_schema)
  let threw = false
  try { new FlexWash(svc, MGR, fake().poster).describe('orderList_getEmployeeSingleWashStatsOrders') } catch { threw = true }
  assert(threw)
})

Deno.test('large results are cut with a note', async () => {
  const big = { [P('salesData_getSingleWashOrders')]: { orders: Array.from({ length: 2000 }, (_, i) => ({ id: i, note: 'x'.repeat(20) })) } }
  const r = await new FlexWash(svc, ADMIN, fake(big).poster).call('salesData_getSingleWashOrders', { carWashIds: [], dateRange: { start: '2026-10-01', end: '2026-10-31' }, paginationOpts: { limit: 2000, offset: 0 } })
  assertStringIncludes(r.text, 'truncated')
  assert(r.text.length < 21000)
  assertEquals(r.rows, 2000)
})
