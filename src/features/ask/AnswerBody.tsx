import { Fragment } from 'react'
import { cn } from '@/lib/utils'

// Renderer for the model's markdown. Deliberately hand-rolled rather than
// pulling in a markdown dependency (see the bundle rule in CLAUDE.md), but with
// enough structure to render as a designed surface: card tables with numeric
// alignment, small two-column results promoted to stat tiles, callouts, and
// code blocks.

type Block =
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

function parse(text: string): Block[] {
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

    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) rows.push(splitRow(lines[i++]))
      blocks.push({ kind: 'table', header, rows })
      continue
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
    blocks.push({ kind: 'para', text: para.join(' ') })
  }

  return blocks
}

function splitRow(l: string): string[] {
  return l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())
}

// A cell reads as a measurement if it is a bare number, optionally signed, with
// a currency mark, thousands separators, or a trailing unit.
const NUMERIC = /^[-+]?[$€£]?\s?[\d,]+(\.\d+)?\s?(%|h|hrs|hours|k|m)?$/i

function numericColumns(header: string[], rows: string[][]): boolean[] {
  return header.map((_, c) => {
    const cells = rows.map((r) => r[c]).filter((v) => v != null && v !== '' && v !== '-')
    if (!cells.length) return false
    return cells.filter((v) => NUMERIC.test(stripMarks(v))).length / cells.length >= 0.6
  })
}

const stripMarks = (s: string) => s.replace(/\*\*/g, '').replace(/`/g, '').trim()

export function AnswerBody({ text, caret = false }: { text: string; caret?: boolean }) {
  const blocks = parse(text)

  return (
    <div className="text-[15px] leading-relaxed text-ink">
      {blocks.map((b, i) => {
        const last = i === blocks.length - 1
        const tail = caret && last

        switch (b.kind) {
          case 'heading':
            return (
              <h3
                key={i}
                className={cn(
                  'font-semibold tracking-tight text-ink first:mt-0',
                  b.level <= 2 ? 'mb-2 mt-5 text-base' : 'mb-1.5 mt-4 text-[15px]',
                )}
              >
                {inline(b.text)}
                {tail && <Caret />}
              </h3>
            )

          case 'rule':
            return <hr key={i} className="my-4 border-0 border-t border-border" />

          case 'quote':
            return (
              <div
                key={i}
                className="my-3 rounded-2xl border border-accent/25 bg-accent-soft/60 px-4 py-3 text-[14px] text-ink"
              >
                {b.lines.map((l, li) => (
                  <p key={li} className="[&+p]:mt-1.5">
                    {inline(l)}
                  </p>
                ))}
                {tail && <Caret />}
              </div>
            )

          case 'code':
            return (
              <pre
                key={i}
                className="my-3 overflow-x-auto rounded-2xl border border-border bg-content px-4 py-3 font-mono text-[12.5px] leading-relaxed text-ink-muted"
              >
                {b.code}
              </pre>
            )

          case 'list':
            return b.ordered ? (
              <ol key={i} className="my-2.5 space-y-1.5">
                {b.items.map((it, ii) => (
                  <li key={ii} className="flex gap-2.5">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-accent-soft text-[11px] font-semibold tabular text-accent">
                      {ii + 1}
                    </span>
                    <span className="min-w-0 flex-1">{inline(it)}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <ul key={i} className="my-2.5 space-y-1.5">
                {b.items.map((it, ii) => (
                  <li key={ii} className="flex gap-2.5">
                    <span className="mt-[0.55rem] size-1.5 shrink-0 rounded-full bg-accent/70" />
                    <span className="min-w-0 flex-1">{inline(it)}</span>
                  </li>
                ))}
              </ul>
            )

          case 'table': {
            const numeric = numericColumns(b.header, b.rows)
            // A short two-column result is a set of measurements, not really a
            // table. Tiles read far better than four rows of grid lines.
            if (b.header.length === 2 && b.rows.length > 0 && b.rows.length <= 4 && numeric[1]) {
              return <StatTiles key={i} label={b.header[0]} metric={b.header[1]} rows={b.rows} />
            }
            return <DataTable key={i} header={b.header} rows={b.rows} numeric={numeric} />
          }

          default:
            return (
              <p key={i} className="my-2.5 first:mt-0 last:mb-0">
                {inline(b.text)}
                {tail && <Caret />}
              </p>
            )
        }
      })}
      {/* Nothing has parsed yet but text is on its way. */}
      {caret && blocks.length === 0 && <Caret />}
    </div>
  )
}

function Caret() {
  return (
    <span className="ai-caret ml-0.5 inline-block h-[1.05em] w-[3px] translate-y-[0.18em] rounded-full bg-accent align-baseline" />
  )
}

function StatTiles({
  label,
  metric,
  rows,
}: {
  label: string
  metric: string
  rows: string[][]
}) {
  return (
    <div className="my-3">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-ink-subtle">
        {stripMarks(metric)} by {stripMarks(label).toLowerCase()}
      </p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {rows.map((r, i) => (
          <div
            key={i}
            className="rounded-2xl border border-border bg-gradient-to-b from-card to-content px-3.5 py-3"
          >
            <div className="truncate text-[12px] text-ink-muted" title={stripMarks(r[0])}>
              {inline(r[0])}
            </div>
            <div className="mt-1 text-lg font-semibold tabular tracking-tight text-ink">
              {inline(r[1] ?? '')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DataTable({
  header,
  rows,
  numeric,
}: {
  header: string[]
  rows: string[][]
  numeric: boolean[]
}) {
  return (
    <div className="my-3 overflow-hidden rounded-2xl border border-border">
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr className="bg-content">
              {header.map((h, i) => (
                <th
                  key={i}
                  className={cn(
                    'whitespace-nowrap px-3.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-ink-muted',
                    numeric[i] ? 'text-right' : 'text-left',
                  )}
                >
                  {stripMarks(h)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, ri) => (
              <tr
                key={ri}
                className="border-t border-border transition-colors hover:bg-accent-soft/40"
              >
                {header.map((_, ci) => (
                  <td
                    key={ci}
                    className={cn(
                      'px-3.5 py-2.5 text-ink',
                      numeric[ci] ? 'whitespace-nowrap text-right tabular' : 'text-left',
                    )}
                  >
                    {inline(r[ci] ?? '')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// Bold, italic, and inline code inside a line of prose.
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|(?<![*\w])\*[^*\n]+\*(?!\w))/g)
  return parts.filter(Boolean).map((p, i) => {
    if (/^\*\*[^*]+\*\*$/.test(p)) {
      return (
        <strong key={i} className="font-semibold text-ink">
          {p.slice(2, -2)}
        </strong>
      )
    }
    if (/^`[^`]+`$/.test(p)) {
      return (
        <code
          key={i}
          className="rounded-md border border-border bg-content px-1.5 py-0.5 font-mono text-[0.85em] text-ink-muted"
        >
          {p.slice(1, -1)}
        </code>
      )
    }
    if (/^\*[^*]+\*$/.test(p)) {
      return (
        <em key={i} className="italic">
          {p.slice(1, -1)}
        </em>
      )
    }
    return <Fragment key={i}>{p}</Fragment>
  })
}
