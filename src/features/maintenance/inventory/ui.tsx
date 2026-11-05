/* eslint-disable react-refresh/only-export-components -- useDebounced lives with the search box it serves */
import { useEffect, useState, type ReactNode } from 'react'
import { ImageOff, Loader2, Minus, Plus, Search } from 'lucide-react'
import { Input } from '@/components/ui/Input'
import { mi } from '@/lib/queries/maintenanceInventory'
import { cn } from '@/lib/utils'
import { qty } from './format'

// Small pieces shared across the module's screens. Big tap targets: most of this gets
// used one-handed on a phone.

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('rounded-lg border border-border bg-card p-4', className)}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export function Loading({ label }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-2 py-10 text-sm text-ink-muted">
      <Loader2 className="size-5 animate-spin" />
      {label}
    </div>
  )
}

export function ErrorNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{children}</p>
}

export function WarnNote({ children }: { children: ReactNode }) {
  return <p className="rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">{children}</p>
}

export function Muted({ children }: { children: ReactNode }) {
  return <p className="py-2 text-sm text-ink-muted">{children}</p>
}

export function Stepper({ value, onChange, min = 0, step = 1, label }: { value: number; onChange: (n: number) => void; min?: number; step?: number; label?: string }) {
  const set = (n: number) => onChange(Math.max(min, Math.round(n * 1000) / 1000))
  return (
    <div className="flex items-center gap-2" role="group" aria-label={label ?? 'Quantity'}>
      <button type="button" onClick={() => set(value - step)} aria-label="Less"
        className="grid size-14 place-items-center rounded-lg border border-border bg-card text-ink active:bg-content">
        <Minus className="size-6" />
      </button>
      <input
        inputMode="decimal"
        value={String(value)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const n = Number(e.target.value)
          if (!Number.isNaN(n)) set(n)
        }}
        className="h-14 w-24 rounded-lg border border-border bg-card text-center text-2xl font-semibold tabular-nums text-ink"
        aria-label={label ?? 'Quantity'}
      />
      <button type="button" onClick={() => set(value + step)} aria-label="More"
        className="grid size-14 place-items-center rounded-lg border border-border bg-card text-ink active:bg-content">
        <Plus className="size-6" />
      </button>
    </div>
  )
}

export function SearchBox({ value, onChange, placeholder, className }: { value: string; onChange: (v: string) => void; placeholder: string; className?: string }) {
  return (
    <div className={cn('relative', className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
      <Input value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-9" />
    </div>
  )
}

// Waits for typing to pause, so each search isn't a request per letter.
export function useDebounced<T>(value: T, ms = 250): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(id)
  }, [value, ms])
  return v
}

export function Chips<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string; count?: number }> }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-1 [scrollbar-width:none]">
      {options.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={cn('shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-sm font-medium transition',
            value === o.value ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink-muted hover:text-ink')}>
          {o.label}{o.count != null ? ` (${o.count})` : ''}
        </button>
      ))}
    </div>
  )
}

const photoUrls = new Map<string, Promise<string | null>>()
export function Thumb({ path, className }: { path: string | null | undefined; className?: string }) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    let alive = true
    let p = photoUrls.get(path)
    if (!p) {
      p = mi.fileUrl(path)
      photoUrls.set(path, p)
    }
    void p.then((u) => { if (alive) setUrl(u) })
    return () => { alive = false }
  }, [path])
  const box = cn('grid size-11 shrink-0 place-items-center overflow-hidden rounded-md border border-border bg-content text-ink-subtle', className)
  if (!path || !url) return <div className={box}><ImageOff className="size-4" /></div>
  return <div className={box}><img src={url} alt="" className="size-full object-cover" loading="lazy" /></div>
}

export function StockFacts({ onHand, available, reserved, uom }: { onHand: number; available: number; reserved: number; uom?: string | null }) {
  return (
    <span className="tabular-nums">
      {qty(onHand)} on hand{uom && uom !== 'ea' ? ` ${uom}` : ''}
      {reserved > 0 ? `, ${qty(available)} free` : ''}
    </span>
  )
}

// Button-shaped row for lists a thumb picks from.
export function RowButton({ onClick, children, className }: { onClick?: () => void; children: ReactNode; className?: string }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex min-h-14 w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-left transition hover:bg-content active:bg-content', className)}>
      {children}
    </button>
  )
}
