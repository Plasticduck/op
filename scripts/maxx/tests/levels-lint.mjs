// The level lint (scripts/maxx/level.mjs lint) over every level, so test.mjs catches what only
// the lint can see: a decor name the tiles atlas does not have (validateLevel has no atlas, and
// play draws nothing for it), a sign that breaks a button from its verb, a door into nowhere.
// A shipping level (mw01..mw08, rivals) must lint with no error and no warning; a test room
// with no error (its warnings are the rules of a shipping level it does not keep).
//   node scripts/maxx/tests/levels-lint.mjs [--only <text>]
import { findLevels, lintLevel, openGame } from '../level.mjs'
import { suite } from '../lib/testkit.mjs'
import { GAME_URL } from '../paths.mjs'

const t = await suite('levels')
const game = await openGame()
try {
  game.meta = (await game.server.ssrLoadModule(GAME_URL + '/game/levels/meta.ts')).LEVEL_META
} catch {
  game.meta = []
}
const found = await findLevels(game)
const SHIPPING = /^(mw0[1-8]|rivals)$/
const say = (out) => out.map((o) => `\n        ${o.sev} ${o.where} ${o.text}`).join('')

t.test('every level file loads, and no two define one id', () => {
  const broken = [...found.values()].filter((e) => !e.level)
  t.ok(!broken.length, `does not load: ${broken.map((e) => `${e.file}: ${e.error?.message}`).join('; ')}`)
  t.ok(!found.clashes.length, `two files define ${found.clashes.map((c) => c.id).join(', ')}`)
})

t.test('the eight sites and Rival Row are all there', () => {
  for (const id of ['mw01', 'mw02', 'mw03', 'mw04', 'mw05', 'mw06', 'mw07', 'mw08', 'rivals']) t.ok(found.get(id)?.level, `no level ${id}`)
})

for (const [id, e] of found) {
  if (!e.level) continue
  const shipping = SHIPPING.test(id)
  t.test(`${id} lints ${shipping ? 'with no error and no warning' : 'with no error'}`, () => {
    const res = lintLevel(game, e)
    const bad = res.out.filter((o) => o.sev === 'error' || (shipping && o.sev === 'warn'))
    t.ok(!bad.length, `${bad.length} problem(s):${say(bad)}`)
  })
}

await t.finish()
await game.close()
