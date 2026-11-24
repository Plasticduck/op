// The scenes' own flow, run in Node with a stand-in shell (nothing is drawn): the map after a
// clear, the title's CONTINUE, the last level's replay, the pause menu on a controller, the
// map's words for a new player and for a browser holding the sound back.
//   node scripts/maxx/tests/scenes-flow.mjs [--only <text>]
import { readdirSync } from 'node:fs'
import { suite } from '../lib/testkit.mjs'
import { ASSETS_DIR } from '../paths.mjs'

const t = await suite('scenes-flow')
const { createSave, SAVE_KEY_PREFIX } = await t.loadModule('engine/save.ts')
const { createMapScene } = await t.loadModule('scenes/map.ts')
const { createPlayScene } = await t.loadModule('scenes/play.ts')
const { createTitleScene } = await t.loadModule('scenes/title.ts')
const { createOptions } = await t.loadModule('scenes/shared/options.ts')
const { FOR_SOUND } = await t.loadModule('scenes/title/kit.ts')
const levels = await t.loadModule('levels/index.ts')

// The real atlases, so the map reads its real layout; nothing is drawn.
const atlases = {}
for (const f of readdirSync(ASSETS_DIR).filter((f) => f.endsWith('.atlas.ts'))) {
  const { atlas } = await t.loadModule('assets/' + f)
  atlases[atlas.name] = atlas
}
const frameOf = (name) => {
  const i = name.indexOf('/')
  return atlases[name.slice(0, i)]?.frames[name.slice(i + 1)] ?? null
}
const sprites = {
  has: (name) => !!frameOf(name),
  draw() {},
  frame: frameOf,
  source: () => null,
  anim: (a, name) => (atlases[a]?.anims?.[name] ?? []).map((f) => a + '/' + f),
  atlas: (name) => atlases[name] ?? null,
}

function memoryStorage() {
  const stored = new Map()
  return { stored, getItem: (k) => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v) }
}

/** A stand-in for the shell's GameCtx. `gone` lists every go() call. */
function shell(opts = {}) {
  const storage = opts.storage ?? memoryStorage()
  const session = t.freshSession(opts.session)
  const heard = []
  const audio = new Proxy({ locked: !!opts.locked }, { get: (o, k) => (k in o ? o[k] : (...a) => void heard.push(String(k) + ':' + String(a[0]))) })
  const game = {
    audio,
    input: { device: opts.device ?? 'gamepad', gamepadConnected: true, rumble() {}, setRumbleEnabled() {}, glyph: () => 'pad_a', touchUsed() {}, poll() {}, destroy() {} },
    sprites,
    save: createSave('flow', storage, opts.events ?? null),
    session,
    tick: 0,
    debug: true,
    gone: [],
    go(id, params = {}) {
      game.gone.push([id, params])
    },
    transitioning: false,
    toggleFullscreen() {},
    fullscreen: false,
    resetSession() {
      Object.assign(session, t.freshSession())
    },
    autoPause: false,
    fps: 60,
    irisAt() {},
    muted: false,
    setMuted() {},
    applySettings() {},
    heard,
    storage,
  }
  return game
}

/** Ticks of a scene, `held` each tick (a list, or a function of the tick number). */
function run(scene, game, input, held, ticks, extra = {}) {
  for (let i = 0; i < ticks; i++) scene.update(game, input(typeof held === 'function' ? held(i) : held, extra))
}
const goneTo = (game, id) => game.gone.some((g) => g[0] === id)

/** A save with MW01 cleared, which the map has already looked at (no flourish to come). */
function mw01Cleared(game) {
  const r = game.save.record('mw01')
  r.cleared = true
  r.bestScore = 6820
  game.save.data.unlocked = 2
  game.save.commit()
  createMapScene().enter(game, {})
  game.gone.length = 0
}

/* The map, back from a clear */

t.test('map: A mashed through the tally does not put Maxx straight back into the level', () => {
  const game = shell()
  mw01Cleared(game)
  const map = createMapScene()
  map.enter(game, { from: 'mw01', exit: 'goal' })
  const input = t.makeInput()
  t.eq(map.state().phase, 'idle', 'nothing to show')
  // An ordinary mash, seven presses a second, for most of two seconds.
  run(map, game, input, (i) => (i % 8 === 0 ? ['confirm'] : []), 112)
  t.ok(!goneTo(game, 'play'), `still on the map after the mash (${JSON.stringify(game.gone)})`)
  run(map, game, input, [], 30)
  run(map, game, input, ['confirm'], 1)
  t.ok(goneTo(game, 'play'), 'half a second after the last press, A plays the site again')
})

t.test('map: a mash that goes on is not a lock: confirm counts again after two seconds', () => {
  const game = shell()
  mw01Cleared(game)
  const map = createMapScene()
  map.enter(game, { from: 'mw01', exit: 'goal' })
  const input = t.makeInput()
  let at = -1
  for (let i = 0; i < 200 && at < 0; i++) {
    run(map, game, input, i % 8 === 0 ? ['confirm'] : [], 1)
    if (goneTo(game, 'play')) at = i
  }
  t.ok(at >= 120 && at <= 128, `entered at tick ${at}`)
})

t.test('map: B straight after a clear does not drop to the title either', () => {
  const game = shell()
  mw01Cleared(game)
  const map = createMapScene()
  map.enter(game, { from: 'mw01', exit: 'goal' })
  const input = t.makeInput()
  run(map, game, input, (i) => (i === 4 ? ['cancel'] : []), 10)
  t.ok(!goneTo(game, 'title'), 'B in the first moments is ignored')
  run(map, game, input, [], 30)
  run(map, game, input, ['cancel'], 1)
  t.ok(goneTo(game, 'title'), 'and works once things have calmed down')
})

t.test('map: a flourish after a first clear is not skipped by the tally mash, and confirm still hurries it later', () => {
  const game = shell()
  mw01Cleared(game)
  // The map has not shown the road on from MW01 yet: drop it from what it remembers.
  const mem = game.save.data.map
  const map0 = createMapScene()
  map0.enter(game, { from: 'mw01', exit: 'quit' })
  const onward = map0.state().roads.filter((r) => r !== mem.roads[0])
  mem.roads = mem.roads.filter((r) => !onward.includes(r))
  game.save.data.unlocked = 2
  const map = createMapScene()
  map.enter(game, { from: 'mw01', exit: 'goal' })
  const input = t.makeInput()
  t.eq(map.state().phase, 'show', 'a road to draw in')
  run(map, game, input, (i) => (i === 3 ? ['confirm'] : []), 6)
  t.eq(map.state().phase, 'show', 'a press in the first moments does not cut the flourish short')
  run(map, game, input, [], 30)
  run(map, game, input, ['confirm'], 1)
  t.eq(map.state().phase, 'idle', 'a press after that finishes it at once')
  t.ok(!goneTo(game, 'play'), 'and does not also enter the level')
})

t.test('map: out of EXIT TO MAP nothing waits', () => {
  const game = shell()
  mw01Cleared(game)
  const map = createMapScene()
  map.enter(game, { from: 'mw01', exit: 'quit' })
  const input = t.makeInput()
  run(map, game, input, (i) => (i === 2 ? ['confirm'] : []), 3)
  t.ok(goneTo(game, 'play'), 'confirm at once plays the site')
})

/* The map's words */

t.test('map: at HQ on a new game the bar says how to walk, and A says where to', () => {
  const game = shell()
  const map = createMapScene()
  map.enter(game, {})
  const st = map.state()
  t.eq(st.node, 'hq', 'a new game starts at HQ')
  t.eq(st.bar.prompt, '{move} WALK  {cancel} TITLE', 'the bar at HQ')
  run(map, game, t.makeInput(), (i) => (i === 1 ? ['confirm'] : []), 3)
  t.eq(map.state().note, '{move} WALK TO MW01 AND WASH SOME CARS!', 'A at HQ')
})

t.test("map: Rival Row's bar shows its three gold tokens", () => {
  const game = shell()
  for (const id of ['mw01', 'mw02', 'mw03']) game.save.record(id).cleared = true
  game.save.data.unlocked = 4
  game.save.data.secretFound = true
  game.save.data.rivalsBeaten = 2
  game.save.record('rivals').tokens = [true, false, true]
  game.save.commit()
  const map = createMapScene()
  map.enter(game, { from: 'rivals', exit: 'quit' })
  const st = map.state()
  t.eq(st.node, 'rivals', 'Maxx at Rival Row')
  t.eq(JSON.stringify(st.bar.tokens), JSON.stringify([true, false, true]), 'its tokens on the bar')
  t.eq(st.bar.extra, 'RIVALS 2/4', 'the rivals count still beside them')
})

t.test('map, options, pause: a browser still holding the sound back is named', () => {
  const game = shell({ locked: true })
  const map = createMapScene()
  map.enter(game, {})
  t.eq(map.state().note, FOR_SOUND.gamepad, 'the map says so as it opens')
  const options = createOptions({ erase: false })
  options.open(game)
  t.eq(options.note, 'locked', 'the options say so')
  const free = shell()
  const map2 = createMapScene()
  map2.enter(free, {})
  t.eq(map2.state().note, '', 'and say nothing once sound is on')
  options.open(free)
  t.eq(options.note, '', 'options too')
})

/* The title */

function toMenu(title, game, input) {
  title.enter(game, {})
  run(title, game, input, ['confirm'], 1)
  run(title, game, input, [], 1)
}

t.test("title: CONTINUE keeps a run that still has lives (B on the map is also spray)", () => {
  const game = shell({ session: { lives: 8, score: 41250, coins: 57, turbo: true } })
  mw01Cleared(game)
  const title = createTitleScene()
  const input = t.makeInput()
  toMenu(title, game, input)
  t.eq(title.labels[0], 'CONTINUE', 'CONTINUE offered')
  run(title, game, input, ['confirm'], 1)
  t.ok(goneTo(game, 'map'), 'to the map')
  t.eq(JSON.stringify([game.session.lives, game.session.score, game.session.coins, game.session.turbo]), JSON.stringify([8, 41250, 57, true]), 'the run kept')
})

t.test('title: CONTINUE after the lives ran out, and NEW GAME, start a fresh run', () => {
  const spent = shell({ session: { lives: 0, score: 900 } })
  mw01Cleared(spent)
  const title = createTitleScene()
  const input = t.makeInput()
  toMenu(title, spent, input)
  run(title, spent, input, ['confirm'], 1)
  t.eq(spent.session.lives + ' ' + spent.session.score, '3 0', 'CONTINUE with no lives left')
  const fresh = shell({ session: { lives: 8, score: 41250 } })
  mw01Cleared(fresh)
  const title2 = createTitleScene()
  const input2 = t.makeInput()
  toMenu(title2, fresh, input2)
  run(title2, fresh, input2, ['down'], 1)
  run(title2, fresh, input2, [], 1)
  run(title2, fresh, input2, ['confirm'], 1)
  t.eq(title2.state, 'ask', 'NEW GAME asks first')
  run(title2, fresh, input2, [], 1)
  run(title2, fresh, input2, ['down'], 1)
  run(title2, fresh, input2, [], 1)
  run(title2, fresh, input2, ['confirm'], 1)
  t.eq(fresh.session.lives + ' ' + fresh.session.score, '3 0', 'NEW GAME, YES: a fresh run')
})

t.test('title: progress saved by another tab while the menu is up brings CONTINUE, and NEW GAME asks', () => {
  const storage = memoryStorage()
  const events = new EventTarget()
  const game = shell({ storage, events })
  const title = createTitleScene()
  const input = t.makeInput()
  toMenu(title, game, input)
  t.ok(!title.labels.includes('CONTINUE'), 'no progress yet: no CONTINUE')
  const other = createSave('flow', storage, null)
  other.record('mw01').cleared = true
  other.data.unlocked = 2
  other.commit()
  events.dispatchEvent(Object.assign(new Event('storage'), { key: SAVE_KEY_PREFIX + 'flow' }))
  run(title, game, input, [], 1)
  t.eq(title.labels[0], 'CONTINUE', 'CONTINUE comes up')
  t.eq(title.labels[title.index], 'NEW GAME', 'the cursor stays on the row it was on')
  run(title, game, input, ['confirm'], 1)
  t.eq(title.state, 'ask', 'NEW GAME asks before erasing what the other tab saved')
})

/* The play scene */

/** The play scene on `level`, run until it is being played. */
function playing(game, params) {
  const play = createPlayScene()
  play.enter(game, { card: false, ...params })
  const input = t.makeInput()
  for (let i = 0; i < 60 && play.state().phase !== 'run'; i++) play.update(game, input([]))
  t.eq(play.state().phase, 'run', 'the level is on')
  return { play, input }
}

function clearLastLevel(finishedBefore) {
  levels.standIn('mw08', 'dev-rivals-a')
  try {
    const game = shell()
    game.save.data.finished = finishedBefore
    const { play, input } = playing(game, { level: 'mw08', area: 'out', col: 5 })
    for (let i = 0; i < 600 && play.world.status !== 'clear'; i++) play.update(game, input(['right']))
    t.eq(play.world.status, 'clear', 'MW08 (a stand-in) cleared')
    for (let i = 0; i < 1500 && !game.gone.length; i++) play.update(game, input(i % 8 === 0 ? ['confirm'] : []))
    t.ok(game.save.data.finished, 'finished is set')
    return game.gone[0]
  } finally {
    levels.standIn('mw08', null)
  }
}

t.test('play: the first clear of MW08 goes to the ending', () => {
  const to = clearLastLevel(false)
  t.eq(to?.[0], 'ending', 'the ending')
})

t.test('play: clearing MW08 again (for its tokens) goes back to the map, not the whole ending', () => {
  const to = clearLastLevel(true)
  t.eq(JSON.stringify(to), JSON.stringify(['map', { from: 'mw08', exit: 'goal' }]), 'the map, Maxx at MW08')
})

/** Pause with the controller's Menu (pause and confirm), and walk the pause menu to OPTIONS. */
function pauseToOptions(game, play, input) {
  const pad = { device: 'gamepad' }
  run(play, game, input, ['pause', 'confirm'], 1, pad)
  run(play, game, input, [], 2, pad)
  t.ok(play.state().paused, 'paused')
  for (let k = 0; k < 3; k++) {
    run(play, game, input, ['down'], 1, pad)
    run(play, game, input, [], 1, pad)
  }
  run(play, game, input, ['confirm'], 1, pad)
  run(play, game, input, [], 2, pad)
  t.eq(play.state().screen, 'options', 'OPTIONS open')
}

t.test('play: Menu in the pause OPTIONS goes back to the level, and leaves the music alone', () => {
  const game = shell()
  const { play, input } = playing(game, { level: 'sandbox' })
  const music = game.save.data.settings.music
  pauseToOptions(game, play, input)
  run(play, game, input, ['pause', 'confirm'], 1, { device: 'gamepad' })
  t.ok(!play.state().paused, 'resumed')
  t.eq(game.save.data.settings.music, music, 'music volume untouched')
})

t.test('play: Enter in the pause OPTIONS is still the keyboard confirm (it steps MUSIC)', () => {
  const game = shell({ device: 'keyboard' })
  const { play, input } = playing(game, { level: 'sandbox' })
  const music = game.save.data.settings.music
  pauseToOptions(game, play, input)
  run(play, game, input, ['pause', 'confirm'], 1, { device: 'keyboard' })
  t.ok(play.state().paused, 'still paused')
  t.eq(game.save.data.settings.music, music + 1, 'MUSIC up one')
})

t.test('play: resuming with B (spray and cancel) does not spray while B is still down', () => {
  const game = shell()
  const { play, input } = playing(game, { level: 'sandbox' })
  const pad = { device: 'gamepad' }
  run(play, game, input, ['pause', 'confirm'], 1, pad)
  run(play, game, input, [], 2, pad)
  const sprayed = []
  for (let i = 0; i < 8; i++) {
    run(play, game, input, ['spray', 'cancel'], 1, pad)
    sprayed.push(play.world.player.spraying)
  }
  t.ok(!play.state().paused, 'B resumed the level')
  t.ok(!sprayed.some(Boolean), `no spray while the B that resumed is held (${sprayed.join(' ')})`)
  run(play, game, input, [], 1, pad)
  run(play, game, input, ['spray'], 2, pad)
  t.ok(play.world.player.spraying, 'a fresh press of spray sprays')
})

t.test('play: spray held through the pause waits for a fresh press after the resume', () => {
  const game = shell()
  const { play, input } = playing(game, { level: 'sandbox' })
  const pad = { device: 'gamepad' }
  run(play, game, input, ['spray'], 3, pad)
  t.ok(play.world.player.spraying, 'spraying before the pause')
  run(play, game, input, ['spray', 'pause', 'confirm'], 1, pad)
  run(play, game, input, ['spray'], 2, pad)
  t.ok(play.state().paused, 'paused')
  run(play, game, input, ['spray', 'confirm'], 1, pad)
  run(play, game, input, ['spray'], 3, pad)
  t.ok(!play.state().paused, 'A on RESUME')
  t.ok(!play.world.player.spraying, 'no spray until it is pressed again')
})

await t.finish()
