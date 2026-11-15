// The demo car's size and outline, as plain numbers, so machines can react to it (a top
// brush rides its roofline, wraps close around its nose) without knowing how it's drawn.
// Feet. dx is measured from the car's center along the tunnel: the nose is at +length/2.

export const CAR = {
  length: 15.6,
  width: 6.3,
  height: 5.7,
  // Where the car's centerline runs across the tunnel (the conveyor carries the driver's
  // side wheels, so the car sits a touch toward the driver's side).
  z: -0.35,
  // Feet per second on the conveyor. Real tunnels run about 1; this is sped up so a
  // whole pass takes under a minute.
  speed: 3.6,
  wheelRadius: 1.2,
  wheelbase: 9.4,
} as const

// Roofline: height above the floor at dx feet from the car's center, 0 outside the car.
// An SUV: tall nose, hood, windshield rake, long flat roof, upright tail.
const PROFILE: Array<[dx: number, y: number]> = [
  [-7.8, 0], [-7.75, 2.9], [-7.4, 4.6], [-6.6, 5.55], [-1.5, 5.7], [1.6, 5.6], [3.6, 3.75], [6.9, 3.4], [7.6, 2.7], [7.8, 0],
]

export function carHeightAt(dx: number): number {
  if (dx <= PROFILE[0][0] || dx >= PROFILE[PROFILE.length - 1][0]) return 0
  for (let k = 1; k < PROFILE.length; k++) {
    const [x1, y1] = PROFILE[k]
    if (dx <= x1) {
      const [x0, y0] = PROFILE[k - 1]
      return y0 + ((y1 - y0) * (dx - x0)) / (x1 - x0)
    }
  }
  return 0
}

export const CAR_PROFILE: ReadonlyArray<readonly [number, number]> = PROFILE

// Half the car's width at dx (it narrows a little at the nose and tail), 0 outside it.
export function carHalfWidthAt(dx: number): number {
  const half = CAR.length / 2
  if (Math.abs(dx) >= half) return 0
  const fromEnd = half - Math.abs(dx)
  return (CAR.width / 2) * (fromEnd > 1.4 ? 1 : 0.86 + 0.14 * (fromEnd / 1.4))
}
