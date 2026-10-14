import { Timer } from 'lucide-react'
import OnTheClock from './OnTheClock'

// Dedicated page for the live "On the Clock" view. The same view also lives as a
// tab inside Labor Data (LaborReport); this just wraps the shared OnTheClock
// component with its own header so it can be reached directly from the nav.
export default function OnTheClockPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
          <Timer className="size-6 text-accent" /> On the Clock
        </h1>
        <p className="mt-1 text-sm text-ink-muted">Who's currently clocked in across every site, live from iSolved — hours, estimated cost, PTO, and check punches.</p>
      </div>
      <OnTheClock />
    </div>
  )
}
