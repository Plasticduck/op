import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, ClipboardList, GripVertical, Plus, Search, Trash2 } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import {
  procedures,
  FIELD_TYPE_OPTIONS,
  type DraftField,
  type ProcedureFieldType,
  type TemplateWithCount,
  type TemplateWithFields,
} from '@/lib/queries/procedures'

const NEEDS_OPTIONS = (t: ProcedureFieldType) => t === 'multiple_choice'

export default function ProceduresPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<TemplateWithCount[]>([])
  const [loading, setLoading] = useState(true)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [creating, setCreating] = useState(false)

  // editor state for the active template
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [fields, setFields] = useState<DraftField[]>([])
  const [saving, setSaving] = useState(false)
  const [savedMsg, setSavedMsg] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await procedures.templates()
    setRows((data as TemplateWithCount[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const openTemplate = useCallback(async (id: string) => {
    setActiveId(id)
    setSavedMsg(null)
    const { data } = await procedures.template(id)
    const t = data as TemplateWithFields | null
    setName(t?.name ?? '')
    setDescription(t?.description ?? '')
    setFields(
      (t?.fields ?? [])
        .sort((a, b) => a.order_index - b.order_index)
        .map((f) => ({ label: f.label, type: f.type as ProcedureFieldType, required: f.required, options: (f.options as string[]) ?? [] })),
    )
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return q ? rows.filter((t) => t.name.toLowerCase().includes(q)) : rows
  }, [rows, search])

  const addField = () => setFields((f) => [...f, { label: '', type: 'checkbox', required: false, options: [] }])
  const updateField = (i: number, patch: Partial<DraftField>) =>
    setFields((f) => f.map((x, idx) => (idx === i ? { ...x, ...patch } : x)))
  const removeField = (i: number) => setFields((f) => f.filter((_, idx) => idx !== i))
  const moveField = (i: number, dir: -1 | 1) =>
    setFields((f) => {
      const j = i + dir
      if (j < 0 || j >= f.length) return f
      const next = [...f]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })

  const save = async () => {
    if (!activeId) return
    setSaving(true)
    setSavedMsg(null)
    await procedures.updateTemplate(activeId, { name: name.trim(), description: description.trim() || null })
    await procedures.setFields(activeId, fields.filter((f) => f.label.trim()).map((f) => ({ ...f, label: f.label.trim() })))
    setSaving(false)
    setSavedMsg('Saved')
    void load()
    setTimeout(() => setSavedMsg(null), 2000)
  }

  const removeTemplate = async (id: string, tName: string) => {
    if (!window.confirm(`Delete "${tName}"? Work orders that already used it keep their copy.`)) return
    await procedures.removeTemplate(id)
    if (activeId === id) setActiveId(null)
    void load()
  }

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4">
      <div className="hidden lg:block lg:pb-4">
        <PageHeader
          title="Procedures"
          subtitle="Build reusable checklists and inspections to attach to work orders."
          actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New Procedure</Button>}
        />
      </div>

      <div className="grid h-full min-h-0 flex-1 gap-0 lg:gap-4 lg:grid-cols-[340px_1fr]">
        {/* List */}
        <div className={cn('flex min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border', activeId ? 'hidden lg:flex' : 'flex')}>
          <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5 lg:hidden">
            <h1 className="text-lg font-semibold text-ink">Procedures</h1>
            <button onClick={() => setCreating(true)} className="grid size-9 place-items-center rounded-full bg-accent text-white hover:bg-accent-hover" aria-label="New procedure"><Plus className="size-4" /></button>
          </div>
          <div className="border-b border-border p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search procedures..." className="h-9 pl-8 text-sm" />
            </div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
            {loading ? (
              <p className="px-3 py-4 text-sm text-ink-muted">Loading...</p>
            ) : filtered.length === 0 ? (
              <p className="px-3 py-4 text-sm text-ink-muted">No procedures yet.</p>
            ) : (
              filtered.map((t) => (
                <button key={t.id} type="button" onClick={() => void openTemplate(t.id)} className={cn('flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2.5 text-left transition', activeId === t.id ? 'bg-accent-soft' : 'hover:bg-content')}>
                  <span className="truncate text-sm font-medium text-ink">{t.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-subtle">{t.fields?.[0]?.count ?? 0} fields</span>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Detail / editor */}
        <div className={cn('min-h-0 flex-col overflow-hidden bg-card lg:rounded-md lg:border lg:border-border', activeId ? 'flex' : 'hidden lg:flex')}>
          {activeId ? (
            <>
              <div className="flex items-center gap-2 border-b border-border px-2 py-2.5 sm:px-4 sm:py-3">
                <button type="button" onClick={() => setActiveId(null)} className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden" aria-label="Back"><ArrowLeft className="size-5" /></button>
                <h2 className="min-w-0 flex-1 truncate text-lg font-semibold text-ink">{name || 'Procedure'}</h2>
                <div className="flex items-center gap-2">
                  {savedMsg && <span className="text-xs text-ok">{savedMsg}</span>}
                  <Button size="sm" onClick={() => void save()} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button>
                  <Button variant="ghost" size="sm" onClick={() => void removeTemplate(activeId, name)}><Trash2 className="size-3.5" /></Button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
                <div className="mb-4 grid gap-3">
                  <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}</Field>
                  <Field label="Description">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />}</Field>
                </div>

                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-ink">Fields</h3>
                  <Button variant="secondary" size="sm" onClick={addField}><Plus className="size-3.5" /> Add field</Button>
                </div>
                {fields.length === 0 ? (
                  <p className="rounded-md border border-dashed border-border px-3 py-6 text-center text-sm text-ink-muted">No fields yet. Add checklist items, inspections, or questions.</p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {fields.map((f, i) => (
                      <div key={i} className="rounded-md border border-border p-2.5">
                        <div className="flex items-start gap-2">
                          <div className="flex flex-col pt-1 text-ink-subtle">
                            <button type="button" onClick={() => moveField(i, -1)} className="hover:text-ink" aria-label="Move up"><GripVertical className="size-4" /></button>
                          </div>
                          <div className="grid flex-1 gap-2 sm:grid-cols-[1fr_180px]">
                            <Input value={f.label} onChange={(e) => updateField(i, { label: e.target.value })} placeholder={f.type === 'section' ? 'Section heading' : 'Field label'} />
                            <Select value={f.type} onChange={(e) => updateField(i, { type: e.target.value as ProcedureFieldType })}>
                              {FIELD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                            </Select>
                            {NEEDS_OPTIONS(f.type) && (
                              <Input
                                className="sm:col-span-2"
                                value={f.options.join(', ')}
                                onChange={(e) => updateField(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                                placeholder="Options, comma separated"
                              />
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <button type="button" onClick={() => removeField(i)} className="text-ink-subtle hover:text-danger" aria-label="Remove field"><Trash2 className="size-4" /></button>
                            {f.type !== 'section' && (
                              <label className="flex items-center gap-1 text-[11px] text-ink-muted">
                                <input type="checkbox" checked={f.required} onChange={(e) => updateField(i, { required: e.target.checked })} className="size-3.5 accent-accent" />
                                Req
                              </label>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          ) : (
            <div className="grid h-full place-items-center text-center text-sm text-ink-muted">
              <div>
                <ClipboardList className="mx-auto mb-2 size-10 text-ink-subtle/60" />
                Pick a procedure to edit its fields.
              </div>
            </div>
          )}
        </div>
      </div>

      {creating && (
        <NewProcedureModal
          accountId={profile?.account_id ?? ''}
          onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); void load(); void openTemplate(id) }}
        />
      )}
    </div>
  )
}

function NewProcedureModal({ accountId, onClose, onCreated }: { accountId: string; onClose: () => void; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const create = async () => {
    if (!name.trim()) return setError('Enter a name')
    setBusy(true)
    const { data, error: err } = await procedures.createTemplate({ account_id: accountId, name: name.trim() })
    setBusy(false)
    if (err || !data) return setError(err?.message ?? 'Could not create')
    onCreated(data.id)
  }
  return (
    <Modal open onClose={onClose} title="New procedure">
      <div className="flex flex-col gap-4">
        <Field label="Name" required>{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="e.g. Bay Daily Inspection" />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void create()} disabled={busy}>Create</Button>
        </div>
      </div>
    </Modal>
  )
}
