// Block parser for the model's markdown. Split out from the renderer so it can
// be exercised on its own: it runs against partially-revealed text on every
// tick of the typewriter, so it has to terminate on prefixes of a document as
// well as the finished thing.

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'para'; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] }
  | { kind: 'table'; header: string[]; rows: string[][] }
  | { kind: 'code'; code: string }
  | { kind: 'quote'; lines: string[] }
  | { kind: 'rule' }

const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
const isDivider = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-')
const isBullet = (l: string) => /^\s*([-*+])\s+/.test(l)
const isNumbered = (l: string) => /^\s*\d+[.)]\s+/.test(l)

export function parse(text: string): Block[] {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: Block[] = []
  let i = 0

  while (i < lines.length) {
    const line = lines[i]

    if (!line.trim()) {
      i++
      continue
    }

    // Fenced code. An unterminated fence still renders, so a block that is
    // mid-stream shows its partial contents instead of vanishing.
    if (/^\s*```/.test(line)) {
      const body: string[] = []
      i++
      while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++])
      if (i < lines.length) i++
      blocks.push({ kind: 'code', code: body.join('\n') })
      continue
    }

    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      blocks.push({ kind: 'rule' })
      i++
      continue
    }

    const heading = /^\s*(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
      i++
      continue
    }

    if (/^\s*>\s?/.test(line)) {
      const quoted: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quoted.push(lines[i].replace(/^\s*>\s?/, ''))
        i++
      }
      blocks.push({ kind: 'quote', lines: quoted })
      continue
    }

    if (isTableRow(line)) {
      if (i + 1 < lines.length && isDivider(lines[i + 1])) {
        const header = splitRow(line)
        const rows: string[][] = []
        i += 2
        while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]))
        blocks.push({ kind: 'table', header, rows })
        continue
      }
      // A header row whose divider has not streamed in yet. Swallow it so the
      // reveal does not flash raw pipes for a tick before the table forms.
      if (i === lines.length - 1) {
        i++
        continue
      }
    }

    if (isBullet(line) || isNumbered(line)) {
      const ordered = isNumbered(line)
      const items: string[] = []
      while (i < lines.length && (ordered ? isNumbered(lines[i]) : isBullet(lines[i]))) {
        items.push(lines[i].replace(/^\s*([-*+]|\d+[.)])\s+/, ''))
        i++
      }
      blocks.push({ kind: 'list', ordered, items })
      continue
    }

    // Consecutive plain lines form one paragraph so wrapped prose does not
    // render as a stack of one-line blocks.
    const para: string[] = []
    while (
      i < lines.length &&
      lines[i].trim() &&
      !isTableRow(lines[i]) &&
      !isBullet(lines[i]) &&
      !isNumbered(lines[i]) &&
      !/^\s*(#{1,4}\s|>|```|---+\s*$)/.test(lines[i])
    ) {
      para.push(lines[i].trim())
      i++
    }
    // The guard that matters. Every other branch advances `i`, but this loop
    // can reject its very first line (a mid-text table row whose divider has
    // not arrived, say) and consume nothing, which spins the outer while
    // forever and locks the tab. Always take at least one line.
    if (para.length === 0) {
      para.push(lines[i].trim())
      i++
    }
    blocks.push({ kind: 'para', text: para.join(' ') })
  }

  return blocks
}

export function splitRow(l: string): string[] {
  return l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())
}

export const stripMarks = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim()

// A cell reads as a measurement if it is a bare number, optionally signed, with
// a currency mark, thousands separators, or a trailing unit.
const NUMERIC = /^[-+]?[$€£]?\s?[\d,]+(\.\d+)?\s?(%|h|hrs|hours|k|m)?$/i

export function numericColumns(header: string[], rows: string[][]): boolean[] {
  return header.map((_, c) => {
    const cells = rows.map((r) => r[c]).filter((v) => v != null && v !== '' && v !== '-')
    if (!cells.length) return false
    return cells.filter((v) => NUMERIC.test(stripMarks(v))).length / cells.length >= 0.6
  })
}
