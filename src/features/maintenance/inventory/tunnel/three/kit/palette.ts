import type { ThemeName } from '../types'

// Every color the 3D tunnel uses, in one place, so models never invent their own.
// Object colors (steel, cloth, paint) are the same in both themes: only the room they
// stand in changes. Hex values are sRGB, as written in CSS.

// Which layer an object is drawn on. The camera draws layer 0 only, so pick shapes and
// shadow-only stand-ins cost nothing on screen.
export const LAYER = { draw: 0, pick: 1, shadow: 2 } as const

// Where the two lights stand, as directions from the floor toward each light. The key
// comes over the viewer's left shoulder; the rim is low and behind, so it catches edges
// and barely touches the floor. Contact shadows (kit/blobs.ts) lean away from the key by
// the same numbers, which is what makes them agree with the real shadows.
export const KEY_DIR = [-0.34, 0.62, 0.4] as const
export const RIM_DIR = [0.42, 0.16, -0.52] as const
// How far a shadow reaches across the floor per foot of height, along X and Z.
export const SHADOW_SLIDE = [-KEY_DIR[0] / KEY_DIR[1], -KEY_DIR[2] / KEY_DIR[1]] as const

export const COLORS = {
  galvanized: '#b3b9c0',
  frame: '#a4abb4',
  frameDark: '#3d434c',
  aluminum: '#d5d9de',
  stainless: '#c7ccd1',
  chrome: '#e6e9ec',
  yellow: '#f5b800',
  hazardBlack: '#1a1d21',
  conveyorBlue: '#1f5fd1',
  rubber: '#1b1c1f',
  blackPlastic: '#16181c',
  motor: '#3a4049',
  glass: '#0f1820',
  brass: '#b08d57',
  red: '#d92d20',
  white: '#eef0f2',
  drumBlue: '#2456b8',
  hoseRed: '#c8372d',
  hoseBlue: '#2a6fdb',
  hoseBlack: '#1d1f23',
  hoseWhite: '#e6e9ed',
  hoseGreen: '#2f9e6b',
  lensGreen: '#34d399',
  lensAmber: '#e0a44a',
  lensRed: '#f26d6d',
  lensOff: '#3a3f47',
  carPaint: '#f4f5f7',
  carTrim: '#24272c',
  // Cloth and foam. Brushes jitter each strip around these.
  cloth: '#2f4fd0',
  clothLight: '#4a78f0',
  clothDark: '#2740b8',
  clothCore: '#1c2a66',
  // The plate machine names are printed on.
  signPlate: '#262a31',
  signInk: '#eef1f5',
} as const

export type Palette = {
  // The page behind the canvas, so the canvas has no visible rectangle.
  backdrop: string
  // The soft pool of light the slab stands in.
  pool: string
  concrete: string
  concreteEdge: string
  curb: string
  paint: string
  paintInk: string
  paintTick: string
  accent: string
  ink: string
  ok: string
  warn: string
  danger: string
  ghost: string
  // Water droplets: a bright core inside a tinted rim, so they read on any backdrop.
  waterCore: string
  waterRim: string
  foam: string
  // Lighting.
  key: string
  keyIntensity: number
  rim: string
  rimIntensity: number
  env: number
  // How strongly metals mirror the room (they ignore env).
  metalEnv: number
  exposure: number
  // How much of the key light a shadow takes away.
  shadow: number
  // The opacity at which a stand-in shadow (kit.blob) matches that on concrete.
  blob: number
}

export const PALETTES: Record<ThemeName, Palette> = {
  light: {
    backdrop: '#f7f8fa',
    pool: '#ffffff',
    concrete: '#c9ccd1',
    concreteEdge: '#b1b5bb',
    curb: '#d4d7db',
    paint: '#f4f5f7',
    paintInk: '#5b6470',
    paintTick: '#7d8793',
    accent: '#2563eb',
    ink: '#0b0f14',
    ok: '#047857',
    warn: '#b45309',
    danger: '#b91c1c',
    ghost: '#8fa3bf',
    waterCore: '#d6ecfb',
    waterRim: '#4595da',
    foam: '#ffffff',
    key: '#fff4e6',
    keyIntensity: 2.7,
    rim: '#cfe0ff',
    rimIntensity: 0.6,
    env: 0.4,
    metalEnv: 1.05,
    exposure: 1.0,
    shadow: 0.68,
    blob: 0.3,
  },
  dark: {
    backdrop: '#0d1219',
    pool: '#1b2532',
    concrete: '#8d939c',
    concreteEdge: '#6f757e',
    curb: '#a3a8b0',
    paint: '#e4e7eb',
    paintInk: '#d5dae1',
    paintTick: '#c2c8d0',
    accent: '#3b82f6',
    ink: '#e7eaef',
    ok: '#34d399',
    warn: '#e0a44a',
    danger: '#f26d6d',
    ghost: '#8fa3bf',
    waterCore: '#f2faff',
    waterRim: '#7cc2f7',
    foam: '#f3f7fb',
    key: '#ffeedd',
    keyIntensity: 2.1,
    // A pale, quiet rim: a saturated one paints every shadow blue and fights the hover glow.
    rim: '#9fb6e6',
    rimIntensity: 0.5,
    env: 0.34,
    metalEnv: 0.6,
    exposure: 0.92,
    shadow: 0.7,
    blob: 0.34,
  },
}
