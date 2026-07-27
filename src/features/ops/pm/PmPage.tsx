import { useCallback, useEffect, useState } from 'react'
import { CalendarClock, Pencil, Play, Plus, Trash2 } from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { pm, FREQ_UNITS, type PmPlan, type PmPlanRow } from '@/lib/queries/pm'
import { procedures, type TemplateWithCount } from '@/lib/queries/procedures'
import { teams as teamsQ, type Team } from '@/lib/queries/teams'
import { PRIORITY_OPTIONS } from '@/lib/queries/workOrders'

export default function PmPage() {
  const [rows, setRows] = useState<PmPlanRow[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<PmPlanRow | null>(null)
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [flash, setFlash] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await pm.list()
    setRows((data as PmPlanRow[] | null) ?? [])
    setLoading(false)
  }, [])
  useEffect(() => { void load() }, [load])

  const generateNow = async (p: PmPlanRow) => {
    setBusyId(p.id)
    const { error } = await pm.generateNow(p.id)
    setBusyId(null)
    setFlash(error ? error.message : `Created a work order from "${p.title}".`)
    setTimeout(() => setFlash(null), 3000)
    void load()
  }

  const remove = async (p: PmPlanRow) => {
    if (!window.confirm(`Delete PM plan "${p.title}"? Work orders it already created stay.`)) return
    await pm.remove(p.id)
    void load()
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-8">
      <PageHeader
        title="Preventive Maintenance"
        subtitle="Schedule recurring work orders that generate automatically."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> New PM Plan</Button>}
      />

      {flash && <div className="mt-3 rounded-md border border-ok/40 bg-ok-soft px-3 py-2 text-sm text-ok">{flash}</div>}

      <div className="mt-4 flex flex-col gap-2">
        {loading ? (
          <p className="text-sm text-ink-muted">Loading...</p>
        ) : rows.length === 0 ? (
          <div className="rounded-md border border-dashed border-border px-4 py-10 text-center text-sm text-ink-muted">
            <CalendarClock className="mx-auto mb-2 size-8 text-ink-subtle/60" />
            No PM plans yet. Create one to auto-generate recurring work orders.
          </div>
        ) : (
          rows.map((p) => (
            <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-2.5">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium text-ink">{p.title}</span>
                  {!p.active && <Badge tone="neutral">Paused</Badge>}
                </div>
                <div className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-ink-subtle">
                  <span>{p.location?.name ?? 'Site'}</span>
                  {p.equipment && <span>{p.equipment.name}</span>}
                  <span>Every {p.frequency_count} {p.frequency_unit}</span>
                  <span>Next: {format(new Date(p.next_due_date + 'T00:00:00'), 'MMM d, yyyy')}</span>
                  {p.procedure && <span>Procedure: {p.procedure.name}</span>}
                  {p.team && <span>Team: {p.team.name}</span>}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Button variant="secondary" size="sm" disabled={busyId === p.id} onClick={() => void generateNow(p)} title="Generate a work order now"><Play className="size-3.5" /></Button>
                <Button variant="secondary" size="sm" onClick={() => setEditing(p)}><Pencil className="size-3.5" /></Button>
                <Button variant="ghost" size="sm" onClick={() => void remove(p)}><Trash2 className="size-3.5" /></Button>
              </div>
            </div>
          ))
        )}
      </div>

      {(creating || editing) && (
        <PmEditModal
          plan={editing}
          onClose={() => { setCreating(false); setEditing(null) }}
          onSaved={() => { setCreating(false); setEditing(null); void load() }}
        />
      )}
    </div>
  )
}

function PmEditModal({ plan, onClose, onSaved }: { plan: PmPlanRow | null; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const [title, setTitle] = useState(plan?.title ?? '')
  const [description, setDescription] = useState(plan?.description ?? '')
  const [locationId, setLocationId] = useState(plan?.location_id ?? locations[0]?.id ?? '')
  const [equipmentId, setEquipmentId] = useState(plan?.equipment_id ?? '')
  const [priority, setPriority] = useState(plan?.priority ?? 'medium')
  const [freqCount, setFreqCount] = useState(String(plan?.frequency_count ?? 1))
  const [freqUnit, setFreqUnit] = useState<PmPlan['frequency_unit']>(plan?.frequency_unit ?? 'months')
  const [leadDays, setLeadDays] = useState(String(plan?.lead_time_days ?? 0))
  const [nextDue, setNextDue] = useState(plan?.next_due_date ?? new Date().toISOString().slice(0, 10))
  const [procId, setProcId] = useState(plan?.procedure_template_id ?? '')
  const [teamId, setTeamId] = useState(plan?.team_id ?? '')
  const [active, setActive] = useState(plan?.active ?? true)
  const [assets, setAssets] = useState<Array<{ id: string; name: string }>>([])
  const [procs, setProcs] = useState<TemplateWithCount[]>([])
  const [teamOpts, setTeamOpts] = useState<Team[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [{ data: p }, { data: t }] = await Promise.all([procedures.templates(), teamsQ.list()])
      setProcs((p as TemplateWithCount[] | null) ?? [])
      setTeamOpts((t as Team[] | null) ?? [])
    })()
  }, [])

  useEffect(() => {
    if (!locationId) { setAssets([]); return }
    void (async () => {
      const { data } = await supabase.from('equipment').select('id, name').eq('location_id', locationId).order('name')
      setAssets((data as Array<{ id: string; name: string }> | null) ?? [])
    })()
  }, [locationId])

  const save = async () => {
    setError(null)
    if (!title.trim()) return setError('Enter a title')
    if (!locationId) return setError('Pick a site')
    setBusy(true)
    const payload = {
      title: title.trim(),
      description: description.trim() || null,
      location_id: locationId,
      equipment_id: equipmentId || null,
      priority,
      frequency_count: Math.max(1, Number(freqCount) || 1),
      frequency_unit: freqUnit,
      lead_time_days: Math.max(0, Number(leadDays) || 0),
      next_due_date: nextDue,
      procedure_template_id: procId || null,
      team_id: teamId || null,
      active,
    }
    if (plan) {
      const { error: err } = await pm.update(plan.id, payload)
      if (err) { setBusy(false); return setError(err.message) }
    } else {
      const { error: err } = await pm.create({ account_id: profile?.account_id ?? '', ...payload })
      if (err) { setBusy(false); return setError(err.message) }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={plan ? 'Edit PM plan' : 'New PM plan'} size="lg">
      <div className="flex flex-col gap-3">
        <Field label="Title" required>{(id) => <Input id={id} value={title} onChange={(e) => setTitle(e.target.value)} autoFocus placeholder="e.g. Monthly pump inspection" />}</Field>
        <Field label="Description">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />}</Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Site" required>{(id) => (
            <Select id={id} value={locationId} onChange={(e) => { setLocationId(e.target.value); setEquipmentId('') }}>
              <option value="">Select...</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Asset">{(id) => (
            <Select id={id} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
              <option value="">None</option>
              {assets.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </Select>
          )}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Repeat every">{() => (
            <div className="flex items-center gap-2">
              <Input type="number" min="1" value={freqCount} onChange={(e) => setFreqCount(e.target.value)} className="w-20" />
              <Select value={freqUnit} onChange={(e) => setFreqUnit(e.target.value as PmPlan['frequency_unit'])}>
                {FREQ_UNITS.map((u) => <option key={u.value} value={u.value}>{u.label}</option>)}
              </Select>
            </div>
          )}</Field>
          <Field label="Next due">{(id) => <Input id={id} type="date" value={nextDue} onChange={(e) => setNextDue(e.target.value)} />}</Field>
          <Field label="Generate ahead (days)">{(id) => <Input id={id} type="number" min="0" value={leadDays} onChange={(e) => setLeadDays(e.target.value)} />}</Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Priority">{(id) => (
            <Select id={id} value={priority} onChange={(e) => setPriority(e.target.value)}>
              {PRIORITY_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          )}</Field>
          <Field label="Procedure">{(id) => (
            <Select id={id} value={procId} onChange={(e) => setProcId(e.target.value)}>
              <option value="">None</option>
              {procs.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          )}</Field>
          <Field label="Team">{(id) => (
            <Select id={id} value={teamId} onChange={(e) => setTeamId(e.target.value)}>
              <option value="">None</option>
              {teamOpts.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </Select>
          )}</Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-ink">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} className="size-4 accent-accent" />
          Active (auto-generates on schedule)
        </label>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>{plan ? 'Save' : 'Create'}</Button>
        </div>
      </div>
    </Modal>
  )
}
