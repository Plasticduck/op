import QRCode from 'qrcode'

// Print-ready tip QR posters, composed on a canvas. Four styles, all rendered
// at high resolution for clean printing; the Tips admin page shows them as
// previews and downloads whichever the manager picks.

export type PosterStyle = 'qr-only' | 'tips-card' | 'bubbles' | 'dark'

export const POSTER_STYLES: Array<{ key: PosterStyle; label: string; description: string }> = [
  { key: 'qr-only', label: 'QR only', description: 'Plain code, fits any sign you already have' },
  { key: 'tips-card', label: 'Tips card', description: 'Clean white card with a TIPS headline' },
  { key: 'bubbles', label: 'Bubbles poster', description: 'Brand blue with soap bubbles' },
  { key: 'dark', label: 'Dark poster', description: 'Navy with white lettering, pops at night' },
]

const BLUE = '#2563eb'
const NAVY = '#0B0F14'
const INK = '#0f172a'
const MUTED = '#64748b'
const FONT = "'DM Sans', system-ui, -apple-system, 'Segoe UI', sans-serif"

type Opts = { url: string; siteName: string }

export async function renderTipPoster(style: PosterStyle, opts: Opts): Promise<HTMLCanvasElement> {
  switch (style) {
    case 'qr-only': return qrOnly(opts)
    case 'tips-card': return tipsCard(opts)
    case 'bubbles': return bubbles(opts)
    case 'dark': return dark(opts)
  }
}

export async function tipPosterDataUrl(style: PosterStyle, opts: Opts): Promise<string> {
  const canvas = await renderTipPoster(style, opts)
  return canvas.toDataURL('image/png')
}

export async function downloadTipPoster(style: PosterStyle, opts: Opts): Promise<void> {
  const dataUrl = await tipPosterDataUrl(style, opts)
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = `tip-qr-${style}-${opts.siteName.toLowerCase().replace(/\s+/g, '-')}.png`
  a.click()
}

// ---- shared drawing helpers ------------------------------------------------

async function qrCanvas(url: string, sizePx: number, dark = NAVY, light = '#ffffff'): Promise<HTMLCanvasElement> {
  const c = document.createElement('canvas')
  await QRCode.toCanvas(c, url, {
    width: sizePx,
    margin: 0,
    errorCorrectionLevel: 'H',
    color: { dark, light },
  })
  return c
}

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas')
  c.width = w
  c.height = h
  const ctx = c.getContext('2d')!
  return [c, ctx]
}

function rounded(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function heart(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, color: string) {
  ctx.save()
  ctx.fillStyle = color
  ctx.beginPath()
  ctx.moveTo(cx, cy + s * 0.32)
  ctx.bezierCurveTo(cx - s * 0.5, cy - s * 0.1, cx - s * 0.36, cy - s * 0.42, cx, cy - s * 0.18)
  ctx.bezierCurveTo(cx + s * 0.36, cy - s * 0.42, cx + s * 0.5, cy - s * 0.1, cx, cy + s * 0.32)
  ctx.fill()
  ctx.restore()
}

function centerText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, color: string) {
  ctx.font = font
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(text, x, y)
}

// ---- styles -----------------------------------------------------------------

async function qrOnly({ url }: Opts): Promise<HTMLCanvasElement> {
  const W = 1024
  const [c, ctx] = makeCanvas(W, W)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, W)
  const qr = await qrCanvas(url, 896, NAVY)
  ctx.drawImage(qr, 64, 64)
  return c
}

async function tipsCard({ url, siteName }: Opts): Promise<HTMLCanvasElement> {
  const W = 1200, H = 1560
  const [c, ctx] = makeCanvas(W, H)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, W, H)
  // hairline frame
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 6
  rounded(ctx, 24, 24, W - 48, H - 48, 40)
  ctx.stroke()

  // headline: TIPS with heart
  centerText(ctx, 'TIPS', W / 2 - 36, 190, `800 170px ${FONT}`, INK)
  heart(ctx, W / 2 + ctx.measureText('TIPS').width / 2 + 56, 188, 120, BLUE)

  centerText(ctx, 'Scan to tip the crew', W / 2, 330, `500 56px ${FONT}`, MUTED)

  // QR panel
  const qrSize = 720
  const qx = (W - qrSize) / 2
  const qy = 420
  ctx.save()
  ctx.shadowColor = 'rgba(15, 23, 42, 0.12)'
  ctx.shadowBlur = 40
  ctx.shadowOffsetY = 12
  ctx.fillStyle = '#ffffff'
  rounded(ctx, qx - 40, qy - 40, qrSize + 80, qrSize + 80, 36)
  ctx.fill()
  ctx.restore()
  ctx.strokeStyle = '#e2e8f0'
  ctx.lineWidth = 3
  rounded(ctx, qx - 40, qy - 40, qrSize + 80, qrSize + 80, 36)
  ctx.stroke()
  ctx.drawImage(await qrCanvas(url, qrSize, NAVY), qx, qy)

  centerText(ctx, '100% goes to the team', W / 2, qy + qrSize + 130, `600 52px ${FONT}`, BLUE)
  centerText(ctx, siteName, W / 2, H - 110, `500 44px ${FONT}`, MUTED)
  return c
}

async function bubbles({ url, siteName }: Opts): Promise<HTMLCanvasElement> {
  const W = 1200, H = 1560
  const [c, ctx] = makeCanvas(W, H)
  // brand blue field
  const grad = ctx.createLinearGradient(0, 0, 0, H)
  grad.addColorStop(0, '#3b82f6')
  grad.addColorStop(1, BLUE)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, W, H)

  // soap bubbles — fixed layout so every print looks the same
  const dots: Array<[number, number, number, number]> = [
    [0.08, 0.06, 46, 0.18], [0.2, 0.13, 24, 0.25], [0.9, 0.08, 60, 0.15],
    [0.78, 0.16, 26, 0.3], [0.06, 0.4, 30, 0.2], [0.94, 0.42, 38, 0.18],
    [0.1, 0.78, 52, 0.16], [0.88, 0.8, 30, 0.25], [0.16, 0.92, 26, 0.2],
    [0.82, 0.94, 44, 0.16], [0.5, 0.035, 18, 0.3], [0.32, 0.05, 14, 0.22],
  ]
  for (const [fx, fy, r, a] of dots) {
    ctx.beginPath()
    ctx.arc(fx * W, fy * H, r, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,255,255,${a})`
    ctx.fill()
    // highlight to read as a bubble, not a dot
    ctx.beginPath()
    ctx.arc(fx * W - r * 0.3, fy * H - r * 0.3, r * 0.25, 0, Math.PI * 2)
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, a + 0.2)})`
    ctx.fill()
  }

  centerText(ctx, 'Tip the Crew', W / 2, 200, `800 120px ${FONT}`, '#ffffff')
  heart(ctx, W / 2, 320, 90, '#ffffff')

  // QR on white tile
  const qrSize = 680
  const qx = (W - qrSize) / 2
  const qy = 430
  ctx.save()
  ctx.shadowColor = 'rgba(0,0,0,0.25)'
  ctx.shadowBlur = 50
  ctx.shadowOffsetY = 16
  ctx.fillStyle = '#ffffff'
  rounded(ctx, qx - 44, qy - 44, qrSize + 88, qrSize + 88, 40)
  ctx.fill()
  ctx.restore()
  ctx.drawImage(await qrCanvas(url, qrSize, NAVY), qx, qy)

  centerText(ctx, 'Scan with your phone camera', W / 2, qy + qrSize + 130, `600 50px ${FONT}`, '#ffffff')
  centerText(ctx, '100% goes to the team', W / 2, qy + qrSize + 200, `500 44px ${FONT}`, 'rgba(255,255,255,0.85)')
  centerText(ctx, siteName, W / 2, H - 90, `600 42px ${FONT}`, 'rgba(255,255,255,0.7)')
  return c
}

async function dark({ url, siteName }: Opts): Promise<HTMLCanvasElement> {
  const W = 1200, H = 1560
  const [c, ctx] = makeCanvas(W, H)
  ctx.fillStyle = NAVY
  ctx.fillRect(0, 0, W, H)

  // accent bar over the headline
  ctx.fillStyle = BLUE
  rounded(ctx, W / 2 - 90, 96, 180, 14, 7)
  ctx.fill()

  centerText(ctx, 'TIPS', W / 2, 230, `800 180px ${FONT}`, '#ffffff')
  centerText(ctx, 'Cashless. Scan & go.', W / 2, 360, `500 54px ${FONT}`, 'rgba(255,255,255,0.65)')

  const qrSize = 700
  const qx = (W - qrSize) / 2
  const qy = 460
  ctx.fillStyle = '#ffffff'
  rounded(ctx, qx - 44, qy - 44, qrSize + 88, qrSize + 88, 40)
  ctx.fill()
  ctx.drawImage(await qrCanvas(url, qrSize, NAVY), qx, qy)

  heart(ctx, W / 2 - 250, qy + qrSize + 140, 64, BLUE)
  centerText(ctx, 'Tip the crew at', W / 2 + 30, qy + qrSize + 140, `600 48px ${FONT}`, '#ffffff')
  centerText(ctx, siteName, W / 2, qy + qrSize + 220, `700 56px ${FONT}`, BLUE)
  return c
}
