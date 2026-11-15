import { Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ColorBy } from '../types'

// What the marks on the floor mean, in the diagram's own words (DiagramLegend), as a
// short list that fits a corner of the canvas. The swatches copy the pads' patterns as
// well as their colors (status.ts): hatched is act now, solid is look at this, a light
// fill is fine, dashes mean there is no machine to speak of.

const SWATCH = {
  ok: 'border-ok bg-ok-soft',
  warn: 'border-warn bg-warn/55',
  danger: 'border-danger bg-[repeating-linear-gradient(135deg,var(--color-danger)_0_1.5px,var(--color-danger-soft)_1.5px_4px)]',
  quiet: 'border-ink-subtle bg-card',
  few: 'border-accent bg-accent/10',
  most: 'border-accent bg-accent/85',
  dashed: 'border-dashed border-ink-subtle bg-transparent',
  retired: 'border-dashed border-ink-subtle bg-border-strong',
  // Nothing is drawn for it: the row keeps its place in the list.
  none: 'border-transparent',
} as const

type Row = [keyof typeof SWATCH, string]

// In the status view a running machine keeps its real colors and gets no mark at all:
// only the ones that are down are flagged.
const ROWS: Record<ColorBy, { title: string; rows: Row[] }> = {
  status: { title: 'Status', rows: [['danger', 'Broken down'], ['warn', 'Down for maintenance'], ['none', 'Running: no mark']] },
  wos: { title: 'Open work orders', rows: [['quiet', 'No open work orders'], ['warn', 'One open'], ['danger', 'Two or more']] },
  sticker: { title: 'Sticker', rows: [['ok', 'Sticker printed'], ['warn', 'Tag made, not printed'], ['danger', 'No sticker']] },
  usage: { title: 'Use count', rows: [['few', 'Fewer cars'], ['most', 'Most cars since its start date'], ['quiet', 'No start date']] },
}

type Props = {
  colorBy: ColorBy
  // Some shape has no machine linked, or a machine that is retired: say what those look like.
  unlinked: boolean
  retired: boolean
  className?: string
}

export function Legend({ colorBy, unlinked, retired, className }: Props) {
  const { title, rows } = ROWS[colorBy] ?? ROWS.status
  const all: Row[] = [...rows]
  if (retired) all.push(['retired', 'Retired'])
  if (unlinked) all.push(['dashed', 'Dashed: no machine linked'])
  return (
    <div data-t3d="legend" className={cn('pointer-events-auto rounded-lg border border-border bg-card/90 px-3 py-2 text-xs text-ink-muted shadow-sm backdrop-blur-sm', className)}>
      <div className="mb-1 font-semibold text-ink">{title}</div>
      <ul className="flex flex-col gap-1">
        {all.map(([tone, label]) => (
          <li key={label} className="flex items-center gap-2">
            <span aria-hidden className={cn('size-3 shrink-0 rounded-[3px] border-[1.5px]', SWATCH[tone])} />{label}
          </li>
        ))}
      </ul>
    </div>
  )
}

// On a narrow canvas the legend folds into a button in the top left corner. Open, it is a
// control like the toolbar: the name chip keeps out from under it. On a phone it opens
// beside the toolbar's column, which stands under the button.
export function FoldedLegend({ open, onToggle, ...legend }: Props & { open: boolean; onToggle: () => void }) {
  return (
    <div data-t3d-keepout className="absolute left-2 top-[calc(0.5rem+var(--t3d-top))] z-20 @min-[640px]:hidden">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border bg-card/90 px-3 text-xs font-medium text-ink-muted shadow-sm backdrop-blur-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent aria-expanded:bg-accent-soft aria-expanded:text-accent @max-[520px]:h-12 pointer-coarse:h-12">
        <Info className="size-4" /> Legend
      </button>
      {open && <Legend {...legend} className="mt-1.5 w-max bg-card @max-[520px]:ml-[3.5rem]" />}
    </div>
  )
}
