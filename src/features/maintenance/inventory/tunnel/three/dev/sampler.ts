import { Group } from 'three'
import type { FoamBrush, Materials, Spray } from '../kit'
import type { ModelBuilder } from '../types'

// Everything in the kit, laid out on one slab: open the preview with kind=_kit. Four rows,
// back to front: every shared material, every shape and assembly, foam brushes on each
// axis (stopped on the left of each pair, at the given activity on the right), and the
// four kinds of spray. Dev only: it shows model authors what they have to build with,
// and it's where a change to the kit gets looked at.

export const kitSampler: ModelBuilder = ({ kit }) => {
  const m = kit.mat
  const root = new Group()
  root.name = 'kit-sampler'
  const fixed = new Group()
  const label = (text: string, x: number, z: number, w = 1.5) => {
    const s = kit.sign(text, w, 0.3)
    s.rotation.x = -Math.PI / 2
    s.position.set(x, 0.02, z)
    s.castShadow = false
    fixed.add(s)
  }

  // Row 1: materials.
  const names = Object.keys(m) as Array<keyof Materials>
  const perRow = Math.ceil(names.length / 2)
  names.forEach((name, k) => {
    const x = -21 + (k % perRow) * 2.8
    const z = k < perRow ? -11 : -8
    fixed.add(kit.cyl(0.55, 1.1, m[name], { bevel: 0.14 }).translateX(x).translateY(0.55).translateZ(z))
    fixed.add(kit.box(0.8, 0.8, 0.8, m[name], 0.08).translateX(x + 1.1).translateY(0.4).translateZ(z))
    label(name, x + 0.5, z + 1.1, 2.2)
  })

  // Row 2: shapes and assemblies.
  let x = -21
  const at = (text: string, width: number) => {
    const c = x + width / 2
    label(text, c, -1.7, Math.max(1.4, text.length * 0.2))
    x += width + 1.2
    return c
  }
  let c = at('box', 1.2)
  fixed.add(kit.box(1.2, 1.6, 1, m.frame, 0.06).translateX(c).translateY(0.8).translateZ(-4))
  c = at('beam', 2)
  fixed.add(kit.beam([c - 1, 0.2, -4], [c + 1, 2.6, -4], [0.3, 0.2], m.frame))
  c = at('cyl', 1)
  fixed.add(kit.cyl(0.45, 1.8, m.aluminum, { r2: 0.3 }).translateX(c).translateY(0.9).translateZ(-4))
  c = at('rod', 1.6)
  fixed.add(kit.rod([c - 0.8, 0.3, -4.4], [c + 0.8, 2.2, -3.6], 0.08, m.stainless))
  c = at('tube', 3.4)
  fixed.add(kit.tube([[c - 1.7, 0, -4], [c - 1.7, 3.6, -4], [c + 1.7, 3.6, -4], [c + 1.7, 0, -4]], 0.11, m.stainless, { bend: 1 }))
  c = at('hose', 3)
  fixed.add(kit.rod([c - 1.5, 0, -4], [c - 1.5, 3, -4], 0.07, m.galvanized), kit.rod([c + 1.5, 0, -4], [c + 1.5, 3.4, -4], 0.07, m.galvanized))
  fixed.add(kit.hose([c - 1.5, 2.9, -4], [c + 1.5, 3.3, -4], 0.05, m.hoseRed, 0.22))
  fixed.add(kit.paint(kit.hose([c - 1.5, 2.3, -4], [c + 1.5, 2.6, -4], 0.04, m.frame, 0.1), 'hoseBlue'))
  c = at('plate + gusset', 2.2)
  fixed.add(kit.plate(1.6, 1.2, 0.08, m.galvanized).translateX(c).translateZ(-4))
  fixed.add(kit.gusset(1, 0.06, m.frame).translateX(c - 0.5).translateY(0.08).translateZ(-4))
  c = at('basePlate', 1.4)
  fixed.add(kit.basePlate(1.2, 1).translateX(c).translateZ(-4))
  c = at('portalFrame', 1)
  fixed.add(kit.portalFrame({ z1: -5.4, z2: -2.6, height: 4.6, tube: 0.3 }).translateX(c))
  c = at('motor', 1.2)
  fixed.add(kit.motor().translateX(c).translateY(0.05).translateZ(-4))
  c = at('airCylinder', 2.6)
  const ram = kit.airCylinder({ body: 1.6, stroke: 1.2 })
  ram.aim(c - 1.2, 0.4, -4, c + 1.2, 2.2, -4)
  fixed.add(ram.root)
  c = at('bearing', 1)
  fixed.add(kit.bearing(0.4).translateX(c).translateY(0.2).translateZ(-4))
  c = at('sign', 2.6)
  fixed.add(kit.sign('Top Brush 1', 2.6, 0.5).translateX(c).translateY(1.2).translateZ(-4))
  // Lamps: one of each color lit, and one dark. They stay out of the merge.
  c = at('lamp', 1.6)
  fixed.add(kit.paint(kit.box(1.6, 0.5, 0.5, m.frame, 0.04), 'dark').translateX(c).translateY(0.25).translateZ(-4))
  for (const [k, color] of (['green', 'amber', 'red', 'red'] as const).entries()) {
    const lamp = kit.lamp(color, 0.14)
    lamp.root.position.set(c - 0.6 + k * 0.4, 0.5, -4)
    lamp.set(k < 3)
    root.add(lamp.root)
  }
  // Any color at all, straight from the sign atlas.
  c = at('paint #hex', 2)
  fixed.add(kit.paint(kit.cyl(0.4, 1.2, m.frame), '#ff9ec4').translateX(c - 0.5).translateY(0.6).translateZ(-4))
  fixed.add(kit.paint(kit.cyl(0.4, 1.2, m.frame), '#7c3aed').translateX(c + 0.5).translateY(0.6).translateZ(-4))

  // Row 3: foam brushes, one pair per axis. Each hangs from a goalpost.
  const brushes: FoamBrush[] = []
  const lively: FoamBrush[] = []
  const pair = (axis: 'x' | 'y' | 'z', cx: number, text: string) => {
    label(text, cx, 9.2, 4.4)
    for (const [k, dx] of [-3.6, 3.6].entries()) {
      const upright = axis === 'y'
      const b = kit.foamBrush({
        axis, length: upright ? 6 : 5, diameter: upright ? 4.4 : 3.8, tiers: upright ? 8 : 9, perTier: upright ? 26 : 20,
        colors: ['#2f4fd0', '#2f4fd0', '#4a78f0'], seed: 4 + k, floor: upright ? 3.2 : 4.2,
      })
      const y = upright ? 3.3 : 4.3
      b.root.position.set(cx + dx, y, 5)
      root.add(b.root)
      brushes.push(b)
      if (k === 1) lively.push(b)
      // The shaft's ends rest on two posts (or hang from one, for an upright brush).
      if (upright) fixed.add(kit.rod([cx + dx, y, 5], [cx + dx, 7, 5], 0.07, m.stainless), kit.beam([cx + dx - 0.6, 7.1, 5], [cx + dx + 0.6, 7.1, 5], 0.2, m.frame))
      else {
        const ax = axis === 'x' ? 2.9 : 0
        const az = axis === 'z' ? 2.9 : 0
        for (const sgn of [-1, 1]) fixed.add(kit.beam([cx + dx + sgn * ax, 0, 5 + sgn * az], [cx + dx + sgn * ax, y + 0.2, 5 + sgn * az], 0.2, m.frame))
        fixed.add(kit.rod([cx + dx - ax, y, 5 - az], [cx + dx + ax, y, 5 + az], 0.06, m.stainless))
      }
      kit.blob(root, upright ? 4.4 : 5, upright ? 4.4 : 3.8, { x: cx + dx, z: 5, shape: upright ? 'round' : 'box', cast: upright ? 6 : 5 })
    }
  }
  pair('y', -14, "foamBrush axis 'y'")
  pair('z', 1, "foamBrush axis 'z'")
  pair('x', 16, "foamBrush axis 'x'")

  // Row 4: spray.
  const sprays: Spray[] = []
  for (const [k, kind] of (['fan', 'jet', 'mist', 'foam'] as const).entries()) {
    const sx = -16 + k * 10
    label(`spray '${kind}'`, sx, 14.6, 3)
    fixed.add(kit.rod([sx - 2.5, 0, 12.5], [sx - 2.5, 5.2, 12.5], 0.08, m.stainless))
    const nozzles = kind === 'foam'
      ? Array.from({ length: 6 }, (_, n) => ({ at: [sx - 2 + n * 0.8, 5, 12.5] as const, dir: [0, -1, 0] as const, across: [1, 0, 0] as const }))
      : [1.6, 3, 4.4].map((h) => ({ at: [sx - 2.4, h, 12.5] as const, dir: [1, kind === 'mist' ? 0.2 : -0.05, 0] as const }))
    if (kind === 'foam') fixed.add(kit.rod([sx - 2.5, 5.1, 12.5], [sx + 2.6, 5.1, 12.5], 0.06, m.stainless))
    const s = kit.spray({ kind, nozzles, reach: kind === 'foam' ? 4.6 : 5, color: kind === 'foam' ? '#ff9ec4' : undefined, seed: 3 + k })
    root.add(s.root)
    sprays.push(s)
  }

  root.add(kit.mergeStatic(fixed))
  return {
    root,
    height: 8,
    update(st) {
      for (const b of lively) {
        b.setSpin(st.activity)
        b.advance(st.dt)
      }
      for (const s of sprays) s.setActivity(st.activity)
    },
    dispose() {
      for (const b of brushes) b.dispose()
    },
  }
}
