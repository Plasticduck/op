// The save shared by two tabs of the game (engine/save.ts), and the menu rule that keeps a stick
// push from changing settings on its way down a list (engine/ui.ts). No simulation needed.
//   node scripts/maxx/tests/scenes-save.mjs [--only <text>]
import { suite } from '../lib/testkit.mjs'

const t = await suite('scenes-save')
const { createSave, SAVE_KEY_PREFIX } = await t.loadModule('engine/save.ts')
const { createMenu } = await t.loadModule('engine/ui.ts')

const KEY = SAVE_KEY_PREFIX + 'tabs'

/**
 * One localStorage shared by the tabs, telling every listening tab about each write. (A browser
 * leaves out the tab that wrote; hearing its own write must change nothing, so this is harder.)
 */
function browser() {
  const stored = new Map()
  const tabs = []
  const tell = (k) => {
    for (const tab of tabs) tab.events.dispatchEvent(Object.assign(new Event('storage'), { key: k }))
  }
  const storage = {
    getItem: (k) => stored.get(k) ?? null,
    setItem(k, v) {
      stored.set(k, v)
      tell(k)
    },
    removeItem(k) {
      stored.delete(k)
      tell(k)
    },
  }
  /** A tab: its save, and the window it listens on. `deaf`: the old save, which listened to nothing. */
  function open(deaf = false) {
    const events = new EventTarget()
    const tab = { events, save: createSave('tabs', storage, deaf ? null : events), changes: 0 }
    tab.save.onChange = () => tab.changes++
    tab.commit = () => tab.save.commit()
    if (!deaf) tabs.push(tab)
    return tab
  }
  return { stored, storage, open, read: () => JSON.parse(stored.get(KEY) ?? 'null') }
}

/** What writeClear leaves after a clear of `id`. */
function clear(tab, id, unlocked, score) {
  const rec = tab.save.record(id)
  rec.cleared = true
  rec.bestScore = score
  tab.save.data.unlocked = unlocked
  tab.save.data.hiScore = Math.max(tab.save.data.hiScore, score)
  tab.commit()
}

t.test('a clear made in one tab survives the other tab walking the map afterwards', () => {
  const b = browser()
  const a = b.open()
  a.commit()
  const tabB = b.open()
  clear(tabB, 'mw01', 2, 6820)
  clear(tabB, 'mw02', 3, 12600)
  // Tab A, opened first, walks one road: noteNode commits the whole save.
  const data = a.save.data
  a.save.data.map.node = 'mw01'
  a.commit()
  const s = b.read()
  t.ok(s.levels.mw01?.cleared && s.levels.mw02?.cleared, `the clears made in tab B are still saved (${JSON.stringify(s.levels)})`)
  t.eq(s.unlocked, 3, 'unlocked')
  t.eq(s.hiScore, 12600, 'hi score')
  t.eq(s.map.node, 'mw01', "and tab A's own walk is saved too")
  t.ok(a.save.data === data, 'taken in place: scenes keep holding the same save.data')
  t.ok(a.changes > 0, 'onChange told the shell (to apply the other tab settings)')
})

t.test('the old way, for comparison: a tab that never hears the other writes its old copy back', () => {
  const b = browser()
  const a = b.open(true)
  const tabB = b.open()
  clear(tabB, 'mw01', 2, 6820)
  a.save.data.map.node = 'mw01'
  a.commit()
  t.eq(b.read().unlocked, 1, 'progress lost without the listener (what the fix prevents)')
})

t.test('a frozen tab that missed the storage event catches up when it is looked at again', () => {
  const b = browser()
  const events = new EventTarget()
  const a = createSave('tabs', b.storage, events)
  const tabB = b.open()
  clear(tabB, 'mw01', 2, 6820)
  t.eq(a.data.unlocked, 1, 'nothing heard yet')
  events.dispatchEvent(new Event('focus'))
  t.eq(a.data.unlocked, 2, 'focus: the newer save is taken in')
  a.data.unlocked = 1
  events.dispatchEvent(new Event('visibilitychange'))
  t.eq(a.data.unlocked, 1, 'nothing new stored: what this tab has is left alone')
})

t.test("another tab's ERASE SAVE and its settings come across; other keys and junk do not", () => {
  const b = browser()
  const a = b.open()
  const tabB = b.open()
  clear(tabB, 'mw01', 2, 6820)
  t.eq(a.save.data.unlocked, 2, 'clear heard')
  tabB.save.data.settings.music = 2
  tabB.save.reset()
  t.eq(JSON.stringify(a.save.data.levels), '{}', 'erase heard')
  t.eq(a.save.data.settings.music, 2, "the other tab's music volume")
  const before = a.changes
  a.events.dispatchEvent(Object.assign(new Event('storage'), { key: 'smm.muted' }))
  a.events.dispatchEvent(new Event('focus'))
  t.eq(a.changes, before, 'another key, or nothing new: no change')
  b.stored.set(KEY, '{"levels": {"mw0')
  a.events.dispatchEvent(Object.assign(new Event('storage'), { key: KEY }))
  t.eq(a.save.data.settings.music, 2, 'a broken write is not taken in')
  a.save.data.hiScore = 50
  a.commit()
  t.eq(b.read().hiScore, 50, "and this tab's next commit puts a good save back")
})

t.test('the save removed by another tab: an empty one, with this tab settings', () => {
  const b = browser()
  const a = b.open()
  a.save.data.settings.sfx = 3
  clear(a, 'mw01', 2, 100)
  b.storage.removeItem(KEY)
  t.eq(a.save.data.unlocked, 1, 'progress gone')
  t.eq(a.save.data.settings.sfx, 3, 'settings kept')
})

t.test('dispose: a tab whose game is gone stops listening', () => {
  const b = browser()
  const a = b.open()
  a.save.dispose()
  const tabB = b.open()
  clear(tabB, 'mw01', 2, 6820)
  t.eq(a.save.data.unlocked, 1, 'not taken in')
})

/* The menu: a stick push a little off straight down must not change the rows it passes. */

const KEYS = ['left', 'right', 'up', 'down', 'jump', 'spray', 'confirm', 'cancel', 'pause', 'select']
function frame(held = [], pressed = held, repeat = pressed) {
  const st = (list) => Object.fromEntries(KEYS.map((k) => [k, list.includes(k)]))
  return { held: st(held), pressed: st(pressed), released: st([]), repeat: st(repeat), axisX: 0, axisY: 0, device: 'gamepad' }
}
function optionsList() {
  const v = { music: 7, sfx: 8 }
  const menu = createMenu({
    items: [
      { label: 'MUSIC', onAdjust: (d) => void (v.music += d) },
      { label: 'SOUND', onAdjust: (d) => void (v.sfx += d) },
      { label: 'BACK', onSelect: () => {} },
    ],
  })
  menu.reset(0)
  return { menu, v }
}

t.test('menu: down and right on the same tick moves the cursor and changes nothing', () => {
  const { menu, v } = optionsList()
  menu.update(frame(['down', 'right']))
  t.eq(menu.index, 1, 'cursor on SOUND')
  t.eq(JSON.stringify(v), JSON.stringify({ music: 7, sfx: 8 }), 'nothing changed')
})

t.test('menu: down first, right a tick later (a 25 degree flick) changes nothing either', () => {
  const { menu, v } = optionsList()
  menu.update(frame(['down']))
  menu.update(frame(['down', 'right'], ['right']))
  menu.update(frame(['down', 'right'], [], ['down', 'right']))
  t.eq(JSON.stringify(v), JSON.stringify({ music: 7, sfx: 8 }), 'nothing changed')
  t.eq(menu.index, 2, 'the held push walks the list')
})

t.test('menu: right alone still changes the row, and so does a keyboard right after down is let go', () => {
  const { menu, v } = optionsList()
  menu.update(frame(['right']))
  t.eq(v.music, 8, 'MUSIC up')
  menu.update(frame([]))
  menu.update(frame(['down']))
  menu.update(frame([]))
  menu.update(frame(['left']))
  t.eq(v.sfx, 7, 'SOUND down')
})

await t.finish()
