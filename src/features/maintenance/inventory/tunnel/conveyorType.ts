import type { TunnelItem, TunnelSide } from '@/lib/queries/miTunnel'
import { CAR } from './three/car'

// What kind of conveyor a 'conveyor' shape stands for. It lives on the shape as
// props.conveyor_type, saved with the drawing like any other prop. Anything but 'belt'
// (missing, or a value from some later version) is a chain, so every drawing made before
// there was a choice stays a chain. The 2D drawing, the editor and the 3D model all read
// it through conveyorType(), and none of this pulls three.js into the 2D bundle.

export type ConveyorType = 'chain' | 'belt'

export const conveyorType = (props: Record<string, unknown> | null | undefined): ConveyorType =>
  props?.conveyor_type === 'belt' ? 'belt' : 'chain'

export const CONVEYOR_TYPES: Record<ConveyorType, { label: string; hint: string }> = {
  chain: { label: 'Chain', hint: "Chain: the driver's side tires ride a narrow track, and a roller on the chain comes up behind each one and pushes the car." },
  belt: { label: 'Belt', hint: "Belt: the car rides on two flat moving belts, one under each side's tires, with no rollers and no guide rail." },
}

// vehicle.ts puts each wheel's center this far either side of the car's centerline.
const WHEEL_SPREAD = CAR.width / 2 - 0.5

// A dual 30 inch belt conveyor (Tommy's Transporter, Sonny's FlowLine WB30, AVW Dual Belt)
// across the tunnel, in feet out from its centerline, which is the car's: the fiberglass
// grating in the middle, then on each side a steel edge channel, a gap, the belt, a gap,
// another channel, and the frame's top out to the pit wall. The car's tires land just
// outboard of each belt's middle, well inside it, as they do on the real thing.
export const BELT = {
  grate: 0.85,
  rail: 0.15,
  gap: 0.06,
  wide: 2.5,
  frame: 0.3,
} as const
// The middle of each belt, and half the whole conveyor's width.
export const BELT_MID = BELT.grate + BELT.rail + BELT.gap + BELT.wide / 2
export const BELT_HALF = BELT.grate + 2 * (BELT.rail + BELT.gap) + BELT.wide + BELT.frame
// A row of pushers crosses the belts every quarter wheelbase (28 in, AVW's pitch), so
// both of a car's tires sit the same way between two rows.
export const BELT_PITCH = CAR.wheelbase / 4

// Where each type's shape goes across the tunnel. A chain runs under the driver's side
// wheels; a belt conveyor is centered on the car and covers both belts, to the half foot.
// The 3D belts always run under the car's wheels, wherever the shape is: this only keeps
// the 2D drawing in step with them.
export function conveyorFootprint(type: ConveyorType): Pick<TunnelItem, 'y_ft' | 'h_ft' | 'side'> {
  return type === 'belt'
    ? { y_ft: CAR.z, h_ft: Math.ceil(BELT_HALF * 4) / 2, side: 'center' }
    : { y_ft: Math.round((CAR.z - WHEEL_SPREAD) * 2) / 2, h_ft: 1.6, side: 'ds' }
}

// Where the shape stood while it was a chain, kept on it as props.chain_at while it is a
// belt, so switching back puts it there again even after the drawing has been saved (a
// site whose chain was drawn somewhere else would otherwise lose that by trying Belt).
type ChainAt = { y_ft: number; side: TunnelSide; across: number }
const SIDES: TunnelSide[] = ['ds', 'ps', 'center', 'both', 'outside']
function chainAt(v: unknown): ChainAt | null {
  if (!v || typeof v !== 'object') return null
  const { y_ft, side, across } = v as Record<string, unknown>
  return typeof y_ft === 'number' && typeof across === 'number' && across > 0 && SIDES.includes(side as TunnelSide)
    ? { y_ft, side: side as TunnelSide, across }
    : null
}

// The change that makes a conveyor shape the other type: the prop, and the footprint that
// goes with it (across the tunnel, which is w_ft when the shape is turned). Beside the
// tunnel (a spare) there is no car to line up with, so only its width changes.
export function conveyorPatch(item: Pick<TunnelItem, 'props' | 'rotation' | 'side' | 'y_ft' | 'w_ft' | 'h_ft'>, type: ConveyorType): Partial<TunnelItem> {
  const turned = item.rotation === 90 || item.rotation === 270
  const across = (v: number) => (turned ? { w_ft: v } : { h_ft: v })
  const beside = item.side === 'outside'
  const { chain_at, ...props } = item.props ?? {}
  if (type === 'belt') {
    const was: unknown = conveyorType(item.props) === 'chain' ? { y_ft: Number(item.y_ft), side: item.side, across: Number(turned ? item.w_ft : item.h_ft) } : chain_at
    const { y_ft, h_ft, side } = conveyorFootprint('belt')
    return { props: { ...props, conveyor_type: 'belt', ...(chainAt(was) ? { chain_at: was } : {}) }, ...(beside ? {} : { y_ft, side }), ...across(h_ft) }
  }
  // Back where it stood as a chain. One that stood beside the tunnel and has since been
  // brought into it goes where the template puts a chain instead.
  const saved = chainAt(chain_at)
  const def = conveyorFootprint('chain')
  const to = saved && (beside || saved.side !== 'outside') ? saved : { y_ft: def.y_ft, side: def.side, across: def.h_ft }
  return { props: { ...props, conveyor_type: 'chain' }, ...(beside ? {} : { y_ft: to.y_ft, side: to.side }), ...across(to.across) }
}

const isBelt = (i: Pick<TunnelItem, 'kind' | 'props'>) => i.kind === 'conveyor' && conveyorType(i.props) === 'belt'

// A belt conveyor in the tunnel can't be moved across it. The 3D belts always run under
// the car's wheels, so a shape moved off the car's line would put its status pad and the
// 2D drawing where the belts aren't. Beside the tunnel (a spare) it goes anywhere.
export const acrossLocked = (i: Pick<TunnelItem, 'kind' | 'props' | 'side'>) => isBelt(i) && i.side !== 'outside'

// What the editor keeps true after every change: a belt conveyor in the tunnel stays on
// the car's line (acrossLocked), whatever moved it. (The 2D drawing puts belts under the
// machines itself, TunnelDiagram's draw order.) The same array comes back when there is
// nothing to change.
export function tidyBelts(items: TunnelItem[]): TunnelItem[] {
  const y = conveyorFootprint('belt').y_ft
  const off = (i: TunnelItem) => acrossLocked(i) && Number(i.y_ft) !== y
  return items.some(off) ? items.map((i) => (off(i) ? { ...i, y_ft: y } : i)) : items
}
