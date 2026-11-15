import type { Model, ModelBuilder, ModelInput } from '../types'
import { arch, blaster, tireShine } from './arches'
import { equipment, label, room, vacuum } from './backroom'
import { shortBrush, sideBrush, topBrush, wheelBrush } from './brushes'
import { conveyor, rollerDown, rollerUp } from './conveyor'
import { blower } from './dryers'
import { photoEye, prepUnit, sensor } from './entrance'
import { fallback } from './fallback'
import { wrap } from './wrap'

// Which model draws which kind of shape (the kinds are the keys of SHAPES in
// ../../shapes.tsx). Each group of kinds lives in its own file, so the people building
// them never edit this one. A kind that isn't listed gets the generic fallback.

const BUILDERS: Record<string, ModelBuilder> = {
  conveyor,
  roller_up: rollerUp,
  roller_down: rollerDown,
  photo_eye: photoEye,
  sensor,
  prep_unit: prepUnit,
  arch,
  blaster,
  tire_shine: tireShine,
  wheel_brush: wheelBrush,
  wrap,
  top_brush: topBrush,
  side_brush: sideBrush,
  short_brush: shortBrush,
  blower,
  equipment,
  vacuum,
  room,
  label,
}

export function buildModel(input: ModelInput): Model {
  const build = BUILDERS[input.item.kind] ?? fallback
  try {
    return build(input)
  } catch (e) {
    // One broken model must not take the whole tunnel down with it.
    console.error(`[tunnel3d] model "${input.item.kind}" failed, drawing the fallback`, e)
    return fallback(input)
  }
}

export const MODEL_KINDS = Object.keys(BUILDERS)
