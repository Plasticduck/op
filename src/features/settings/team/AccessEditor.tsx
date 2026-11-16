import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { usePageAccess } from '@/lib/pageAccess'
import { roleOverride } from '@/lib/pageAccessLogic'
import { pageAccess, type PageAccessChange } from '@/lib/queries/pageAccess'
import { updateCompany } from '@/lib/queries/companySettings'
import { ALL_PAGES, NAV_GROUP_LABELS, navEmailOk, navFlagOn, type PageDef } from '@/components/layout/Sidebar'
import { SECTION_CATALOG, defaultAllowed, pageAllowed, permRoleInList } from '@/lib/permissions'
import { CATEGORY_LABEL, ROLE_LABEL, displayRole, permRole, shortName, type PermRole } from '@/lib/rbac'
import type { AccountUser } from '@/lib/queries/account'
import { SERVER_LIMITED } from '@/features/settings/team/accessNotes'

// The super admin's editor: every page in Operator, for one role or one person,
// including Admins. A checkbox that differs from the usual rule is saved as a
// grant or block (page_access); matching the usual rule clears it. Sections
// inside a page keep using the Team page permissions (company settings), as the
// other admins' editor does.

type Subject = { kind: 'role'; role: PermRole } | { kind: 'user'; user: AccountUser }

const ROLE_OPTIONS: PermRole[] = ['owner', 'manager', 'regional_manager', 'executive', 'finance', 'corporate_display', 'employee', 'technician']
const roleLabel = (r: PermRole) => (r in ROLE_LABEL ? ROLE_LABEL[r as keyof typeof ROLE_LABEL] : CATEGORY_LABEL[r as keyof typeof CATEGORY_LABEL])

function AccessGrid({ subject, onDone, onCancel }: { subject: Subject; onDone?: () => void; onCancel?: () => void }) {
  const { profile } = useAuth()
  const { settings, reload: reloadCompany } = useCompany()
  const { rows, reload } = usePageAccess()
  const role: PermRole = subject.kind === 'role' ? subject.role : permRole(subject.user.role, subject.user.role_category)
  const userId = subject.kind === 'user' ? subject.user.id : null

  const pages = useMemo(
    () => ALL_PAGES.filter((p) => p.to !== '/app/dashboard' && navFlagOn(p.flag, profile)),
    [profile],
  )

  // What the subject gets without their own grant or block.
  const usual = (p: PageDef): boolean => {
    if (subject.kind === 'user') {
      const r = roleOverride(rows, role, p.to)
      if (r !== undefined) return r
      return (
        pageAllowed(role, p.to, p.roles, {
          rolePerms: settings.pagePermissions,
          userId: subject.user.id,
          userPerms: settings.userPermissions,
          optInRoles: p.optIn,
        }) && navEmailOk(p, subject.user.email, role)
      )
    }
    return (
      pageAllowed(role, p.to, p.roles, { rolePerms: settings.pagePermissions, optInRoles: p.optIn }) &&
      (!p.emails || (!!p.orRoles && permRoleInList(role, p.orRoles)))
    )
  }
  const explicit = (p: PageDef): boolean | undefined =>
    userId ? rows.find((r) => r.user_id === userId && r.page === p.to)?.allowed : roleOverride(rows, role, p.to)

  // Sections only apply below Admin (Admins always see every section).
  const sections = (to: string) => (role === 'owner' ? [] : SECTION_CATALOG.filter((s) => s.page === to && permRoleInList(role, s.roles)))
  const sectionStore = () => (userId ? settings.userPermissions?.[userId] ?? {} : settings.pagePermissions?.[role] ?? {})
  const sectionUsual = (key: string) => {
    if (!userId) return defaultAllowed(role, key, SECTION_CATALOG.find((s) => s.key === key)?.optIn)
    const r = settings.pagePermissions?.[role]?.[key]
    return typeof r === 'boolean' ? r : defaultAllowed(role, key, SECTION_CATALOG.find((s) => s.key === key)?.optIn)
  }

  const [allowed, setAllowed] = useState<Record<string, boolean>>({})
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    const map: Record<string, boolean> = {}
    const store = sectionStore()
    for (const p of pages) {
      map[p.to] = explicit(p) ?? usual(p)
      for (const s of sections(p.to)) map[s.key] = typeof store[s.key] === 'boolean' ? store[s.key] : sectionUsual(s.key)
    }
    setAllowed(map)
    setSaved(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pages, rows, settings, role, userId])

  const q = query.trim().toLowerCase()
  const groups = useMemo(() => {
    const labels = [...NAV_GROUP_LABELS, ...new Set(pages.map((p) => p.group).filter((g) => !NAV_GROUP_LABELS.includes(g)))]
    return labels
      .map((label) => ({
        label,
        items: pages.filter((p) => p.group === label && (!q || p.label.toLowerCase().includes(q) || label.toLowerCase().includes(q))),
      }))
      .filter((g) => g.items.length > 0)
  }, [pages, q])

  const changed = pages.filter((p) => allowed[p.to] !== usual(p))
  const added = changed.filter((p) => allowed[p.to]).length
  const removed = changed.length - added

  const toggle = (key: string) => { setAllowed((a) => ({ ...a, [key]: !a[key] })); setSaved(false) }
  const setGroup = (items: PageDef[], on: boolean) => {
    setAllowed((a) => { const n = { ...a }; for (const i of items) n[i.to] = on; return n })
    setSaved(false)
  }
  const resetAll = () => {
    setAllowed((a) => { const n = { ...a }; for (const p of pages) n[p.to] = usual(p); return n })
    setSaved(false)
  }

  const save = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    try {
      const subjectKey = userId ? { user_id: userId } : { perm_role: role }
      const changes: PageAccessChange[] = []
      for (const p of pages) {
        const want = allowed[p.to]
        const next = want === usual(p) ? null : want
        const have = explicit(p)
        if ((next === null && have === undefined) || (next !== null && have === next)) continue
        changes.push({ ...subjectKey, page: p.to, allowed: next })
      }
      await pageAccess.save(changes)

      // Sections: same rule as the other admins' editor (stored only where they
      // differ from the role's default).
      if (role !== 'owner') {
        const store: Record<string, boolean> = { ...sectionStore() }
        let touched = false
        for (const p of pages) {
          for (const s of sections(p.to)) {
            const want = allowed[s.key]
            const was = store[s.key]
            if (want === sectionUsual(s.key)) { if (s.key in store) { delete store[s.key]; touched = true } }
            else if (was !== want) { store[s.key] = want; touched = true }
          }
        }
        if (touched) {
          if (userId) {
            const next = { ...(settings.userPermissions ?? {}) }
            if (Object.keys(store).length) next[userId] = store
            else delete next[userId]
            await updateCompany(profile.account_id, { settings: { ...settings, userPermissions: next } })
          } else {
            const next = { ...(settings.pagePermissions ?? {}) }
            if (Object.keys(store).length) next[role] = store
            else delete next[role]
            await updateCompany(profile.account_id, { settings: { ...settings, pagePermissions: next } })
          }
          await reloadCompany()
        }
      }
      await reload()
      setSaved(true)
      onDone?.()
    } catch (e) {
      setError((e as { message?: string })?.message || 'Could not save permissions.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a page" className="pl-8" aria-label="Find a page" />
        </div>
        <p className="text-xs text-ink-muted">
          {changed.length === 0
            ? 'Matches the usual pages for this role.'
            : `${added} added, ${removed} removed compared with the usual pages.`}
        </p>
        {changed.length > 0 && (
          <button type="button" className="text-xs text-accent hover:underline" onClick={resetAll}>
            Reset to usual
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {groups.map((g) => {
          const allOn = g.items.every((i) => allowed[i.to])
          return (
            <div key={g.label} className="rounded-md border border-border p-3">
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{g.label}</span>
                <button type="button" className="text-xs text-accent hover:underline" onClick={() => setGroup(g.items, !allOn)}>
                  {allOn ? 'Disable all' : 'Enable all'}
                </button>
              </div>
              <ul className="flex flex-col gap-1.5">
                {g.items.map((p) => {
                  const on = !!allowed[p.to]
                  const differs = on !== usual(p)
                  const secs = sections(p.to)
                  return (
                    <li key={p.to}>
                      <label className="flex items-start gap-2 text-sm text-ink">
                        <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={on} onChange={() => toggle(p.to)} />
                        <span className="min-w-0">
                          {p.label}
                          {differs && (
                            <Badge tone={on ? 'accent' : 'warn'} className="ml-1.5 align-middle">{on ? 'Added' : 'Removed'}</Badge>
                          )}
                          {differs && on && SERVER_LIMITED[p.to] && (
                            <span className="mt-0.5 block text-xs text-ink-subtle">{SERVER_LIMITED[p.to]}</span>
                          )}
                        </span>
                      </label>
                      {secs.length > 0 && (
                        <ul className="ml-6 mt-1 flex flex-col gap-1">
                          {secs.map((s) => (
                            <li key={s.key}>
                              <label className="flex items-center gap-2 text-xs text-ink-muted">
                                <input type="checkbox" className="size-3.5" checked={!!allowed[s.key]} disabled={!on} onChange={() => toggle(s.key)} />
                                {s.label}
                              </label>
                            </li>
                          ))}
                        </ul>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )
        })}
      </div>

      {error && <p className="text-sm text-danger">{error}</p>}
      <div className="flex items-center justify-end gap-3">
        {saved && !onDone && <span className="text-xs text-ink-muted">Saved.</span>}
        {onCancel && <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>}
        <Button onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save permissions'}</Button>
      </div>
    </div>
  )
}

// Role-level section of the Team page, for the super admin.
export function RoleAccessEditor() {
  const [role, setRole] = useState<PermRole>('manager')
  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="text-sm font-semibold text-ink">Edit user permissions</h2>
        <p className="mt-0.5 text-xs text-ink-muted">
          Choose which pages each role can use, from every page in Operator, Admin included. Checking a page the role
          doesn't usually get gives it to everyone in the role. To change a single person, use the Permissions button on
          their row above. Your own access can't be changed.
        </p>
      </div>
      <div className="rounded-md border border-border bg-card p-4">
        <label className="mb-4 flex w-56 flex-col gap-1 text-xs font-medium text-ink-muted">
          Role
          <Select value={role} onChange={(e) => setRole(e.target.value as PermRole)}>
            {ROLE_OPTIONS.map((r) => <option key={r} value={r}>{roleLabel(r)}</option>)}
          </Select>
        </label>
        <AccessGrid key={role} subject={{ kind: 'role', role }} />
      </div>
    </section>
  )
}

// One person's pages, for the super admin (anyone but themselves, Admins too).
export function UserAccessModal({ user, onClose }: { user: AccountUser; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={`Permissions · ${user.name}`} size="xl">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          {displayRole(user.role, user.role_category)}. Choose which pages {shortName(user.name, user.role_category)} can
          use, from every page in Operator. This applies to this person only and wins over their role.
        </p>
        <AccessGrid subject={{ kind: 'user', user }} onDone={onClose} onCancel={onClose} />
      </div>
    </Modal>
  )
}
