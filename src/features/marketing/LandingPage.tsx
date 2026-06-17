import { Link } from 'react-router-dom'
import {
  BarChart3,
  ClipboardList,
  Sparkles,
  Users,
} from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { MarketingNav, MarketingFooter, PricingCards, Reveal } from './components'

export default function LandingPage() {
  return (
    <div className="min-h-dvh bg-content">
      <MarketingNav />

      {/* Hero (centered) */}
      <section className="mx-auto w-full max-w-3xl px-4 pt-16 pb-10 text-center sm:px-6 lg:pt-24">
        <h1 className="text-4xl font-semibold leading-tight tracking-tight text-ink sm:text-5xl">
          Everything your car wash runs on, in one place.
        </h1>
        <p className="mx-auto mt-4 max-w-xl text-lg text-ink-muted">
          Checklists, work orders, scheduling, time clock, and reporting, built
          for tunnel and conveyor operators. No more paper and spreadsheets.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Link to="/signup">
            <Button size="lg">Start free trial</Button>
          </Link>
          <Link to="/demo">
            <Button size="lg" variant="secondary">Try on-demand demo</Button>
          </Link>
        </div>
        <p className="mt-3 text-xs text-ink-subtle">
          14 days free · no credit card · cancel anytime
        </p>
      </section>

      {/* Big dashboard preview, revealed on scroll */}
      <section className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6 lg:pb-24">
        <Reveal>
          <DashboardShot />
        </Reveal>
      </section>

      {/* Problem */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto grid w-full max-w-6xl gap-6 px-4 py-12 sm:grid-cols-3 sm:px-6">
          {[
            { t: 'Paper checklists vanish', d: 'Opening and closing routines live on clipboards no one can audit later.' },
            { t: 'No shift visibility', d: 'Who clocked in, who is over 40 hours, who missed a shift. All guesswork.' },
            { t: 'Disconnected tools', d: 'Work orders in texts, sales in a notebook, HR in a filing cabinet.' },
          ].map((p) => (
            <div key={p.t}>
              <h3 className="font-medium text-ink">{p.t}</h3>
              <p className="mt-1 text-sm text-ink-muted">{p.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solution */}
      <section className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-ink">
          Three modules, one login
        </h2>
        <div className="mt-8 grid gap-4 md:grid-cols-3">
          <ModuleCard
            tone="accent"
            icon={ClipboardList}
            title="Ops"
            items={['Checklists & overdue alerts', 'Work orders + parts inventory', 'Equipment & downtime tracking', 'Closeouts & documents']}
          />
          <ModuleCard
            tone="warn"
            icon={Users}
            title="People"
            items={['Weekly schedule builder', 'Time clock kiosk with PINs', 'Timesheets & payroll export', 'Reviews, counseling, injuries']}
          />
          <ModuleCard
            tone="ok"
            icon={BarChart3}
            title="Reports & Insights"
            items={['11 prebuilt reports', 'CSV & PDF export', 'Cross-location comparisons', 'AI-generated insight cards']}
          />
        </div>
      </section>

      {/* AI Insights callout */}
      <section className="border-y border-border bg-card">
        <div className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2 lg:items-center">
          <div>
            <div className="mb-2 inline-flex items-center gap-2 text-accent">
              <Sparkles className="size-5" />
              <span className="text-sm font-medium uppercase tracking-wide">AI Insights</span>
            </div>
            <h2 className="text-2xl font-semibold tracking-tight text-ink">
              Your data tells a story, and WashLyfe reads it for you.
            </h2>
            <p className="mt-3 max-w-md text-sm text-ink-muted">
              Every night, WashLyfe analyzes your operations and surfaces
              specific, actionable observations, not dashboards you have to
              decode.
            </p>
          </div>
          <div className="flex flex-col gap-3">
            <InsightCard tone="warn" text="Bay 2 tunnel motor caused 4 of your last 6 downtime events this month. Schedule preventive service before the weekend." />
            <InsightCard tone="danger" text="Friday's closeout shows a $215 cash discrepancy between sales and deposit." />
            <InsightCard tone="accent" text="Downtown checklist completion is 94% vs Highway 40 at 71%. Worth sharing the workflow." />
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6">
        <h2 className="text-center text-2xl font-semibold tracking-tight text-ink">
          Straightforward pricing
        </h2>
        <p className="mt-1 text-center text-sm text-ink-muted">
          Real prices, right here. No "contact sales."
        </p>
        <div className="mt-8">
          <PricingCards />
        </div>
      </section>

      <MarketingFooter />
    </div>
  )
}

// Full class strings per tone — Tailwind's JIT needs them spelled out, not
// composed from variables.
const MODULE_TONES = {
  accent: { iconBg: 'bg-accent-soft', iconText: 'text-accent', dot: 'bg-accent' },
  warn: { iconBg: 'bg-warn-soft', iconText: 'text-warn', dot: 'bg-warn' },
  ok: { iconBg: 'bg-ok-soft', iconText: 'text-ok', dot: 'bg-ok' },
} as const

function ModuleCard({
  icon: Icon,
  title,
  items,
  tone,
}: {
  icon: typeof Users
  title: string
  items: string[]
  tone: keyof typeof MODULE_TONES
}) {
  const t = MODULE_TONES[tone]
  return (
    <div className="group rounded-lg border border-border bg-card p-6 transition duration-200 hover:-translate-y-0.5 hover:border-ink-muted/30 hover:shadow-md motion-reduce:hover:translate-y-0">
      <div className={`mb-4 inline-flex rounded-md p-2 ${t.iconBg} ${t.iconText}`}>
        <Icon className="size-5" />
      </div>
      <h3 className="text-lg font-semibold tracking-tight text-ink">{title}</h3>
      <ul className="mt-3 flex flex-col gap-2 text-sm text-ink-muted">
        {items.map((i) => (
          <li key={i} className="flex items-start gap-2.5">
            <span className={`mt-1.5 size-1.5 shrink-0 rounded-full ${t.dot}`} />
            <span>{i}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function InsightCard({ tone, text }: { tone: 'accent' | 'warn' | 'danger'; text: string }) {
  return (
    <div className="rounded-md border border-border bg-content p-3 text-sm">
      <Badge tone={tone}>{tone === 'danger' ? 'Critical' : tone === 'warn' ? 'Warning' : 'Info'}</Badge>
      <p className="mt-2 text-ink">{text}</p>
    </div>
  )
}

// A real screenshot of the dashboard, framed like an app window.
function DashboardShot() {
  return (
    <figure className="overflow-hidden rounded-xl border border-border bg-card shadow-2xl ring-1 ring-black/5">
      <div className="flex items-center gap-1.5 border-b border-border bg-content px-4 py-2.5">
        <span className="size-3 rounded-full bg-border" />
        <span className="size-3 rounded-full bg-border" />
        <span className="size-3 rounded-full bg-border" />
      </div>
      <img
        src="/dashboard-preview.png"
        alt="The Operator dashboard showing the weekly weather outlook, open work orders, recent sales, parts alerts, and key stats"
        className="block w-full"
        loading="lazy"
      />
    </figure>
  )
}
