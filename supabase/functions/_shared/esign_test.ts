// deno test --no-lock supabase/functions/_shared/esign_test.ts
import { assert, assertEquals } from 'jsr:@std/assert@1'
import { activeOrder, allSigned, canonicalJson, describeUA, fmtTime, isoUtc, parsePng, pdfSafe, sha256Hex, validSignature } from './esign.ts'

// A 1x1 transparent PNG.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

Deno.test('canonicalJson: key order does not change the text', () => {
  const a = canonicalJson({ b: 1, a: { d: [1, { z: 1, y: 2 }], c: 'x' }, u: undefined })
  const b = canonicalJson({ a: { c: 'x', d: [1, { y: 2, z: 1 }] }, b: 1 })
  assertEquals(a, b)
  assertEquals(a, '{"a":{"c":"x","d":[1,{"y":2,"z":1}]},"b":1}')
})

Deno.test('sha256Hex matches the standard test vector', async () => {
  assertEquals(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
})

Deno.test('routing: in order, step by step', () => {
  const rs = [
    { role: 'sender' as const, status: 'signed' as const, routing_order: 0 },
    { role: 'signer' as const, status: 'signed' as const, routing_order: 1 },
    { role: 'signer' as const, status: 'sent' as const, routing_order: 2 },
    { role: 'signer' as const, status: 'waiting' as const, routing_order: 3 },
    { role: 'cc' as const, status: 'waiting' as const, routing_order: 4 },
  ]
  assertEquals(activeOrder(rs), 2)
  assert(!allSigned(rs))
  rs[2].status = 'signed'; rs[3].status = 'signed'
  assertEquals(activeOrder(rs), null)
  assert(allSigned(rs), 'a copy recipient never blocks completion')
})

Deno.test('routing: any order means one step', () => {
  const rs = [
    { role: 'signer' as const, status: 'signed' as const, routing_order: 1 },
    { role: 'signer' as const, status: 'viewed' as const, routing_order: 1 },
  ]
  assertEquals(activeOrder(rs), 1)
  assert(!allSigned(rs))
})

Deno.test('signatures: only real PNGs with a name', () => {
  const png = parsePng(PNG)
  assertEquals([png?.width, png?.height], [1, 1])
  assertEquals(parsePng('data:image/png;base64,aGVsbG8='), null)
  assertEquals(parsePng('data:image/jpeg;base64,/9j/4AAQ'), null)
  assert(validSignature({ kind: 'drawn', image: PNG, name: 'Pat Doe' }))
  assert(!validSignature({ kind: 'drawn', image: PNG, name: 'P' }))
  assert(!validSignature({ kind: 'stamp', image: PNG, name: 'Pat Doe' }))
})

Deno.test('describeUA', () => {
  assertEquals(describeUA('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36'), 'Chrome 142 on Windows')
  assertEquals(describeUA('Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1'), 'Safari 18 on iPhone')
  assertEquals(describeUA('Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/142.0 Safari/537.36 Edg/142.0'), 'Edge 142 on Windows')
  assertEquals(describeUA(null), 'Unknown device')
})

Deno.test('pdf text: no characters the standard PDF fonts cannot print', () => {
  assertEquals(pdfSafe('4:04:13\u202fPM CST'), '4:04:13 PM CST')
  assertEquals(pdfSafe('Caf\u00e9 \u201cquote\u201d \u2014 \u20ac5'), 'Caf\u00e9 \u201cquote\u201d \u2014 \u20ac5')
  assertEquals(pdfSafe('Soap \u{1F9FC} x2 \u6d17'), 'Soap ? x2 ?')
  assert(!/[\u202f\u00a0]/.test(fmtTime('2026-11-13T22:04:13Z')))
  assertEquals(isoUtc('2026-11-13T22:04:13.324165+00:00'), '2026-11-13T22:04:13.324Z')
})
