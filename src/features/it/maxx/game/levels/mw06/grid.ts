// A sheet of blank tiles to draw an area on, by column and row, and the rows it comes to.
// MW06 is long and its beats are placed by column, so it is drawn with this instead of typed
// as rows; `node scripts/maxx/level.mjs reach mw06` prints the rows it makes.

export interface Sheet {
  /** Fill the box from column x0 to x1 and row y0 to y1 (inclusive) with one character. */
  fill(x0: number, x1: number, y0: number, y1: number, ch: string): void
  /** Write `text` along row y, starting at column x. A blank in it leaves that cell as it is. */
  put(x: number, y: number, text: string): void
  /** One character at each of these columns of row y. */
  dots(y: number, ch: string, columns: number[]): void
  /** Scenery: one character at each [column, row], only where the cell is still blank. */
  dress(ch: string, cells: [number, number][]): void
  rows(): string[]
}

export function sheet(width: number, height: number): Sheet {
  const cells: string[][] = []
  for (let y = 0; y < height; y++) {
    const row: string[] = []
    for (let x = 0; x < width; x++) row.push(' ')
    cells.push(row)
  }
  const inside = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < width && y < height
  const set = (x: number, y: number, ch: string): void => {
    if (inside(x, y)) cells[y][x] = ch
  }
  return {
    fill(x0, x1, y0, y1, ch) {
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, ch)
    },
    put(x, y, text) {
      for (let i = 0; i < text.length; i++) if (text[i] !== ' ') set(x + i, y, text[i])
    },
    dots(y, ch, columns) {
      for (const x of columns) set(x, y, ch)
    },
    dress(ch, list) {
      for (const [x, y] of list) if (inside(x, y) && cells[y][x] === ' ') cells[y][x] = ch
    },
    rows() {
      return cells.map((row) => row.join(''))
    },
  }
}
