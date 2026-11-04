import { buildLabelsPdf, type PrintTemplate } from '@/lib/labels/labelPdf'
import type { LabelContent } from '@/lib/labels/layout'
import { VEHICLE_STICKER_BASE } from '@/lib/queries/fleet'

// Dash stickers for QR self-assign, drawn by the same label engine as IT
// Inventory stickers. Fixed stocks with no calibration (IT's printer setup is
// per IT template and behind IT access), so print at 100%.
export type StickerStock = { id: string; name: string; template: PrintTemplate }

export const STICKER_STOCKS: StickerStock[] = [
  {
    id: 'avery5163',
    name: 'Avery 5163 sheet, 2" x 4" (10 per page)',
    template: {
      name: 'Avery 5163',
      page_spec: {
        page: { w_mm: 215.9, h_mm: 279.4 },
        label: { w_mm: 101.6, h_mm: 50.8 },
        cols: 2,
        rows: 5,
        margin_top_mm: 12.7,
        margin_left_mm: 3.96875,
        pitch_x_mm: 104.775,
        pitch_y_mm: 50.8,
      },
      layout: { style: 'standard', show: ['tag', 'name', 'site'] },
      offset_x_mm: 0,
      offset_y_mm: 0,
      scale: 1,
    },
  },
  {
    id: 'roll2x2',
    name: 'Label printer roll, 2" x 2"',
    template: {
      name: '2 x 2 roll',
      page_spec: {
        page: null,
        label: { w_mm: 50.8, h_mm: 50.8 },
        cols: 1,
        rows: 1,
        margin_top_mm: 0,
        margin_left_mm: 0,
        pitch_x_mm: 50.8,
        pitch_y_mm: 50.8,
      },
      // A square is too narrow for text beside the QR: big QR, code and name under it.
      layout: { style: 'outdoor', show: ['tag', 'name'] },
      offset_x_mm: 0,
      offset_y_mm: 0,
      scale: 1,
    },
  },
]

export const vehicleSticker = (code: string, vehicleName: string): LabelContent => ({
  tag: code,
  url: `${VEHICLE_STICKER_BASE}${code}`,
  name: vehicleName,
  site: 'Scan to drive this vehicle',
})

export function buildVehicleStickersPdf(stock: StickerStock, items: LabelContent[]) {
  return buildLabelsPdf(stock.template, items)
}
