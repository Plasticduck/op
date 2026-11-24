// A fingerprint of everything in a World that play depends on. Two runs fed
// the same inputs must give the same fingerprint on every tick: that is the
// determinism check in scripts/maxx/sim.mjs, and a handy way to spot a desync.
import type { World } from './types'

export function worldHash(w: World): string {
  const f64 = new Float64Array(1)
  const u32 = new Uint32Array(f64.buffer)
  let h = 0x811c9dc5
  const num = (n: number): void => {
    f64[0] = n
    h = Math.imul(h ^ u32[0], 0x01000193)
    h = Math.imul(h ^ u32[1], 0x01000193)
  }
  const str = (s: string): void => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
    h = Math.imul(h ^ 0xff, 0x01000193)
  }
  const flag = (b: boolean): void => num(b ? 1 : 0)
  const record = (r: Record<string, number | string | boolean>): void => {
    for (const key of Object.keys(r).sort()) {
      str(key)
      const v = r[key]
      if (typeof v === 'number') num(v)
      else str(String(v))
    }
  }

  str(w.area.id)
  str(w.status)
  str(w.exit ?? '')
  flag(w.clearWalk)
  str(w.bossMusic ?? '')
  num(w.tick)
  num(w.timeLeft)
  num(w.statusT)
  num(w.seed)
  num(w.nextId)
  num(w.camera.x)
  num(w.camera.y)
  num(w.camLook)
  num(w.chain)
  num(w.chainT)
  flag(w.warpLock)
  if (w.warp) {
    str(w.warp.mode + w.warp.phase + w.warp.toArea + w.warp.toMarker)
    num(w.warp.t)
  }
  if (w.checkpoint) {
    str(w.checkpoint.areaId)
    num(w.checkpoint.x)
    num(w.checkpoint.y)
  }
  if (w.boss) {
    str(w.boss.name)
    num(w.boss.hp)
  }
  if (w.camBounds) {
    num(w.camBounds.x0)
    num(w.camBounds.x1)
  }
  record(w.flags)

  const p = w.player
  num(p.x)
  num(p.y)
  num(p.vx)
  num(p.vy)
  num(p.facing)
  str(p.state)
  num(p.stateT)
  num(p.pips)
  num(p.invuln)
  num(p.wax)
  num(p.hover)
  num(p.runDist)
  num(p.ridingId)
  num(p.airT)
  num(p.jumpBuf)
  num(p.coyote)
  num(p.sprayAcc)
  str(p.floor)
  str(p.aim)
  flag(p.onGround)
  flag(p.turbo)
  flag(p.spraying)
  flag(p.hovering)
  flag(p.skidding)
  flag(p.jumping)
  flag(p.jumpCut)

  // Every area, not only the one in view: the ones left behind must hold still.
  for (const id of Object.keys(w.areas).sort()) {
    const area = w.areas[id]
    str(id)
    for (let i = 0; i < area.grid.t.length; i++) h = Math.imul(h ^ ((area.grid.t[i] << 8) | area.grid.d[i]), 0x01000193)
    for (const e of area.entities ?? []) {
      num(e.id)
      str(e.kind)
      str(e.variant)
      str(e.state)
      str(e.solid)
      // Which profile, and which way round (cars mirror theirs as they turn).
      if (e.ground && e.ground.length > 0) {
        num(e.ground.length)
        num(e.ground[0])
        num(e.ground[e.ground.length - 1])
      } else {
        num(-1)
      }
      num(e.x)
      num(e.y)
      num(e.w)
      num(e.h)
      num(e.vx)
      num(e.vy)
      num(e.facing)
      num(e.stateT)
      num(e.hp)
      flag(e.active)
      flag(e.dead)
      flag(e.harmful)
      flag(e.onGround)
      record(e.vars)
    }
  }
  for (const d of w.droplets) {
    num(d.x)
    num(d.y)
    num(d.vx)
    num(d.vy)
    num(d.life)
  }

  const s = w.stats
  num(s.carsTotal)
  num(s.carsWashed)
  num(s.coins)
  num(s.score)
  for (const t of s.tokens) flag(t)
  num(w.session.lives)
  num(w.session.score)
  num(w.session.coins)
  num(w.session.pips)
  flag(w.session.turbo)
  return (h >>> 0).toString(16).padStart(8, '0')
}
