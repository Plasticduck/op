// Rain and snow, in two layers: a thin far one behind the tiles and a sparser near one in
// front of everything. Nothing is stored per drop: each one's place is worked out from the
// clock and the camera, so there is nothing to update and a frame photographs the same twice.
import { VIEW_H, VIEW_W } from '../contract'
import type { WeatherKind } from './themes'

const FAR = 44
const NEAR = 22
const COUNT = FAR + NEAR
/** Room round the screen, so a streak never pops in at an edge. */
const PAD = 24
const SPAN_X = VIEW_W + PAD * 2
const SPAN_Y = VIEW_H + PAD * 2

// Where each drop starts and how it differs from its neighbours, fixed for good.
const startX = new Float32Array(COUNT)
const startY = new Float32Array(COUNT)
const quirk = new Float32Array(COUNT)
{
  let seed = 0x51ed270b
  const rnd = (): number => {
    seed ^= seed << 13
    seed ^= seed >>> 17
    seed ^= seed << 5
    return (seed >>> 0) / 4294967296
  }
  for (let i = 0; i < COUNT; i++) {
    startX[i] = rnd() * SPAN_X
    startY[i] = rnd() * SPAN_Y
    quirk[i] = rnd()
  }
}

/**
 * One layer of the weather. `near` false is the layer behind the tiles, true the one in
 * front. The far layer follows the camera at half speed, the near one is fixed in the world.
 * The arithmetic is written out in the loops (no helper that hands back a fraction, which
 * would be a boxed number every drop, every frame).
 */
export function drawWeather(g: CanvasRenderingContext2D, kind: WeatherKind, near: boolean, camX: number, camY: number, tick: number): void {
  if (kind === 'none') return
  const from = near ? FAR : 0
  const to = near ? COUNT : FAR
  const follow = near ? 1 : 0.5
  const ox = camX * follow
  const oy = camY * follow
  if (kind === 'rain') {
    g.fillStyle = near ? '#d6dae3' : '#767b8a'
    const fall = near ? 10 : 6.5
    const slant = near ? -3 : -2
    const len = near ? 5 : 3
    for (let i = from; i < to; i++) {
      const q = 0.8 + quirk[i] * 0.4
      let wx = (startX[i] + tick * slant * q - ox) % SPAN_X
      if (wx < 0) wx += SPAN_X
      let wy = (startY[i] + tick * fall * q - oy) % SPAN_Y
      if (wy < 0) wy += SPAN_Y
      const x = (wx | 0) - PAD
      const y = (wy | 0) - PAD
      // Two short pieces, one pixel apart: a streak that leans without a soft edge.
      g.fillRect(x, y, 1, len)
      g.fillRect(x - 1, y + len, 1, len)
    }
    return
  }
  g.fillStyle = near ? '#f7f4f8' : '#dff3ff'
  for (let i = from; i < to; i++) {
    const q = quirk[i]
    const fall = (near ? 1.3 : 0.7) + q * 0.5
    const sway = Math.sin((tick + q * 400) * (0.02 + q * 0.02)) * (near ? 9 : 6)
    let wx = (startX[i] + sway - tick * 0.25 - ox) % SPAN_X
    if (wx < 0) wx += SPAN_X
    let wy = (startY[i] + tick * fall - oy) % SPAN_Y
    if (wy < 0) wy += SPAN_Y
    const x = (wx | 0) - PAD
    const y = (wy | 0) - PAD
    if (near && q > 0.5) {
      // A bigger flake: a plus.
      g.fillRect(x - 1, y, 3, 1)
      g.fillRect(x, y - 1, 1, 3)
    } else {
      const s = near || q > 0.6 ? 2 : 1
      g.fillRect(x, y, s, s)
    }
  }
}
