// One-off: rebuild the WashLyfe logo as a horizontal lockup —
// [blue mark] [WASH LYFE], mark scaled to the text height, "live it!" dropped.
// Run: node scripts/relogo.mjs   (operates on public/washlyfe-logo.png)
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { PNG } from 'pngjs'

const img = PNG.sync.read(fs.readFileSync('public/washlyfe-logo.png'))
const { width: w, height: h, data } = img
const px = (x, y) => { const i = (y * w + x) * 4; return [data[i], data[i + 1], data[i + 2], data[i + 3]] }
const isBlue = (r, g, b, a) => a > 40 && b > 120 && b - r > 25 && b - g > 5
const isBlack = (r, g, b, a) => a > 40 && r < 80 && g < 80 && b < 90 && !(b - r > 25 && b - g > 5)

// crop an inclusive rectangle into a fresh transparent PNG
function crop(x0, y0, x1, y1) {
  const cw = x1 - x0 + 1, ch = y1 - y0 + 1
  const out = new PNG({ width: cw, height: ch }); out.data.fill(0)
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const si = ((y0 + y) * w + (x0 + x)) * 4, di = (y * cw + x) * 4
    out.data[di] = data[si]; out.data[di + 1] = data[si + 1]; out.data[di + 2] = data[si + 2]; out.data[di + 3] = data[si + 3]
  }
  return out
}

// 1) blue mark bbox
const m = { x0: w, y0: h, x1: -1, y1: -1 }
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
  const [r, g, b, a] = px(x, y)
  if (isBlue(r, g, b, a)) { m.x0 = Math.min(m.x0, x); m.y0 = Math.min(m.y0, y); m.x1 = Math.max(m.x1, x); m.y1 = Math.max(m.y1, y) }
}

// 2) WASH LYFE band = rows dense with black pixels (excludes the sparse "live it!")
const rowBlack = new Array(h).fill(0)
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = px(x, y); if (isBlack(r, g, b, a)) rowBlack[y]++ }
let ty0 = -1, ty1 = -1
for (let y = 0; y < h; y++) if (rowBlack[y] > 50) { if (ty0 < 0) ty0 = y; ty1 = y }
let tx0 = w, tx1 = -1
for (let y = ty0; y <= ty1; y++) for (let x = 0; x < w; x++) { const [r, g, b, a] = px(x, y); if (isBlack(r, g, b, a)) { tx0 = Math.min(tx0, x); tx1 = Math.max(tx1, x) } }

const mark = crop(m.x0, m.y0, m.x1, m.y1)
const text = crop(tx0, ty0, tx1, ty1)
fs.writeFileSync('/tmp/mark.png', PNG.sync.write(mark))
fs.writeFileSync('/tmp/text.png', PNG.sync.write(text))

// 3) scale mark to the text's height (sips = quality resample, keeps alpha)
const textH = ty1 - ty0 + 1
execSync(`sips --resampleHeight ${textH} /tmp/mark.png --out /tmp/mark-r.png`, { stdio: 'ignore' })
const markR = PNG.sync.read(fs.readFileSync('/tmp/mark-r.png'))

// 4) compose side by side, vertically centered, on transparent background
const gap = Math.round(textH * 0.16)
const outH = Math.max(markR.height, text.height)
const outW = markR.width + gap + text.width
const out = new PNG({ width: outW, height: outH }); out.data.fill(0)
const blit = (src, ox, oy) => {
  for (let y = 0; y < src.height; y++) for (let x = 0; x < src.width; x++) {
    const si = (y * src.width + x) * 4, di = ((y + oy) * outW + (x + ox)) * 4
    if (src.data[si + 3] === 0) continue
    out.data[di] = src.data[si]; out.data[di + 1] = src.data[si + 1]; out.data[di + 2] = src.data[si + 2]; out.data[di + 3] = src.data[si + 3]
  }
}
blit(markR, 0, Math.round((outH - markR.height) / 2))
blit(text, markR.width + gap, Math.round((outH - text.height) / 2))
fs.writeFileSync('public/washlyfe-logo.png', PNG.sync.write(out))
console.log(`mark ${markR.width}x${markR.height} | text ${text.width}x${text.height} | final ${outW}x${outH}`)
