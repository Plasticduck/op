import { Link } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { MarketingNav, MarketingFooter, PricingCards } from './components'

export default function PricingPage() {
  return (
    <div className="min-h-dvh bg-content">
      <MarketingNav />
      <section className="mx-auto w-full max-w-4xl px-4 py-16 sm:px-6">
        <div className="text-center">
          <h1 className="text-3xl font-semibold tracking-tight text-ink">Pricing</h1>
          <p className="mt-2 text-sm text-ink-muted">
            14-day free trial on every plan. No credit card to start. Cancel anytime.
          </p>
        </div>
        <div className="mt-10">
          <PricingCards />
        </div>

        <div className="mt-12 rounded-lg border border-border bg-card p-6">
          <h2 className="text-sm font-semibold text-ink">Questions operators ask</h2>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              { q: 'Do I need a credit card to try it?', a: 'No. Start a 14-day trial and explore everything. A card is only required when you subscribe.' },
              { q: 'How does multi-location billing work?', a: '$79 per active location per month, minimum two. Archive a location and billing adjusts automatically.' },
              { q: 'Can employees use it on their phones?', a: 'Yes. The time clock kiosk, checklists, schedule, and documents all work on a phone.' },
              { q: 'Want a hand setting up?', a: 'A WashLyfe Support Agent can set things up for you. Entirely optional, and never a gate to trying it yourself.' },
            ].map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-medium text-ink">{f.q}</dt>
                <dd className="mt-1 text-sm text-ink-muted">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link to="/signup"><Button size="lg">Start free trial</Button></Link>
          <Link to="/demo"><Button size="lg" variant="secondary">Try on-demand demo</Button></Link>
        </div>
      </section>
      <MarketingFooter />
    </div>
  )
}
