// The prep gun: droplets leave the nozzle, fly, and wash what they hit.
import { DT, MUZZLE, TILE } from '../contract'
import { fx, rand, sfx, sfxEvery } from './api'
import { cos, sin } from './mathx'
import { tileFlags } from './physics'
import { getBehavior } from './registry'
import { AIR, T_SOLID, T_WASHABLE } from './tiles'
import { TUNING as T } from './tuning'
import type { Droplet, Entity, World } from './types'

const DEG = Math.PI / 180
const AIM_ANGLE = { fwd: 0, up: -45 * DEG, down: 90 * DEG }

/** Fire the droplets the gun owes this tick. Reads player.spraying and player.aim. */
export function fireGun(w: World): void {
  const p = w.player
  const rate = T.sprayRate * (p.turbo ? T.turboRate : 1)
  if (!p.spraying) {
    // Idle, the gun gets one droplet ready and no more, so tapping is never faster than holding.
    p.sprayAcc = Math.min(1 - rate, p.sprayAcc + rate)
    return
  }
  p.sprayAcc += rate
  while (p.sprayAcc >= 1) {
    p.sprayAcc -= 1
    fireOne(w)
  }
}

function fireOne(w: World): void {
  const p = w.player
  const muzzle = MUZZLE[p.aim]
  const x = p.x + p.w / 2 + p.facing * muzzle.x
  const y = p.y + p.h + muzzle.y
  const power = p.turbo ? T.turboPower : T.dropletPower
  const tx = Math.floor(x / TILE)
  const ty = Math.floor(y / TILE)
  // Nozzle pressed into a wall: the water lands on that wall.
  if (tileFlags(w, tx, ty) & T_SOLID) {
    splashTile(w, tx, ty, power, x, y)
    return
  }
  if (w.droplets.length >= T.maxDroplets) return
  const speed = T.dropletSpeed * (p.turbo ? T.turboReach : 1)
  const angle = AIM_ANGLE[p.aim] + (rand(w) * 2 - 1) * T.dropletJitter * DEG
  let vx = cos(angle) * speed * p.facing
  if (p.aim !== 'down') vx += p.vx * T.dropletInherit
  w.droplets.push({ x, y, vx, vy: sin(angle) * speed, life: T.dropletLife, power })
}

export function stepDroplets(w: World): void {
  const ds = w.droplets
  for (let i = ds.length - 1; i >= 0; i--) {
    const d = ds[i]
    let gone = --d.life < 0
    if (!gone) {
      d.vy += T.dropletGravity * DT
      d.x += d.vx * DT
      d.y += d.vy * DT
      const tx = Math.floor(d.x / TILE)
      const ty = Math.floor(d.y / TILE)
      if (tileFlags(w, tx, ty) & T_SOLID) {
        splashTile(w, tx, ty, d.power, d.x, d.y)
        gone = true
      } else {
        gone = sprayHit(w, w.solids, d) || sprayHit(w, w.actives, d)
      }
    }
    if (gone) {
      ds[i] = ds[ds.length - 1]
      ds.pop()
    }
  }
}

function sprayHit(w: World, list: Entity[], d: Droplet): boolean {
  const r = T.dropletRadius
  for (let i = 0; i < list.length; i++) {
    const e = list[i]
    if (e.dead || d.x < e.x - r || d.x > e.x + e.w + r || d.y < e.y - r || d.y > e.y + e.h + r) continue
    const beh = getBehavior(e.kind)
    if (!beh?.onSpray) continue
    // Bosses and rivals take turbo water at less than its full power (TUNING.turboBossPower).
    const power = d.power
    if (beh.boss && power > T.turboBossPower) d.power = T.turboBossPower
    const used = beh.onSpray(e, w, d)
    d.power = power
    if (used) return true
  }
  return false
}

/** Water on a solid tile. Grime blocks wear away under it. */
function splashTile(w: World, tx: number, ty: number, power: number, x: number, y: number): void {
  const g = w.grid
  const i = ty * g.w + tx
  if (!(tileFlags(w, tx, ty) & T_WASHABLE)) {
    fx(w, 'splash', x, y, 2)
    return
  }
  g.d[i] = Math.min(255, g.d[i] + power)
  if (g.d[i] < T.grimeBlockHits) {
    fx(w, 'splash', x, y, 2)
    sfxEvery(w, 'sprayHit', 6)
    return
  }
  g.t[i] = AIR
  g.d[i] = 0
  sfx(w, 'crumble')
  fx(w, 'foam', tx * TILE + TILE / 2, ty * TILE + TILE / 2, 8)
}
