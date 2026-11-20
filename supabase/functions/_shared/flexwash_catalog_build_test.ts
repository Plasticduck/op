// deno test supabase/functions/_shared/flexwash_catalog_build_test.ts
// deno-lint-ignore-file no-explicit-any
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { buildFlexCatalog, canon, diffFlexCatalog, parseDocs, readsOnly } from './flexwash_catalog_build.ts'

const body = (props: Record<string, unknown>, required: string[] = []) =>
  ({ requestBody: { content: { 'application/json': { schema: { type: 'object', properties: props, required } } } } })
const doc = (paths: Record<string, unknown>) => ({ openapi: '3.1.0', paths, components: { schemas: {} } })
const ids = { type: 'array', items: { type: 'string' } }
const range = { type: 'object', properties: { start: { type: 'string' }, end: { type: 'string' } } }

Deno.test('only reading endpoints are kept; other new ones are held for review', () => {
  const b = buildFlexCatalog(doc({
    '/external/accounting/get-line-items-detail': { post: { summary: 'Lines', ...body({ carWashIds: ids, dateRange: range, limit: { type: 'integer' } }, ['carWashIds', 'dateRange', 'limit']) } },
    '/external/magic-links/list-magic-links': { post: { summary: 'List Magic Links' } },
    '/external/vehicles/add-vehicle-subscription-preview': { post: { summary: 'Preview', ...body({ customerId: { type: 'string' } }) } },
    '/external/customers/cancel-membership': { post: { summary: 'Cancel', ...body({ customerId: { type: 'string' } }) } },
    '/external/customers/refund-order': { post: { summary: 'Refund', ...body({ orderId: { type: 'string' } }) } },
    '/external/customers/update-customer': { post: { summary: 'Update', ...body({ customerId: { type: 'string' } }) } },
    '/external/files/{id}': { post: { summary: 'File' } },
    '/external/carwash/get-car-washes': { get: { summary: 'GET only' } },
  }))
  assertEquals(Object.keys(b.endpoints), ['accounting_getLineItemsDetail', 'magicLinks_listMagicLinks', 'vehicles_addVehicleSubscriptionPreview'])
  assertEquals(b.held.map((h) => h.name), ['customers_cancelMembership', 'customers_refundOrder'])
  assertEquals(b.endpoints.accounting_getLineItemsDetail.scope, 'carWashIds')
  assertEquals(b.endpoints.magicLinks_listMagicLinks.scope, 'admin')
  assertEquals(b.endpoints.magicLinks_listMagicLinks.noBody, true)
  assertEquals(b.endpoints.vehicles_addVehicleSubscriptionPreview.scope, 'customer')
  assertEquals(b.endpoints.accounting_getLineItemsDetail.signature, '{carWashIds: string[], dateRange: {start,end}, limit: int}')
})

Deno.test('readsOnly goes by the verb after the area', () => {
  for (const n of ['customers_getCustomerDetails', 'customers_searchCustomers', 'customers_loadTimeline', 'customers_currentBilling', 'customers_previewNextBilling', 'orderList_searchOrders']) assert(readsOnly(n), n)
  for (const n of ['customers_cancelMembership', 'orders_voidOrder', 'gift_issueCard', 'customers_deleteCard']) assert(!readsOnly(n), n)
})

Deno.test('the diff flags newly required inputs and removed endpoints as breaking', () => {
  const before = buildFlexCatalog(doc({
    '/external/accounting/get-line-items-detail': { post: { summary: 'Lines', ...body({ carWashIds: ids, dateRange: range }, ['carWashIds', 'dateRange']) } },
    '/external/tags/get-tags': { post: { summary: 'Tags', ...body({ carWashIds: ids }) } },
  })).endpoints
  const after = buildFlexCatalog(doc({
    '/external/accounting/get-line-items-detail': { post: { summary: 'Lines', ...body({ carWashIds: ids, dateRange: range, limit: { type: 'integer' }, cursor: { type: 'string' } }, ['carWashIds', 'dateRange', 'limit']) } },
    '/external/magic-links/list-magic-links': { post: { summary: 'List Magic Links' } },
  })).endpoints
  const d = diffFlexCatalog(before, after)
  assertEquals(d.added, ['magicLinks_listMagicLinks'])
  assertEquals(d.removed, ['tags_getTags'])
  assertEquals(d.changed, ['accounting_getLineItemsDetail'])
  assertEquals(d.breaking.map((b) => `${b.name} ${b.detail}`).sort(), ['accounting_getLineItemsDetail now requires limit', 'tags_getTags is gone from the docs'])
  assertEquals(diffFlexCatalog(after, after), { added: [], removed: [], changed: [], breaking: [] })
})

Deno.test('parseDocs reads the OpenAPI document out of the docs page script', () => {
  const js = `window.onload = function() { var options = {"swaggerDoc": ${JSON.stringify(doc({ '/external/x/get-y': { post: { summary: 'Y' } } }))}, "customOptions": {}}; }`
  assertEquals(Object.keys(parseDocs(js).paths), ['/external/x/get-y'])
})

Deno.test('a catalog read back with its keys reordered is the same catalog', () => {
  const a = { x: { path: '/p', schema: { type: 'object', properties: { b: 1, a: [{ d: 1, c: 2 }] } } } }
  const b = { x: { schema: { properties: { a: [{ c: 2, d: 1 }], b: 1 }, type: 'object' }, path: '/p' } }
  assertEquals(canon(a), canon(b))
  assert(canon(a) !== canon({ x: { path: '/p', schema: { type: 'object', properties: { b: 2, a: [] } } } }))
  assertEquals(diffFlexCatalog(a as any, b as any).changed, [])
})
