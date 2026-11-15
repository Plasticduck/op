import { alongText, signed } from './machines'

// What a machine in someone's hand says at its feet: where it is, how far it has come from
// where it is saved, and which machines it now stands on. Overlapping is allowed (the
// drawing may be rough), so it is said in the warning tone and nothing stops the drop.

type Props = {
  name: string
  // Where it is now and where it is saved, in layout feet.
  x: number
  y: number
  from: { x_ft: number; y_ft: number }
  // Beside the tunnel a machine also moves across: say that too.
  across: boolean
  overlaps: string[]
}

function listNames(names: string[]): string {
  if (names.length <= 2) return names.join(' and ')
  return `${names[0]} and ${names.length - 1} more`
}

export function MoveReadout({ name, x, y, from, across, overlaps }: Props) {
  const sideways = across && Math.abs(y - from.y_ft) > 0.04
  return (
    <div data-t3d="readout" className="w-max max-w-72 rounded-lg border border-border bg-card px-2.5 py-1.5 text-xs shadow-md">
      <div className="font-semibold tabular-nums text-ink">
        {name}: {alongText(x)}{' '}
        <span className="font-normal text-ink-muted">({signed(x - from.x_ft)}{sideways ? `, ${signed(y - from.y_ft)} across` : ''})</span>
      </div>
      {overlaps.length > 0 && <div className="font-medium text-warn">Overlaps {listNames(overlaps)}</div>}
    </div>
  )
}
