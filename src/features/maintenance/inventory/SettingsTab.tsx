import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Plus, Printer, Trash2, TriangleAlert } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Field } from '@/components/forms/Field'
import { MultiLocationSelect } from '@/components/forms/MultiLocationSelect'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { mi, MI_ROLE_LABEL, type MiAlert, type MiLocation, type MiLocationType, type MiPerson, type MiRole, type PartListRow } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { dayTime, errText, LOCATION_TYPE_LABEL, qty } from './format'
import { ImportPanel } from './ImportPanel'
import { LabelsDialog, type LabelItem } from './LabelsDialog'
import { TemplatesCard } from './tunnel/TemplatesCard'
import { Card, ErrorNote, Muted, SearchBox, useDebounced } from './ui'

export default function SettingsTab() {
  const { me } = useMi()
  const { hash } = useLocation()
  useEffect(() => {
    if (hash) document.querySelector(hash)?.scrollIntoView()
  }, [hash])
  const admin = me.rank >= 5
  const director = me.rank >= 4
  return (
    <div className="flex flex-col gap-4">
      {admin && <AlertSettings />}
      {admin && <Rules />}
      {admin && <People />}
      <Locations />
      <div id="tunnels"><TemplatesCard /></div>
      {me.rank >= 3 && <SiteRules />}
      {director && <Categories />}
      {director && <Kits />}
      {admin && <div id="import"><ImportPanel /></div>}
      <AlertLog />
      {admin && me.has_sample_data && <SampleData />}
    </div>
  )
}

function AlertSettings() {
  const { me, notify, reload } = useMi()
  const s = me.settings
  const [start, setStart] = useState(String(s.quiet_start_hour))
  const [end, setEnd] = useState(String(s.quiet_end_hour))
  const [preview, setPreview] = useState<unknown[] | null>(null)
  const [confirmOn, setConfirmOn] = useState(false)
  const save = async (p: Record<string, unknown>, m: string) => {
    try {
      await mi.updateSettings(p)
      await reload()
      notify(m)
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const showPreview = async () => {
    const { data, error } = await mi.previewAlerts()
    if (error) notify('Could not load the preview.', 'danger')
    else setPreview((data as { pending?: unknown[] }).pending ?? [])
  }
  return (
    <Card title="Text alerts">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={s.sms_enabled ? 'ok' : 'neutral'}>{s.sms_enabled ? 'On' : 'Off'}</Badge>
        <p className="min-w-0 flex-1 text-sm text-ink-muted">
          {s.sms_enabled
            ? 'Critical parts, overdue tools and big count differences text the people responsible.'
            : 'Off, so nothing texts anyone. Alerts still show in the log below. Turn on once real stock is loaded.'}
        </p>
        <Button variant={s.sms_enabled ? 'secondary' : 'primary'} onClick={() => (s.sms_enabled ? void save({ sms_enabled: false }, 'Text alerts are off.') : setConfirmOn(true))}>
          {s.sms_enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </div>
      <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-border pt-3">
        <Field label="Quiet from (hour, 0-23)">{(id) => <Input id={id} inputMode="numeric" className="w-28" value={start} onChange={(e) => setStart(e.target.value)} />}</Field>
        <Field label="Until">{(id) => <Input id={id} inputMode="numeric" className="w-28" value={end} onChange={(e) => setEnd(e.target.value)} />}</Field>
        <Button variant="secondary" onClick={() => void save({ quiet_start_hour: Number(start), quiet_end_hour: Number(end) }, 'Saved.')}>Save</Button>
        <Button variant="ghost" onClick={() => void showPreview()}>Who would get what</Button>
      </div>
      <p className="mt-2 text-xs text-ink-muted">A critical part at zero texts even during quiet hours. Times are Central.</p>
      {preview && (
        <div className="mt-3 rounded-md border border-border p-3 text-sm">
          {preview.length === 0 ? <Muted>Nothing is waiting to go out.</Muted> : preview.map((p, i) => {
            const a = p as { message: string; recipients: Array<{ name: string; sms_ok: boolean }> }
            return (
              <div key={i} className="border-t border-border py-1.5 first:border-t-0">
                <p className="text-ink">{a.message}</p>
                <p className="text-xs text-ink-muted">To: {a.recipients.map((r) => `${r.name}${r.sms_ok ? '' : ' (no phone on file)'}`).join(', ') || 'no one'}</p>
              </div>
            )
          })}
        </div>
      )}
      <ConfirmDialog open={confirmOn} title="Turn on text alerts?" description="Real texts start going out to the people with roles here. If sample data is still loaded, its low stock will text too." confirmLabel="Turn on"
        onCancel={() => setConfirmOn(false)} onConfirm={() => { setConfirmOn(false); void save({ sms_enabled: true }, 'Text alerts are on.') }} />
    </Card>
  )
}

function Rules() {
  const { me, notify, reload } = useMi()
  const s = me.settings
  const [f, setF] = useState({
    threshold: String(s.count_variance_threshold), tolerance: String(s.count_tolerance_pct), stale: String(s.stale_days), carrying: String(Number(s.carrying_rate) * 100),
    photo: s.high_value_photo_cost != null ? String(s.high_value_photo_cost) : '', mgr: String(s.po_limits.site_manager ?? ''), reg: String(s.po_limits.regional_manager ?? ''), auto: s.auto_counts_enabled,
    crit: String(s.count_schedule.critical_days), a: String(s.count_schedule.a_days), b: String(s.count_schedule.b_days), c: String(s.count_schedule.c_days),
  })
  const save = async () => {
    try {
      await mi.updateSettings({
        count_variance_threshold: Number(f.threshold), count_tolerance_pct: Number(f.tolerance), stale_days: Number(f.stale), carrying_rate: Number(f.carrying) / 100,
        high_value_photo_cost: f.photo, po_limits: { site_manager: Number(f.mgr), regional_manager: Number(f.reg) }, auto_counts_enabled: f.auto,
        count_schedule: { critical_days: Number(f.crit), a_days: Number(f.a), b_days: Number(f.b), c_days: Number(f.c) },
      })
      await reload()
      notify('Saved.')
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const num = (label: string, k: keyof typeof f, hint?: string) => (
    <Field label={label} hint={hint}>{(id) => <Input id={id} inputMode="decimal" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}</Field>
  )
  return (
    <Card title="Rules">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {num('Site manager PO limit ($)', 'mgr')}
        {num('Regional manager PO limit ($)', 'reg')}
        {num('Count difference needing review ($)', 'threshold')}
        {num('Count tolerance (%)', 'tolerance')}
        {num('Stale after (days)', 'stale')}
        {num('Carrying cost (% a year)', 'carrying')}
        {num('Ask for an install photo over ($)', 'photo', 'Blank turns it off.')}
      </div>
      <div className="mt-3 border-t border-border pt-3">
        <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4" checked={f.auto} onChange={(e) => setF({ ...f, auto: e.target.checked })} /> Schedule counts automatically (blind), every:</label>
        <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {num('Critical (days)', 'crit')}
          {num('Class A (days)', 'a')}
          {num('Class B (days)', 'b')}
          {num('Class C (days)', 'c')}
        </div>
      </div>
      <div className="mt-3 flex justify-end"><Button onClick={() => void save()}>Save rules</Button></div>
    </Card>
  )
}

function People() {
  const { refs, notify, reload, userId } = useMi()
  const [editing, setEditing] = useState<MiPerson | 'new' | null>(null)
  return (
    <Card title="People and roles" actions={<Button size="sm" variant="secondary" onClick={() => setEditing('new')}><Plus className="size-4" /> Add</Button>}>
      <p className="mb-2 text-xs text-ink-muted">While this page rolls out, someone new also has to be on the access list in the app's code.</p>
      {refs.people.map((p) => (
        <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
          <div className="min-w-0">
            <span className="font-medium text-ink">{p.name}</span>
            <span className="text-ink-muted"> {MI_ROLE_LABEL[p.role]}</span>
            <p className="text-xs text-ink-subtle">
              {[p.region_names.length ? p.region_names.join(', ') : null, p.site_ids.length ? `${p.site_ids.length} site${p.site_ids.length === 1 ? '' : 's'}` : null, !p.has_phone ? 'No phone for texts' : null].filter(Boolean).join(' · ')}
            </p>
          </div>
          <span className="flex gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setEditing(p)}>Edit</Button>
            {p.id !== userId && <Button size="sm" variant="ghost" onClick={() => { void mi.removeMember(p.id).then(reload).catch((e) => notify(errText(e), 'danger')) }}>Remove</Button>}
          </span>
        </div>
      ))}
      {editing && <PersonDialog person={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
    </Card>
  )
}

function PersonDialog({ person, onClose, onSaved }: { person: MiPerson | null; onClose: () => void; onSaved: () => void }) {
  const { refs } = useMi()
  const [users, setUsers] = useState<Array<{ id: string; name: string; email: string }>>([])
  const [user, setUser] = useState(person?.id ?? '')
  const [role, setRole] = useState<MiRole>(person?.role ?? 'site_tech')
  const [sites, setSites] = useState<string[]>(person?.site_ids ?? [])
  const [regions, setRegions] = useState<string[]>(person?.region_names ?? [])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => { if (!person) void mi.accountUsers().then(setUsers).catch(() => {}) }, [person])
  const save = async () => {
    try {
      await mi.setMember({ user, role, sites: role === 'regional_manager' || role === 'site_tech' || role === 'site_manager' ? sites : [], regions: role === 'regional_manager' ? regions : [] })
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  const taken = new Set(refs.people.map((p) => p.id))
  return (
    <Modal open onClose={onClose} title={person ? `Role for ${person.name}` : 'Add someone'}>
      <div className="flex flex-col gap-3">
        {!person && (
          <Field label="Person" required>
            {(id) => (
              <Select id={id} value={user} onChange={(e) => setUser(e.target.value)}>
                <option value="">Pick one</option>
                {users.filter((u) => !taken.has(u.id)).map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        <Field label="Role">
          {(id) => (
            <Select id={id} value={role} onChange={(e) => setRole(e.target.value as MiRole)}>
              {Object.entries(MI_ROLE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        {role === 'regional_manager' && (
          <Field label="Regions">
            {() => (
              <div className="flex flex-col gap-1">
                {refs.regions.map((r) => (
                  <label key={r} className="flex items-center gap-2 text-sm text-ink">
                    <input type="checkbox" className="size-4" checked={regions.includes(r)} onChange={(e) => setRegions((p) => (e.target.checked ? [...p, r] : p.filter((x) => x !== r)))} /> {r}
                  </label>
                ))}
              </div>
            )}
          </Field>
        )}
        {(role === 'site_tech' || role === 'site_manager') && (
          <Field label="Sites">{() => <MultiLocationSelect options={refs.sites} value={sites} onChange={setSites} />}</Field>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!user} onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}

function Locations() {
  const { me, refs, accountId, notify, reload } = useMi()
  const [editing, setEditing] = useState<MiLocation | 'new' | null>(null)
  const [newBin, setNewBin] = useState<Record<string, string>>({})
  const [labels, setLabels] = useState<LabelItem[] | null>(null)
  const canEdit = me.rank >= 4
  const addBin = async (location: string) => {
    const name = (newBin[location] ?? '').trim()
    if (!name) return
    try {
      await mi.addBin(accountId, location, name)
      setNewBin((p) => ({ ...p, [location]: '' }))
      await reload()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const siteName = (id: string | null) => refs.sites.find((s) => s.id === id)?.name ?? null
  return (
    <Card title="Locations and bins" actions={canEdit ? <Button size="sm" variant="secondary" onClick={() => setEditing('new')}><Plus className="size-4" /> Add</Button> : undefined}>
      {refs.locations.length === 0 && <Muted>No stockrooms, cabinets, trucks or warehouses yet.</Muted>}
      {refs.locations.map((l) => {
        const bins = refs.bins.filter((b) => b.location_id === l.id)
        return (
          <div key={l.id} className="border-t border-border py-3 first:border-t-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0 text-sm">
                <span className="font-medium text-ink">{l.name}</span>
                <span className="text-ink-muted"> {LOCATION_TYPE_LABEL[l.type]}{siteName(l.site_id) ? `, ${siteName(l.site_id)}` : l.region_name ? `, ${l.region_name}` : ''}</span>
                {!l.active && <Badge className="ml-1.5">Inactive</Badge>}
                {l.is_sample && <Badge className="ml-1.5">Sample</Badge>}
              </div>
              <span className="flex gap-1.5">
                <Button size="sm" variant="ghost" onClick={() => setLabels([{ type: 'location', id: l.id, name: l.name, site: siteName(l.site_id) }, ...bins.map((b) => ({ type: 'bin' as const, id: b.id, name: `Bin ${b.name}`, site: l.name }))])}><Printer className="size-4" /> Labels</Button>
                {canEdit && <Button size="sm" variant="ghost" onClick={() => setEditing(l)}>Edit</Button>}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-muted">{bins.length ? `Bins: ${bins.map((b) => b.name).join(', ')}` : 'No bins yet.'}</p>
            {l.can_manage && (
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); void addBin(l.id) }}>
                <Input aria-label={`New bin at ${l.name}`} className="h-9 max-w-40" value={newBin[l.id] ?? ''} onChange={(e) => setNewBin((p) => ({ ...p, [l.id]: e.target.value }))} placeholder="New bin" />
                <Button size="sm" variant="secondary" type="submit">Add bin</Button>
              </form>
            )}
          </div>
        )
      })}
      {editing && <LocationDialog loc={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); void reload() }} />}
      {labels && <LabelsDialog items={labels} onClose={() => setLabels(null)} />}
    </Card>
  )
}

function LocationDialog({ loc, onClose, onSaved }: { loc: MiLocation | null; onClose: () => void; onSaved: () => void }) {
  const { refs, accountId } = useMi()
  const [f, setF] = useState({
    name: loc?.name ?? '', type: (loc?.type ?? 'stockroom') as MiLocationType, site_id: loc?.site_id ?? '', region_name: loc?.region_name ?? '', assigned_user_id: loc?.assigned_user_id ?? '', active: loc?.active ?? true,
  })
  const [error, setError] = useState<string | null>(null)
  const roaming = f.type === 'regional_warehouse' || f.type === 'truck'
  const save = async () => {
    try {
      await mi.saveLocation({
        id: loc?.id, account_id: accountId, name: f.name.trim(), type: f.type, site_id: f.site_id || null, region_name: f.site_id ? null : f.region_name || null, assigned_user_id: f.assigned_user_id || null, active: f.active,
      })
      onSaved()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <Modal open onClose={onClose} title={loc ? `Edit ${loc.name}` : 'New location'}>
      <div className="flex flex-col gap-3">
        <Field label="Name" required>{(id) => <Input id={id} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="MW01 stockroom, Truck 3" />}</Field>
        <Field label="Type">
          {(id) => (
            <Select id={id} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value as MiLocationType })}>
              {Object.entries(LOCATION_TYPE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Site" hint={roaming ? 'A warehouse or truck can belong to a region instead.' : undefined}>
          {(id) => <Select id={id} value={f.site_id} onChange={(e) => setF({ ...f, site_id: e.target.value })}><option value="">None</option>{refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>}
        </Field>
        {!f.site_id && (
          <Field label="Region">
            {(id) => <Select id={id} value={f.region_name} onChange={(e) => setF({ ...f, region_name: e.target.value })}><option value="">None</option>{refs.regions.map((r) => <option key={r} value={r}>{r}</option>)}</Select>}
          </Field>
        )}
        {f.type === 'truck' && (
          <Field label="Driven by" hint="They can work from this truck wherever they are.">
            {(id) => <Select id={id} value={f.assigned_user_id} onChange={(e) => setF({ ...f, assigned_user_id: e.target.value })}><option value="">No one yet</option>{refs.people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>}
          </Field>
        )}
        {loc && <label className="flex items-center gap-2 text-sm text-ink"><input type="checkbox" className="size-4" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /> Active</label>}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button disabled={!f.name.trim()} onClick={() => void save()}>Save</Button></div>
      </div>
    </Modal>
  )
}

function SiteRules() {
  const { refs, notify } = useMi()
  const [on, setOn] = useState<Set<string>>(new Set())
  useEffect(() => { void mi.siteSettings().then((r) => setOn(new Set(r.filter((x) => x.allow_negative).map((x) => x.site_id)))).catch(() => {}) }, [])
  const toggle = async (site: string, value: boolean) => {
    try {
      await mi.setSiteSetting(site, value)
      setOn((p) => { const n = new Set(p); if (value) n.add(site); else n.delete(site); return n })
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  return (
    <Card title="Issue now, reconcile later">
      <p className="mb-2 text-sm text-ink-muted">Normally stock can't go below zero. At these sites it can, and going negative creates a count to reconcile it.</p>
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4 lg:grid-cols-6">
        {refs.sites.map((s) => (
          <label key={s.id} className="flex items-center gap-2 py-1 text-sm text-ink">
            <input type="checkbox" className="size-4" checked={on.has(s.id)} onChange={(e) => void toggle(s.id, e.target.checked)} /> {s.name}
          </label>
        ))}
      </div>
    </Card>
  )
}

function Categories() {
  const { refs, accountId, notify, reload } = useMi()
  const [name, setName] = useState('')
  const add = async () => {
    try {
      await mi.addCategory(accountId, name.trim())
      setName('')
      await reload()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  return (
    <Card title="Part categories">
      <div className="flex flex-wrap gap-1.5">
        {refs.categories.map((c) => (
          <span key={c.id} className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-sm text-ink">
            {c.name}
            <button type="button" aria-label={`Remove ${c.name}`} className="text-ink-subtle hover:text-danger" onClick={() => { void mi.removeCategory(c.id).then(reload).catch((e) => notify(errText(e), 'danger')) }}>
              <Trash2 className="size-3.5" />
            </button>
          </span>
        ))}
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) void add() }}>
        <Input aria-label="New category" className="max-w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder="New category" />
        <Button variant="secondary" type="submit" disabled={!name.trim()}>Add</Button>
      </form>
    </Card>
  )
}

function Kits() {
  const { refs, accountId, notify } = useMi()
  const [kits, setKits] = useState<Awaited<ReturnType<typeof mi.kits>>>([])
  const [name, setName] = useState('')
  const [kind, setKind] = useState('tunnel')
  const [open, setOpen] = useState<string | null>(null)
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [found, setFound] = useState<PartListRow[]>([])
  const load = useCallback(() => { void mi.kits().then(setKits).catch((e) => notify(errText(e), 'danger')) }, [notify])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!dq.trim()) return
    let alive = true
    void mi.parts({ q: dq, limit: 8 }).then((r) => { if (alive) setFound(r.rows) })
    return () => { alive = false }
  }, [dq])
  const run = (p: Promise<unknown>) => { void p.then(load).catch((e) => notify(errText(e), 'danger')) }
  return (
    <Card title="Critical spares kits">
      <p className="mb-2 text-sm text-ink-muted">What each site has to keep on hand. Reports score sites against these.</p>
      {kits.length === 0 && <Muted>No kits yet.</Muted>}
      {kits.map((k) => (
        <div key={k.id} className="border-t border-border py-2 first:border-t-0">
          <button type="button" className="flex w-full flex-wrap items-center justify-between gap-2 text-left text-sm" onClick={() => setOpen(open === k.id ? null : k.id)}>
            <span className="font-medium text-ink">{k.name}{k.is_sample && <Badge className="ml-1.5">Sample</Badge>}</span>
            <span className="text-ink-muted">{k.items.length} parts, required at {k.sites.length} site{k.sites.length === 1 ? '' : 's'}</span>
          </button>
          {open === k.id && (
            <div className="mt-2 flex flex-col gap-3">
              <div>
                {k.items.map((i) => (
                  <div key={i.part_id} className="flex items-center justify-between gap-2 py-1 text-sm">
                    <span className="truncate text-ink">{i.part?.name} x{qty(i.qty)}</span>
                    <Button variant="ghost" size="icon" aria-label="Remove" onClick={() => run(mi.setKitItem(k.id, i.part_id, 0))}><Trash2 className="size-4" /></Button>
                  </div>
                ))}
                <SearchBox value={q} onChange={setQ} placeholder="Add a part to this kit" className="mt-1" />
                {dq.trim() && found.map((r) => (
                  <button key={r.id} type="button" className="block w-full truncate py-1.5 text-left text-sm text-accent hover:underline" onClick={() => { setQ(''); run(mi.setKitItem(k.id, r.id, 1)) }}>{r.name}</button>
                ))}
              </div>
              <div>
                <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink-muted">Required at</p>
                <div className="grid grid-cols-3 gap-1 sm:grid-cols-6">
                  {refs.sites.map((s) => (
                    <label key={s.id} className="flex items-center gap-1.5 text-sm text-ink">
                      <input type="checkbox" className="size-4" checked={k.sites.some((x) => x.site_id === s.id)} onChange={(e) => run(mi.setSiteKit(accountId, s.id, k.id, e.target.checked))} /> {s.name}
                    </label>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>
      ))}
      <form className="mt-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) { run(mi.saveKit(accountId, name.trim(), kind)); setName('') } }}>
        <Input aria-label="Kit name" className="max-w-64" value={name} onChange={(e) => setName(e.target.value)} placeholder="New kit" />
        <Select aria-label="Kit type" className="w-32" value={kind} onChange={(e) => setKind(e.target.value)}><option value="tunnel">Tunnel</option><option value="lube">Lube</option><option value="other">Other</option></Select>
        <Button variant="secondary" type="submit" disabled={!name.trim()}>Add kit</Button>
      </form>
    </Card>
  )
}

function AlertLog() {
  const [rows, setRows] = useState<MiAlert[] | null>(null)
  useEffect(() => { void mi.alerts().then(setRows).catch(() => setRows([])) }, [])
  const label: Record<string, string> = { pending: 'Waiting', sent: 'Texted', off: 'Texts off', digest: 'In the daily digest', no_recipient: 'No one to text', failed: 'Failed' }
  return (
    <Card title="Alert log">
      {!rows ? <Muted>Loading...</Muted> : rows.length === 0 ? <Muted>No alerts yet.</Muted> : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.slice(0, 40).map((a) => (
            <li key={a.id} className="py-2 text-sm">
              <p className="text-ink">{a.message}</p>
              <p className="text-xs text-ink-subtle">{dayTime(a.created_at)}, {label[a.status] ?? a.status}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function SampleData() {
  const { notify, reload } = useMi()
  const [confirming, setConfirming] = useState(false)
  const remove = async () => {
    setConfirming(false)
    try {
      const r = await mi.removeSampleData()
      notify(`Removed ${r.parts} sample parts and ${r.locations} sample locations.`)
      await reload()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  return (
    <Card title="Sample data">
      <p className="mb-3 flex items-start gap-2 text-sm text-ink-muted"><TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" /> Sample parts, stock, tools, POs and history are loaded so the screens have something to show. Remove them before going live. Anything recorded at a sample location goes with them.</p>
      <Button variant="danger" onClick={() => setConfirming(true)}>Remove sample data</Button>
      <ConfirmDialog open={confirming} title="Remove all sample data?" description="This can't be undone. Real parts and work orders aren't touched." confirmLabel="Remove it" onCancel={() => setConfirming(false)} onConfirm={() => void remove()} />
    </Card>
  )
}
