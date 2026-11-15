import { CAR } from './car'

// The demo car's trip and what it wakes up on the way. Plain functions of time and
// distance, with no memory, so any moment of the loop can be drawn on its own (which is
// what makes screenshots repeatable).

// A machine starts working this many feet before the car's nose reaches its footprint,
// and winds down over this many after the tail has left it.
export const LEAD_FT = 8
export const TRAIL_FT = 6

const smooth = (v: number) => {
  const c = Math.min(1, Math.max(0, v))
  return c * c * (3 - 2 * c)
}

// How hard a machine is working: 1 while any part of the car is over its footprint,
// easing up as the car arrives and down after it leaves. carDx is the car's center minus
// the machine's, halfW half the footprint's length along the tunnel.
export function activityAt(carDx: number, halfW: number): number {
  const ahead = -carDx - CAR.length / 2 - halfW
  if (ahead > 0) return smooth(1 - ahead / LEAD_FT)
  const behind = carDx - CAR.length / 2 - halfW
  if (behind > 0) return smooth(1 - behind / TRAIL_FT)
  return 1
}

export type CarTrip = {
  // Where the car's center starts and ends, and how long one pass takes, in seconds.
  from: number
  to: number
  period: number
}

// The trip: up the prep lane, onto the conveyor, through the tunnel and off the far end.
// conveyorFrom and conveyorTo are the ends of the conveyor's shape; the slab limits keep
// the car on the concrete.
export function carTrip(conveyorFrom: number, conveyorTo: number, slabMin: number, slabMax: number): CarTrip {
  const half = CAR.length / 2
  const from = Math.max(slabMin + half + 1.5, conveyorFrom - 22)
  const to = Math.max(from + 1, Math.min(slabMax - half - 1, conveyorTo + half + 4))
  return { from, to, period: (to - from) / CAR.speed }
}

export type CarAt = { x: number; scale: number; progress: number }

const APPEAR_S = 0.45
const VANISH_S = 0.3

// Where the car is at scene time t. It pops in at the start of each pass and out at the
// end (scale), since there is no road beyond the slab for it to drive in from.
export function carAt(trip: CarTrip, t: number, out: CarAt): CarAt {
  const phase = ((t % trip.period) + trip.period) % trip.period
  out.x = trip.from + phase * CAR.speed
  out.progress = phase / trip.period
  const into = smooth(phase / APPEAR_S)
  const outOf = smooth((trip.period - phase) / VANISH_S)
  // A touch of overshoot on the way in, like something set down.
  out.scale = Math.min(into * (1 + 0.06 * Math.sin(Math.min(1, phase / APPEAR_S) * Math.PI)), 1.06) * outOf
  return out
}

// Where a car waits when the conveyor is down: stopped short of the entrance.
export const PARKED_NOSE_X = -2.4
