// Checks the test kit itself against the core simulation (and shows how a test file looks).
import { suite } from '../lib/testkit.mjs'

const t = await suite('kit')

t.test('flat() puts Maxx on the floor and until() steps the world', () => {
  const w = t.flat(['  @      c'])
  t.ok(t.until(w, [], (w) => w.player.onGround, 60) > 0, 'he never landed')
  t.ok(t.find(w, 'car', 'compact'), 'the compact car is there')
})

t.test('spray() washes a car through its own behaviour', () => {
  const w = t.flat(['  @      c'])
  t.steps(w, [], 5)
  const car = t.find(w, 'car')
  const before = car.hp
  t.spray(w, car)
  t.ok(car.hp < before, 'dirt came off')
})

await t.finish()
