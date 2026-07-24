/* eslint-disable react-refresh/only-export-components -- NAV_GROUPS is shared with CommandPalette as the single source of truth for nav */
import { useEffect, useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Activity,
  AlarmClockOff,
  AlertTriangle,
  Award,
  BadgeDollarSign,
  Bandage,
  Bolt,
  BookUser,
  Banknote,
  BrainCircuit,
  GraduationCap,
  Sparkles,
  CalendarClock,
  CalendarHeart,
  ChartNoAxesCombined,
  ChevronDown,
  Clock,
  Coffee,
  Cog,
  CreditCard,
  FileClock,
  Folders,
  Gauge,
  ListChecks,
  Building2,
  Map,
  Megaphone,
  Tags as TagsIcon,
  MessageCircle,
  MessageSquareWarning,
  PackageOpen,
  Palmtree,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  SearchCheck,
  Settings,
  Shirt,
  Signpost,
  Stamp,
  Telescope,
  UserPlus,
  UsersRound,
  Wallet,
  Warehouse,
  Wrench,
  X,
} from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { pageAllowed } from '@/lib/permissions'
import type { Role } from '@/lib/rbac'
import { cn } from '@/lib/utils'

type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  roles: Role[]
  // Item only shows when the account has this feature flag enabled.
  flag?: 'gm_bonus'
  // Roles that can be granted this page but default to OFF (admin opts them in).
  optIn?: Role[]
}

type NavGroup = {
  label: string
  items: NavItem[]
  roles?: Role[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        to: '/app/dashboard',
        label: 'Dashboard',
        icon: Gauge,
        roles: ['owner', 'manager', 'employee', 'technician'],
      },
      {
        to: '/app/messages',
        label: 'Messages',
        icon: MessageCircle,
        roles: ['owner', 'manager', 'employee', 'technician'],
      },
      {
        to: '/app/ask',
        label: 'Operator AI',
        icon: Sparkles,
        roles: ['owner', 'manager', 'employee', 'technician'],
      },
      {
        to: '/app/insights',
        label: 'AI Insights',
        icon: BrainCircuit,
        roles: ['owner', 'manager', 'technician'],
      },
    ],
  },
  {
    label: 'Operations',
    roles: ['owner', 'manager', 'employee', 'technician'],
    items: [
      {
        to: '/app/site-performance',
        label: 'Site Performance',
        icon: Activity,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/checklists',
        label: 'Checklists',
        icon: ListChecks,
        roles: ['owner', 'manager', 'employee'],
      },
      {
        to: '/app/supplies',
        label: 'Supplies',
        icon: PackageOpen,
        roles: ['owner', 'manager', 'employee', 'technician'],
      },
      {
        to: '/app/tips',
        label: 'Tips',
        icon: Banknote,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/bonuses',
        label: 'Bonuses',
        icon: BadgeDollarSign,
        roles: ['owner', 'manager'],
        optIn: ['manager'],
        flag: 'gm_bonus',
      },
      {
        to: '/app/contacts',
        label: 'Contacts',
        icon: BookUser,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/site-reviews',
        label: 'Site Reviews',
        icon: Stamp,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/site-audits',
        label: 'Site Audits',
        icon: SearchCheck,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/invoices',
        label: 'Invoices',
        icon: Wallet,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/inventory',
        label: 'Inventory',
        icon: Warehouse,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/sales-reports',
        label: 'Sales Reports',
        icon: ChartNoAxesCombined,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/violations',
        label: 'Violations',
        icon: AlertTriangle,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/signage',
        label: 'Signage',
        icon: Signpost,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/market-research',
        label: 'Market Research',
        icon: Telescope,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/social-calendar',
        label: 'Social Calendar',
        icon: Megaphone,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/documents',
        label: 'Documents',
        icon: Folders,
        roles: ['owner', 'manager', 'employee', 'technician'],
      },
    ],
  },
  {
    label: 'Maintenance',
    roles: ['owner', 'manager', 'employee', 'technician'],
    items: [
      {
        to: '/app/work-orders',
        label: 'Work Orders',
        icon: Wrench,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/reports',
        label: 'Maintenance Reports',
        icon: ChartNoAxesCombined,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/downtime',
        label: 'Downtime',
        icon: AlarmClockOff,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/assets',
        label: 'Assets',
        icon: Cog,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/parts',
        label: 'Parts',
        icon: Bolt,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/vendors',
        label: 'Vendors',
        icon: Building2,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/categories',
        label: 'Maintenance Categories',
        icon: TagsIcon,
        roles: ['owner', 'manager', 'technician'],
      },
    ],
  },
  {
    label: 'People',
    items: [
      {
        to: '/app/employees',
        label: 'Employees',
        icon: UsersRound,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/schedule',
        label: 'Schedule',
        icon: CalendarClock,
        roles: ['owner', 'manager', 'employee'],
      },
      {
        to: '/app/timeclock',
        label: 'Time Clock',
        icon: Clock,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/timesheets',
        label: 'Timesheets',
        icon: FileClock,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/reviews',
        label: 'Performance Reviews',
        icon: Award,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/training',
        label: 'Training',
        icon: GraduationCap,
        roles: ['owner', 'manager', 'employee'],
      },
      {
        to: '/app/counseling',
        label: 'Counseling',
        icon: MessageSquareWarning,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/injuries',
        label: 'Injuries',
        icon: Bandage,
        roles: ['owner', 'manager'],
      },
      {
        to: '/app/uniforms',
        label: 'Uniforms',
        icon: Shirt,
        roles: ['owner', 'manager', 'employee'],
      },
      {
        to: '/app/time-off',
        label: 'Time Off',
        icon: Palmtree,
        roles: ['owner', 'manager', 'employee', 'technician'],
      },
      {
        to: '/app/breaks',
        label: 'Breaks',
        icon: Coffee,
        roles: ['owner', 'manager', 'technician'],
      },
      {
        to: '/app/calendar',
        label: 'Calendar',
        icon: CalendarHeart,
        roles: ['owner', 'manager', 'employee', 'technician'],
      },
    ],
  },
  {
    label: 'Account',
    roles: ['owner', 'technician'],
    items: [
      {
        to: '/app/settings/team',
        label: 'Team',
        icon: UserPlus,
        roles: ['owner', 'technician'],
      },
      {
        to: '/app/settings/locations',
        label: 'Locations',
        icon: Map,
        roles: ['owner', 'technician'],
      },
      {
        to: '/app/settings/billing',
        label: 'Billing',
        icon: CreditCard,
        roles: ['owner'],
      },
      {
        to: '/app/settings',
        label: 'Settings',
        icon: Settings,
        roles: ['owner'],
      },
    ],
  },
]

const STORAGE_KEY = 'tunnelsync.navGroups'

// The grouped, collapsible nav body — shared by the desktop sidebar and the
// mobile drawer. `onNavigate` lets the drawer close itself when a link is tapped.
export function SidebarNav({
  role,
  onNavigate,
  collapsed,
}: {
  role: Role
  onNavigate?: () => void
  collapsed?: boolean
}) {
  const location = useLocation()
  const { profile } = useAuth()
  const { settings } = useCompany()
  const [query, setQuery] = useState('')

  const canSee = (i: NavItem) =>
    pageAllowed(role, i.to, i.roles, {
      rolePerms: settings.pagePermissions,
      userId: profile?.id,
      userPerms: settings.userPermissions,
      optInRoles: i.optIn,
    }) &&
    (!i.flag || (i.flag === 'gm_bonus' && !!profile?.gm_bonus_enabled))

  // Only the groups + items this role (and account) can see.
  const baseGroups = NAV_GROUPS
    .filter((g) => !g.roles || g.roles.includes(role))
    .map((g) => ({ ...g, items: g.items.filter(canSee) }))
    .filter((g) => g.items.length > 0)

  // Apply search filter. Match against group label OR item label. A group
  // matching its own label keeps all its items.
  const q = query.trim().toLowerCase()
  const visibleGroups = q
    ? baseGroups
        .map((g) => {
          const groupHit = g.label.toLowerCase().includes(q)
          const filteredItems = groupHit
            ? g.items
            : g.items.filter((i) => i.label.toLowerCase().includes(q))
          return { ...g, items: filteredItems }
        })
        .filter((g) => g.items.length > 0)
    : baseGroups

  // Collapsible sections, remembered across visits. Default: everything open.
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) return JSON.parse(saved) as Record<string, boolean>
    } catch {
      /* ignore malformed storage */
    }
    return Object.fromEntries(NAV_GROUPS.map((g) => [g.label, true]))
  })

  // Whatever section you're currently in stays open so you never lose your place.
  useEffect(() => {
    const active = visibleGroups.find((g) =>
      g.items.some((i) => location.pathname.startsWith(i.to)),
    )
    if (active && !openGroups[active.label]) {
      setOpenGroups((prev) => ({ ...prev, [active.label]: true }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname])

  const toggle = (label: string) => {
    setOpenGroups((prev) => {
      const next = { ...prev, [label]: !(prev[label] ?? true) }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore storage failures */
      }
      return next
    })
  }

  // Collapsed rail: icons only, no search or group headers. Every visible item
  // gets a tooltip so it stays navigable. Filtering (role + account flags) is the
  // same baseGroups the expanded nav uses.
  if (collapsed) {
    return (
      <nav className="scrollbar-hover min-h-0 flex-1 overflow-y-auto px-2 py-4">
        <ul className="flex flex-col items-center gap-1">
          {baseGroups.flatMap((g) => g.items).map((item) => (
            <li key={item.to} className="w-full">
              <NavLink
                to={item.to}
                end={item.to === '/app/dashboard'}
                onClick={onNavigate}
                title={item.label}
                aria-label={item.label}
              >
                {({ isActive }) => (
                  <span
                    className={cn(
                      'mx-auto grid size-10 place-items-center rounded-lg transition',
                      isActive
                        ? 'bg-accent text-white'
                        : 'text-ink-invert-muted ring-1 ring-inset ring-white/10 hover:bg-white/[0.06] hover:text-white',
                    )}
                  >
                    <item.icon className="size-[18px]" strokeWidth={2.25} />
                  </span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    )
  }

  return (
    <nav className="scrollbar-hover min-h-0 flex-1 overflow-y-auto px-3 py-4">
      <div className="relative mb-3">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-invert-muted/60" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search nav..."
          className="h-9 w-full rounded-md border border-white/10 bg-white/[0.04] pl-8 pr-7 text-sm text-white placeholder:text-ink-invert-muted/60 focus:outline-none focus:ring-2 focus:ring-accent/60"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            aria-label="Clear search"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-ink-invert-muted/70 hover:text-white"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      {visibleGroups.length === 0 && (
        <p className="px-2 py-4 text-center text-xs text-ink-invert-muted/60">No matches</p>
      )}
      {visibleGroups.map((group) => {
        const isOpen = q.length > 0 || (openGroups[group.label] ?? true)
        return (
          <div key={group.label} className="mb-3">
            <button
              type="button"
              onClick={() => toggle(group.label)}
              aria-expanded={isOpen}
              className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-invert-muted/70 transition hover:text-white/90"
            >
              {group.label}
              <ChevronDown
                className={cn(
                  'size-3.5 shrink-0 transition-transform duration-200',
                  isOpen ? 'rotate-0' : '-rotate-90',
                )}
              />
            </button>
            {isOpen && (
              <ul className="mt-2 flex flex-col gap-1">
                {group.items.map((item) => (
                  <li key={item.to}>
                    <NavLink
                      to={item.to}
                      end={item.to === '/app/dashboard'}
                      onClick={onNavigate}
                    >
                      {({ isActive }) => (
                        <span
                          className={cn(
                            'group flex items-center gap-3 rounded-lg px-2 py-1.5 text-[15px] font-medium transition',
                            isActive
                              ? 'bg-white/[0.07] text-white'
                              : 'text-ink-invert-muted hover:bg-white/[0.04] hover:text-white',
                          )}
                        >
                          <span
                            className={cn(
                              'grid size-9 shrink-0 place-items-center rounded-lg transition duration-150',
                              isActive
                                ? 'bg-accent text-white'
                                : 'bg-white/[0.06] text-white/75 ring-1 ring-inset ring-white/10 group-hover:bg-accent/15 group-hover:text-white group-hover:ring-accent/40',
                            )}
                          >
                            <item.icon className="size-[18px]" strokeWidth={2.25} />
                          </span>
                          {item.label}
                        </span>
                      )}
                    </NavLink>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </nav>
  )
}

const COLLAPSE_KEY = 'tunnelsync.sidebarCollapsed'

export function Sidebar({ role }: { role: Role }) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === '1'
    } catch {
      return false
    }
  })
  const toggle = () =>
    setCollapsed((c) => {
      const next = !c
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0')
      } catch {
        /* ignore storage failures */
      }
      return next
    })

  return (
    <aside
      className={cn(
        'relative hidden h-dvh shrink-0 flex-col bg-shell text-ink-invert lg:flex',
        collapsed ? 'w-16' : 'w-64',
      )}
    >
      <div className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-white/[0.04] to-transparent" />
      <div
        className={cn(
          'relative flex h-16 items-center border-b border-white/5',
          collapsed ? 'justify-center px-2' : 'px-5',
        )}
      >
        {!collapsed && <Logo invert size="lg" />}
        <button
          type="button"
          onClick={toggle}
          aria-label={collapsed ? 'Expand menu' : 'Collapse menu'}
          className={cn(
            'rounded-md p-1.5 text-ink-invert-muted/70 transition hover:bg-white/[0.06] hover:text-white',
            !collapsed && 'ml-auto',
          )}
        >
          {collapsed ? <PanelLeftOpen className="size-5" /> : <PanelLeftClose className="size-5" />}
        </button>
      </div>
      <SidebarNav role={role} collapsed={collapsed} />
      {!collapsed && (
        <div className="relative border-t border-white/5 p-3 text-[11px] uppercase tracking-wider text-ink-invert-muted/60">
          v0.0.0 · {role}
        </div>
      )}
    </aside>
  )
}
