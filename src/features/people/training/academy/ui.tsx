import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Check, UserRound, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAcademy } from './context'

export function Eyebrow({ children, tone = 'muted', className }: { children: ReactNode; tone?: 'muted' | 'red' | 'blue'; className?: string }) {
  return (
    <div
      className={cn(
        'text-[11px] font-bold uppercase tracking-[0.08em]',
        tone === 'red' ? 'text-danger' : tone === 'blue' ? 'text-accent' : 'text-ink-muted',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function WhyBox({ text, label = 'Why this matters' }: { text: string | null | undefined; label?: string }) {
  if (!text) return null
  return (
    <div className="rounded-lg border border-accent/40 bg-accent-soft px-4 py-3">
      <Eyebrow tone="blue">{label}</Eyebrow>
      <p className="mt-1 text-[15px] leading-relaxed text-ink">{text}</p>
    </div>
  )
}

export function DraftNote({ show }: { show: boolean }) {
  const { outline } = useAcademy()
  if (!show) return null
  return (
    <div className="rounded-lg border border-warn/40 bg-warn-soft px-4 py-2.5 text-sm text-warn">
      {outline?.program?.draft_note || 'Draft standards for this level. Details may change after review.'}
    </div>
  )
}

export function Bar({ pct, className }: { pct: number; className?: string }) {
  return (
    <div className={cn('h-2 overflow-hidden rounded-full bg-border/70', className)}>
      <div className={cn('h-full rounded-full', pct >= 100 ? 'bg-ok' : 'bg-accent')} style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
    </div>
  )
}

export function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border py-2 text-sm">
      <span className="text-ink-muted">{label}</span>
      <b className="text-right font-semibold text-ink">{value}</b>
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5', className)}>{children}</div>
}

export function Dot({ done, dashed }: { done?: boolean; dashed?: boolean }) {
  return (
    <span
      className={cn(
        'inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2',
        done ? 'border-ok bg-ok text-white' : 'border-border-strong',
        dashed && !done && 'border-dashed',
      )}
    >
      {done && <Check className="size-2.5" strokeWidth={4} />}
    </span>
  )
}

export function Pill({ children, tone = 'neutral' }: { children: ReactNode; tone?: 'neutral' | 'ok' | 'warn' | 'red' | 'blue' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'red' && 'bg-danger-soft text-danger',
        tone === 'blue' && 'bg-accent-soft text-accent',
        tone === 'neutral' && 'bg-border/60 text-ink-muted',
      )}
    >
      {children}
    </span>
  )
}

// Shown on every Academy screen while a leader is training a team member on this device.
export function TraineeBar() {
  const { trainee, stopTrainee, me } = useAcademy()
  if (!trainee) return null
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-warn/50 bg-warn-soft px-3 py-2 text-sm text-ink">
      <span className="inline-flex items-center gap-2">
        <UserRound className="size-4 text-warn" />
        <span>
          Training <b>{trainee.name}</b> on this device. Their answers and sign-offs save to them
          {me?.learner ? ', not to you.' : '.'}
        </span>
      </span>
      <button
        type="button"
        onClick={stopTrainee}
        className="inline-flex items-center gap-1 rounded-md border border-border bg-card px-2 py-1 text-xs font-medium text-ink hover:bg-content"
      >
        <X className="size-3.5" /> Done training
      </button>
    </div>
  )
}

// A link that looks like a Button.
export function LinkButton({
  to, children, variant = 'primary', size = 'md', className,
}: { to: string; children: ReactNode; variant?: 'primary' | 'secondary'; size?: 'sm' | 'md'; className?: string }) {
  return (
    <Link
      to={to}
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-md font-medium transition',
        size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        variant === 'primary' ? 'bg-accent text-white hover:bg-accent-hover' : 'border border-border bg-card text-ink hover:bg-content',
        className,
      )}
    >
      {children}
    </Link>
  )
}

export function BackLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link to={to} className="text-sm text-ink-muted hover:text-ink">
      ← {children}
    </Link>
  )
}
