import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { cn } from '@/lib/utils'

// Fades + lifts its children into view the first time they enter the viewport.
// Respects reduced-motion preferences.
export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          io.disconnect()
        }
      },
      { threshold: 0.15 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <div
      ref={ref}
      className={cn(
        'transition-all duration-700 ease-out motion-reduce:transition-none motion-reduce:transform-none',
        shown ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-10 scale-[0.97] opacity-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-content/80 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          {/* Marketing surface keeps the WashLyfe lockup; the authenticated
              app + auth pages use the new Operator brand by default. */}
          <Logo brand="washlyfe" />
        </Link>
        <nav className="flex items-center gap-1 sm:gap-3">
          {/* Public-side theme switch. The app has its own in the top bar; the
              marketing surface has no top bar, so it lives here. */}
          <ThemeToggle />
          <Link to="/pricing" className="px-3 py-1.5 text-sm text-ink-muted hover:text-ink">
            Pricing
          </Link>
          <Link to="/login" className="px-3 py-1.5 text-sm text-ink-muted hover:text-ink">
            Sign in
          </Link>
          <Link to="/signup">
            <Button size="sm">Start free trial</Button>
          </Link>
        </nav>
      </div>
    </header>
  )
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border">
      <div className="mx-auto flex w-full max-w-6xl flex-col items-center gap-2 px-4 py-10 text-center sm:px-6">
        <h2 className="text-2xl font-semibold tracking-tight text-ink">
          Run your wash on one system.
        </h2>
        <p className="max-w-md text-sm text-ink-muted">
          14-day free trial. No credit card required.
        </p>
        <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
          <Link to="/signup">
            <Button>Start free trial</Button>
          </Link>
          <Link to="/demo">
            <Button variant="secondary">Try on-demand demo</Button>
          </Link>
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          Want help getting set up? Talk to a WashLyfe Support Agent. Optional, never required.
        </p>
        <div className="mt-6 flex items-center gap-4 text-xs">
          <Link to="/terms" className="text-ink-muted hover:text-ink">Terms of Service</Link>
          <Link to="/privacy" className="text-ink-muted hover:text-ink">Privacy Policy</Link>
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          © {new Date().getFullYear()} WashLyfe Operator. Operations + people for car wash teams.
        </p>
      </div>
    </footer>
  )
}

type Tier = {
  name: string
  price: string
  unit: string
  note: string
  features: string[]
  featured: boolean
  cta?: { label: string; href: string }
}

export function PricingCards() {
  const tiers: Tier[] = [
    {
      name: 'Single location',
      price: '$99',
      unit: '/month',
      note: 'or $990/year, two months free',
      features: ['One location', 'Unlimited team members', 'All Ops + People modules', 'Reports & AI Insights'],
      featured: true,
    },
    {
      name: 'Multi-location',
      price: '$79',
      unit: '/location/month',
      note: 'Minimum 2 locations',
      features: ['Everything in Single', 'Cross-location reports', 'Regional manager access', 'Per-location settings'],
      featured: false,
    },
    {
      name: 'Enterprise',
      price: 'Custom',
      unit: '',
      note: '20+ locations, pricing varies',
      features: ['Everything in Multi-location', 'Volume discount', 'Dedicated onboarding', 'Priority support'],
      featured: false,
      cta: { label: 'Contact for pricing', href: 'mailto:info@washlyfe.com?subject=Enterprise%20pricing%20inquiry' },
    },
  ]
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {tiers.map((t) => (
        <div
          key={t.name}
          className={
            'flex flex-col rounded-lg border bg-card p-6 ' +
            (t.featured ? 'border-accent ring-1 ring-accent' : 'border-border')
          }
        >
          <h3 className="font-medium text-ink">{t.name}</h3>
          <div className="mt-2 flex items-baseline gap-1">
            <span className="text-3xl font-semibold text-ink">{t.price}</span>
            {t.unit && <span className="text-sm text-ink-muted">{t.unit}</span>}
          </div>
          <p className="mt-1 text-xs text-ink-muted">{t.note}</p>
          <ul className="mt-4 flex flex-1 flex-col gap-2 text-sm text-ink">
            {t.features.map((f) => (
              <li key={f} className="flex items-center gap-2">
                <Check className="size-4 text-accent" /> {f}
              </li>
            ))}
          </ul>
          {t.cta ? (
            <a href={t.cta.href} className="mt-6">
              <Button className="w-full" variant="secondary">{t.cta.label}</Button>
            </a>
          ) : (
            <Link to="/signup" className="mt-6">
              <Button className="w-full" variant={t.featured ? 'primary' : 'secondary'}>
                Start free trial
              </Button>
            </Link>
          )}
        </div>
      ))}
    </div>
  )
}
