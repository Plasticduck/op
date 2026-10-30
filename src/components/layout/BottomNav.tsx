import { useEffect, useMemo, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  BarChart3,
  CalendarDays,
  Check,
  ClipboardList,
  LayoutDashboard,
  Loader2,
  Menu,
  Settings2,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { SidebarNav, useVisibleNavItems, type VisibleNavItem } from '@/components/layout/Sidebar'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { supabase } from '@/lib/supabase'
import { pageAllowed } from '@/lib/permissions'
import type { PermRole, Role } from '@/lib/rbac'
import { cn } from '@/lib/utils'

type Tab = { to: string; label: string; icon: LucideIcon; roles: Role[] }

// How many shortcut slots the bar holds before "More". Keeps room for + More.
const MAX_FAVORITES = 4

// The default shortcuts, used until a user customizes their own bar. Role-filtered
// and capped at MAX_FAVORITES.
const DEFAULT_TABS: Tab[] = [
  { to: '/app/dashboard', label: 'Home', icon: LayoutDashboard, roles: ['owner', 'manager', 'employee'] },
  { to: '/app/checklists', label: 'Checklists', icon: ClipboardList, roles: ['owner', 'manager', 'employee'] },
  { to: '/app/schedule', label: 'Schedule', icon: CalendarDays, roles: ['owner', 'manager', 'employee'] },
  { to: '/app/reports', label: 'Reports', icon: BarChart3, roles: ['owner', 'manager', 'technician'] },
]

type BarItem = { to: string; label: string; icon: LucideIcon }

// Native-app-style bottom tab bar for phones/tablets (hidden at lg+, where the
// fixed sidebar takes over). Each user can pick which shortcuts live here (up to
// MAX_FAVORITES) from the full nav; "More" opens a bottom sheet with everything,
// plus the Customize picker.
export function BottomNav({ role }: { role: PermRole }) {
  const { profile, refreshProfile } = useAuth()
  const { settings } = useCompany()
  const [open, setOpen] = useState(false)
  const [customizing, setCustomizing] = useState(false)
  // Keep the sheet mounted briefly while closing so the slide-down animation
  // can play (React would otherwise unmount the instant `open` flips false).
  const [mounted, setMounted] = useState(false)
  // Drives the slide-up transition: false = parked off-screen at translate-y-full,
  // true = settled at translate-y-0. Flipped on next paint after mount so the
  // browser actually animates the change instead of starting in its final state.
  const [visible, setVisible] = useState(false)

  const available = useVisibleNavItems(role)
  const byTo = useMemo(() => new Map(available.map((i) => [i.to, i])), [available])

  // The default bar: curated TABS the role can see.
  const defaultItems = useMemo<BarItem[]>(
    () =>
      DEFAULT_TABS.filter((t) =>
        pageAllowed(role, t.to, t.roles, {
          rolePerms: settings.pagePermissions,
          userId: profile?.id,
          userPerms: settings.userPermissions,
        }),
      )
        .slice(0, MAX_FAVORITES)
        .map((t) => ({ to: t.to, label: t.label, icon: t.icon })),
    [role, settings.pagePermissions, settings.userPermissions, profile?.id],
  )

  // The user's saved shortcuts, dropping any they can no longer see.
  const favTos = useMemo(
    () => (profile?.nav_favorites ?? []).filter((to) => byTo.has(to)).slice(0, MAX_FAVORITES),
    [profile?.nav_favorites, byTo],
  )

  const barItems: BarItem[] =
    favTos.length > 0
      ? favTos.map((to) => { const i = byTo.get(to)!; return { to: i.to, label: i.label, icon: i.icon } })
      : defaultItems

  // Hide the bottom bar on mobile detail routes so chat / WO / asset / part
  // detail screens get the full bottom area + native keyboard handling. The
  // user can still navigate back to the list with the in-page back button.
  const { pathname } = useLocation()
  const hideOnMobile =
    /^\/app\/(messages|work-orders|work-orders-new|assets|parts)\/[0-9a-f-]+/i.test(pathname) ||
    /^\/app\/it-inventory\/[0-9a-f]{8}-/i.test(pathname)

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

  const saveFavorites = async (tos: string[]) => {
    if (!profile?.id) return
    await supabase.from('users').update({ nav_favorites: tos.length ? tos : null }).eq('id', profile.id)
    await refreshProfile()
  }

  const item =
    'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium transition'

  if (hideOnMobile) return null

  return (
    <>
      <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] lg:hidden">
        {barItems.map((t) => (
          <NavLink
            key={t.to}
            to={t.to}
            end={t.to === '/app/dashboard'}
            className={({ isActive }) => cn(item, isActive ? 'text-accent' : 'text-ink-muted')}
          >
            <t.icon className="size-5" />
            <span className="max-w-full truncate px-0.5">{t.label}</span>
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
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => { setOpen(false); setCustomizing(true) }}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1 text-sm font-medium text-ink-invert-muted hover:bg-white/10 hover:text-white"
                >
                  <Settings2 className="size-4" /> Customize bar
                </button>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label="Close menu"
                  className="rounded-md p-1 text-ink-invert-muted hover:bg-white/10 hover:text-white"
                >
                  <X className="size-5" />
                </button>
              </div>
            </div>
            <SidebarNav role={role} onNavigate={() => setOpen(false)} />
          </div>
        </div>
      )}

      {customizing && (
        <CustomizeBar
          available={available}
          initial={favTos.length > 0 ? favTos : defaultItems.map((d) => d.to)}
          onClose={() => setCustomizing(false)}
          onSave={async (tos) => { await saveFavorites(tos); setCustomizing(false) }}
        />
      )}
    </>
  )
}

// Bottom-sheet picker: choose up to MAX_FAVORITES shortcuts for the bar. Mounted
// only while open, so its selection state initializes fresh from `initial`.
function CustomizeBar({ available, initial, onClose, onSave }: {
  available: VisibleNavItem[]
  initial: string[]
  onClose: () => void
  onSave: (tos: string[]) => Promise<void> | void
}) {
  const [selected, setSelected] = useState<string[]>(initial)
  const [saving, setSaving] = useState(false)

  // Group the available destinations by their nav section, preserving order.
  const groups = useMemo(() => {
    const out: Array<{ group: string; items: VisibleNavItem[] }> = []
    for (const it of available) {
      const last = out[out.length - 1]
      if (last && last.group === it.group) last.items.push(it)
      else out.push({ group: it.group, items: [it] })
    }
    return out
  }, [available])

  const atMax = selected.length >= MAX_FAVORITES
  const toggle = (to: string) =>
    setSelected((prev) =>
      prev.includes(to) ? prev.filter((t) => t !== to) : prev.length >= MAX_FAVORITES ? prev : [...prev, to],
    )

  const save = async () => {
    setSaving(true)
    try { await onSave(selected) } finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] lg:hidden">
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-shell/60 backdrop-blur-[2px]" />
      <div className="absolute inset-x-0 bottom-0 flex max-h-[90vh] flex-col rounded-t-2xl bg-shell pb-[env(safe-area-inset-bottom)] text-ink-invert shadow-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-white/5 px-5 py-3">
          <div>
            <div className="text-base font-semibold">Customize bottom bar</div>
            <div className="text-xs text-ink-invert-muted">Pick up to {MAX_FAVORITES} shortcuts · {selected.length}/{MAX_FAVORITES} selected</div>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1 text-ink-invert-muted hover:bg-white/10 hover:text-white">
            <X className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {groups.map((g) => (
            <div key={g.group} className="mb-3">
              <div className="px-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-invert-muted">{g.group}</div>
              <div className="grid grid-cols-1 gap-1">
                {g.items.map((it) => {
                  const idx = selected.indexOf(it.to)
                  const isSel = idx >= 0
                  const disabled = !isSel && atMax
                  return (
                    <button
                      key={it.to}
                      type="button"
                      onClick={() => toggle(it.to)}
                      disabled={disabled}
                      className={cn(
                        'flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition',
                        isSel ? 'bg-accent/20 text-white ring-1 ring-accent/50' : 'text-ink-invert-muted hover:bg-white/5',
                        disabled && 'opacity-40',
                      )}
                    >
                      <it.icon className="size-5 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{it.label}</span>
                      {isSel ? (
                        <span className="grid size-5 shrink-0 place-items-center rounded-full bg-accent text-[11px] font-bold text-white">{idx + 1}</span>
                      ) : (
                        <span className="size-5 shrink-0 rounded-full border border-white/15" />
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-white/5 px-4 py-3">
          <button
            type="button"
            onClick={() => setSelected([])}
            className="rounded-lg px-3 py-2 text-sm font-medium text-ink-invert-muted hover:bg-white/10 hover:text-white"
          >
            Reset to default
          </button>
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-white hover:bg-accent-hover disabled:opacity-60"
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}
