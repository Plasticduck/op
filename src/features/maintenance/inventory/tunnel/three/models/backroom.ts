import { Group } from 'three'
import { CAR } from '../car'
import type { Model, ModelBuilder, ModelInput } from '../types'
import { compressor, customerAir } from './backroomAir'
import { createRig, towardTunnel, TONE } from './backroomParts'
import type { Design } from './backroomParts'
import { controlCabinet, hydraFlex, powerPack, pumpStation, reclaim, skidUnit } from './backroomPlant'
import { accessories, turbine } from './backroomVacuum'
import { roUnit, softener, waterHeater } from './backroomWater'
import { fallback } from './fallback'

export { label, room } from './backroomScenery'

// Everything beside the tunnel: the equipment room's machines, the vacuum plant, and the
// two kinds of scenery that frame them (a room, a line of text on the floor).
//
// None of these reach for the car. They stand in a room off the passenger side and, when
// they are up, simply run: a flywheel turns, a gauge holds its pressure, a pilot light is
// lit. Down, everything is still and dark.
//
// One builder serves every `equipment` shape. Which machine it draws comes from the
// shape's label and machine type (see `designFor`): a chemical wall, an R.O. skid, a
// water softener, air compressors, and so on, with a plain machine skid for anything it
// doesn't recognise.
//
// Each machine is DESIGNED at real size, in feet, for the standard 8 by 6 ft tile, with
// its front toward +z (the side the overview camera sees). `machine()` then fits the
// design to the shape it was given: it shrinks it evenly when the shape is smaller than
// the design needs, turns it a quarter when the shape is deep and narrow, and lets it
// grow a little on a much larger shape. A design is never stretched. Designs that are a
// row of something (drums along a wall, cabinet sections, pumps on a skid) add units
// along the width they're given instead.
//
// The designs are in backroomAir.ts, backroomWater.ts, backroomPlant.ts and
// backroomVacuum.ts, the parts they're built from in backroomParts.ts, and the rooms and
// floor lettering in backroomScenery.ts.

const HALF = Math.PI / 2

// Fits a design to the shape and wraps it up as a model.
function machine(input: ModelInput, name: string, design: Design): Model {
  const { kit, w, h } = input
  const [nw, nd] = design.need
  const fit = Math.min((w - 0.3) / nw, (h - 0.3) / nd)
  const fitTurned = Math.min((w - 0.3) / nd, (h - 0.3) / nw)
  // A deep, narrow shape: stand the machine end on, its front toward the entrance.
  const quarter = fit < 1 && fitTurned > fit * 1.15
  const W0 = quarter ? h : w
  const D0 = quarter ? w : h
  const best = quarter ? fitTurned : fit
  const k = best < 1 ? Math.max(0.2, best) : Math.min(1.3, 1 + Math.max(0, Math.min(W0 / 8, D0 / 6) - 1) * 0.4)

  const root = new Group()
  root.name = name
  const body = new Group()
  body.scale.setScalar(k)
  if (quarter) body.rotation.y = -HALF
  root.add(body)

  const [tx, tz] = towardTunnel(input)
  const ax = quarter ? -tz : -tx
  const az = quarter ? tx : -tz
  const rig = createRig(kit, input.detail)
  const label = input.item.label.trim() || input.item.match_type?.trim() || 'Equipment'
  const twin = Number(/(\d+)\s*$/.exec(label)?.[1] ?? 1)
  const built = design.build(rig, {
    W: W0 / k, D: D0 / k, label, mirror: twin % 2 === 0 ? -1 : 1, body,
    lot: ax > 0.5 ? '+x' : ax < -0.5 ? '-x' : az < -0.5 ? '-z' : '+z',
  })
  rig.finish(body)

  const ticks = rig.ticks
  const [bx, by, bz] = built.beacon
  return {
    root,
    height: built.height * k,
    // The design's spot, carried through the fit.
    beacon: quarter ? { x: -bz * k, y: by * k, z: bx * k } : { x: bx * k, y: by * k, z: bz * k },
    update(s) {
      for (let i = 0; i < ticks.length; i++) ticks[i](s)
    },
  }
}

// A shape someone has drawn in the car's path gets the fallback's drive-over plate: none
// of these machines belongs under a car.
function inLane(input: ModelInput): boolean {
  const reach = CAR.width / 2 - 1.2
  return input.side !== 'outside' && input.y - input.h / 2 < CAR.z + reach && input.y + input.h / 2 > CAR.z - reach
}

// ---- Which machine a shape is -----------------------------------------------------------

// Told from the shape's label, whatever its case, or failing that from its machine type:
// what someone wrote on the drawing names the machine. The order matters where names
// overlap ("Reclaim Pump" is a reclaim system, "Pump Control Panel" a cabinet).
function designFor(input: ModelInput): Design {
  return designNamed(input.item.label) ?? designNamed(input.item.match_type ?? '') ?? skidUnit
}

function designNamed(name: string): Design | null {
  const text = name.toLowerCase()
  if (/hydra\s*-?\s*flex|chemical|dispens|injector/.test(text)) return hydraFlex
  if (/(^|[^a-z])r\.?\s*\/?\s*o\.?([^a-z]|$)|osmosis/.test(text)) return roUnit
  if (/soften/.test(text)) return softener
  if (/customer\s*air/.test(text)) return customerAir
  // The numbered compressors are the blue pair; "Air Compressor" is the charcoal one.
  if (/\bair\b|compress/.test(text)) return /\d/.test(text) ? compressor(TONE.drum, TONE.drum, 3) : compressor('dark', 'mid', 14)
  if (/hydraulic|power\s*pack|\bhpu\b/.test(text)) return powerPack
  if (/reclaim/.test(text)) return reclaim
  if (/heater|boiler/.test(text)) return waterHeater
  if (/controller|\bmcc\b|panel|\bvfd\b|\bplc\b|electrical|disconnect|motor control/.test(text)) return controlCabinet
  if (/pump/.test(text)) return pumpStation
  return null
}

// kind 'equipment': pumps, compressors, the R.O. unit, the chemical wall.
export const equipment: ModelBuilder = (input) => (inLane(input) ? fallback(input) : machine(input, 'equipment', designFor(input)))

// kind 'vacuum': turbines and the vacuum accessories. Anything that isn't called a
// turbine is the station customers use.
export const vacuum: ModelBuilder = (input) => {
  if (inLane(input)) return fallback(input)
  // As for equipment, the label speaks first.
  const plant = (name: string) => /turbine|producer|blower/.test(name.toLowerCase())
  const station = /accessor|station|hose|nozzle|canopy|arch/.test(input.item.label.toLowerCase())
  return machine(input, 'vacuum', plant(input.item.label) || (!station && plant(input.item.match_type ?? '')) ? turbine : accessories)
}
