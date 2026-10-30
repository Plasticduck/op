import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Pencil, Plus, Save, Trash2, TriangleAlert, X } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { itInventory, type ItCustomField } from '@/lib/queries/itInventory'
import { categoriesFor, FIELD_TYPES, fieldOptions, keyFromName } from './customFields'
import { AuditSettings } from './AuditSettings'
import { ReminderSettings } from './ReminderSettings'
import { useItRefs, type ItRefs } from './useItRefs'

// IT Inventory settings: how tags look, what prints on stickers, reminders,
// and the custom fields each category asks for. Owners change these; everyone
// on the IT side can see them.

export function SettingsPage() {
  const { profile } = useAuth()
  const { refs, error, reload } = useItRefs()
  const [flash, setFlash] = useState<string | null>(null)
  const admin = profile?.role === 'owner'

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/app/it-inventory" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> IT Inventory
      </Link>
      <div className="mt-3">
        <PageHeader title="IT Inventory settings" subtitle={admin ? 'Tags, stickers, reminders, audits and the extra details you track.' : 'Only an admin can change these.'} />
      </div>
      {flash && (
        <div className="mt-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
          <span>{flash}</span>
          <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
        </div>
      )}
      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {!refs ? (
        <div className="grid place-items-center py-16 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
      ) : (
        <div className="mt-5 space-y-6">
          <TagSettings key={refs.settings.updated_at} refs={refs} admin={admin}
            onSaved={() => { void reload(); setFlash('Saved. New tags and stickers use it.') }} />
          <ReminderSettings refs={refs} admin={admin} onSaved={(m) => { void reload(); setFlash(m) }} />
          <AuditSettings key={`audits-${refs.settings.updated_at}`} refs={refs} admin={admin} onSaved={(m) => { void reload(); setFlash(m) }} />
          <CustomFields refs={refs} admin={admin} accountId={profile?.account_id ?? ''}
            onChanged={(m) => { void reload(); setFlash(m) }} />
        </div>
      )}
    </div>
  )
}

function TagSettings({ refs, admin, onSaved }: { refs: ItRefs; admin: boolean; onSaved: () => void }) {
  const s = refs.settings
  const [prefix, setPrefix] = useState(s.tag_prefix)
  const [padding, setPadding] = useState(String(s.tag_padding))
  const [phone, setPhone] = useState(s.support_phone ?? '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pad = Math.min(10, Math.max(3, Number(padding) || 6))
  const example = `${prefix.toUpperCase() || 'IT'}-${'1'.padStart(pad, '0')}`
  const dirty = prefix.toUpperCase() !== s.tag_prefix || pad !== s.tag_padding || (phone.trim() || null) !== (s.support_phone ?? null)

  const save = async () => {
    if (!/^[A-Z0-9]{1,8}$/.test(prefix.toUpperCase())) { setError('Use 1 to 8 letters or numbers, like MW.'); return }
    setSaving(true)
    setError(null)
    const { error: err } = await itInventory.updateSettings(s.id, { tag_prefix: prefix.toUpperCase(), tag_padding: pad, support_phone: phone.trim() || null })
    setSaving(false)
    if (err) setError(err.message)
    else onSaved()
  }

  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h2 className="text-sm font-semibold text-ink">Tags and stickers</h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Tag prefix" hint="Letters before the number.">
          {(id) => <Input id={id} value={prefix} onChange={(e) => setPrefix(e.target.value)} className="font-mono uppercase" disabled={!admin} maxLength={8} />}
        </Field>
        <Field label="Digits" hint="Zeros fill the number to this length.">
          {(id) => <Input id={id} type="number" min={3} max={10} value={padding} onChange={(e) => setPadding(e.target.value)} disabled={!admin} />}
        </Field>
        <Field label="Help phone on stickers" hint="Optional. Prints where there's room.">
          {(id) => <Input id={id} value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!admin} placeholder="806-555-0100" />}
        </Field>
      </div>
      <p className="mt-3 text-sm text-ink-muted">
        New tags look like <span className="font-mono text-ink">{example}</span>. Tags already made keep their number;
        a tag is never changed once it's on a sticker.
      </p>
      <p className="mt-1 text-sm text-ink-muted">
        Sticker QR codes link to <span className="font-mono text-ink">/t/{s.short_code}/…</span>. That code can't change, so printed stickers keep working.
      </p>
      {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {admin && (
        <div className="mt-3">
          <Button onClick={() => void save()} disabled={!dirty || saving}>{saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />} Save</Button>
        </div>
      )}
    </section>
  )
}

function CustomFields({ refs, admin, accountId, onChanged }: { refs: ItRefs; admin: boolean; accountId: string; onChanged: (m: string) => void }) {
  const [editing, setEditing] = useState<ItCustomField | 'new' | null>(null)
  const [removing, setRemoving] = useState<ItCustomField | null>(null)
  const typeLabel = (t: string) => FIELD_TYPES.find((x) => x.key === t)?.label ?? t
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink">Custom fields</h2>
          <p className="mt-1 text-xs text-ink-muted">Extra details to track for some kinds of gear, like firmware version on pay stations or the admin login on routers.</p>
        </div>
        {admin && <Button size="sm" onClick={() => setEditing('new')}><Plus className="size-4" /> Add a field</Button>}
      </div>
      {refs.fields.length === 0 ? (
        <p className="mt-4 rounded-md border border-border bg-content/40 p-3 text-sm text-ink-muted">No custom fields yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {refs.fields.map((f) => {
            const cats = categoriesFor(refs, f.id).map((id) => refs.category.get(id)?.name).filter(Boolean)
            return (
              <li key={f.id} className="flex items-start gap-3 px-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-ink">{f.name}</span>
                    <Badge tone={f.field_type === 'secret' ? 'warn' : 'neutral'}>{typeLabel(f.field_type)}</Badge>
                    {f.is_required && <Badge tone="accent">Required</Badge>}
                    {f.show_in_list && <Badge>In the list</Badge>}
                    {f.editable_during_audit && <Badge>Audits</Badge>}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-muted">{cats.length ? cats.join(', ') : 'Not on any category yet'}</div>
                </div>
                {admin && (
                  <>
                    <button type="button" onClick={() => setEditing(f)} aria-label={`Edit ${f.name}`} className="grid size-8 place-items-center rounded-md text-ink-muted hover:bg-content"><Pencil className="size-4" /></button>
                    <button type="button" onClick={() => setRemoving(f)} aria-label={`Remove ${f.name}`} className="grid size-8 place-items-center rounded-md text-danger hover:bg-danger-soft"><Trash2 className="size-4" /></button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {editing && (
        <FieldDialog refs={refs} accountId={accountId} field={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)} onSaved={(m) => { setEditing(null); onChanged(m) }} />
      )}
      <ConfirmDialog
        open={!!removing}
        title={`Remove "${removing?.name ?? ''}"?`}
        description="It stops showing on items. Values already entered stay in each item's history."
        confirmLabel="Remove" destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (!removing) return
          void itInventory.removeField(removing.id).then(() => { setRemoving(null); onChanged('Field removed.') })
        }}
      />
    </section>
  )
}

function FieldDialog({ refs, accountId, field, onClose, onSaved }: {
  refs: ItRefs; accountId: string; field: ItCustomField | null; onClose: () => void; onSaved: (m: string) => void
}) {
  const [name, setName] = useState(field?.name ?? '')
  const [type, setType] = useState(field?.field_type ?? 'text')
  const [options, setOptions] = useState(field ? fieldOptions(field).join(', ') : '')
  const [help, setHelp] = useState(field?.help_text ?? '')
  const [required, setRequired] = useState(field?.is_required ?? false)
  const [inList, setInList] = useState(field?.show_in_list ?? false)
  const [audit, setAudit] = useState(field?.editable_during_audit ?? false)
  const [cats, setCats] = useState<Set<string>>(() => new Set(field ? categoriesFor(refs, field.id) : []))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const assetCats = refs.categories.filter((c) => c.kind === 'asset')

  const save = async () => {
    if (!name.trim()) { setError('Give it a name.'); return }
    const opts = options.split(',').map((o) => o.trim()).filter(Boolean)
    if (type === 'select' && opts.length < 2) { setError('List at least two choices, separated by commas.'); return }
    setSaving(true)
    setError(null)
    let key = field?.key ?? keyFromName(name)
    if (!field) {
      // Keep keys unique: firmware_version, firmware_version_2, ...
      const used = new Set(refs.fields.map((f) => f.key))
      for (let n = 2; used.has(key); n++) key = `${keyFromName(name).slice(0, 36)}_${n}`
    }
    const { data, error: err } = await itInventory.saveField({
      ...(field ? { id: field.id } : {}),
      account_id: accountId, name: name.trim(), key, field_type: type,
      options: type === 'select' ? opts : [], help_text: help.trim() || null,
      is_required: required, show_in_list: type !== 'secret' && inList, editable_during_audit: audit,
    })
    if (err || !data) { setSaving(false); setError(err?.message ?? "Couldn't save."); return }
    const linkErr = await itInventory.setFieldCategories(accountId, data.id, [...cats], refs.categories)
    setSaving(false)
    if (linkErr) { setError(linkErr); return }
    onSaved(field ? `Saved "${name.trim()}".` : `Added "${name.trim()}". It shows on ${cats.size} categor${cats.size === 1 ? 'y' : 'ies'}.`)
  }

  return (
    <Modal open onClose={onClose} size="lg" title={field ? `Edit ${field.name}` : 'Add a custom field'}>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Firmware version" autoFocus />}</Field>
          <Field label="Kind of value">
            {(id) => (
              <Select id={id} value={type} onChange={(e) => setType(e.target.value)} disabled={!!field}>
                {FIELD_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
              </Select>
            )}
          </Field>
          {type === 'select' && (
            <Field label="Choices" hint="Separate with commas." className="sm:col-span-2">
              {(id) => <Input id={id} value={options} onChange={(e) => setOptions(e.target.value)} placeholder="Good, Fair, Needs replacing" />}
            </Field>
          )}
          <Field label="Help text" hint="Optional. Shows under the field." className="sm:col-span-2">
            {(id) => <Input id={id} value={help} onChange={(e) => setHelp(e.target.value)} placeholder="Where to find it on the device" />}
          </Field>
        </div>
        {type === 'secret' && (
          <p className="flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
            <TriangleAlert className="mt-0.5 size-4 shrink-0" />
            Secret values are encrypted. Only admins can see them, and every time one is shown it's recorded on the item's history.
          </p>
        )}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Check on={required} onChange={setRequired}>Required when adding or editing</Check>
          {type !== 'secret' && <Check on={inList} onChange={setInList}>Show as a column in the list</Check>}
          <Check on={audit} onChange={setAudit}>Can be updated during an audit</Check>
        </div>
        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Show it on</div>
          <div className="flex flex-wrap gap-2">
            {assetCats.map((c) => {
              const on = cats.has(c.id)
              return (
                <button key={c.id} type="button" onClick={() => setCats((s) => { const n = new Set(s); if (on) n.delete(c.id); else n.add(c.id); return n })}
                  className={cn('rounded-full border px-3 py-1 text-sm transition', on ? 'border-accent bg-accent-soft text-accent' : 'border-border bg-card text-ink hover:bg-content')}>
                  {c.name}
                </button>
              )
            })}
          </div>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex flex-col-reverse gap-2 border-t border-border pt-4 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving}>{saving && <Loader2 className="size-4 animate-spin" />} Save</Button>
        </div>
      </div>
    </Modal>
  )
}

function Check({ on, onChange, children }: { on: boolean; onChange: (v: boolean) => void; children: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked)} className="size-4 rounded border-border text-accent focus:ring-accent" />
      {children}
    </label>
  )
}
