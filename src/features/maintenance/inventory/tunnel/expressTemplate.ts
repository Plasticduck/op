import type { TunnelSave, TunnelSide, TunnelZone } from '@/lib/queries/miTunnel'

// The standard express exterior tunnel, as Mighty Wash runs it: the order approved on
// 2026-11-11 as a starting point, built from the 30 machines MaintainX lists at every site.
// Each shape's match type is the MaintainX type, so applying this to a site links each
// shape to that site's machine. Shapes with no match type (presoak, protectant, tire
// shine) have no MaintainX record yet: they're drawn dashed until someone links them.
// Distances are a good-enough guess; each site's copy can be dragged to match.

export const EXPRESS_TEMPLATE_NAME = 'Express tunnel (standard)'

const ZONES: TunnelZone[] = [
  { name: 'Prep', x_from: -28, x_to: -2 },
  { name: 'Entrance', x_from: -2, x_to: 11 },
  { name: 'Wash', x_from: 11, x_to: 77 },
  { name: 'Rinse and protect', x_from: 77, x_to: 98 },
  { name: 'Dryers', x_from: 98, x_to: 127 },
  { name: 'Exit', x_from: 127, x_to: 140 },
]

type Row = [kind: string, label: string, x: number, y: number, w: number, h: number, side: TunnelSide, zone: string | null, match: string | null, props?: Record<string, unknown>]

const ROWS: Row[] = [
  ['conveyor', 'Conveyor', 64, -3, 140, 1.6, 'ds', null, 'Chain'],
  ['roller_up', 'Roller Up', -3, -3, 6, 3, 'ds', 'Entrance', 'Roller Up Assembly'],
  ['prep_unit', 'Bug Prep', -16, -11.5, 5, 3.5, 'outside', 'Prep', 'Bug Prep Unit'],
  ['prep_unit', 'Prep Guns', -16, 11.5, 5, 3.5, 'outside', 'Prep', 'Prep Gun Unit'],
  ['photo_eye', 'Entrance Eyes', 1.5, 0, 1, 16, 'both', 'Entrance', 'Photo Eyes (Entrance)'],
  ['sensor', 'Truck Bed Sensor', 5, 0, 1, 16, 'both', 'Entrance', 'Truck Bed Sensor'],
  ['arch', 'Presoak', 9, 0, 1.5, 16, 'both', 'Entrance', null],
  ['blaster', 'HP Blaster', 14, 0, 3, 16, 'both', 'Wash', 'High Pressure Blaster'],
  ['wheel_brush', 'Wheel Boss DS', 20, -6.3, 4, 2.2, 'ds', 'Wash', 'Wheel Boss DS'],
  ['wheel_brush', 'Wheel Boss PS', 20, 6.3, 4, 2.2, 'ps', 'Wash', 'Wheel Boss PS'],
  ['wrap', 'Wrap DS1', 26, -4.6, 5, 5, 'ds', 'Wash', 'Wrap Driver Side 1'],
  ['wrap', 'Wrap PS1', 29, 4.6, 5, 5, 'ps', 'Wash', 'Wrap Passenger Side 1'],
  ['top_brush', 'Top Brush 1', 35, 0, 3.5, 13, 'center', 'Wash', 'Top Brush 1'],
  ['side_brush', 'Gloss Boss DS', 42, -5.8, 4, 4, 'ds', 'Wash', 'Gloss Boss DS'],
  ['side_brush', 'Gloss Boss PS', 42, 5.8, 4, 4, 'ps', 'Wash', 'Gloss Boss PS'],
  ['short_brush', 'Short Brush', 50, 0, 2.5, 9, 'center', 'Wash', 'Short Brush'],
  ['side_brush', 'Van High', 56, -6, 3.5, 3.5, 'ds', 'Wash', 'Van High', { tall: true }],
  ['wrap', 'Wrap DS2', 63, -4.6, 5, 5, 'ds', 'Wash', 'Wrap Driver Side 2'],
  ['wrap', 'Wrap PS2', 66, 4.6, 5, 5, 'ps', 'Wash', 'Wrap Passenger Side 2'],
  ['top_brush', 'Top Brush 2', 72, 0, 3.5, 13, 'center', 'Wash', 'Top Brush 2'],
  ['arch', 'Protectant', 80, 0, 1.5, 16, 'both', 'Rinse and protect', null],
  ['tire_shine', 'Tire Shine DS', 85, -6.6, 3, 1.6, 'ds', 'Rinse and protect', null],
  ['tire_shine', 'Tire Shine PS', 85, 6.6, 3, 1.6, 'ps', 'Rinse and protect', null],
  ['arch', 'R.O. Rinse', 91, 0, 1.5, 16, 'both', 'Rinse and protect', 'R.O. Rinse'],
  ['arch', 'Spot Free Rinse', 95, 0, 1.5, 16, 'both', 'Rinse and protect', 'Spot Free Rinse'],
  ['blower', 'Dryers', 112.5, 0, 25, 16, 'both', 'Dryers', 'Blower Assembly'],
  ['roller_down', 'Roller Down', 131, -3, 6, 3, 'ds', 'Exit', 'Roller Down Assembly'],
  // Set back from the passenger-side wall so the names along it have room.
  ['room', 'Equipment Room', 58, 31, 40, 17, 'outside', 'Equipment room', null],
  ['equipment', 'Hydra Flex', 44, 27.5, 8, 6, 'outside', 'Equipment room', 'Hydra Flex'],
  ['equipment', 'R.O. Unit', 53, 27.5, 8, 6, 'outside', 'Equipment room', 'R.O. Unit'],
  ['equipment', 'Water Softener', 62, 27.5, 8, 6, 'outside', 'Equipment room', 'Water Softener System'],
  ['equipment', 'Customer Air', 71, 27.5, 8, 6, 'outside', 'Equipment room', 'Customer Air Comp'],
  ['equipment', 'Air Comp 1', 44, 35, 8, 6, 'outside', 'Equipment room', 'Air Comp 1'],
  ['equipment', 'Air Comp 2', 53, 35, 8, 6, 'outside', 'Equipment room', 'Air Comp 2'],
  ['equipment', 'Air Compressor', 62, 35, 8, 6, 'outside', 'Equipment room', 'Air Compressor'],
  ['room', 'Vacuums', 110, 31, 30, 13, 'outside', 'Vacuums', null],
  ['vacuum', 'Turbine 1', 101, 32, 7, 6, 'outside', 'Vacuums', 'Vacuum Turbine 1'],
  ['vacuum', 'Turbine 2', 110, 32, 7, 6, 'outside', 'Vacuums', 'Vacuum Turbine 2'],
  ['vacuum', 'Accessories', 119, 32, 7, 6, 'outside', 'Vacuums', 'Vacuum Accessories'],
]

export function expressTemplate(): TunnelSave {
  return {
    is_template: true,
    name: EXPRESS_TEMPLATE_NAME,
    length_ft: 134,
    width_ft: 16,
    zones: ZONES,
    items: ROWS.map(([kind, label, x, y, w, h, side, zone, match, props], i) => ({
      kind, label, x_ft: x, y_ft: y, w_ft: w, h_ft: h, rotation: 0, side, zone, match_type: match, asset_id: null, sort_order: i, props: props ?? {},
    })),
  }
}
