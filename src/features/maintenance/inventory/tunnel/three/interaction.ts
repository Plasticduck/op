import { Matrix4, Plane, Raycaster, Vector2, Vector3 } from 'three'
import type { Intersection, Object3D } from 'three'
import { CLICK_MS, clickSlop, DOUBLE_MS, movable, moveLimits, NEAR_PX, resolveMove, SNAP_FINE_FT, SNAP_FT } from './interactionMath'
import type { MoveLimits } from './interactionMath'
import { LAYER } from './kit'
import type { Interaction, LiveItem, MoveEvent, SceneContext } from './types'

// The pointer: what it's over, what a click means, dragging a machine along the floor,
// and who gets the wheel. The exported signature is the contract and is frozen:
//   attachInteraction(ctx) -> Interaction { sync(), update(dt, now), dispose() }
// (see types.ts). Everything it needs comes through ctx, and everything it says goes out
// through ctx.events, ctx.setHover and ctx.setDrag.
//
// HOVER (mouse and pen). The machine under the pointer, tested against the pick shapes
// only, at most once a frame. A pointer that misses everything gets the nearest machine
// whose footprint center is within NEAR_PX. Nothing changes while a button is down, and
// while the camera is gliding after something the person did (an orbit, the wheel, a
// fly-to) hover waits for it to slow, then looks again where the pointer rests, as it
// does when the page scrolls the canvas under it. The showroom's slow turn and the ride
// are different: there the view never stops, so hover keeps up with it frame by frame.
//
// CLICK. A press and release within a few pixels and CLICK_MS, primary button or one
// finger. On a machine that isn't selected: onSelect. On the selected one: onOpen, if a
// machine is linked. A double-click (a second click on the same spot pressed within
// DOUBLE_MS of the first, or one the browser counts as a double-click by the system's
// own setting) opens the machine the first click hit, whichever was selected and
// whatever the fly-to has slid under the pointer since. Empty floor: onSelect(null). The
// showroom ('preview') selects nothing. In move mode a click on the selected machine
// does not open it (a press there is nearly always a drag that didn't travel); a
// double-click still does.
//
// Selecting puts the page's machine card up (on a phone, a sheet the canvas shrinks
// above), and it can appear right under the pointer. Two things would then press
// whatever button is there. A tap's own click, which the browser sends after touchend
// to what is under the finger by then: it is dropped off the canvas. And the second
// press of a double-click: it is caught on the window before the page hears it and
// counted as the second click (onStrayDown has when). A press anywhere else in between
// ends the double-click.
//
// MOVING (options.moveMode, 'site' mode). A press on a machine that can move takes the
// camera off the pointer, and once the pointer has travelled past the click threshold
// the machine follows it: along the tunnel only when it stands in the tunnel, both ways
// on the floor beside it (interactionMath.ts has the limits and the grid). The scene is
// told through
//   ctx.setDrag({ id, from, x_ft, y_ft, overlaps })   on pick-up and every change
//   ctx.moveItem(id, x_ft, y_ft, lift)                 where the model is drawn
//   ctx.setDrag(null)                                  once it's back on the floor
// and the page through events.onMove: 'start', a 'move' for every new snapped spot, then
// 'end' or 'cancel' (Esc, a second finger, the browser taking the pointer away, move mode
// switched off, the machine deleted). The lift, the last bit of travel after a drop and
// the trip home after a cancel are eased in update(), and the drag stays set until the
// machine is down, so the scene leaves it alone until then (should the drawing put it
// somewhere else meanwhile, it comes down there).
//
// Stopping the camera for a drag: OrbitControls listens for pointerdown on the canvas
// and can't be stopped from a listener added after it. Ours is a capture listener on
// ctx.container (the canvas's parent), so it runs first and sets controls.enabled =
// false; OrbitControls then ignores that press. It goes back to true when the press ends.
//
// THE WHEEL. OrbitControls swallows every wheel event unless enableZoom is false, which
// would trap someone scrolling the page over the canvas. So a capture listener decides
// per event: zoom when the view fills the screen, when Ctrl or Cmd is held (a trackpad
// pinch arrives that way), or once the person has pressed inside the view and not left
// it since. Otherwise the event is left alone for the page, and 't3d:wheel-passed' is
// sent from the container (at most every few seconds) so the page can say how to zoom.
//
// TOUCH. One finger orbits, two zoom and pan (OrbitControls' own defaults), a tap is a
// click, there is no hover. Inline, the canvas takes touch-action: pan-y so a vertical
// swipe scrolls the page and a sideways one orbits; expanded or in move mode it's none.

// How far a machine in hand rides above the floor, in feet, and the seconds it takes to
// rise or settle.
const LIFT_FT = 0.45
const LIFT_S = 0.16
// How fast a held machine closes on its snapped spot, and a cancelled one on home: the
// seconds it takes to cover about two thirds of what's left.
const FOLLOW_S = 0.045
const RETURN_S = 0.085
// The scene sliding under a still pointer faster than this, in pixels a frame, is a
// glide: hover waits.
const GLIDE_PX = 1
// Out of the view for this long and the wheel scrolls the page again.
const DISARM_MS = 700
const HINT_MS = 4000
// The mouse events a press brings after it come at once from a mouse, a moment after
// touchend from a tap. The ones to drop are caught for this long, or until the next press.
const EAT_MS = 1000

// Beside the tunnel, a pointer looking down at the point it holds by less than this (the
// sine of about one degree) would meet a level plane so far off that a pixel is feet.
const LEVEL_LOOK = 0.02

type Grab = {
  id: string
  plane: Plane
  offX: number
  offY: number
  // Set when the pointer is read at the floor below the point it holds instead: how far
  // that spot is from the pointer on screen, in normalized device units.
  foot: { dx: number; dy: number } | null
}

type Press = {
  id: number
  type: string
  x: number
  y: number
  // Where the pointer is now.
  lx: number
  ly: number
  at: number
  // The machine under it when it went down.
  hit: string | null
  // The furthest it has been from where it went down, in pixels.
  travel: number
  // No longer a click: the wrong button, a second finger, a menu, a drag.
  dead: boolean
  // Set while the press may still become a machine drag.
  grab: Grab | null
  // A finger on the inline canvas that hasn't shown yet whether it is scrolling the page
  // or turning the camera.
  undecided: boolean
  // The browser counts this press as the second (or later) of a double-click.
  repeat: boolean
}

// The second press of a double-click that landed on something the page put over the
// spot (onStrayDown), from the window's listeners.
type Stray = {
  id: number
  type: string
  x: number
  y: number
  at: number
  travel: number
  dead: boolean
  // The browser counts it as a second click.
  repeat: boolean
}

// A machine off the floor: in hand, or on its way down after a drop or a cancel.
type Carry = {
  id: string
  // The pointer holding it. -1 once let go.
  pointer: number
  held: boolean
  // Cancelled: it is going home.
  back: boolean
  from: { x_ft: number; y_ft: number }
  // Where the drawing had it at pick-up, to tell a cancel from the drawing changing.
  home: { x: number; y: number }
  // Where the drawing had it the last time it changed, to see it change again.
  drawn: { x: number; y: number }
  said: Set<string>
  limits: MoveLimits
  plane: Plane
  offX: number
  offY: number
  foot: { dx: number; dy: number } | null
  // Where it belongs (snapped), where it's drawn, and how far up.
  tx: number
  ty: number
  vx: number
  vy: number
  rise: number
  lift: number
  overlaps: string[]
  alt: boolean
  seen: number
}

const UP = new Vector3(0, 1, 0)
const smooth = (p: number) => p * p * (3 - 2 * p)
const spot = (x: number, y: number) => `${x}|${y}`

export function attachInteraction(ctx: SceneContext): Interaction {
  const dom = ctx.dom
  const box = ctx.container
  const controls = ctx.controls
  const camera = ctx.camera
  // As found, to hand back on dispose.
  const was = { cursor: dom.style.cursor, touchAction: dom.style.touchAction, zoom: controls.enableZoom }

  const ray = new Raycaster()
  ray.layers.set(LAYER.pick)
  const ndc = new Vector2()
  const targets: Object3D[] = []
  const hits: Array<Intersection<Object3D>> = []
  const hitAt = new Vector3()
  let hitOn = false
  const floor = new Plane(UP, 0)
  const _p = new Vector3()
  const _n = new Vector3()
  const _inv = new Matrix4()
  const _view = new Matrix4()
  const _now = new Matrix4()
  const _last = new Matrix4()
  const _to = { x: 0, y: 0 }
  let rectW = 1
  let rectH = 1

  let hover: string | null = null
  // The mouse or pen over the canvas, in client pixels.
  let over = false
  let px = 0
  let py = 0
  let pickWanted = false
  let pickRaf = 0
  let gliding = false
  let seenView = false
  let cursor = was.cursor

  let press: Press | null = null
  let carry: Carry | null = null
  // The controls are off because a machine is under the pointer (never because the ride
  // has them off: that isn't ours to undo).
  let tookControls = false
  // Turning is off while an inline swipe is still undecided.
  let tookRotate = false
  let listening = false
  // The last click, while a second one could still make it a double-click: the machine
  // it hit, when it was pressed and where.
  let lastClick: { id: string; at: number; x: number; y: number; opened: boolean } | null = null
  // A second press that landed off the canvas and is ours (onStrayDown), until it's up,
  // and one that may yet be, until its mousedown.
  let stray: Stray | null = null
  let maybe: Stray | null = null
  let eatTimer = 0
  const fingers = new Set<number>()
  let swiping = false
  let handing = false

  let armed = false
  let disarmTimer = 0
  let hintAt = -HINT_MS

  const canMove = () => ctx.options.moveMode && ctx.options.mode === 'site'

  // ---- What's under a point of the screen ----

  const aim = (cx: number, cy: number): boolean => {
    const r = dom.getBoundingClientRect()
    if (!r.width || !r.height) return false
    rectW = r.width
    rectH = r.height
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1)
    // The camera may have been moved since the last frame was drawn.
    camera.updateMatrixWorld()
    ray.setFromCamera(ndc, camera)
    return true
  }

  const viewNow = (out: Matrix4) => out.multiplyMatrices(camera.projectionMatrix, _inv.copy(camera.matrixWorld).invert())

  // Leaves the point of the machine that was hit in hitAt (hitOn false: a near miss).
  const pickAt = (cx: number, cy: number): LiveItem | null => {
    hitOn = false
    // Off the canvas (it scrolled away under the pointer) the ray would find machines
    // nobody can see.
    if (!aim(cx, cy) || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1) return null
    hits.length = 0
    ray.intersectObjects(targets, false, hits)
    for (const h of hits) {
      const it = ctx.item(h.object.userData.itemId as string)
      if (!it) continue
      hitAt.copy(h.point)
      hitOn = true
      return it
    }
    viewNow(_view)
    const e = _view.elements
    let best: LiveItem | null = null
    let bestD = NEAR_PX
    for (const it of ctx.items) {
      if (it.scenery) continue
      // Behind the camera.
      if (e[3] * it.x + e[11] * it.y + e[15] <= 0) continue
      _p.set(it.x, 0, it.y).applyMatrix4(_view)
      const d = Math.hypot(((_p.x - ndc.x) * rectW) / 2, ((_p.y - ndc.y) * rectH) / 2)
      if (d < bestD) {
        bestD = d
        best = it
      }
    }
    return best
  }

  const refreshTargets = () => {
    targets.length = 0
    for (const it of ctx.items) if (!it.scenery) for (const p of it.picks) targets.push(p)
  }

  // ---- Hover and the cursor ----

  const showCursor = () => {
    let next = was.cursor
    if (carry?.held || press?.grab) next = 'grabbing'
    // The showroom has nothing to click.
    else if (hover && ctx.options.mode !== 'preview') {
      const it = ctx.item(hover)
      if (it) next = canMove() && movable(it) ? 'grab' : 'pointer'
    }
    if (next === cursor) return
    cursor = next
    dom.style.cursor = next
  }

  const setHover = (id: string | null) => {
    if (id === hover) return
    hover = id
    showCursor()
    ctx.setHover(id)
    ctx.events.onHover(id)
  }

  const canHover = () => over && !press && !carry?.held

  const hoverNow = () => {
    pickWanted = false
    if (canHover()) setHover(pickAt(px, py)?.id ?? null)
  }

  const wantPick = () => {
    pickWanted = true
    if (pickRaf) return
    pickRaf = requestAnimationFrame(() => {
      pickRaf = 0
      if (!pickWanted) return
      // Mid-glide: update() looks again once the view has slowed. Asking for a frame
      // makes sure it runs, should the glide have ended while the pointer was away.
      if (gliding) ctx.invalidate()
      else hoverNow()
    })
  }

  // How many pixels the scene under the pointer slid since the last frame.
  const viewSlid = (): number => {
    camera.updateMatrixWorld()
    viewNow(_now)
    let slid = 0
    if (over && seenView && !_now.equals(_last) && aim(px, py)) {
      const o = ray.ray.origin
      const d = ray.ray.direction
      // The floor under the pointer, or a point about as far as the camera is looking.
      const reach = o.distanceTo(controls.target)
      const t = d.y < -1e-3 ? Math.min(-o.y / d.y, reach * 3) : reach
      _p.copy(d).multiplyScalar(t).add(o)
      const e = _last.elements
      if (e[3] * _p.x + e[7] * _p.y + e[11] * _p.z + e[15] <= 0) slid = Infinity
      else {
        _p.applyMatrix4(_last)
        slid = Math.hypot(((_p.x - ndc.x) * rectW) / 2, ((_p.y - ndc.y) * rectH) / 2)
      }
    }
    _last.copy(_now)
    seenView = true
    return slid
  }

  // ---- The wheel and touch scrolling ----

  const showZoom = () => { controls.enableZoom = ctx.options.expanded || armed }

  const arm = () => {
    clearTimeout(disarmTimer)
    armed = true
    showZoom()
  }

  const giveRotate = () => {
    if (!tookRotate) return
    tookRotate = false
    controls.enableRotate = true
  }

  const showTouchAction = () => {
    // Inline, a vertical swipe belongs to the page. Once a finger has set off sideways
    // the gesture is the camera's to the end.
    const next = ctx.options.expanded || ctx.options.moveMode || swiping ? 'none' : 'pan-y'
    if (dom.style.touchAction !== next) dom.style.touchAction = next
  }

  // ---- Moving a machine ----

  const onKey = (e: KeyboardEvent) => {
    const c = carry
    if (!c || !c.held) return
    if (e.key === 'Escape') {
      if (e.type !== 'keydown') return
      // Esc here means "put it back", not whatever else the page does with it.
      e.preventDefault()
      e.stopPropagation()
      cancelDrag()
    } else if (e.key === 'Alt') {
      // The grid changes under a still pointer. (Windows would also open the menu bar.)
      e.preventDefault()
      const p = press
      if (p && p.id === c.pointer) dragTo(p.lx, p.ly, e.type === 'keydown')
    }
  }

  const listen = (on: boolean) => {
    if (on === listening) return
    listening = on
    if (on) {
      window.addEventListener('keydown', onKey, true)
      window.addEventListener('keyup', onKey, true)
    } else {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onKey, true)
    }
  }

  // The pointer no longer has a machine: the camera gets it back.
  const letGo = () => {
    if (tookControls) {
      tookControls = false
      controls.enabled = true
    }
    listen(false)
    showCursor()
  }

  const grabOf = (it: LiveItem): Grab => {
    // A near miss holds the floor under the pointer.
    if (!hitOn && !ray.ray.intersectPlane(floor, hitAt)) hitAt.set(it.x, 0, it.y)
    const plane = new Plane()
    const o = ray.ray.origin
    const inside = it.item.side !== 'outside'
    if (_n.subVectors(hitAt, o).normalize().y > (inside ? 0 : -LEVEL_LOOK)) {
      // The pointer looks up at the point it holds (a low camera, the top of a tall
      // machine). The planes below would meet it only while it points up, and the machine
      // would come closer as the pointer rises. The floor right below that point is always
      // in reach, though: the pointer carries that spot on screen and the machine follows
      // it across the floor.
      _p.set(hitAt.x, 0, hitAt.z).applyMatrix4(viewNow(_view))
      plane.copy(floor)
      return { id: it.id, plane, offX: it.x - hitAt.x, offY: it.y - hitAt.z, foot: { dx: _p.x - ndc.x, dy: _p.y - ndc.y } }
    }
    if (inside) {
      // It slides along the tunnel only. The pointer is read on a plane through that line,
      // turned to face the camera, so how far it strays to either side of the line counts
      // for nothing.
      _n.set(0, o.y - hitAt.y, o.z - hitAt.z)
      if (_n.lengthSq() < 1e-6) _n.copy(UP)
      plane.setFromNormalAndCoplanarPoint(_n.normalize(), hitAt)
    } else {
      // A level plane at the height it was grabbed, so the point under the pointer stays
      // under it however tall the machine is.
      plane.set(UP, -Math.max(0, hitAt.y))
    }
    return { id: it.id, plane, offX: it.x - hitAt.x, offY: it.y - hitAt.z, foot: null }
  }

  const tell = (phase: MoveEvent['phase']) => {
    const c = carry
    if (!c) return
    c.said.add(spot(c.tx, c.ty))
    if (phase !== 'end') ctx.setDrag({ id: c.id, from: c.from, x_ft: c.tx, y_ft: c.ty, overlaps: c.overlaps })
    ctx.events.onMove({ id: c.id, phase, x_ft: c.tx, y_ft: c.ty, overlaps: c.overlaps })
  }

  // Puts a machine that is still settling straight down.
  const land = () => {
    const c = carry
    if (!c || c.held) return
    carry = null
    ctx.moveItem(c.id, c.tx, c.ty, 0)
    // Its pick shapes go with it now, not at the next frame: a press may be about to
    // look for it where it stands.
    ctx.item(c.id)?.model.root.updateMatrixWorld(true)
    ctx.setDrag(null)
  }

  function dragTo(cx: number, cy: number, alt: boolean) {
    const c = carry
    if (!c || !c.held) return
    c.alt = alt
    if (!aim(cx, cy)) return
    if (c.foot) {
      ndc.x += c.foot.dx
      ndc.y += c.foot.dy
      ray.setFromCamera(ndc, camera)
    }
    // Pointing past the horizon: stay put.
    if (!ray.ray.intersectPlane(c.plane, _p)) return
    resolveMove(c.limits, _p.x + c.offX, _p.z + c.offY, alt ? SNAP_FINE_FT : SNAP_FT, c.ty, _to)
    if (_to.x === c.tx && _to.y === c.ty) return
    c.tx = _to.x
    c.ty = _to.y
    c.overlaps = ctx.overlapsOf(c.id, c.tx, c.ty)
    tell('move')
  }

  const beginDrag = (p: Press, alt: boolean) => {
    const g = p.grab
    p.grab = null
    p.dead = true
    const it = g ? ctx.item(g.id) : undefined
    if (!g || !it || !canMove()) return letGo()
    land()
    carry = {
      id: it.id, pointer: p.id, held: true, back: false,
      from: { x_ft: it.x, y_ft: it.y },
      home: { x: Number(it.item.x_ft), y: Number(it.item.y_ft) },
      drawn: { x: Number(it.item.x_ft), y: Number(it.item.y_ft) },
      said: new Set(),
      limits: moveLimits({ x: it.x, y: it.y, w: it.w, h: it.h, outside: it.item.side === 'outside' }, ctx.data.layout, ctx.bounds, ctx.tunnelSlab),
      plane: g.plane, offX: g.offX, offY: g.offY, foot: g.foot,
      tx: it.x, ty: it.y, vx: it.x, vy: it.y, rise: 0, lift: 0,
      overlaps: ctx.overlapsOf(it.id, it.x, it.y),
      alt, seen: 0,
    }
    // It glows while it's in hand, as it did under the pointer.
    if (p.type !== 'touch') setHover(it.id)
    showCursor()
    tell('start')
    dragTo(p.lx, p.ly, alt)
  }

  const drop = () => {
    const c = carry
    if (!c || !c.held) return
    c.held = false
    c.pointer = -1
    letGo()
    tell('end')
    ctx.invalidate()
  }

  function cancelDrag() {
    const c = carry
    if (!c || !c.held) return
    c.held = false
    c.back = true
    if (press && press.id === c.pointer) press.dead = true
    c.pointer = -1
    // Home is where it was picked up, unless the drawing itself moved it meanwhile
    // (someone else's save arrived mid-drag): then it belongs where the drawing says.
    // The page may also have been applying our own moves as they came, which is not that.
    let hx = c.from.x_ft
    let hy = c.from.y_ft
    const it = ctx.item(c.id)
    if (it) {
      const dx = Number(it.item.x_ft)
      const dy = Number(it.item.y_ft)
      if ((dx !== c.home.x || dy !== c.home.y) && !c.said.has(spot(dx, dy))) {
        hx = dx
        hy = dy
      }
    }
    c.tx = hx
    c.ty = hy
    c.overlaps = ctx.overlapsOf(c.id, hx, hy)
    letGo()
    tell('cancel')
    ctx.invalidate()
  }

  // The machine in hand is gone from the drawing: nothing to put back.
  const abort = () => {
    const c = carry
    if (!c) return
    carry = null
    if (press && press.id === c.pointer) press.dead = true
    letGo()
    ctx.setDrag(null)
    if (c.held) ctx.events.onMove({ id: c.id, phase: 'cancel', x_ft: c.from.x_ft, y_ft: c.from.y_ft, overlaps: [] })
  }

  const stepCarry = (now: number): boolean => {
    const c = carry
    if (!c) return false
    // Its own clock: the first frame after the loop has been idle would otherwise jump.
    const gap = now - c.seen
    const dt = c.seen && gap < 100 ? Math.max(0, gap) / 1000 : 1 / 60
    c.seen = now
    const cut = ctx.options.reducedMotion
    const riseTo = c.held ? 1 : 0
    const stepRise = dt / LIFT_S
    c.rise = cut ? riseTo : c.rise + Math.min(stepRise, Math.max(-stepRise, riseTo - c.rise))
    const lift = LIFT_FT * smooth(c.rise)
    const k = cut ? 1 : 1 - Math.exp(-dt / (c.back ? RETURN_S : FOLLOW_S))
    let x = c.vx + (c.tx - c.vx) * k
    let y = c.vy + (c.ty - c.vy) * k
    if (Math.abs(c.tx - x) < 0.004) x = c.tx
    if (Math.abs(c.ty - y) < 0.004) y = c.ty
    if (x !== c.vx || y !== c.vy || lift !== c.lift) {
      c.vx = x
      c.vy = y
      c.lift = lift
      ctx.moveItem(c.id, x, y, lift)
    }
    const there = x === c.tx && y === c.ty && c.rise === riseTo
    if (there && !c.held) land()
    return !there
  }

  // ---- Clicks ----

  // A second click on the spot is a double-click on the same machine even if the view
  // has started gliding to it and something else is under the pointer by now. Timed
  // from press to press, as the system times its own. False when it isn't one.
  const twice = (p: Pick<Press, 'type' | 'x' | 'y' | 'at' | 'repeat'>): boolean => {
    const last = lastClick
    if (!last || !(p.repeat || p.at - last.at <= DOUBLE_MS) || Math.hypot(p.x - last.x, p.y - last.y) > clickSlop(p.type) * 2) return false
    const it = ctx.item(last.id)
    if (!it) return false
    const opens = !!it.asset && !last.opened
    // A third quick click is still about that machine (a double-click that opened
    // nothing is often tried again at once), and it opens only once.
    lastClick = { id: it.id, at: p.at, x: p.x, y: p.y, opened: last.opened || opens }
    if (opens) ctx.events.onOpen(it.id)
    return true
  }

  const click = (p: Press) => {
    // The showroom has nothing to select.
    if (ctx.options.mode === 'preview') return
    if (twice(p)) return
    lastClick = null
    const it = p.hit ? ctx.item(p.hit) : undefined
    if (!it) return ctx.events.onSelect(null)
    const opens = it.id === ctx.options.selectedId && !!it.asset && !canMove()
    lastClick = { id: it.id, at: p.at, x: p.x, y: p.y, opened: opens }
    if (it.id !== ctx.options.selectedId) ctx.events.onSelect(it.id)
    else if (opens) ctx.events.onOpen(it.id)
  }

  // ---- Pointer events ----

  const endSwipe = () => {
    if (fingers.size || !swiping) return
    swiping = false
    showTouchAction()
  }

  // OrbitControls never saw the first finger go down (the controls were off for it).
  // Show it that finger now, so the two are a pinch from here on.
  const handOver = (p: Press) => {
    handing = true
    try {
      dom.dispatchEvent(new PointerEvent('pointerdown', { pointerId: p.id, pointerType: p.type, isPrimary: true, clientX: p.lx, clientY: p.ly, button: 0, buttons: 1, bubbles: true }))
    } catch {
      // The camera sits this gesture out.
    }
    handing = false
  }

  const onDown = (e: PointerEvent) => {
    if (handing) return
    // A press anywhere in the scene's box means the wheel is meant for it.
    arm()
    if (e.target !== dom) return
    // Any press takes the camera back from a glide or the showroom's slow turn.
    ctx.stopCamera()
    if (e.pointerType === 'touch') {
      if (e.isPrimary) fingers.clear()
      fingers.add(e.pointerId)
    }
    const first = press
    if (first && first.id !== e.pointerId && !e.isPrimary) {
      // A second finger: this was never a click, and two fingers are always the camera.
      first.dead = true
      first.undecided = false
      giveRotate()
      const mine = !!first.grab || (!!carry && carry.held && carry.pointer === first.id)
      cancelDrag()
      if (first.grab) {
        first.grab = null
        letGo()
      }
      if (mine && first.type === 'touch' && e.pointerType === 'touch') handOver(first)
      return
    }
    if (first) {
      // The same pointer down again, or a first finger while nothing else is down: the
      // last press ended where we couldn't see it.
      press = null
      giveRotate()
      cancelDrag()
      letGo()
    }
    // What the last drag left in the air comes down first, so it's picked up from where it belongs.
    land()
    const it = pickAt(e.clientX, e.clientY)
    const p: Press = {
      id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, at: performance.now(),
      hit: it ? it.id : null, travel: 0, dead: e.button !== 0 || !e.isPrimary, grab: null,
      // A pen scrolls the page as a finger does.
      undecided: e.pointerType !== 'mouse' && dom.style.touchAction === 'pan-y',
      repeat: false,
    }
    // Ctrl, Cmd and Shift drags are the camera's (pan), also on a machine.
    if (!p.dead && it && canMove() && movable(it) && controls.enabled && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
      p.grab = grabOf(it)
      controls.enabled = false
      tookControls = true
      listen(true)
      try {
        dom.setPointerCapture(e.pointerId)
      } catch {
        // The pointer is already gone: the press ends as soon as it moves.
      }
    }
    press = p
    showCursor()
  }

  const onMove = (e: PointerEvent) => {
    const p = press
    if (p && p.id === e.pointerId) {
      if (e.pointerType !== 'touch' && e.buttons === 0) {
        // The button came up somewhere we couldn't see.
        press = null
        cancelDrag()
        letGo()
      } else {
        p.lx = e.clientX
        p.ly = e.clientY
        const dx = e.clientX - p.x
        const dy = e.clientY - p.y
        p.travel = Math.max(p.travel, Math.hypot(dx, dy))
        const far = p.travel > clickSlop(p.type)
        if (carry && carry.held && carry.pointer === p.id) dragTo(e.clientX, e.clientY, e.altKey)
        else if (far && p.grab) beginDrag(p, e.altKey)
        else {
          // The camera's drag: nothing stays lit under a moving view.
          if (far) setHover(null)
          if (!p.undecided) return
          // Inline, a swipe that sets off up or down is the page's: the browser scrolls and
          // takes the pointer away, but only after a move or two has got through. The
          // camera waits (this runs before OrbitControls hears the move) until the finger
          // has set off sideways, and then the gesture is its own to the end.
          if (far && Math.abs(dx) >= Math.abs(dy)) {
            p.undecided = false
            swiping = true
            giveRotate()
            showTouchAction()
          } else if (controls.enableRotate) {
            controls.enableRotate = false
            tookRotate = true
          }
        }
        return
      }
    }
    if (e.pointerType === 'touch') return
    px = e.clientX
    py = e.clientY
    over = true
    if (e.buttons === 0) wantPick()
  }

  const onUp = (e: PointerEvent) => {
    fingers.delete(e.pointerId)
    endSwipe()
    const p = press
    if (!p || p.id !== e.pointerId) return
    press = null
    giveRotate()
    if (carry && carry.held && carry.pointer === p.id) {
      dragTo(e.clientX, e.clientY, e.altKey)
      drop()
      lastClick = null
    } else {
      letGo()
      const travel = Math.max(p.travel, Math.hypot(e.clientX - p.x, e.clientY - p.y))
      if (!p.dead && travel <= clickSlop(p.type) && performance.now() - p.at <= CLICK_MS) {
        click(p)
        // A tap's mousedown, mouseup and click come after touchend, aimed again at where
        // the finger was, and the tap may just have put the card up there: they'd press
        // the button under it.
        if (p.type === 'touch') eat(true)
      }
      // A drag, a long press or another button between two clicks: no double-click.
      else lastClick = null
    }
    if (e.pointerType === 'touch') return
    px = e.clientX
    py = e.clientY
    wantPick()
  }

  const onCancel = (e: PointerEvent) => {
    fingers.delete(e.pointerId)
    endSwipe()
    const p = press
    if (!p || p.id !== e.pointerId) return
    press = null
    lastClick = null
    giveRotate()
    if (carry && carry.pointer === p.id) cancelDrag()
    letGo()
  }

  // The browser counts clicks by the system's own double-click speed and distance, which
  // someone may have set slower than DOUBLE_MS: a press it counts as a second click is one.
  // Mouse and pen only: a finger's mousedown comes after its tap is over.
  const onMouseDown = (e: MouseEvent) => {
    const p = press
    if (p && p.type !== 'touch' && e.detail >= 2) p.repeat = true
  }

  // ---- When the page's card comes up under the pointer ----

  // The mouse events the browser sends after a press that was ours: a tap's click on the
  // canvas, a press we kept from the page. Off the canvas, they are dropped.
  const onEat = (e: MouseEvent) => {
    // A keyboard's click (Enter on a button) has no count, and is the person's own.
    if (e.detail === 0 || e.target === dom) return
    e.preventDefault()
    e.stopPropagation()
  }
  const EATEN = ['mousedown', 'mouseup', 'click', 'dblclick'] as const
  const eat = (on: boolean) => {
    clearTimeout(eatTimer)
    for (const t of EATEN) window.removeEventListener(t, onEat, true)
    if (!on) return
    for (const t of EATEN) window.addEventListener(t, onEat, true)
    eatTimer = window.setTimeout(() => eat(false), EAT_MS)
  }

  const onStrayMove = (e: PointerEvent) => {
    const s = stray
    if (s && s.id === e.pointerId) s.travel = Math.max(s.travel, Math.hypot(e.clientX - s.x, e.clientY - s.y))
  }
  const followStray = (on: boolean) => {
    if (on) {
      window.addEventListener('pointermove', onStrayMove, true)
      window.addEventListener('pointerup', onStrayUp, true)
      window.addEventListener('pointercancel', onStrayUp, true)
    } else {
      window.removeEventListener('pointermove', onStrayMove, true)
      window.removeEventListener('pointerup', onStrayUp, true)
      window.removeEventListener('pointercancel', onStrayUp, true)
    }
  }
  function onStrayUp(e: PointerEvent) {
    const s = stray
    if (!s || s.id !== e.pointerId) return
    e.stopPropagation()
    stray = null
    followStray(false)
    // Its click is ours too, also when it turned out to be a drag: whatever is under the
    // pointer never saw the press.
    if (e.type === 'pointerup') eat(true)
    const travel = Math.max(s.travel, Math.hypot(e.clientX - s.x, e.clientY - s.y))
    const clicked = e.type === 'pointerup' && !s.dead && travel <= clickSlop(s.type) && performance.now() - s.at <= CLICK_MS
    if (!clicked || !twice(s)) lastClick = null
  }

  // Nothing on the card is pressed, focused or selected (the default of the mouse's
  // mousedown is to focus and start a selection), and its click is eaten.
  const claim = (e: Event, s: Stray) => {
    e.preventDefault()
    e.stopPropagation()
    stray = s
    followStray(true)
  }

  // On the window, capturing, so it hears every press before the page does. A press off
  // the canvas is the second click of a double-click when it is on the spot of a click on
  // a machine (within the click distance), and something other than the canvas now covers
  // that spot: the page put it there since. A button that was already beside the machine
  // (the toolbar's) leaves the spot showing the canvas, and keeps its clicks. Any other
  // press off the canvas ends the double-click.
  const onStrayDown = (e: PointerEvent) => {
    eat(false)
    maybe = null
    const s = stray
    if (s) {
      // Another finger: no longer a click. (The same pointer again: its release was lost.)
      if (s.id !== e.pointerId) {
        s.dead = true
        return
      }
      stray = null
      followStray(false)
    }
    const last = lastClick
    if (!last || e.target === dom || press) return
    const on = e.isPrimary && e.button === 0 && ctx.options.mode !== 'preview' && Math.hypot(e.clientX - last.x, e.clientY - last.y) <= clickSlop(e.pointerType) * 2
    if (!on || document.elementFromPoint(last.x, last.y) === dom) {
      lastClick = null
      return
    }
    const next: Stray = { id: e.pointerId, type: e.pointerType, x: e.clientX, y: e.clientY, at: performance.now(), travel: 0, dead: false, repeat: false }
    if (next.at - last.at <= DOUBLE_MS) claim(e, next)
    // Slower than that, a mouse's or pen's press may still be one by the system's own
    // setting, as on the canvas: its mousedown, which comes next, says.
    else if (e.pointerType !== 'touch') maybe = next
    else lastClick = null
  }
  const onStrayMouseDown = (e: MouseEvent) => {
    const m = maybe
    maybe = null
    if (!m) return
    if (e.detail >= 2) claim(e, { ...m, repeat: true })
    else lastClick = null
  }

  // The browser took the pointer away mid-drag (after a normal release the machine has
  // already been let go, and this does nothing).
  const onLostCapture = (e: PointerEvent) => {
    if (carry && carry.held && carry.pointer === e.pointerId) cancelDrag()
  }

  const onLeave = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    over = false
    pickWanted = false
    if (!carry?.held) setHover(null)
  }

  const onMenu = (e: Event) => {
    if (press) press.dead = true
    // OrbitControls keeps the menu away, except while it's off for a machine under the pointer.
    if (tookControls) e.preventDefault()
  }

  const onWheel = (e: WheelEvent) => {
    if (e.target !== dom) return
    const open = ctx.options.expanded || armed
    const forced = e.ctrlKey || e.metaKey
    // Decided before OrbitControls sees the event: with zoom off it leaves the event
    // alone and the page scrolls.
    controls.enableZoom = open || forced
    if (press) {
      // Mid-drag OrbitControls lets the wheel through, and the page would scroll away
      // under the pointer.
      e.preventDefault()
      return
    }
    if (open || forced || e.timeStamp - hintAt < HINT_MS) return
    hintAt = e.timeStamp
    box.dispatchEvent(new CustomEvent('t3d:wheel-passed', { bubbles: true }))
  }

  const onBoxLeave = () => {
    clearTimeout(disarmTimer)
    disarmTimer = window.setTimeout(() => {
      armed = false
      showZoom()
    }, DISARM_MS)
  }
  const onBoxEnter = () => clearTimeout(disarmTimer)

  // The page scrolled the canvas under a pointer that stayed put: the browser says nothing
  // about that to the canvas, so look again where the pointer rests.
  const onScroll = () => {
    const c = carry
    const p = press
    if (c && c.held && p && p.id === c.pointer) dragTo(p.lx, p.ly, c.alt)
    else if (over) wantPick()
  }

  box.addEventListener('pointerdown', onDown, true)
  window.addEventListener('pointerdown', onStrayDown, true)
  window.addEventListener('mousedown', onStrayMouseDown, true)
  window.addEventListener('scroll', onScroll, { capture: true, passive: true })
  box.addEventListener('wheel', onWheel, { capture: true, passive: false })
  box.addEventListener('pointerenter', onBoxEnter)
  box.addEventListener('pointerleave', onBoxLeave)
  dom.addEventListener('pointermove', onMove)
  dom.addEventListener('mousedown', onMouseDown)
  dom.addEventListener('pointerup', onUp)
  dom.addEventListener('pointercancel', onCancel)
  dom.addEventListener('lostpointercapture', onLostCapture)
  dom.addEventListener('pointerleave', onLeave)
  dom.addEventListener('contextmenu', onMenu)
  // OrbitControls set touch-action: none when it connected: ours goes on after it.
  showTouchAction()
  showZoom()

  return {
    sync() {
      refreshTargets()
      const c = carry
      const it = c ? ctx.item(c.id) : undefined
      if (c && !it) abort()
      else if (c && it) {
        const dx = Number(it.item.x_ft)
        const dy = Number(it.item.y_ft)
        const moved = dx !== c.drawn.x || dy !== c.drawn.y
        c.drawn.x = dx
        c.drawn.y = dy
        if (c.held && !canMove()) cancelDrag()
        else {
          // Coming down after a drop or a cancel, and the drawing has just put it somewhere
          // else (the page undid the move, someone else's save came in): it lands there.
          if (!c.held && moved && (dx !== c.tx || dy !== c.ty)) {
            c.tx = dx
            c.ty = dy
            c.overlaps = ctx.overlapsOf(c.id, dx, dy)
            ctx.setDrag({ id: c.id, from: c.from, x_ft: dx, y_ft: dy, overlaps: c.overlaps })
          }
          // A model rebuilt mid-drag starts where the drawing has it: back in hand.
          ctx.moveItem(c.id, c.vx, c.vy, c.lift)
        }
      }
      if (press?.grab && !canMove()) {
        press.grab = null
        letGo()
      }
      if (hover && !ctx.item(hover)) setHover(null)
      showTouchAction()
      showZoom()
      showCursor()
      // What's under a still pointer may have changed.
      if (over) wantPick()
    },
    update(_dt, now) {
      let busy = stepCarry(now)
      const slid = viewSlid()
      // The showroom's turn and the ride never stop: hover keeps up with them instead.
      const driven = controls.autoRotate || (!controls.enabled && !tookControls)
      gliding = slid >= GLIDE_PX && !driven
      if (slid > 0.01) pickWanted = true
      if (pickWanted && canHover()) {
        if (gliding) busy = true
        else hoverNow()
      }
      return busy
    },
    dispose() {
      cancelAnimationFrame(pickRaf)
      clearTimeout(disarmTimer)
      box.removeEventListener('pointerdown', onDown, true)
      window.removeEventListener('pointerdown', onStrayDown, true)
      window.removeEventListener('mousedown', onStrayMouseDown, true)
      followStray(false)
      eat(false)
      stray = null
      maybe = null
      window.removeEventListener('scroll', onScroll, true)
      box.removeEventListener('wheel', onWheel, true)
      box.removeEventListener('pointerenter', onBoxEnter)
      box.removeEventListener('pointerleave', onBoxLeave)
      dom.removeEventListener('pointermove', onMove)
      dom.removeEventListener('mousedown', onMouseDown)
      dom.removeEventListener('pointerup', onUp)
      dom.removeEventListener('pointercancel', onCancel)
      dom.removeEventListener('lostpointercapture', onLostCapture)
      dom.removeEventListener('pointerleave', onLeave)
      dom.removeEventListener('contextmenu', onMenu)
      listen(false)
      giveRotate()
      if (press && tookControls && dom.hasPointerCapture(press.id)) dom.releasePointerCapture(press.id)
      if (tookControls) controls.enabled = true
      tookControls = false
      press = null
      carry = null
      controls.enableZoom = was.zoom
      dom.style.touchAction = was.touchAction
      dom.style.cursor = was.cursor
    },
  }
}
