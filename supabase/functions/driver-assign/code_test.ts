// deno test supabase/functions/driver-assign/code_test.ts
import { assertEquals } from 'jsr:@std/assert@1'
import { stickerCode } from './code.ts'

Deno.test('the full sticker link', () => {
  assertEquals(stickerCode('https://operator.washlyfe.com/v/ABC234'), 'ABC234')
  assertEquals(stickerCode('https://operator.washlyfe.com/v/abc234'), 'ABC234')
  assertEquals(stickerCode('https://operator.washlyfe.com/v/ABC234?src=qr'), 'ABC234')
  assertEquals(stickerCode('  https://operator.washlyfe.com/v/ABC234/  '), 'ABC234')
})

Deno.test('a code on its own', () => {
  assertEquals(stickerCode('XYZ789'), 'XYZ789')
  assertEquals(stickerCode(' xyz789 '), 'XYZ789')
})

Deno.test('anything else is refused', () => {
  assertEquals(stickerCode(''), null)
  assertEquals(stickerCode(null), null)
  assertEquals(stickerCode('https://example.com/something'), null)
  assertEquals(stickerCode('https://operator.washlyfe.com/v/ABC2345'), null) // seven characters
  assertEquals(stickerCode('ABC1O0'), null) // 1, O and 0 are never in codes
  assertEquals(stickerCode('IT-000123'), null) // an IT Inventory sticker
})
