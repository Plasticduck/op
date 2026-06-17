import { useCallback, useEffect, useState } from 'react'
import { Contact as ContactIcon, Mail, Phone, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { contacts, type Contact } from '@/lib/queries/ops'

const CATEGORIES = [
  { value: 'vendor', label: 'Vendor' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'service', label: 'Service' },
  { value: 'other', label: 'Other' },
]

function Inner({ locationId }: { locationId: string }) {
  const [rows, setRows] = useState<Contact[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<Contact | null>(null)
  const [creating, setCreating] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Contact | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await contacts.list(locationId)
    setRows((data as Contact[] | null) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const filtered = filter === 'all' ? rows : rows.filter((r) => r.category === filter)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Contacts"
        subtitle="Vendors, suppliers, and service partners for this location."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> Add contact</Button>}
      />

      <div className="flex items-center gap-2">
        <Select value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : filtered.length === 0 ? (
        <EmptyState icon={ContactIcon} title="No contacts" description="Add vendors and service partners for quick access." action={<Button onClick={() => setCreating(true)}>Add contact</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((c) => (
            <div key={c.id} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-medium text-ink">{c.name}</h3>
                  {c.company && <p className="text-xs text-ink-muted">{c.company}</p>}
                </div>
                <Badge tone="neutral">{c.category}</Badge>
              </div>
              <div className="mt-3 flex flex-col gap-1.5 text-sm">
                {c.phone && (
                  <a href={`tel:${c.phone}`} className="inline-flex items-center gap-2 text-ink-muted hover:text-accent">
                    <Phone className="size-3.5" /> {c.phone}
                  </a>
                )}
                {c.email && (
                  <a href={`mailto:${c.email}`} className="inline-flex items-center gap-2 text-ink-muted hover:text-accent">
                    <Mail className="size-3.5" /> {c.email}
                  </a>
                )}
              </div>
              <div className="mt-3 flex gap-1 border-t border-border pt-2">
                <Button variant="ghost" size="sm" onClick={() => setEditing(c)}>Edit</Button>
                <Button variant="ghost" size="sm" className="text-danger hover:text-danger" onClick={() => setRemoveTarget(c)}>Delete</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(creating || editing) && (
        <ContactModal
          locationId={locationId}
          existing={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); void load() }}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        title={`Delete ${removeTarget?.name}?`}
        confirmLabel="Delete"
        destructive
        onConfirm={async () => { if (removeTarget) await contacts.remove(removeTarget.id); setRemoveTarget(null); void load() }}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  )
}

function ContactModal({ locationId, existing, onClose, onSaved }: {
  locationId: string; existing: Contact | null; onClose: () => void; onSaved: () => void
}) {
  const isNew = !existing
  const [name, setName] = useState(existing?.name ?? '')
  const [company, setCompany] = useState(existing?.company ?? '')
  const [phone, setPhone] = useState(existing?.phone ?? '')
  const [email, setEmail] = useState(existing?.email ?? '')
  const [category, setCategory] = useState(existing?.category ?? 'vendor')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!name.trim()) return setError('Enter a name')
    const payload = {
      name: name.trim(),
      company: company.trim() || null,
      phone: phone.trim() || null,
      email: email.trim() || null,
      category,
      notes: notes.trim() || null,
    }
    const { error: err } = isNew
      ? await contacts.create({ ...payload, location_id: locationId })
      : await contacts.update(existing.id, payload)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={isNew ? 'Add contact' : `Edit ${existing?.name}`}>
      <div className="flex flex-col gap-4">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Company">{(id) => <Input id={id} value={company ?? ''} onChange={(e) => setCompany(e.target.value)} />}</Field>
          <Field label="Category">
            {(id) => (
              <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Phone">{(id) => <Input id={id} value={phone ?? ''} onChange={(e) => setPhone(e.target.value)} />}</Field>
          <Field label="Email">{(id) => <Input id={id} type="email" value={email ?? ''} onChange={(e) => setEmail(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes ?? ''} onChange={(e) => setNotes(e.target.value)} />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>{isNew ? 'Add contact' : 'Save changes'}</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function ContactsPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
