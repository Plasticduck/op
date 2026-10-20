import { useMemo, useState } from 'react'
import { Loader2, Plus, Search, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { getCompany, updateCompany } from '@/lib/queries/companySettings'
import { displayRole } from '@/lib/rbac'
import type { AccountUser } from '@/lib/queries/account'

// Admin editor for Invoice Approval's approver list (company_settings
// .invoiceApproverEmails). Edits are staged and saved together. People can be
// added from existing logins or by email for someone who doesn't have one yet.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function InvoiceApproversModal({ users, onClose }: { users: AccountUser[]; onClose: () => void }) {
  const { profile } = useAuth()
  const { settings, reload } = useCompany()
  const [emails, setEmails] = useState<string[]>(() => (settings.invoiceApproverEmails ?? []).map((e) => e.toLowerCase()))
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const byEmail = useMemo(() => new Map(users.map((u) => [u.email.toLowerCase(), u])), [users])
  const listed = useMemo(() => new Set(emails), [emails])

  // Current approvers: people with a login first (by name), then emails without one.
  const rows = useMemo(
    () => emails
      .map((email) => ({ email, user: byEmail.get(email) ?? null }))
      .sort((a, b) => (a.user ? 0 : 1) - (b.user ? 0 : 1) || (a.user?.name ?? a.email).localeCompare(b.user?.name ?? b.email)),
    [emails, byEmail],
  )

  const q = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!q) return []
    return users
      .filter((u) => !listed.has(u.email.toLowerCase()) && (u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [q, users, listed])
  const canAddTyped = EMAIL_RE.test(q) && !listed.has(q) && !byEmail.has(q)

  const add = (email: string) => {
    const e = email.trim().toLowerCase()
    if (!e || listed.has(e)) return
    setEmails((prev) => [...prev, e])
    setQuery('')
  }
  const remove = (email: string) => setEmails((prev) => prev.filter((e) => e !== email))

  const original = (settings.invoiceApproverEmails ?? []).map((e) => e.toLowerCase()).sort().join(',')
  const dirty = [...emails].sort().join(',') !== original

  const save = async () => {
    if (!profile) return
    setBusy(true)
    setError(null)
    // Re-read settings right before writing so a concurrent change to another
    // setting (regions, permissions, ...) isn't overwritten.
    const fresh = await getCompany(profile.account_id)
    const { error: err } = await updateCompany(profile.account_id, {
      settings: { ...fresh.settings, invoiceApproverEmails: emails },
    })
    if (err) {
      setBusy(false)
      return setError(err.message)
    }
    await reload()
    setBusy(false)
    onClose()
  }

  return (
    <Modal open onClose={onClose} title="Invoice approvers" size="md">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-muted">
          Only people on this list appear in the Approver dropdown. Someone added without a login appears once their account exists.
        </p>

        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && canAddTyped) { e.preventDefault(); add(q) } }}
            placeholder="Add someone: type a name or email"
            className="pl-8"
          />
          {(matches.length > 0 || canAddTyped) && (
            <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-card shadow-md">
              {matches.map((u) => (
                <button
                  key={u.id}
                  type="button"
                  onClick={() => add(u.email)}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-content"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ink">{u.name}</span>
                    <span className="block truncate text-xs text-ink-subtle">{u.email} · {displayRole(u.role, u.role_category)}</span>
                  </span>
                  <Plus className="size-4 shrink-0 text-accent" />
                </button>
              ))}
              {canAddTyped && (
                <button type="button" onClick={() => add(q)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-content">
                  <span className="min-w-0 flex-1 truncate text-ink">Add <span className="font-medium">{q}</span> (no login yet)</span>
                  <Plus className="size-4 shrink-0 text-accent" />
                </button>
              )}
            </div>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto rounded-md border border-border">
          {rows.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-ink-muted">
              No approvers. The dropdown will show all admins and managers instead.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.map(({ email, user }) => (
                <li key={email} className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm text-ink">{user?.name ?? email}</div>
                    <div className="truncate text-xs text-ink-subtle">
                      {user ? `${email} · ${displayRole(user.role, user.role_category)}` : 'No login yet'}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(email)}
                    className="rounded-md p-1.5 text-ink-muted hover:bg-danger-soft hover:text-danger"
                    aria-label={`Remove ${user?.name ?? email}`}
                  >
                    <X className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <p className="-mt-2 text-xs text-ink-subtle">{rows.length} approver{rows.length === 1 ? '' : 's'}</p>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !dirty}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}
