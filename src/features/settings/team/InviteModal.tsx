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
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<InvitableRole>('employee')
  const [locIds, setLocIds] = useState<string[]>([])
  // HR fields for the roster record.
  const [roleTitle, setRoleTitle] = useState('')
  const [phone, setPhone] = useState('')
  const [startDate, setStartDate] = useState('')
  const [hourly, setHourly] = useState('')
  const [uniform, setUniform] = useState('')
  const [pin, setPin] = useState('')
  // Technicians work across every site, so site assignment doesn't apply to them.
  const allSites = isUser && role === 'technician'
  // An employee (roster) record is created for non-users and for user-employees;
  // managers/technicians are login-only, so their HR fields don't apply.
  const hasRosterRecord = !isUser || role === 'employee'
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setIsUser(true)
    setFirst('')
    setLast('')
    setEmail('')
    setRole('employee')
    setLocIds([])
    setRoleTitle('')
    setPhone('')
    setStartDate('')
    setHourly('')
    setUniform('')
    setPin('')
    setError(null)
  }

  const close = () => {
    reset()
    onClose()
  }

  const rosterPayload = (locId: string, cleanEmail: string | null) => ({
    location_id: locId,
    first_name: first.trim(),
    last_name: last.trim(),
    email: cleanEmail,
    phone: phone.trim() || null,
    role_title: roleTitle.trim() || null,
    start_date: startDate || null,
    hourly_rate: hourly ? Number(hourly) : null,
    uniform_size: uniform.trim() || null,
    status: 'active' as const,
  })

  const submit = async () => {
    if (!profile) return
    setError(null)
    if (!first.trim() || !last.trim()) return setError('Enter a first and last name')
    if (pin && !/^\d{5}$/.test(pin)) return setError('Kiosk PIN must be exactly 5 digits')

    // Non-user: just add a roster record. No login, no email needed.
    if (!isUser) {
      if (locIds.length === 0) return setError('Assign at least one location')
      setSubmitting(true)
      const { data: created, error: empErr } = await employees.create(
        rosterPayload(locIds[0], email.trim().toLowerCase() || null),
      )
      if (empErr) {
        setSubmitting(false)
        return setError(empErr.message)
      }
      if (pin && created) {
        const { error: pinErr } = await employees.setPin((created as { id: string }).id, pin)
        if (pinErr) {
          setSubmitting(false)
          return setError(pinErr.message)
        }
      }
      setSubmitting(false)
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
      name: `${first.trim()} ${last.trim()}`.trim(),
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
      const { data: created } = await employees.create(rosterPayload(locIds[0], cleanEmail))
      if (pin && created) await employees.setPin((created as { id: string }).id, pin)
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="First name" required>
            {(id) => (
              <Input id={id} value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Jordan" />
            )}
          </Field>
          <Field label="Last name" required>
            {(id) => (
              <Input id={id} value={last} onChange={(e) => setLast(e.target.value)} placeholder="Rivera" />
            )}
          </Field>
        </div>

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

        {hasRosterRecord && (
          <div className="flex flex-col gap-4 rounded-md border border-border bg-content/50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-ink-muted">
              Employee details (optional)
            </p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Role title">
                {(id) => (
                  <Input id={id} value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Attendant" />
                )}
              </Field>
              <Field label="Phone">
                {(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} />}
              </Field>
              <Field label="Start date">
                {(id) => (
                  <Input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                )}
              </Field>
              <Field label="Hourly rate">
                {(id) => (
                  <Input id={id} type="number" step="0.01" value={hourly} onChange={(e) => setHourly(e.target.value)} placeholder="0.00" />
                )}
              </Field>
              <Field label="Uniform size">
                {(id) => <Input id={id} value={uniform} onChange={(e) => setUniform(e.target.value)} placeholder="M" />}
              </Field>
              <Field label="Kiosk PIN" hint="5 digits used to clock in/out at the kiosk.">
                {(id) => (
                  <Input
                    id={id}
                    inputMode="numeric"
                    maxLength={5}
                    value={pin}
                    onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                    placeholder="00000"
                  />
                )}
              </Field>
            </div>
          </div>
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
