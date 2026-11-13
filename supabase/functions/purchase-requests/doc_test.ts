// deno test --no-lock -A supabase/functions/purchase-requests/doc_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { canonicalJson, sha256Hex } from '../_shared/esign.ts'
import { buildDocument, type PrRow, validate } from './doc.ts'

const base: PrRow = {
  id: '11111111-1111-1111-1111-111111111111', account_id: 'a', number: 1042,
  requester_id: 'u1', requester_name: 'Pat Doe', requester_email: 'pat@example.com',
  title: 'Replacement dryer motor', vendor: 'Sonny\'s', site: '22 - Odessa', category: 'Equipment',
  gl_code: '6100', payment_method: 'Purchase order', needed_by: '2026-12-01', priority: 'urgent',
  justification: 'Dryer 3 motor failed.',
  line_items: [{ description: 'Motor', quantity: 2, unit_price: 1250.5 }, { description: 'Freight', quantity: 1, unit_price: '0.10' }],
  subtotal: 2501.1, shipping: 25, tax: 10.33, total: 2536.43,
  status: 'draft', envelope_id: null, ever_sent: false, submitted_at: null, approved_at: null,
  purchased_at: null, purchased_by_name: null, po_number: null, actual_amount: null, purchase_note: null,
}

Deno.test('validate: a complete request passes', () => {
  assertEquals(validate(base), [])
})

Deno.test('validate: says what is missing', () => {
  const p = validate({ ...base, vendor: ' ', justification: null, line_items: [{ description: '', quantity: 0, unit_price: 1.234 }], total: 0 })
  assert(p.some((x) => x.includes('vendor')))
  assert(p.some((x) => x.includes('business reason')))
  assert(p.some((x) => x.includes('Line 1 needs a description')))
  assert(p.some((x) => x.includes('quantity')))
  assert(p.some((x) => x.includes('dollars and cents')))
  assert(p.some((x) => x.includes('more than $0.00')))
})

Deno.test('document: money is exact and fingerprints are stable', async () => {
  const signers = [{ user_id: 'u2', name: 'Alex Approver', email: 'alex@example.com', required_by_rule: null }]
  const d = buildDocument({ pr: base, company: 'Mighty Wash', version: 1, files: [], signers, cc: [], signInOrder: true })
  assertEquals(d.line_items.map((l) => l.amount), ['2501.00', '0.10'])
  assertEquals([d.subtotal, d.shipping, d.tax, d.total], ['2501.10', '25.00', '10.33', '2536.43'])
  assertEquals(d.number, 'PR-1042')
  assertEquals(d.routing.signers[0].order, 1)
  const again = buildDocument({ pr: { ...base, line_items: [...base.line_items] }, company: 'Mighty Wash', version: 1, files: [], signers, cc: [], signInOrder: true })
  assertEquals(await sha256Hex(canonicalJson(d)), await sha256Hex(canonicalJson(again)))
  const edited = buildDocument({ pr: { ...base, title: 'Replacement dryer motors' }, company: 'Mighty Wash', version: 1, files: [], signers, cc: [], signInOrder: true })
  assert(await sha256Hex(canonicalJson(d)) !== await sha256Hex(canonicalJson(edited)), 'any edit changes the fingerprint')
})

Deno.test('document: any order puts every approver on one step', () => {
  const signers = [
    { user_id: 'u2', name: 'A', email: 'a@x.com' },
    { user_id: 'u3', name: 'B', email: 'b@x.com', required_by_rule: '$10,000.00 and over' },
  ]
  const d = buildDocument({ pr: base, company: 'MW', version: 2, files: [], signers, cc: [], signInOrder: false })
  assertEquals(d.routing.signers.map((s) => s.order), [1, 1])
  assertEquals(d.routing.signers[1].required_by_rule, '$10,000.00 and over')
})
