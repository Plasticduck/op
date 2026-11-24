// The master palette of Super Mighty Maxx (design bible, section 9) for every
// art script. Ramps run dark to light. Use these names; add a colour only when
// really needed, add it here, and say so in your report.
//
//   import { PAL, C, MAXX, GUN } from './palette.mjs'
//   PAL.red[3]   C.brandRed   C.outline   MAXX.glove   GUN.tip
//
// checkPalette(canvas, extra?) lists any colour in a canvas that is not in the
// palette, so a generator can refuse to ship a stray shade.

import { hex, rgba } from './pix.mjs'

export const PAL = {
  outline: '#1e0d06',
  navy: '#1b2253',
  red: ['#3c0507', '#7f0207', '#ae0512', '#d10713', '#f51924', '#ff6b6b'],
  wood: ['#311107', '#7a4a1a', '#b96e23', '#d57a1d', '#f09c3f', '#f1ae51', '#f5c56e', '#fbdb8a', '#fff1c4'],
  blue: ['#0b2a6b', '#1456b8', '#109ff9', '#5cc8ff', '#b9ecff'],
  teal: ['#0e7c86', '#25c2d0', '#a8f0f0'],
  green: ['#0f3b1e', '#1f7a34', '#49b23c', '#9be04f'],
  grey: ['#16161d', '#2e3038', '#4b4f5c', '#767b8a', '#a9afbd', '#d6dae3', '#f7f4f8'],
  mud: ['#2b1a0e', '#4a2f17', '#6b4522', '#8a5f33', '#b08850'],
  yellow: ['#b8860b', '#f5c518', '#ffe866'],
  purple: ['#1a1033', '#2e1f5e', '#5b3fa0', '#9a7fe0'],
  orange: ['#c2410c', '#f97316', '#fdba74'],
  pink: ['#e85aa0'],
  ice: ['#6fb3dd', '#a8d8f0', '#dff3ff'],
}

/** The colours asked for by name most often. */
export const C = {
  outline: PAL.outline,
  navy: PAL.navy,
  black: PAL.grey[0],
  white: PAL.grey[6],
  brandRed: PAL.red[3],
  brandBlue: PAL.blue[2],
  water: PAL.teal[1],
  waterLight: PAL.teal[2],
  gold: PAL.yellow[1],
  tunnel: PAL.grey[1],
}

/**
 * Mighty Maxx's own colours, taken from the client's run sheet
 * (scripts/maxx/source/maxx-run.png). Most are in the master palette already;
 * the ones marked + exist only on him.
 */
export const MAXX = {
  outline: '#1e0d06',
  // mask, cape, gloves, boots
  redLine: '#3c0507',
  redDark: '#7f0207',
  redShade: '#ae0512',
  red: '#d10713',
  redLight: '#f51924',
  // the wooden brush body
  woodLine: '#311107',
  woodDark: '#854909', // +
  woodShade: '#b96e23',
  woodMid: '#d57a1d',
  wood: '#f09c3f',
  woodLight: '#f1ae51',
  // bristles
  bristleShade: '#c89844', // +
  bristle: '#f5c56e',
  bristleLight: '#fbdb8a',
  bristleTip: '#fbe2b3', // +
  // sleeves and leggings
  blueLine: '#091439', // +
  blueDark: '#0d4f9a', // +
  blueShade: '#0780df', // +
  blue: '#109ff9',
  // eyes, teeth, shield
  white: '#f7f4f8',
  whiteShade: '#f0e3eb', // +
}

/**
 * The prep gun (a pressure-washer trigger gun on a steel lance, brass nozzle),
 * drawn from the master greys. The hose is light enough to show on the dark
 * tunnel wall and carries a dark edge for the bright sky.
 */
export const GUN = {
  outline: PAL.grey[0],
  hose: PAL.grey[3],
  dark: PAL.grey[2],
  body: PAL.grey[3],
  light: PAL.grey[4],
  shine: PAL.grey[5],
  grip: PAL.blue[1],
  gripDark: PAL.blue[0],
  tip: PAL.yellow[1],
  tipLight: PAL.yellow[2],
  tipDark: PAL.yellow[0],
}

const flat = (o) => Object.values(o).flatMap((v) => (Array.isArray(v) ? v : [v]))

/** Every colour art may use, as '#rrggbb' strings. */
export const ALL_COLOURS = [...new Set([...flat(PAL), ...flat(MAXX)])]

/** Colours in `canvas` that are outside the palette (plus `extra`): [{ colour, count }]. Empty means clean. */
export function checkPalette(canvas, extra = []) {
  const ok = new Set([...ALL_COLOURS, ...extra].map((c) => rgba(c)))
  const bad = []
  for (const [v, count] of canvas.colours()) {
    if ((v & 0xff) !== 0xff) bad.push({ colour: `${hex(v)} with alpha ${v & 0xff}`, count })
    else if (!ok.has(v)) bad.push({ colour: hex(v), count })
  }
  return bad
}
