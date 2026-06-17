import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Building2, Loader2, Mail, MapPin, Pencil, Phone, Plus, Search, Trash2, X } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { Badge } from '@/components/ui/Badge'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { vendors, type Vendor, type VendorContact } from '@/lib/queries/workOrders'

type VendorWithContacts = Vendor & { contacts: VendorContact[] }

const KIND_OPTIONS: Array<{ value: 'parts_supplier' | 'service' | 'both' | 'other'; label: string }> = [
  { value: 'parts_supplier', label: 'Parts supplier' },
  { value: 'service', label: 'Service contractor' },
  { value: 'both', label: 'Parts + Service' },
  { value: 'other', label: 'Other' },
]

export default function VendorsPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<VendorWithContacts[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [activeId, setActiveId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<VendorWithContacts | null>(null)
  const [addingContact, setAddingContact] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await vendors.list()
    setRows((data as VendorWithContacts[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((v) => v.name.toLowerCase().includes(q) || (v.email ?? '').toLowerCase().includes(q))
  }, [rows, search])

  const active = rows.find((v) => v.id === activeId) ?? null

  const removeVendor = async (v: Vendor) => {
    if (!window.confirm(`Delete vendor "${v.name}"?`)) return
    await vendors.remove(v.id)
    if (activeId === v.id) setActiveId(null)
    void load()
  }

  const removeContact = async (id: string) => {
    if (!window.confirm('Delete this contact?')) return
    await vendors.removeContact(id)
    void load()
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      <div className="hidden lg:block lg:pb-4">
        <PageHeader
          title="Vendors"
          subtitle="Parts suppliers and service contractors."
          actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Vendor</Button>}
        />
      </div>

      <div className="grid h-full min-h-0 flex-1 gap-0 lg:gap-4 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <div className={cn(
          'flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          activeId ? 'hidden lg:flex' : 'flex',
        )}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Vendors</h1>
            <button
              onClick={() => setCreating(true)}
              className="grid size-9 place-items-center rounded-full bg-accent text-white hover:bg-accent-hover"
              aria-label="New vendor"
            >
              <Plus className="size-4" />
            </button>
          </div>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search vendors..." className="h-9 pl-8 text-sm" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-3 py-4 text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-muted">No vendors yet. Add your first one above.</p>
            ) : (
              filtered.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => setActiveId(v.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 border-b border-border px-3 py-2.5 text-left transition',
                    activeId === v.id ? 'bg-accent-soft' : 'hover:bg-content',
                  )}
                >
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-accent/15 text-xs font-semibold text-accent">
                    {v.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink">{v.name}</div>
                    <div className="truncate text-[11px] text-ink-subtle">
                      {(v.contacts?.length ?? 0) > 0 ? `${v.contacts.length} contact${v.contacts.length === 1 ? '' : 's'}` : 'No contacts'}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail */}
        <div className={cn(
          'min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border',
          activeId ? 'flex' : 'hidden lg:flex',
        )}>
          {active ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-2 py-2.5 sm:px-4 sm:py-3">
                <button
                  type="button"
                  onClick={() => setActiveId(null)}
                  className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden"
                  aria-label="Back"
                >
                  <ArrowLeft className="size-5" />
                </button>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-lg font-semibold text-ink">{active.name}</h2>
                  <Badge tone="neutral">{KIND_OPTIONS.find((k) => k.value === active.kind)?.label ?? active.kind}</Badge>
                </div>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => setEditing(active)}><Pencil className="size-3.5" /> Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => void removeVendor(active)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                {/* About */}
                <section className="mb-5">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {active.email && <DetailRow icon={Mail} text={active.email} />}
                    {active.phone && <DetailRow icon={Phone} text={active.phone} />}
                    {active.address && <DetailRow icon={MapPin} text={active.address} />}
                    {active.website && (
                      <DetailRow icon={Building2} text={<a href={active.website} target="_blank" rel="noreferrer" className="text-accent hover:underline">{active.website}</a>} />
                    )}
                  </div>
                  {active.notes && (
                    <p className="mt-3 rounded-md bg-content p-3 text-sm text-ink">{active.notes}</p>
                  )}
                </section>

                {/* Contacts */}
                <section>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-ink">Contact List</h3>
                    <button
                      type="button"
                      onClick={() => setAddingContact(true)}
                      className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover"
                    >
                      <Plus className="size-3" /> New Contact
                    </button>
                  </div>
                  {(active.contacts?.length ?? 0) === 0 ? (
                    <p className="rounded-md bg-content/60 px-3 py-3 text-sm text-ink-muted">No contacts yet.</p>
                  ) : (
                    <div className="overflow-hidden rounded-md border border-border">
                      {active.contacts.map((c) => (
                        <div key={c.id} className="group flex items-start justify-between gap-3 border-b border-border px-3 py-2.5 text-sm last:border-0">
                          <div className="min-w-0">
                            <div className="font-medium text-ink">{c.name}</div>
                            <div className="text-[11px] text-ink-subtle">
                              {c.role_title && <span>{c.role_title}</span>}
                              {c.role_title && (c.email || c.phone) && ' . '}
                              {c.email && <a href={'mailto:' + c.email} className="hover:text-accent">{c.email}</a>}
                              {c.email && c.phone && ' . '}
                              {c.phone && <a href={'tel:' + c.phone} className="hover:text-accent">{c.phone}</a>}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void removeContact(c.id)}
                            className="hidden text-ink-subtle hover:text-danger group-hover:block"
                            aria-label="Remove"
                          ><X className="size-3.5" /></button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-ink-muted">
              <div>
                <Building2 className="mx-auto mb-2 size-10 text-ink-subtle/60" />
                Pick a vendor to view contacts.
              </div>
            </div>
          )}
        </div>
      </div>

      {(creating || editing) && (
        <VendorEditModal
          accountId={profile?.account_id ?? ''}
          vendor={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); void load() }}
        />
      )}
      {addingContact && active && (
        <ContactModal
          vendorId={active.id}
          onClose={() => setAddingContact(false)}
          onSaved={() => { setAddingContact(false); void load() }}
        />
      )}
    </div>
  )
}

function DetailRow({ icon: Icon, text }: { icon: React.ComponentType<{ className?: string }>; text: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-sm text-ink">
      <Icon className="size-4 shrink-0 text-ink-subtle" />
      <span className="truncate">{text}</span>
    </div>
  )
}

function VendorEditModal({
  accountId, vendor, onClose, onSaved,
}: {
  accountId: string
  vendor: Vendor | null
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(vendor?.name ?? '')
  const [kind, setKind] = useState<'parts_supplier' | 'service' | 'both' | 'other'>(
    (vendor?.kind as 'parts_supplier' | 'service' | 'both' | 'other') ?? 'parts_supplier',
  )
  const [email, setEmail] = useState(vendor?.email ?? '')
  const [phone, setPhone] = useState(vendor?.phone ?? '')
  const [address, setAddress] = useState(vendor?.address ?? '')
  const [website, setWebsite] = useState(vendor?.website ?? '')
  const [notes, setNotes] = useState(vendor?.notes ?? '')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    setError(null)
    if (!name.trim()) return setError('Enter a vendor name')
    setBusy(true)
    const payload = {
      name: name.trim(),
      kind,
      email: email.trim() || null,
      phone: phone.trim() || null,
      address: address.trim() || null,
      website: website.trim() || null,
      notes: notes.trim() || null,
    }
    const { error: err } = vendor
      ? await vendors.update(vendor.id, payload)
      : await vendors.create({ account_id: accountId, ...payload })
    setBusy(false)
    if (err) return setError(err.message)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={vendor ? 'Edit vendor' : 'New vendor'} size="md">
      <div className="flex flex-col gap-3">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Kind">
          {(id) => (
            <Select id={id} value={kind} onChange={(e) => setKind(e.target.value as 'parts_supplier' | 'service' | 'both' | 'other')}>
              {KIND_OPTIONS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
            </Select>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
          <Field label="Phone">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
        </div>
        <Field label="Address">{(id) => <Input id={id} value={address} onChange={(e) => setAddress(e.target.value)} />}</Field>
        <Field label="Website">{(id) => <Input id={id} type="url" placeholder="https://" value={website} onChange={(e) => setWebsite(e.target.value)} />}</Field>
        <Field label="Notes">
          {(id) => <textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent" />}
        </Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{vendor ? 'Save' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}

function ContactModal({ vendorId, onClose, onSaved }: {
  vendorId: string; onClose: () => void; onSaved: () => void
}) {
  const [name, setName] = useState('')
  const [role, setRole] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim()) return
    setBusy(true)
    await vendors.addContact({
      vendor_id: vendorId,
      name: name.trim(),
      role_title: role.trim() || null,
      email: email.trim() || null,
      phone: phone.trim() || null,
    })
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Add contact">
      <div className="flex flex-col gap-3">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus />}</Field>
        <Field label="Role / title">{(id) => <Input id={id} value={role} onChange={(e) => setRole(e.target.value)} />}</Field>
        <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
        <Field label="Phone">{(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Add</Button>
        </div>
      </div>
    </Modal>
  )
}
