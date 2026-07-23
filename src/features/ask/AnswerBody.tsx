import { Fragment } from 'react'
import { numericColumns, parse, stripMarks } from '@/features/ask/answerBlocks'
import { cn } from '@/lib/utils'

// Renderer for the model's markdown. Deliberately hand-rolled rather than
// pulling in a markdown dependency (see the bundle rule in CLAUDE.md), but with
// enough structure to render as a designed surface: card tables with numeric
// alignment, small two-column results promoted to stat tiles, callouts, and
// code blocks.

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
