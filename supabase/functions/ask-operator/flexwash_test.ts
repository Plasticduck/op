// Offline tests of Operator AI's FlexWash access rules (no network, no secrets).
// Run from the op folder:
//   DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock supabase/functions/ask-operator/flexwash_test.ts
// (DENO_NO_PACKAGE_JSON keeps Deno from reading the app's package.json.)
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import { FlexWash, flexPrompt, flexUserNote, type FlexAccess } from './flexwash.ts'
import { FLEX_ENDPOINTS } from './flexwash_catalog.ts'

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
  assertStringIncludes(flexPrompt(true), 'orderList_getEmployeeSingleWashStatsOrders')
  assert(!flexPrompt(false).includes('orderList_getEmployeeSingleWashStatsOrders'))
  assertStringIncludes(flexUserNote(MGR), 'MW17 = "352"')
  assertStringIncludes(flexUserNote(OFFICE), 'commission')
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
