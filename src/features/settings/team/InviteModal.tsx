import { useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { MultiLocationSelect } from '@/components/forms/MultiLocationSelect'
import { createInvitation, inviteUrl, type LocationFull } from '@/lib/queries/account'
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
  const [role, setRole] = useState<'manager' | 'employee'>('employee')
  const [locIds, setLocIds] = useState<string[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdUrl, setCreatedUrl] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const reset = () => {
    setEmail('')
    setRole('employee')
    setLocIds([])
    setError(null)
    setCreatedUrl(null)
    setCopied(false)
  }

  const close = () => {
    reset()
    onClose()
  }

  const submit = async () => {
    if (!profile) return
    setError(null)
    if (!email.includes('@')) return setError('Enter a valid email')
    if (locIds.length === 0) return setError('Assign at least one location')

    setSubmitting(true)
    const { data, error: err } = await createInvitation({
      account_id: profile.account_id,
      invited_by: profile.id,
      email: email.trim().toLowerCase(),
      role,
      location_ids: locIds,
    })
    setSubmitting(false)
    if (err) return setError(err.message)
    setCreatedUrl(inviteUrl((data as { token: string }).token))
    onCreated()
  }

  const copy = async () => {
    if (!createdUrl) return
    await navigator.clipboard.writeText(createdUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Modal
      open={open}
      onClose={close}
      title="Invite team member"
      description={
        createdUrl
          ? 'Share this link with your teammate. It expires in 72 hours.'
          : 'They get a secure link to set their password and join.'
      }
    >
      {createdUrl ? (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Input value={createdUrl} readOnly className="font-mono text-xs" />
            <Button variant="secondary" size="icon" onClick={copy} aria-label="Copy link">
              {copied ? <Check className="size-4 text-ok" /> : <Copy className="size-4" />}
            </Button>
          </div>
          <div className="flex justify-end">
            <Button onClick={close}>Done</Button>
          </div>
        </div>
      ) : (
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
                onChange={(e) => setRole(e.target.value as 'manager' | 'employee')}
              >
                <option value="employee">Employee</option>
                <option value="manager">Manager</option>
              </Select>
            )}
          </Field>
          <Field label="Locations" hint="Assign one or more sites" required>
            {() => (
              <MultiLocationSelect
                options={locations.filter((l) => !l.archived)}
                value={locIds}
                onChange={setLocIds}
              />
            )}
          </Field>
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
      )}
    </Modal>
  )
}
