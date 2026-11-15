import { CarFront } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { statusOf, type Machine } from './machines'

// The strip along the bottom while the camera rides the car: the machine it is passing,
// how far along the ride is, and the way out. The bar's fill is written straight to the
// page by the view (barRef) as the scene reports progress, never through a render.

type Props = {
  near: Machine | null
  preview: boolean
  barRef: (el: HTMLDivElement | null) => void
  onStop: () => void
}

export function RideCaption({ near, preview, barRef, onStop }: Props) {
  return (
    <div data-t3d="ride" className="pointer-events-auto flex w-[26rem] max-w-full items-center gap-3 rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur-sm">
      <CarFront className="size-5 shrink-0 text-accent" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-semibold text-ink">{near ? near.name : 'Riding through the tunnel'}</span>
          {!preview && near?.asset && <Badge tone={statusOf(near.asset).tone} className="shrink-0">{statusOf(near.asset).short}</Badge>}
          {!preview && near && !near.asset && <span className="shrink-0 text-xs text-ink-subtle">Not linked</span>}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-border" role="progressbar" aria-label="Ride progress" aria-valuemin={0} aria-valuemax={100}>
          <div ref={barRef} className="h-full origin-left rounded-full bg-accent" />
        </div>
      </div>
      <Button size="sm" variant="secondary" onClick={onStop} aria-label="Stop the ride" className="@max-[520px]:h-11 pointer-coarse:h-11">Stop</Button>
    </div>
  )
}
