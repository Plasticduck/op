import { useEffect, useRef } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { cn } from '@/lib/utils'

// The module's screens as a segmented control under the page title, the same as IT
// Inventory's. Stock groups transfers, counts, reorder and POs under one tab with its own
// row underneath. On a phone the bar scrolls sideways and keeps the current screen in view.

const BASE = '/app/maintenance-inventory'

const SECTIONS: Array<{ to: string; label: string; end?: boolean; match?: RegExp; minRank: number }> = [
  { to: BASE, label: 'Overview', end: true, minRank: 1 },
  { to: `${BASE}/equipment`, label: 'Equipment', minRank: 1 },
  { to: `${BASE}/tunnel`, label: 'Tunnel', minRank: 1 },
  { to: `${BASE}/parts`, label: 'Parts', minRank: 1 },
  { to: `${BASE}/tools`, label: 'Tools', minRank: 1 },
  { to: `${BASE}/transfers`, label: 'Stock', match: /\/(transfers|counts|reorder|pos)(\/|$)/, minRank: 1 },
  { to: `${BASE}/work-orders`, label: 'Work orders', minRank: 1 },
]

const STOCK: Array<{ to: string; label: string; minRank: number }> = [
  { to: `${BASE}/transfers`, label: 'Transfers', minRank: 1 },
  { to: `${BASE}/counts`, label: 'Counts', minRank: 1 },
  { to: `${BASE}/reorder`, label: 'Reorder', minRank: 2 },
  { to: `${BASE}/pos`, label: 'POs', minRank: 2 },
]

const tab = (active: boolean) => cn(
  'shrink-0 whitespace-nowrap rounded-md px-3 py-1.5 text-center text-sm font-medium transition',
  active ? 'bg-accent-soft text-accent' : 'text-ink-muted hover:text-ink',
)

export function SectionNav({ rank }: { rank: number }) {
  const nav = useRef<HTMLElement>(null)
  const { pathname } = useLocation()
  useEffect(() => {
    nav.current?.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [pathname])
  const inStock = /\/(transfers|counts|reorder|pos)(\/|$)/.test(pathname)
  return (
    <div className="flex flex-col gap-2">
      <nav ref={nav} aria-label="Maintenance Inventory"
        className="flex w-full gap-0.5 overflow-x-auto rounded-lg border border-border bg-card p-0.5 [scrollbar-width:none] sm:w-fit">
        {SECTIONS.filter((s) => rank >= s.minRank).map((s) => (
          <NavLink key={s.to} to={s.to} end={s.end}
            aria-current={s.match ? (s.match.test(pathname) ? 'page' : undefined) : undefined}
            className={({ isActive }) => tab(s.match ? s.match.test(pathname) : isActive)}>
            {s.label}
          </NavLink>
        ))}
      </nav>
      {inStock && (
        <nav aria-label="Stock" className="flex gap-1 overflow-x-auto [scrollbar-width:none]">
          {STOCK.filter((s) => rank >= s.minRank).map((s) => (
            <NavLink key={s.to} to={s.to}
              className={({ isActive }) => cn('shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-sm transition',
                isActive ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink-muted hover:text-ink')}>
              {s.label}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  )
}
