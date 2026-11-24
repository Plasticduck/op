// Who gets the Tab key: engine/input.ts against a stand-in page (a window, a document and the
// elements focus can be on), so the key rules run in Node without a browser.
import { suite } from '../lib/testkit.mjs'

const t = await suite('input')
const { createInput } = await t.loadModule('engine/input.ts')

class FakeElement {
  /** owns: a field, button or link, which keeps its keys (input.ts OWN_KEYS). */
  constructor(owns = false) {
    this.owns = owns
  }
  closest() {
    return this.owns ? this : null
  }
}
class FakeCanvas extends FakeElement {}

const canvas = new FakeCanvas()
const body = new FakeElement()
const button = new FakeElement(true)

/** Runs fn(input, press) with a stand-in page in place, and takes it down again. */
function onPage(fn) {
  const listeners = new Map()
  const target = {
    addEventListener: (type, f) => listeners.set(type, [...(listeners.get(type) ?? []), f]),
    removeEventListener: (type, f) => listeners.set(type, (listeners.get(type) ?? []).filter((g) => g !== f)),
  }
  const saved = ['window', 'document', 'Element', 'HTMLCanvasElement'].map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)])
  Object.assign(globalThis, { window: target, document: { ...target, visibilityState: 'visible' }, Element: FakeElement, HTMLCanvasElement: FakeCanvas })
  const input = createInput()
  /** One key down and up with focus on `on`. Returns whether the game kept the key from the browser. */
  const press = (code, on, mods = {}) => {
    const ev = { code, target: on, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, isComposing: false, repeat: false, defaultPrevented: false, ...mods }
    ev.preventDefault = () => {
      ev.defaultPrevented = true
    }
    ev.composedPath = () => [on]
    for (const f of listeners.get('keydown') ?? []) f(ev)
    for (const f of listeners.get('keyup') ?? []) f({ ...ev })
    return ev.defaultPrevented
  }
  try {
    fn(input, press)
  } finally {
    input.destroy()
    for (const [k, d] of saved) {
      if (d) Object.defineProperty(globalThis, k, d)
      else delete globalThis[k]
    }
  }
}

t.test('Tab on the game canvas stays in the game, as select', () => {
  onPage((input, press) => {
    t.ok(press('Tab', canvas), 'the browser moved focus off the canvas')
    t.ok(input.poll().pressed.select, 'select was not pressed')
    t.ok(press('Tab', canvas, { repeat: true }), 'a held Tab moved focus off the canvas')
  })
})

t.test('Shift+Tab leaves the game', () => {
  onPage((input, press) => {
    t.ok(!press('Tab', canvas, { shiftKey: true }), 'Shift+Tab was swallowed')
    t.ok(!input.poll().pressed.select, 'Shift+Tab pressed select')
  })
})

t.test('Tab from the page around the game moves focus as usual', () => {
  onPage((input, press) => {
    t.ok(!press('Tab', body), 'Tab was swallowed with focus on the body')
    t.ok(!input.poll().pressed.select, 'Tab on the body pressed select')
    t.ok(!press('Tab', button), 'Tab was swallowed on a button')
  })
})

t.test('the game keys still work from the body', () => {
  onPage((input, press) => {
    t.ok(press('Space', body), 'Space on the body scrolled the page')
    const f = input.poll()
    t.ok(f.pressed.jump && f.pressed.confirm, 'Space on the body did not jump')
  })
})

await t.finish()
