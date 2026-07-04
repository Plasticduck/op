import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { MultiLocationSelect } from '@/components/forms/MultiLocationSelect'
import {
  createInvitation,
  type InvitableRole,
  type LocationFull,
} from '@/lib/queries/account'
import { useAuth } from '@/lib/auth'

export function InviteModal({
  open,
  onClose,
  onCreated,
  locations,
}: {
  open: boolean
  onClose: () => void
  onCreated: () => void
  locations: LocationFull[]
}) {
  const { profile } = useAuth()
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('employee')
  const [locIds, setLocIds] = useState<string[]>([])
  // Technicians work across every site, so site assignment doesn't apply to them.
  const allSites = role === 'technician'
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setEmail('')
    setRole('employee')
    setLocIds([])
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    if (!profile) return
    setError(null)
    if (!email.includes('@')) return setError('Enter a valid email')
    if (!allSites && locIds.length === 0) return setError('Assign at least one location')

    setSubmitting(true)
    const { error: err } = await createInvitation({
      account_id: profile.account_id,
      invited_by: profile.id,
      email: email.trim().toLowerCase(),
      role,
      location_ids: allSites ? [] : locIds,
    })
    setSubmitting(false)
    if (err) return setError(err.message)
    // Invite sent. Close the box; the link is available under Pending invitations.
    onCreated()
    close()
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite team member"
      description="They get a secure link to set their password and join."
    >
      <div className="flex flex-col gap-4">
          <Field label="Email" required>
            {(id) => (
              <Input
                id={id}
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="teammate@company.com"
              />
            )}
          </Field>
          <Field label="Role" required>
            {(id) => (
              <Select
                id={id}
                value={role}
                onChange={(e) => setRole(e.target.value as InvitableRole)}
              >
                <option value="employee">Employee</option>
                <option value="technician">Technician</option>
                <option value="manager">Manager</option>
              </Select>
            )}
          </Field>
          {allSites ? (
            <Field label="Locations" hint="Technicians have access to all sites.">
              {() => (
                <p className="rounded-md border border-border bg-content px-3 py-2 text-sm text-ink-muted">
                  All sites
                </p>
              )}
            </Field>
          ) : (
            <Field label="Locations" hint="Assign one or more sites" required>
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
            <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={close}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              Send invite
            </Button>
          </div>
      </div>
    </Modal>
  )
}
