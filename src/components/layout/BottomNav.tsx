import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Menu,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { SidebarNav } from '@/components/layout/Sidebar'
import type { Role } from '@/lib/rbac'
import { cn } from '@/lib/utils'

type Tab = { to: string; label: string; icon: LucideIcon; roles: Role[] }

// The handful of destinations that earn a permanent bottom-bar slot. Everything
// else lives behind "More". Filtered by role, capped at 4 so + More fits.
const TABS: Tab[] = [
  { to: '/app/dashboard', label: 'Home', icon: LayoutDashboard, roles: ['owner', 'manager', 'employee'] },
  { to: '/app/checklists', label: 'Checklists', icon: ClipboardList, roles: ['owner', 'manager', 'employee'] },
  { to: '/app/schedule', label: 'Schedule', icon: CalendarDays, roles: ['owner', 'manager', 'employee'] },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'manager'] },
]

// Native-app-style bottom tab bar for phones/tablets (hidden at lg+, where the
// fixed sidebar takes over). "More" opens a bottom sheet with the full menu.
export function BottomNav({ role }: { role: Role }) {
  const [open, setOpen] = useState(false)
  // Keep the sheet mounted briefly while closing so the slide-down animation
  // can play (React would otherwise unmount the instant `open` flips false).
  const [mounted, setMounted] = useState(false)
  // Drives the slide-up transition: false = parked off-screen at translate-y-full,
  // true = settled at translate-y-0. Flipped on next paint after mount so the
  // browser actually animates the change instead of starting in its final state.
  const [visible, setVisible] = useState(false)
  const tabs = TABS.filter((t) => t.roles.includes(role)).slice(0, 4)
  // Hide the bottom bar on mobile detail routes so chat / WO / asset / part
  // detail screens get the full bottom area + native keyboard handling. The
  // user can still navigate back to the list with the in-page back button.
  const { pathname } = useLocation()
  const hideOnMobile = /^\/app\/(messages|work-orders|assets|parts)\/[0-9a-f-]+/i.test(pathname)

  useEffect(() => {
    if (open) {
      setMounted(true)
      // Double rAF: React can batch mounted=true + visible=true into a single
      // commit, so the browser never paints the initial translate-y-full state
      // and the transition snaps instead of animates. Especially in iOS
      // WKWebView. Two rAFs guarantee one paint of the start state first.
      let inner = 0
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setVisible(true))
      })
      return () => {
        cancelAnimationFrame(outer)
        if (inner) cancelAnimationFrame(inner)
      }
    }
    setVisible(false)
    const id = setTimeout(() => setMounted(false), 300)
    return () => clearTimeout(id)
  }, [open])

  useEffect(() => {
    if (!mounted) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [mounted])

  const item =
    'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition'

  if (hideOnMobile) return null

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {tabs.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/app/dashboard'}
            className={({ isActive }) => cn(item, isActive ? 'text-accent' : 'text-ink-muted')}
          >
            <t.icon className="size-5" />
            {t.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setOpen(true)} className={cn(item, open ? 'text-accent' : 'text-ink-muted')}>
          <Menu className="size-5" />
          More
        </button>
      </nav>

      {mounted && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <button
            type="button"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
            className={cn(
              'absolute inset-0 bg-shell/50 backdrop-blur-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none',
              visible ? 'opacity-100' : 'opacity-0',
            )}
          />
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 flex max-h-[85vh] flex-col rounded-t-2xl bg-shell pb-[env(safe-area-inset-bottom)] text-ink-invert shadow-2xl',
              'transform-gpu transition-transform duration-300 ease-out motion-reduce:transition-none motion-reduce:transform-none',
              visible ? 'translate-y-0' : 'translate-y-full',
            )}
          >
            <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
              <Logo invert />
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close menu"
                className="rounded-md p-1 text-ink-invert-muted hover:bg-white/10 hover:text-white"
              >
                <X className="size-5" />
              </button>
            </div>
            <SidebarNav role={role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}
    </>
  )
}
