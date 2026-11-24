// Things Maxx picks up: coin, token, bubble, turbo, wax, oneup.
//
// A prize knocked out of a block (bumpTile spawns it with props.pop) starts
// inside the block in state 'pop' and rises out of the top over
// TUNING.popTicks. Then: a bubble floats up a little and bobs, the turbo
// nozzle sits on the block, the wax can and the 1UP slide away from Maxx
// along the ground (state 'walk'). Placed straight into a level they stay put.
//
// For the renderer (box w x h, states):
//   coin    18 x 20  'idle'                      floats in the middle of its tile
//   token   22 x 22  'idle' | 'owned'            vars.token = its slot 0..2; 'owned' = already in the save
//   bubble  20 x 20  'pop' | 'idle'              bobs
//   turbo   22 x 20  'pop' | 'idle'
//   wax     20 x 24  'pop' | 'idle' | 'walk'
//   oneup   22 x 22  'pop' | 'idle' | 'walk'
// While in 'pop' its z is -1: draw it behind the tiles so it rises out of the block.
// vars.popped is 1 once it has come out of a block (the renderer gives it a hop as it lands).
// A token with props.owned shows as owned whatever the save says: for test rooms.
import { TILE } from '../../contract'
import {
  addCoins,
  addScore,
  collectToken,
  facePlayer,
  fx,
  giveLife,
  giveTurbo,
  giveWax,
  healPlayer,
  kill,
  moveBody,
  patrol,
  propBool,
  propNum,
  registerEntity,
  rumble,
  setBox,
  setState,
  sfx,
  turnAround,
} from '../api'
import { sin } from '../mathx'
import { TUNING as T } from '../tuning'
import type { Entity, World } from '../types'

function initPrize(e: Entity, width: number, height: number, lift = 0): void {
  if (e.props.pop === true) {
    setBox(e, width, height)
    e.state = 'pop'
    e.z = -1
  } else {
    setBox(e, width, height, lift)
  }
}

/** Rise out of the block. True while (and on the tick) it is still coming out. */
function popping(e: Entity): boolean {
  if (e.state !== 'pop') return false
  const k = Math.min(1, e.stateT / T.popTicks)
  e.y = e.spawnY - TILE * k
  if (k >= 1) {
    setState(e, 'idle')
    e.z = 0
    e.vars.popped = 1
  }
  return true
}

/** After popping out, slide away from Maxx. */
function walkOff(e: Entity, w: World): void {
  facePlayer(e, w)
  turnAround(e)
  setState(e, 'walk')
}

function centerX(e: Entity): number {
  return e.x + e.w / 2
}
function centerY(e: Entity): number {
  return e.y + e.h / 2
}

/* coin: a silver-blue wash token, worth one coin */

function takeCoin(e: Entity, w: World): void {
  if (e.dead) return
  kill(e)
  addCoins(w, 1)
  sfx(w, 'coin')
  fx(w, 'sparkle', centerX(e), centerY(e), 3)
}

registerEntity('coin', {
  init(e) {
    setBox(e, 18, 20, 6)
    e.gravity = 0
    e.collides = false
  },
  update() {},
  onTouch(e, w) {
    takeCoin(e, w)
    return true
  },
  // A coin resting on a block is knocked loose when the block is bumped.
  onBump: takeCoin,
})

/* token: one of the level's three gold tokens. State 'owned' = already in the save. */

registerEntity('token', {
  init(e, w) {
    setBox(e, 22, 22, 5)
    e.gravity = 0
    e.collides = false
    if (e.vars.token === undefined) e.vars.token = propNum(e, 'index', -1)
    if (w.stats.tokens[e.vars.token] || propBool(e, 'owned', false)) e.state = 'owned'
  },
  update() {},
  onTouch(e, w) {
    const fresh = e.state !== 'owned'
    kill(e)
    collectToken(w, e.vars.token)
    addScore(w, fresh ? T.tokenScore : T.tokenScore / 10, centerX(e), e.y - 4)
    sfx(w, 'token')
    fx(w, 'sparkle', centerX(e), centerY(e), 10)
    rumble(w, 0.2, 0.5, 120)
    return true
  },
})

/* bubble: heals one pip. It waits for Maxx if his shine is already full. */

registerEntity('bubble', {
  init(e) {
    initPrize(e, 20, 20, 6)
    e.gravity = 0
    e.collides = false
    e.vars.restY = e.y
    e.vars.rise = 0
  },
  update(e) {
    if (popping(e)) {
      if (e.state !== 'pop') {
        e.vars.restY = e.y - 26
        e.vars.rise = 26
      }
      return
    }
    if (e.vars.rise > 0) e.vars.rise = Math.max(0, e.vars.rise - 0.6)
    e.y = e.vars.restY + e.vars.rise + sin(e.stateT * 0.09) * 3
  },
  onTouch(e, w) {
    if (e.state === 'pop' || !healPlayer(w)) return true
    kill(e)
    addScore(w, T.bubbleScore)
    fx(w, 'bubble', centerX(e), centerY(e), 8)
    return true
  },
})

/* turbo: the turbo nozzle */

registerEntity('turbo', {
  init(e) {
    initPrize(e, 22, 20)
  },
  update(e, w) {
    if (!popping(e)) moveBody(e, w)
  },
  onTouch(e, w) {
    if (e.state === 'pop') return true
    kill(e)
    // A second nozzle is worth points instead.
    if (w.player.turbo) addScore(w, T.powerScore, centerX(e), e.y - 4)
    giveTurbo(w)
    fx(w, 'sparkle', centerX(e), centerY(e), 8)
    return true
  },
})

/* wax: a can of Mighty Wax */

registerEntity('wax', {
  init(e) {
    initPrize(e, 20, 24)
  },
  update(e, w) {
    if (popping(e)) {
      if (e.state !== 'pop') walkOff(e, w)
    } else if (e.state === 'walk') {
      patrol(e, w, T.itemWalkSpeed)
    } else {
      moveBody(e, w)
    }
  },
  onTouch(e, w) {
    if (e.state === 'pop') return true
    kill(e)
    giveWax(w)
    fx(w, 'star', centerX(e), centerY(e), 10)
    rumble(w, 0.3, 0.6, 200)
    return true
  },
})

/* oneup: an extra life */

registerEntity('oneup', {
  init(e) {
    initPrize(e, 22, 22)
  },
  update(e, w) {
    if (popping(e)) {
      if (e.state !== 'pop') walkOff(e, w)
    } else if (e.state === 'walk') {
      patrol(e, w, T.oneupWalkSpeed)
    } else {
      moveBody(e, w)
    }
  },
  onTouch(e, w) {
    if (e.state === 'pop') return true
    kill(e)
    giveLife(w)
    fx(w, 'sparkle', centerX(e), centerY(e), 10)
    rumble(w, 0.3, 0.6, 200)
    return true
  },
})
