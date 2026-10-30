// Proves IT Inventory stickers scan. For every seeded label template and a set
// of tags, lays out the sticker with the real layout code (src/lib/labels),
// rasterizes it at thermal (203 dpi) and laser (300 dpi) resolution, and
// decodes it with zxing (the library behind the in-app scanner). Fails if the
// QR doesn't read back as the sticker URL or the Code 128 as the tag. Stock
// that shows a logo is also tried with a wide and a tall logo, drawn as a
// solid black block, and fails if the logo touches the QR or the barcode.
//
// Run: node scripts/test-label-scans.mjs

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createServer } from 'vite'
import { prepareZXingModule, readBarcodesFromImageData } from 'zxing-wasm/reader'

const require = createRequire(import.meta.url)
prepareZXingModule({
  overrides: { wasmBinary: readFileSync(require.resolve('zxing-wasm/reader/zxing_reader.wasm')) },
})

// Same specs as it_bootstrap() in supabase/migrations/0198_it_sticker_logo_sizes.sql.
const STD = ['qr', 'barcode', 'tag', 'name', 'site']
const TEMPLATES = [
  ['Roll 2.25 x 1.25 in', { page: null, label: { w_mm: 57.15, h_mm: 31.75 } }, { style: 'standard', show: [...STD, 'logo'] }],
  ['Roll 2 x 1 in', { page: null, label: { w_mm: 50.8, h_mm: 25.4 } }, { style: 'standard', show: [...STD, 'logo'] }],
  ['Roll 3 x 2 in', { page: null, label: { w_mm: 76.2, h_mm: 50.8 } }, { style: 'standard', show: [...STD, 'phone', 'logo'] }],
  ['DYMO 30336', { page: null, label: { w_mm: 53.975, h_mm: 25.4 } }, { style: 'standard', show: [...STD, 'logo'] }],
  ['DYMO 30252', { page: null, label: { w_mm: 88.9, h_mm: 28.575 } }, { style: 'standard', show: [...STD, 'logo'] }],
  ['Brother QL 62 x 29 mm', { page: null, label: { w_mm: 62, h_mm: 29 } }, { style: 'standard', show: [...STD, 'logo'] }],
  ['Brother QL 29 x 90 mm', { page: null, label: { w_mm: 90.3, h_mm: 29 } }, { style: 'standard', show: [...STD, 'logo'] }],
  ['Avery 5160', { page: { w_mm: 215.9, h_mm: 279.4 }, label: { w_mm: 66.675, h_mm: 25.4 } }, { style: 'compact', show: [...STD, 'logo'] }],
  ['Avery 5163', { page: { w_mm: 215.9, h_mm: 279.4 }, label: { w_mm: 101.6, h_mm: 50.8 } }, { style: 'standard', show: [...STD, 'phone', 'logo'] }],
  ['Outdoor 2 x 2 in', { page: null, label: { w_mm: 50.8, h_mm: 50.8 } }, { style: 'outdoor', show: ['qr', 'tag', 'name', 'logo'] }],
]
// No logo, a wide wordmark (3:1) and a tall mark (0.65:1).
const LOGOS = [null, 3, 0.65]
const TAGS = ['MW-000123', 'LBK3-0042', 'WD-000001', 'CCW-1234567', 'MIGHTYWA-0000012345']
const SHORT = 'mightywash'

const server = await createServer({
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
  optimizeDeps: { noDiscovery: true, entries: [] },
})
const { drawLabel } = await server.ssrLoadModule('/src/lib/labels/layout.ts')

function raster(rects, wMm, hMm, dpi) {
  const k = dpi / 25.4
  const margin = 3 // mm of white around the label, like the sticker backing
  const W = Math.round((wMm + 2 * margin) * k)
  const H = Math.round((hMm + 2 * margin) * k)
  const data = new Uint8ClampedArray(W * H * 4).fill(255)
  for (const r of rects) {
    const x0 = Math.round((r.x + margin) * k)
    const x1 = Math.round((r.x + r.w + margin) * k)
    const y0 = Math.round((r.y + margin) * k)
    const y1 = Math.round((r.y + r.h + margin) * k)
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * W + x) * 4
        data[i] = data[i + 1] = data[i + 2] = 0
      }
    }
  }
  return { data, width: W, height: H, colorSpace: 'srgb' }
}

const overlaps = (a, b, gap) => a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap

let failures = 0
for (const [name, partial, layout] of TEMPLATES) {
  const spec = { cols: 1, rows: 1, margin_top_mm: 0, margin_left_mm: 0, pitch_x_mm: 0, pitch_y_mm: 0, ...partial }
  for (const [tag, aspect] of TAGS.flatMap((t) => LOGOS.map((l) => [t, l]))) {
    const url = `https://operator.washlyfe.com/t/${SHORT}/${tag}`
    const d = drawLabel({ tag, url, name: 'Pay Lane 1 pay station', site: 'MW12 Lubbock 50th St', phone: '806-555-0100' }, spec, layout, aspect)
    if (aspect && d.logo) {
      // The QR's box (quiet zone included) is square from the top-left padding.
      const clash = d.rects.some((r) => overlaps(r, d.logo, 0.5)) || d.logo.x < d.qrModuleMm * 4
      if (clash) failures++
      if (clash) console.log(`FAIL  ${name} logo ${aspect}:1 overlaps the QR or barcode`)
    }
    if (aspect && layout.style === 'outdoor' && d.logo) { failures++; console.log(`FAIL  ${name} has a logo on outdoor stock`) }
    const logoNote = aspect ? `logo ${String(aspect).padEnd(4)} ${d.logo ? `${d.logo.w.toFixed(1)}x${d.logo.h.toFixed(1)}mm` : 'left off'}` : 'no logo'
    for (const dpi of [203, 300]) {
      const img = raster(d.logo ? [...d.rects, d.logo] : d.rects, spec.label.w_mm, spec.label.h_mm, dpi)
      const found = await readBarcodesFromImageData(img, { formats: ['QRCode', 'Code128'], tryHarder: true, maxNumberOfSymbols: 4 })
      const qr = found.find((f) => f.format === 'QRCode')?.text
      const bar = found.find((f) => f.format === 'Code128')?.text
      const wantBar = layout.show.includes('barcode') && d.barMm !== null
      const ok = qr === url && (!wantBar || bar === tag)
      if (!ok) failures++
      console.log(
        `${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${tag.padEnd(20)} ${logoNote.padEnd(22)} ${dpi}dpi  ` +
        `qr ${d.qrModuleMm.toFixed(2)}mm/module ${qr === url ? 'read' : 'NOT READ'}  ` +
        (wantBar ? `code128 ${d.barMm.toFixed(2)}mm ${bar === tag ? 'read' : `NOT READ (${bar ?? 'none'})`}` : (layout.show.includes('barcode') ? 'code128 left off (too narrow)' : 'no barcode')),
      )
    }
  }
}
await server.close()
console.log(failures ? `\n${failures} FAILED` : '\nALL STICKERS SCAN')
process.exit(failures ? 1 : 0)
