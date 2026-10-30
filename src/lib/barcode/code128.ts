// Code 128 encoder (printable ASCII). Uses Code Set B, switching to Code Set C
// for runs of four or more digits, which keeps a tag like MW-000123 narrow
// enough to fit across a small label. Returns the bar/space widths in modules,
// starting with a bar, so any renderer (PDF, SVG, canvas) can draw it.

// Symbol patterns 0-105 (6 widths, 11 modules) and STOP (7 widths, 13 modules).
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232',
]
const STOP = '2331112'
const START_B = 104
const START_C = 105
const CODE_B = 100 // switch to B from C
const CODE_C = 99 // switch to C from B

const isDigit = (ch: string) => ch >= '0' && ch <= '9'
function digitRun(s: string, i: number): number {
  let n = 0
  while (i + n < s.length && isDigit(s[i + n])) n++
  return n
}

// Symbol values including start and check, excluding stop.
export function code128Values(text: string): number[] {
  for (const ch of text) {
    const c = ch.charCodeAt(0)
    if (c < 32 || c > 126) throw new Error(`Code 128 can't encode "${ch}"`)
  }
  if (!text) throw new Error('Nothing to encode')
  const values: number[] = []
  let set: 'B' | 'C'
  let i = 0
  const lead = digitRun(text, 0)
  if (lead >= 4 && lead % 2 === 0) {
    set = 'C'
    values.push(START_C)
  } else {
    set = 'B'
    values.push(START_B)
  }
  while (i < text.length) {
    const run = digitRun(text, i)
    if (set === 'B' && run >= 4) {
      // Keep the C pairs aligned to the end of the run.
      if (run % 2 === 1) {
        values.push(text.charCodeAt(i) - 32)
        i++
      }
      values.push(CODE_C)
      set = 'C'
      continue
    }
    if (set === 'C') {
      if (run >= 2) {
        values.push(Number(text.slice(i, i + 2)))
        i += 2
        continue
      }
      values.push(CODE_B)
      set = 'B'
    }
    values.push(text.charCodeAt(i) - 32)
    i++
  }
  let sum = values[0]
  for (let k = 1; k < values.length; k++) sum += values[k] * k
  values.push(sum % 103)
  return values
}

// Bar/space widths in modules (bar first), without quiet zones.
export function code128Widths(text: string): number[] {
  const widths: number[] = []
  for (const v of code128Values(text)) for (const ch of PATTERNS[v]) widths.push(Number(ch))
  for (const ch of STOP) widths.push(Number(ch))
  return widths
}

// Quiet zone each side, in modules (the standard minimum is 10).
export const CODE128_QUIET = 10
