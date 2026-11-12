import type { ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Clock, Timer } from 'lucide-react'
import OnTheClock from './OnTheClock'
import FlexWashLabor from './FlexWashLabor'

// Dedicated On the Clock page. The iSolved tab is the shared live OnTheClock view
// (also a tab inside Labor Data); the FlexWash tab is labor from FlexWash's own
// time clock. ?tab=flexwash opens the FlexWash tab.
export default function OnTheClockPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'flexwash' ? 'flexwash' : 'isolved'
  const pick = (t: 'isolved' | 'flexwash') => setParams(t === 'flexwash' ? { tab: 'flexwash' } : {}, { replace: true })

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-ink">
          <Timer className="size-6 text-accent" /> On the Clock
        </h1>
        <p className="mt-1 text-sm text-ink-muted">
          {tab === 'flexwash'
            ? 'Labor hours and cost by site from FlexWash’s time clock, for today, this week and this pay period.'
            : 'Who’s currently clocked in across every site, live from iSolved: hours, estimated cost, PTO, and check punches.'}
        </p>
      </div>
      <div className="mt-5 flex items-center gap-2 border-b border-border" role="tablist">
        <Tab active={tab === 'isolved'} onClick={() => pick('isolved')} icon={<Timer className="size-4" />} label="iSolved" />
        <Tab active={tab === 'flexwash'} onClick={() => pick('flexwash')} icon={<Clock className="size-4" />} label="FlexWash" />
      </div>
      {tab === 'flexwash' ? <FlexWashLabor /> : <OnTheClock />}
    </div>
  )
}

function Tab({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: ReactNode; label: string }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-semibold ${active ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
    >
      {icon}
      {label}
    </button>
  )
}
