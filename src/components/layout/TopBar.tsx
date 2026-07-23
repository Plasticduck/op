import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, Bell, Check, ChevronDown, CreditCard, LogOut, Search, Wrench } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { useNotifications, type Notification } from '@/lib/notifications'
import { timeAgo } from '@/lib/format'
import { ROLE_LABEL } from '@/lib/rbac'
import { cn } from '@/lib/utils'

function renderNotification(n: Notification): { icon: typeof Bell; text: string; to: string } {
  const p = n.payload
  switch (n.kind) {
    case 'work_order_assigned':
      return {
        icon: Wrench,
        text: `Assigned to you: ${String(p.title ?? 'a work order')}`,
        to: `/app/work-orders/${String(p.work_order_id ?? '')}`,
      }
    case 'low_stock':
      return {
        icon: AlertTriangle,
        text: `Low stock: ${String(p.name ?? 'a part')} (${String(p.quantity ?? 0)} left)`,
        to: '/app/parts',
      }
    default:
      return { icon: Bell, text: n.kind, to: '/app/dashboard' }
  }
}

export function TopBar() {
  const { profile, signOut } = useAuth()
  const { locations, activeLocation, setActiveId } = useLocations()
  const { items, unread, markRead, markAllRead } = useNotifications()
  const [locOpen, setLocOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [bellOpen, setBellOpen] = useState(false)
  const locRef = useRef<HTMLDivElement>(null)
  const userRef = useRef<HTMLDivElement>(null)
  const bellRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (locRef.current && !locRef.current.contains(e.target as Node))
        setLocOpen(false)
      if (userRef.current && !userRef.current.contains(e.target as Node))
        setUserOpen(false)
      if (bellRef.current && !bellRef.current.contains(e.target as Node))
        setBellOpen(false)
    }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [])

  if (!profile) return null

  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border bg-card px-4 pt-[env(safe-area-inset-top)] [box-sizing:content-box]">
      <Link to="/app/dashboard" className="lg:hidden" aria-label="WashLyfe">
        <Logo size="sm" />
      </Link>
      <button
        type="button"
        onClick={() => window.dispatchEvent(new CustomEvent('command-palette:open'))}
        aria-label="Jump to a page"
        className="relative hidden h-9 w-72 max-w-full items-center gap-2 rounded-md border border-border bg-content/60 pl-3 pr-1.5 text-sm text-ink-muted hover:border-accent/40 hover:text-ink sm:flex"
      >
        <Search className="size-4 text-ink-subtle" />
        <span>Jump to a page...</span>
        <kbd className="ml-auto rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">⌘ K</kbd>
      </button>

      <div className="ml-auto flex items-center gap-2">
        {/* Location switcher */}
        {locations.length > 0 && (
          <div className="relative" ref={locRef}>
            <button
              type="button"
              onClick={() => setLocOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-ink-muted hover:text-ink"
            >
              <span className="font-medium text-ink">
                {activeLocation?.name ?? 'Select location'}
              </span>
              <ChevronDown className="size-3.5" />
            </button>
            {locOpen && (
              <div className="absolute right-0 mt-1 max-h-[70vh] w-52 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg">
                {locations.map((l) => (
                  <button
                    key={l.id}
                    type="button"
                    onClick={() => {
                      setActiveId(l.id)
                      setLocOpen(false)
                    }}
                    className={cn(
                      'flex w-full items-center justify-between px-3 py-1.5 text-sm hover:bg-content',
                      l.id === activeLocation?.id ? 'text-ink' : 'text-ink-muted',
                    )}
                  >
                    {l.name}
                    {l.id === activeLocation?.id && (
                      <Check className="size-3.5 text-accent" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <ThemeToggle />

        <div className="relative" ref={bellRef}>
          <button
            type="button"
            aria-label="Notifications"
            onClick={() => setBellOpen((v) => !v)}
            className="relative rounded-md p-1.5 text-ink-muted hover:bg-content hover:text-ink"
          >
            <Bell className="size-5" />
            {unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-accent px-1 text-[10px] font-semibold text-white">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
          </button>
          {bellOpen && (
            <div className="absolute right-0 mt-1 w-80 overflow-hidden rounded-md border border-border bg-card shadow-lg">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <span className="text-sm font-semibold text-ink">Notifications</span>
                {unread > 0 && (
                  <button onClick={() => void markAllRead()} className="text-xs text-accent hover:underline">
                    Mark all read
                  </button>
                )}
              </div>
              <div className="max-h-96 overflow-y-auto">
                {items.length === 0 ? (
                  <p className="px-3 py-6 text-center text-sm text-ink-muted">You're all caught up.</p>
                ) : (
                  items.map((n) => {
                    const r = renderNotification(n)
                    return (
                      <Link
                        key={n.id}
                        to={r.to}
                        onClick={() => { void markRead(n.id); setBellOpen(false) }}
                        className={cn(
                          'flex items-start gap-2.5 border-b border-border px-3 py-2.5 last:border-0 hover:bg-content',
                          !n.read_at && 'bg-accent-soft/40',
                        )}
                      >
                        <r.icon className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                        <div className="min-w-0">
                          <p className="text-sm text-ink">{r.text}</p>
                          <p className="text-xs text-ink-muted">{timeAgo(n.created_at)}</p>
                        </div>
                        {!n.read_at && <span className="ml-auto mt-1 size-2 shrink-0 rounded-full bg-accent" />}
                      </Link>
                    )
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* User menu */}
        <div className="relative" ref={userRef}>
          <button
            type="button"
            onClick={() => setUserOpen((v) => !v)}
            className="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-content"
          >
            <div className="grid size-7 place-items-center rounded-full bg-accent/15 text-xs font-semibold uppercase text-accent">
              {profile.name.charAt(0)}
            </div>
            <div className="hidden text-left text-xs leading-tight sm:block">
              <div className="font-medium text-ink">{profile.name}</div>
              <div className="text-ink-muted">{ROLE_LABEL[profile.role]}</div>
            </div>
            <ChevronDown className="hidden size-3.5 text-ink-muted sm:block" />
          </button>
          {userOpen && (
            <div className="absolute right-0 mt-1 w-48 overflow-hidden rounded-md border border-border bg-card py-1 shadow-lg">
              <div className="border-b border-border px-3 py-2 text-xs text-ink-muted">
                {profile.email}
              </div>
              {profile.role === 'owner' && (
                <Link
                  to="/app/settings/billing"
                  onClick={() => setUserOpen(false)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-content"
                >
                  <CreditCard className="size-4" />
                  Billing & subscription
                </Link>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-ink hover:bg-content"
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
