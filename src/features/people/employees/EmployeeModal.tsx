import { useState } from 'react'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { employees, type Employee } from '@/lib/queries/people'

export function EmployeeModal({
  locationId,
  existing,
  onClose,
  onSaved,
}: {
  locationId: string
  existing: Employee | null
  onClose: () => void
  onSaved: () => void
}) {
  const isNew = !existing
  const [first, setFirst] = useState(existing?.first_name ?? '')
  const [last, setLast] = useState(existing?.last_name ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [roleTitle, setRoleTitle] = useState(existing?.role_title ?? '')
  const [startDate, setStartDate] = useState(existing?.start_date ?? '')
  const [hourly, setHourly] = useState(existing?.hourly_rate != null ? String(existing.hourly_rate) : '')
  const [uniform, setUniform] = useState(existing?.uniform_size ?? '')
  const [status, setStatus] = useState(existing?.status ?? 'active')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const hasPin = !!existing?.pin_hash

  const save = async () => {
    setError(null)
    if (!first.trim() || !last.trim()) return setError('First and last name are required')
    if (pin && !/^\d{4}$/.test(pin)) return setError('Kiosk PIN must be exactly 4 digits')
    const payload = {
      first_name: first.trim(),
      last_name: last.trim(),
      email: email.trim() || null,
      phone: phone.trim() || null,
      role_title: roleTitle.trim() || null,
      start_date: startDate || null,
      hourly_rate: hourly ? Number(hourly) : null,
      uniform_size: uniform.trim() || null,
      status,
    }
    const { data, error: err } = isNew
      ? await employees.create({ ...payload, location_id: locationId })
      : await employees.update(existing.id, payload).select().single()
    if (err) return setError(err.message)

    // Set the kiosk PIN (separate, hashed RPC). Required on create per setup flow.
    const employeeId = isNew ? (data as { id: string }).id : existing.id
    if (pin) {
      const { error: pinErr } = await employees.setPin(employeeId, pin)
      if (pinErr) return setError(pinErr.message)
    }
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add employee' : 'Edit employee'} size="lg">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="First name" required>{(id) => <Input id={id} value={first} onChange={(e) => setFirst(e.target.value)} />}</Field>
          <Field label="Last name" required>{(id) => <Input id={id} value={last} onChange={(e) => setLast(e.target.value)} />}</Field>
          <Field label="Email">{(id) => <Input id={id} type="email" value={email ?? ''} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={phone ?? ''} onChange={(e) => setPhone(e.target.value)} />}</Field>
          <Field label="Role title">{(id) => <Input id={id} value={roleTitle ?? ''} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Attendant" />}</Field>
          <Field label="Start date">{(id) => <Input id={id} type="date" value={startDate ?? ''} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="Hourly rate">{(id) => <Input id={id} type="number" step="0.01" value={hourly} onChange={(e) => setHourly(e.target.value)} />}</Field>
          <Field label="Uniform size">{(id) => <Input id={id} value={uniform ?? ''} onChange={(e) => setUniform(e.target.value)} placeholder="M" />}</Field>
          <Field
            label="Kiosk PIN"
            className="col-span-2"
            hint={hasPin ? 'A PIN is set — leave blank to keep it, or enter 4 digits to change.' : '4 digits the employee uses to clock in/out at the kiosk.'}
          >
            {(id) => (
              <Input
                id={id}
                inputMode="numeric"
                maxLength={4}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                placeholder={hasPin ? '••••' : '0000'}
              />
            )}
          </Field>
          <Field label="Status" className="col-span-2">
            {(id) => (
              <Select id={id} value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </Select>
            )}
          </Field>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>{isNew ? 'Add employee' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  )
}
