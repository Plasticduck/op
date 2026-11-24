// Deterministic sin, cos and hypot for the simulation and the levels.
//
// The language leaves Math.sin, Math.cos, Math.hypot (and tan, atan2, exp, pow, log, **) to each
// engine, and they disagree in the last bit: Chrome and Node differ on about one input in 30. A
// droplet's angle or a grackle's wave a bit off grows into a different run after a few thousand
// ticks, so a replay made in Node would not play the same in the browser. These are built from
// + - * / and sqrt only, which IEEE 754 makes exact everywhere.
//
// sin and cos are fdlibm's (the port V8 uses, so for |x| up to 2^19 * pi/2 they give the very bits
// Node 24's Math.sin and Math.cos give, and the simulation's numbers did not move). Past that, a
// plain reduction takes over: still deterministic, within 1e-12 up to |x| = 1e9, and no game
// timer gets there in 40 hours of play. sim.mjs checks both, and scans sim/** and levels/** for
// any use of the engine's own.

// Reading a double's high word. DataView is big-endian by default on every machine.
const view = new DataView(new ArrayBuffer(8))
function hiWord(x: number): number {
  view.setFloat64(0, x)
  return view.getInt32(0)
}
function fromHiWord(h: number): number {
  view.setInt32(0, h)
  view.setInt32(4, 0)
  return view.getFloat64(0)
}

const S1 = -1.66666666666666324348e-1
const S2 = 8.33333333332248946124e-3
const S3 = -1.98412698298579493134e-4
const S4 = 2.75573137070700676789e-6
const S5 = -2.50507602534068634195e-8
const S6 = 1.58969099521155010221e-10
const C1 = 4.16666666666666019037e-2
const C2 = -1.38888888888741095749e-3
const C3 = 2.48015872894767294178e-5
const C4 = -2.75573143513906633035e-7
const C5 = 2.08757232129817482790e-9
const C6 = -1.13596475577881948265e-11
const INV_PIO2 = 6.36619772367581382433e-1
const PIO2_1 = 1.57079632673412561417
const PIO2_1T = 6.07710050650619224932e-11
const PIO2_2 = 6.07710050630396597660e-11
const PIO2_2T = 2.02226624879595063154e-21
const PIO2_3 = 2.02226624871116645580e-21
const PIO2_3T = 8.47842766036889956997e-32
// High words of n * pi/2 for n = 1..32: where the medium reduction needs its extra steps.
const NPIO2_HW = [
  0x3ff921fb, 0x400921fb, 0x4012d97c, 0x401921fb, 0x401f6a7a, 0x4022d97c, 0x4025fdbb, 0x402921fb, 0x402c463a, 0x402f6a7a, 0x4031475c, 0x4032d97c, 0x40346b9c, 0x4035fdbb, 0x40378fdb, 0x403921fb,
  0x403ab41b, 0x403c463a, 0x403dd85a, 0x403f6a7a, 0x40407e4c, 0x4041475c, 0x4042106c, 0x4042d97c, 0x4043a28c, 0x40446b9c, 0x404534ac, 0x4045fdbb, 0x4046c6cb, 0x40478fdb, 0x404858eb, 0x404921fb,
]
// pi/2 in pieces of at most 21 significant bits (from pi's hex digits), so n * piece is exact for n below 2^32.
const PIO2_PIECES = [1.570796012878418, 3.1391618904308416e-7, 2.89607313824769e-13, 8.333741273895185e-20, 1.644622145585423e-26, 3.5480463208383466e-32, 6.81898737670971e-39]

function kernelSin(x: number, y: number, iy: number): number {
  const ix = hiWord(x) & 0x7fffffff
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return x
  const z = x * x
  const v = z * x
  const r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6)))
  if (iy === 0) return x + v * (S1 + z * r)
  return x - (z * (0.5 * y - v * r) - y - v * S1)
}

function kernelCos(x: number, y: number): number {
  const ix = hiWord(x) & 0x7fffffff
  if (ix < 0x3e400000 && Math.trunc(x) === 0) return 1
  const z = x * x
  const r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))))
  if (ix < 0x3fd33333) return 1 - (0.5 * z - (z * r - x * y))
  const qx = ix > 0x3fe90000 ? 0.28125 : fromHiWord(ix - 0x00200000)
  const iz = 0.5 * z - qx
  const a = 1 - qx
  return a - (iz - (z * r - x * y))
}

// x less n * pi/2, as a head and a tail: set by remPio2, which returns n.
let y0 = 0
let y1 = 0

function remPio2(x: number): number {
  const hx = hiWord(x)
  const ix = hx & 0x7fffffff
  if (ix < 0x4002d97c) {
    let z: number
    if (hx > 0) {
      z = x - PIO2_1
      if (ix !== 0x3ff921fb) {
        y0 = z - PIO2_1T
        y1 = z - y0 - PIO2_1T
      } else {
        z -= PIO2_2
        y0 = z - PIO2_2T
        y1 = z - y0 - PIO2_2T
      }
      return 1
    }
    z = x + PIO2_1
    if (ix !== 0x3ff921fb) {
      y0 = z + PIO2_1T
      y1 = z - y0 + PIO2_1T
    } else {
      z += PIO2_2
      y0 = z + PIO2_2T
      y1 = z - y0 + PIO2_2T
    }
    return -1
  }
  if (ix > 0x413921fb) return remLarge(x)
  let t = Math.abs(x)
  const n = Math.trunc(t * INV_PIO2 + 0.5)
  let r = t - n * PIO2_1
  let w = n * PIO2_1T
  if (n < 32 && ix !== NPIO2_HW[n - 1]) {
    y0 = r - w
  } else {
    const j = ix >> 20
    y0 = r - w
    let i = j - ((hiWord(y0) >> 20) & 0x7ff)
    if (i > 16) {
      t = r
      w = n * PIO2_2
      r = t - w
      w = n * PIO2_2T - (t - r - w)
      y0 = r - w
      i = j - ((hiWord(y0) >> 20) & 0x7ff)
      if (i > 49) {
        t = r
        w = n * PIO2_3
        r = t - w
        w = n * PIO2_3T - (t - r - w)
        y0 = r - w
      }
    }
  }
  y1 = r - y0 - w
  if (hx < 0) {
    y0 = -y0
    y1 = -y1
    return -n
  }
  return n
}

/** Past fdlibm's medium range (it would hand over to a big table): pi/2 piece by piece. */
function remLarge(x: number): number {
  const t = Math.abs(x)
  const n = Math.floor(t * INV_PIO2 + 0.5)
  let r = t
  for (let i = 0; i < PIO2_PIECES.length; i++) r -= n * PIO2_PIECES[i]
  y0 = x < 0 ? -r : r
  y1 = 0
  // The quadrant only needs n modulo 4, which survives the conversion to 32 bits.
  return x < 0 ? -(n % 4) : n % 4
}

/** Math.sin, the same in every engine. */
export function sin(x: number): number {
  const ix = hiWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) return kernelSin(x, 0, 0)
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x)
  switch (n & 3) {
    case 0:
      return kernelSin(y0, y1, 1)
    case 1:
      return kernelCos(y0, y1)
    case 2:
      return -kernelSin(y0, y1, 1)
    default:
      return -kernelCos(y0, y1)
  }
}

/** Math.cos, the same in every engine. */
export function cos(x: number): number {
  const ix = hiWord(x) & 0x7fffffff
  if (ix <= 0x3fe921fb) return kernelCos(x, 0)
  if (ix >= 0x7ff00000) return x - x
  const n = remPio2(x)
  switch (n & 3) {
    case 0:
      return kernelCos(y0, y1)
    case 1:
      return -kernelSin(y0, y1, 1)
    case 2:
      return -kernelCos(y0, y1)
    default:
      return kernelSin(y0, y1, 1)
  }
}

/** The length of (x, y). Math.hypot's rounding is the engine's choice; this one is IEEE's. */
export function hypot(x: number, y: number): number {
  return Math.sqrt(x * x + y * y)
}
