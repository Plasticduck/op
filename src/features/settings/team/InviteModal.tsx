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
  sendInviteEmail,
  type InvitableRole,
  type LocationFull,
} from '@/lib/queries/account'
import { employees } from '@/lib/queries/people'
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
  // A "user" gets an app login (emailed invite); a "non-user" is roster-only
  // staff (scheduling / time clock) with no login and no email required.
  const [isUser, setIsUser] = useState(true)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('employee')
  const [locIds, setLocIds] = useState<string[]>([])
  // Technicians work across every site, so site assignment doesn't apply to them.
  const allSites = isUser && role === 'technician'
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setIsUser(true)
    setName('')
    setEmail('')
    setRole('employee')
    setLocIds([])
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const splitName = (full: string) => {
    const trimmed = full.trim()
    const first = trimmed.split(' ')[0]
    const last = trimmed.slice(first.length).trim()
    return { first, last }
  }

  const submit = async () => {
    if (!profile) return
    setError(null)
    if (!name.trim()) return setError('Enter their name')

    // Non-user: just add a roster record. No login, no email needed.
    if (!isUser) {
      if (locIds.length === 0) return setError('Assign at least one location')
      const { first, last } = splitName(name)
      setSubmitting(true)
      const { error: empErr } = await employees.create({
        location_id: locIds[0],
        first_name: first,
        last_name: last,
        email: email.trim().toLowerCase() || null,
        status: 'active',
      })
      setSubmitting(false)
      if (empErr) return setError(empErr.message)
      onCreated()
      return close()
    }

    if (!email.includes('@')) return setError('Enter a valid email')
    if (!allSites && locIds.length === 0) return setError('Assign at least one location')

    const cleanEmail = email.trim().toLowerCase()
    setSubmitting(true)
    const { data, error: err } = await createInvitation({
      account_id: profile.account_id,
      invited_by: profile.id,
      name: name.trim(),
      email: cleanEmail,
      role,
      location_ids: allSites ? [] : locIds,
    })
    if (err) {
      setSubmitting(false)
      return setError(err.message)
    }

    // Pre-create the People roster record so an invited employee is schedulable
    // right away, before they accept. accept_invitation links this same record
    // (matched by email) when they sign in, so there's no duplicate. Best effort:
    // if it fails, acceptance still creates the record.
    if (role === 'employee' && locIds.length >= 1) {
      const { first, last } = splitName(name)
      await employees.create({
        location_id: locIds[0],
        first_name: first,
        last_name: last,
        email: cleanEmail,
        status: 'active',
      })
    }

    // Email the invite. The invite exists either way, so if the email fails we
    // keep the modal open and tell them the link is copyable from Pending
    // invitations.
    const emailRes = await sendInviteEmail((data as { id: string }).id)
    setSubmitting(false)
    onCreated()
    if (emailRes.ok) {
      close()
    } else {
      setError(
        `Invite created, but the email could not be sent (${emailRes.error ?? 'unknown error'}). Copy the link from Pending invitations to share it.`,
      )
    }
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Add team member"
      description={
        isUser
          ? 'They get a secure link to set their password and join. Employees are added to your roster automatically.'
          : 'Added to your staff roster for scheduling and time. No app login or email required.'
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Full name" required>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jordan Rivera"
            />
          )}
        </Field>
        <Field label="Account type" hint="Non-users appear on schedules and the time clock but can't log in.">
          {(id) => (
            <Select
              id={id}
              value={isUser ? 'user' : 'nonuser'}
              onChange={(e) => setIsUser(e.target.value === 'user')}
            >
              <option value="user">App user (can log in)</option>
              <option value="nonuser">Non-user (roster only, no login)</option>
            </Select>
          )}
        </Field>

        {isUser && (
          <>
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
          </>
        )}

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
            {isUser ? 'Send invite' : 'Add to roster'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
