import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CornerDownLeft, Search } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { pageAllowed, permRoleInList } from '@/lib/permissions'
import { permRole } from '@/lib/rbac'
import { NAV_GROUPS, navEmailOk, navFlagOn, navItemLabel } from '@/components/layout/Sidebar'
import { itInventory, type SearchHit } from '@/lib/queries/itInventory'
import { cn } from '@/lib/utils'

type Row = { to: string; label: string; group: string; sub?: string }

// Cmd+K / Ctrl+K global jump-to-page. Searches across every nav item the
// current role can see and pushes the matching route on Enter. Arrow keys move
// the highlight; Esc closes; clicking outside also closes.
export function CommandPalette() {
  const { profile } = useAuth()
  const { settings } = useCompany()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const items = useMemo(() => {
    if (!profile) return []
    const role = permRole(profile.role, profile.role_category)
    const flat: Row[] = []
    for (const g of NAV_GROUPS) {
      if (!permRoleInList(role, g.roles)) continue
      for (const i of g.items) {
        if (
          !pageAllowed(role, i.to, i.roles, {
            rolePerms: settings.pagePermissions,
            userId: profile.id,
            userPerms: settings.userPermissions,
            optInRoles: i.optIn,
          })
        )
          continue
        if (!navFlagOn(i.flag, profile)) continue
        if (!navEmailOk(i, profile.email, role)) continue
        flat.push({ to: i.to, label: navItemLabel(i, profile.account_id), group: g.label })
      }
    }
    return flat
  }, [profile, settings.pagePermissions, settings.userPermissions])

  // IT Inventory equipment, for people who can open it: searched on the server
  // (tag, name, serial, model, IP, MAC...). An exact tag or serial, which is
  // what a USB barcode scanner types, goes to the top so Enter opens it.
  const canSearchIt = items.some((i) => i.to === '/app/it-inventory')
  const [hits, setHits] = useState<SearchHit[]>([])
  useEffect(() => {
    const q = query.trim()
    if (!open || !canSearchIt || q.length < 2) { setHits([]); return }
    let alive = true
    const t = window.setTimeout(() => {
      void itInventory.search(q, 8).then(({ data }) => { if (alive) setHits((data as SearchHit[] | null) ?? []) })
    }, 180)
    return () => { alive = false; window.clearTimeout(t) }
  }, [query, open, canSearchIt])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const pages: Row[] = q
      ? items.filter((i) => i.label.toLowerCase().includes(q) || i.group.toLowerCase().includes(q))
      : items
    const gear: Row[] = hits.map((h) => ({
      to: `/app/it-inventory/${h.id}`,
      label: `${h.asset_tag}  ${h.name}`,
      group: 'IT equipment',
      sub: [h.site, h.category].filter(Boolean).join(' · '),
    }))
    return hits[0]?.exact ? [...gear, ...pages] : [...pages, ...gear]
  }, [items, query, hits])

  // Global key listener for the open shortcut + a custom event the topbar
  // dispatches when its "Jump to a page" button is clicked.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isModK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (isModK) {
        e.preventDefault()
        setOpen((o) => !o)
        return
      }
      if (e.key === 'Escape' && open) setOpen(false)
    }
    const onOpen = () => setOpen(true)
    window.addEventListener('keydown', onKey)
    window.addEventListener('command-palette:open', onOpen)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('command-palette:open', onOpen)
    }
  }, [open])

  // Focus input + reset state every time it opens.
  useEffect(() => {
    if (open) {
      setQuery('')
      setActiveIdx(0)
      setTimeout(() => inputRef.current?.focus(), 10)
    }
  }, [open])

  // Keep the active row visible inside the scroll container.
  useEffect(() => {
    if (!open) return
    const node = listRef.current?.querySelector<HTMLElement>('[data-active="true"]')
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIdx, open])

  if (!open) return null

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(filtered.length - 1, i + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(0, i - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const pick = filtered[activeIdx]
      if (pick) {
        navigate(pick.to)
        setOpen(false)
      }
    }
  }

  // Group filtered items by group label for prettier display.
  const groupedFiltered: Array<{ group: string; rows: typeof filtered }> = []
  for (const row of filtered) {
    const last = groupedFiltered[groupedFiltered.length - 1]
    if (last && last.group === row.group) last.rows.push(row)
    else groupedFiltered.push({ group: row.group, rows: [row] })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[10vh]">
      <button
        type="button"
        aria-label="Close"
        onClick={() => setOpen(false)}
        className="absolute inset-0 bg-shell/50 backdrop-blur-[2px]"
      />
      <div
        role="dialog"
        aria-label="Command palette"
        onKeyDown={onListKey}
        className="relative z-10 flex max-h-[70vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
      >
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-4 text-ink-muted" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setActiveIdx(0) }}
            placeholder={canSearchIt ? 'Jump to a page, or find equipment by tag, serial, IP...' : 'Jump to a page...'}
            className="flex-1 bg-transparent text-sm text-ink placeholder:text-ink-subtle focus:outline-none"
          />
          <kbd className="rounded border border-border bg-content px-1.5 py-0.5 text-[10px] font-medium text-ink-muted">esc</kbd>
        </div>
        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1.5">
          {filtered.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-ink-muted">No matching pages</p>
          ) : (
            groupedFiltered.map((g) => (
              <div key={g.group} className="mb-1">
                <div className="px-3 pb-0.5 pt-2 text-[10px] font-semibold uppercase tracking-wider text-ink-subtle">
                  {g.group}
                </div>
                {g.rows.map((row) => {
                  const overall = filtered.indexOf(row)
                  const active = overall === activeIdx
                  return (
                    <button
                      key={row.to}
                      data-active={active}
                      onClick={() => { navigate(row.to); setOpen(false) }}
                      onMouseEnter={() => setActiveIdx(overall)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm',
                        active ? 'bg-accent-soft text-accent' : 'text-ink hover:bg-content',
                      )}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{row.label}</span>
                        {row.sub && <span className="block truncate text-xs text-ink-muted">{row.sub}</span>}
                      </span>
                      {active && <CornerDownLeft className="size-3.5 shrink-0 opacity-70" />}
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>
        <div className="flex items-center justify-between gap-3 border-t border-border bg-content px-3 py-1.5 text-[11px] text-ink-muted">
          <span>
            <kbd className="rounded border border-border bg-card px-1 font-medium">↑</kbd>{' '}
            <kbd className="rounded border border-border bg-card px-1 font-medium">↓</kbd> navigate
          </span>
          <span>
            <kbd className="rounded border border-border bg-card px-1 font-medium">↵</kbd> open
          </span>
          <span>
            <kbd className="rounded border border-border bg-card px-1 font-medium">⌘ K</kbd> toggle
          </span>
        </div>
      </div>
    </div>
  )
}
