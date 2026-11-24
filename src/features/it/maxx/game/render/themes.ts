// What a theme looks like behind the playfield: sky bands, clouds, three parallax strips,
// all read from the theme's 'bg_<theme>' atlas, with a flat stand-in for whatever is missing.
// Also the flat colours the tile layer falls back on (render/tiles.ts).
//
// A 'bg_<theme>' atlas: frames 'far', 'mid', 'near' and 'clouds', each optional, each tiled
// across by its own width with its bottom edge on the bottom of the screen.
//   meta.sky        [[yTop, cssColor], ...] flat bands behind everything (y in screen pixels, 0..360)
//   meta.scroll     { far, mid, near } share of the camera's x each strip moves by (0.15, 0.35, 0.6)
//   meta.cloudSpeed px a second the clouds drift left by themselves (default 6)
//   meta.weather    'rain' | 'snow' | 'none'
// In an area taller than the screen the strips sink as the camera climbs, each by its own
// share of the climb (the clouds by the sky bands' share), and the top sky band fills in above.
import { VIEW_H, VIEW_W } from '../contract'
import type { Sprites, SpriteFrame, ThemeId } from '../contract'

export const THEMES: readonly ThemeId[] = ['lot', 'vacuum', 'tunnel', 'storm', 'lube', 'highway', 'winter', 'mega', 'bonus', 'backlot']

export type WeatherKind = 'rain' | 'snow' | 'none'

/** Flat colours for a theme with no art yet. */
export interface ThemeLook {
  sky: readonly (readonly [number, string])[]
  /** A band of far ground along the bottom of the sky, or '' for none (indoors). */
  horizon: string
  ground: string
  groundTop: string
  wall: string
  wallTop: string
  pillar: string
  weather: WeatherKind
}

export const THEME_LOOK: Record<ThemeId, ThemeLook> = {
  lot: { sky: [[0, '#109ff9'], [120, '#5cc8ff'], [250, '#b9ecff']], horizon: '#f5c56e', ground: '#a9afbd', groundTop: '#d6dae3', wall: '#d6dae3', wallTop: '#d10713', pillar: '#767b8a', weather: 'none' },
  vacuum: { sky: [[0, '#f09c3f'], [130, '#f5c56e'], [240, '#fff1c4']], horizon: '#b96e23', ground: '#b08850', groundTop: '#f5c56e', wall: '#b96e23', wallTop: '#f09c3f', pillar: '#7a4a1a', weather: 'none' },
  tunnel: { sky: [[0, '#2e3038'], [200, '#4b4f5c']], horizon: '', ground: '#4b4f5c', groundTop: '#f5c518', wall: '#767b8a', wallTop: '#a9afbd', pillar: '#d10713', weather: 'none' },
  storm: { sky: [[0, '#2e3038'], [140, '#4b4f5c'], [260, '#0e7c86']], horizon: '#4a2f17', ground: '#6b4522', groundTop: '#8a5f33', wall: '#4a2f17', wallTop: '#6b4522', pillar: '#2b1a0e', weather: 'rain' },
  lube: { sky: [[0, '#2b1a0e'], [220, '#311107']], horizon: '', ground: '#4b4f5c', groundTop: '#f97316', wall: '#2e3038', wallTop: '#4b4f5c', pillar: '#767b8a', weather: 'none' },
  highway: { sky: [[0, '#2e1f5e'], [90, '#5b3fa0'], [170, '#e85aa0'], [230, '#f97316'], [290, '#fdba74']], horizon: '#311107', ground: '#2e3038', groundTop: '#4b4f5c', wall: '#7a4a1a', wallTop: '#b96e23', pillar: '#4b4f5c', weather: 'none' },
  winter: { sky: [[0, '#6fb3dd'], [140, '#a8d8f0'], [260, '#dff3ff']], horizon: '#f7f4f8', ground: '#a9afbd', groundTop: '#f7f4f8', wall: '#6fb3dd', wallTop: '#dff3ff', pillar: '#767b8a', weather: 'snow' },
  mega: { sky: [[0, '#1a1033'], [220, '#2e1f5e']], horizon: '', ground: '#1b2253', groundTop: '#5b3fa0', wall: '#2e1f5e', wallTop: '#9a7fe0', pillar: '#d10713', weather: 'none' },
  bonus: { sky: [[0, '#1b2253'], [220, '#0b2a6b']], horizon: '', ground: '#0b2a6b', groundTop: '#f5c518', wall: '#1456b8', wallTop: '#f5c518', pillar: '#b8860b', weather: 'none' },
  backlot: { sky: [[0, '#16161d'], [200, '#1a1033']], horizon: '#2e3038', ground: '#2e3038', groundTop: '#4b4f5c', wall: '#4b4f5c', wallTop: '#767b8a', pillar: '#16161d', weather: 'none' },
}

export function themeLook(theme: string): ThemeLook {
  return (THEME_LOOK as Record<string, ThemeLook | undefined>)[theme] ?? THEME_LOOK.lot
}

interface Strip {
  image: CanvasImageSource
  frame: SpriteFrame
  /** Share of the camera's sideways movement it follows. */
  scroll: number
  /** Share of a tall area's climb it sinks by. */
  follow: number
  /** Pixels a tick it drifts left by itself. */
  drift: number
}

/** Everything behind the playfield for one theme, worked out once when an area starts. */
export interface Backdrop {
  theme: string
  /** True when the theme's atlas is there. */
  art: boolean
  bandY: number[]
  bandColor: string[]
  horizon: string
  /** Back to front: clouds, far, mid, near. */
  strips: Strip[]
  weather: WeatherKind
}

/** Share of a tall area's climb the sky bands sink by. */
const SKY_FOLLOW = 0.08
const CLOUD_SCROLL = 0.06
const HORIZON_H = 56
const DEFAULT_SCROLL = { far: 0.15, mid: 0.35, near: 0.6 }

const num = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)

export function resolveBackdrop(sprites: Sprites, theme: string): Backdrop {
  const look = themeLook(theme)
  const name = `bg_${theme}`
  const atlas = sprites.atlas(name)
  const meta = atlas?.meta ?? {}
  const bd: Backdrop = { theme, art: !!atlas, bandY: [], bandColor: [], horizon: atlas ? '' : look.horizon, strips: [], weather: look.weather }

  const sky = Array.isArray(meta.sky) ? (meta.sky as unknown[]) : null
  const bands: [number, string][] = []
  for (const b of sky ?? look.sky) {
    if (Array.isArray(b) && typeof b[0] === 'number' && typeof b[1] === 'string') bands.push([b[0], b[1]])
  }
  if (!bands.length) for (const b of look.sky) bands.push([b[0], b[1]])
  bands.sort((a, b) => a[0] - b[0])
  for (const [y, color] of bands) {
    bd.bandY.push(Math.round(y))
    bd.bandColor.push(color)
  }

  const scroll = (meta.scroll ?? {}) as Record<string, unknown>
  const add = (frame: string, by: number, follow: number, drift: number) => {
    const src = sprites.source(`${name}/${frame}`)
    if (src && src.frame.w > 0 && src.frame.h > 0) bd.strips.push({ image: src.image, frame: src.frame, scroll: by, follow, drift })
  }
  // The clouds sink with the sky bands, so art matched to a band (storm's rain shafts) stays on it at any climb.
  add('clouds', CLOUD_SCROLL, SKY_FOLLOW, num(meta.cloudSpeed, 6) / 60)
  for (const strip of ['far', 'mid', 'near'] as const) {
    const by = num(scroll[strip], DEFAULT_SCROLL[strip])
    add(strip, by, by, 0)
  }

  const weather = meta.weather
  if (weather === 'rain' || weather === 'snow' || weather === 'none') bd.weather = weather
  return bd
}

/**
 * Sky, clouds and strips for a camera at (camX, camY) in an area `areaH` pixels tall.
 * `pinned` nails everything to the world instead (no parallax, no drift), so pictures taken
 * at different camera positions join up: the level overview tool.
 */
export function drawBackdrop(g: CanvasRenderingContext2D, bd: Backdrop, camX: number, camY: number, areaH: number, tick: number, pinned: boolean): void {
  // How far the camera has climbed above its lowest position. Pinned, everything hangs from the
  // bottom of the area wherever the camera is, below that position too.
  const climb = pinned ? areaH - VIEW_H - camY : Math.max(0, areaH - VIEW_H - camY)
  const skyDown = pinned ? climb : Math.round(climb * SKY_FOLLOW)
  const n = bd.bandY.length
  for (let i = 0; i < n; i++) {
    const top = i === 0 ? 0 : Math.min(VIEW_H, Math.max(0, bd.bandY[i] + skyDown))
    const bottom = i === n - 1 ? VIEW_H : Math.min(VIEW_H, Math.max(0, bd.bandY[i + 1] + skyDown))
    if (bottom <= top) continue
    g.fillStyle = bd.bandColor[i]
    g.fillRect(0, top, VIEW_W, bottom - top)
  }
  if (bd.horizon) {
    const y = VIEW_H - HORIZON_H + (pinned ? climb : Math.round(climb * DEFAULT_SCROLL.far))
    if (y < VIEW_H) {
      g.fillStyle = bd.horizon
      g.fillRect(0, y, VIEW_W, VIEW_H - y)
    }
  }
  for (let i = 0; i < bd.strips.length; i++) {
    const s = bd.strips[i]
    const f = s.frame
    const y = VIEW_H - f.h + (pinned ? climb : Math.round(climb * s.follow))
    if (y >= VIEW_H || y + f.h <= 0) continue
    const shift = pinned ? camX : Math.floor(camX * s.scroll + tick * s.drift)
    // | 0 turns a -0 into 0: a -0 handed to the canvas is a boxed number, an allocation every frame.
    let x = -(((shift % f.w) + f.w) % f.w) | 0
    for (; x < VIEW_W; x += f.w) g.drawImage(s.image, f.x, f.y, f.w, f.h, x, y | 0, f.w, f.h)
  }
}
