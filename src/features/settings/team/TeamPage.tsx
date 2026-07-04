import { useCallback, useEffect, useMemo, useState } from 'react'
import { Clock, Copy, UserPlus } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { MultiLocationSelect } from '@/components/forms/MultiLocationSelect'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { InviteModal } from '@/features/settings/team/InviteModal'
import { useAuth } from '@/lib/auth'
import { ROLE_LABEL, type Role } from '@/lib/rbac'
import {
  listAllLocations,
  listInvitations,
  listUsers,
  removeUser,
  resendInvitation,
  sendInviteEmail,
  revokeInvitation,
  updateUserRoleLocations,
  inviteUrl,
  type AccountUser,
  type Invitation,
  type LocationFull,
} from '@/lib/queries/account'

export function TeamPage() {
  const { profile } = useAuth()
  const [users, setUsers] = useState<AccountUser[]>([])
  const [invites, setInvites] = useState<Invitation[]>([])
  const [locations, setLocations] = useState<LocationFull[]>([])
  const [loading, setLoading] = useState(true)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editUser, setEditUser] = useState<AccountUser | null>(null)
  const [removeTarget, setRemoveTarget] = useState<AccountUser | null>(null)
  const [busy, setBusy] = useState(false)

  const locNameById = useMemo(
    () => Object.fromEntries(locations.map((l) => [l.id, l.name])),
    [locations],
  )

  const load = useCallback(async () => {
    setLoading(true)
    const [u, i, l] = await Promise.all([
      listUsers(),
      listInvitations(),
      listAllLocations(),
    ])
    setUsers((u.data as AccountUser[] | null) ?? [])
    setInvites((i.data as Invitation[] | null) ?? [])
    setLocations((l.data as LocationFull[] | null) ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const doRemove = async () => {
    if (!removeTarget) return
    setBusy(true)
    await removeUser(removeTarget.id)
    setBusy(false)
    setRemoveTarget(null)
    void load()
  }

  if (loading) {
    return <p className="text-sm text-ink-muted">Loading team…</p>
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Members */}
      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-ink">
            Team members ({users.length})
          </h2>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus className="size-4" />
            Invite team member
          </Button>
        </div>

        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Locations</th>
                <th className="px-3 py-2.5 font-medium">Last active</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5">
                    <div className="font-medium text-ink">{u.name}</div>
                    <div className="text-xs text-ink-muted">{u.email}</div>
                  </td>
                  <td className="px-3 py-2.5">
                    <Badge tone={u.role === 'owner' ? 'accent' : 'neutral'}>
                      {ROLE_LABEL[u.role]}
                    </Badge>
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {u.role === 'owner'
                      ? 'All locations'
                      : u.location_ids.map((id) => locNameById[id] ?? '—').join(', ') ||
                        '—'}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">
                    {u.last_seen_at
                      ? formatDistanceToNow(new Date(u.last_seen_at), { addSuffix: true })
                      : 'Never'}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {u.id !== profile?.id && u.role !== 'owner' && (
                      <div className="flex justify-end gap-1">
                        <Button variant="ghost" size="sm" onClick={() => setEditUser(u)}>
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:text-danger"
                          onClick={() => setRemoveTarget(u)}
                        >
                          Remove
                        </Button>
                      </div>
                    )}
                    {u.id === profile?.id && (
                      <span className="text-xs text-ink-subtle">You</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pending invitations */}
      {invites.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink">
            Pending invitations ({invites.length})
          </h2>
          <div className="overflow-x-auto rounded-md border border-border bg-card">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  <th className="px-3 py-2.5 font-medium">Email</th>
                  <th className="px-3 py-2.5 font-medium">Role</th>
                  <th className="px-3 py-2.5 font-medium">Expires</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {invites.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date()
                  return (
                    <tr key={inv.id} className="border-t border-border hover:bg-content">
                      <td className="px-3 py-2.5 text-ink">{inv.email}</td>
                      <td className="px-3 py-2.5">
                        <Badge tone="neutral">{ROLE_LABEL[inv.role]}</Badge>
                      </td>
                      <td className="px-3 py-2.5 text-ink-muted">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3.5" />
                          {expired ? (
                            <span className="text-danger">expired</span>
                          ) : (
                            formatDistanceToNow(new Date(inv.expires_at), { addSuffix: true })
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => navigator.clipboard.writeText(inviteUrl(inv.token))}
                          >
                            <Copy className="size-3.5" />
                            Copy link
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={async () => {
                              // Refresh the 72h window and email the link again.
                              await resendInvitation(inv.id)
                              await sendInviteEmail(inv.id)
                              void load()
                            }}
                          >
                            Resend
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger hover:text-danger"
                            onClick={async () => {
                              await revokeInvitation(inv.id)
                              void load()
                            }}
                          >
                            Revoke
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <InviteModal
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onCreated={load}
        locations={locations}
      />

      {editUser && (
        <EditUserModal
          user={editUser}
          locations={locations}
          onClose={() => setEditUser(null)}
          onSaved={() => {
            setEditUser(null)
            void load()
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title={`Remove ${removeTarget?.name}?`}
        description="Their access is revoked immediately. Their historical records are preserved."
        confirmLabel="Remove"
        destructive
        loading={busy}
        onConfirm={doRemove}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}

function EditUserModal({
  user,
  locations,
  onClose,
  onSaved,
}: {
  user: AccountUser
  locations: LocationFull[]
  onClose: () => void
  onSaved: () => void
}) {
  const [role, setRole] = useState<Role>(user.role)
  const [locIds, setLocIds] = useState<string[]>(user.location_ids)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Owners and technicians span every site, so per-site assignment doesn't apply.
  const allSites = role === 'owner' || role === 'technician'

  const save = async () => {
    setError(null)
    if (!allSites && locIds.length === 0) {
      return setError('Assign at least one location')
    }
    setBusy(true)
    const { error: err } = await updateUserRoleLocations(
      user.id,
      role,
      role === 'technician' ? [] : locIds,
    )
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${user.name}`}>
      <div className="flex flex-col gap-4">
        <Field label="Role">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as Role)}>
              <option value="employee">Employee</option>
              <option value="technician">Technician</option>
              <option value="manager">Manager</option>
              <option value="owner">Owner</option>
            </Select>
          )}
        </Field>
        {allSites ? (
          <Field label="Locations" hint="Has access to all sites.">
            {() => (
              <p className="rounded-md border border-border bg-content px-3 py-2 text-sm text-ink-muted">
                All sites
              </p>
            )}
          </Field>
        ) : (
          <Field label="Locations">
            {() => (
              <MultiLocationSelect
                options={locations.filter((l) => !l.archived)}
                value={locIds}
                onChange={setLocIds}
              />
            )}
          </Field>
        )}
        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={busy}>
            Save changes
          </Button>
        </div>
      </div>
    </Modal>
  )
}
