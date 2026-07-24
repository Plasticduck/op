import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  ExternalLink,
  GraduationCap,
  ListChecks,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { EmptyState } from '@/components/ui/EmptyState'
import { useAuth } from '@/lib/auth'
import { employees as employeesQ } from '@/lib/queries/people'
import {
  certStatus,
  training,
  type Certification,
  type OnboardingStep,
  type StepState,
  type TrainingItem,
} from '@/lib/queries/training'
import { cn } from '@/lib/utils'

const inputCls =
  'h-9 w-full rounded-md border border-border bg-content px-2.5 text-sm text-ink outline-none focus:border-accent'
const labelCls = 'mb-1 block text-xs font-medium text-ink-muted'

type Emp = { id: string; first_name: string; last_name: string; user_id: string | null }
type Tab = 'training' | 'onboarding' | 'certs'

// deno-lint style loose rows for the joined selects
type AssignRow = {
  id: string
  employee_id: string
  due_date: string | null
  completed_at: string | null
  training_item: { id: string; title: string; category: string | null; required: boolean } | null
  employee: { first_name: string; last_name: string } | null
}
type OnbRow = {
  id: string
  employee_id: string
  template_id: string | null
  completed_at: string | null
  step_state: StepState
  employee: { first_name: string; last_name: string } | null
  template: { name: string; steps: OnboardingStep[] } | null
}
type CertRow = Certification & { employee: { first_name: string; last_name: string } | null }
type TemplateRow = { id: string; name: string; steps: OnboardingStep[]; active: boolean }

const TABS: { key: Tab; label: string; icon: typeof GraduationCap }[] = [
  { key: 'training', label: 'Training', icon: GraduationCap },
  { key: 'onboarding', label: 'Onboarding', icon: ListChecks },
  { key: 'certs', label: 'Certifications', icon: BadgeCheck },
]

function Inner({ locationId }: { locationId: string }) {
  const { profile } = useAuth()
  const isManager = profile?.role === 'owner' || profile?.role === 'manager'
  const [tab, setTab] = useState<Tab>('training')

  const [emps, setEmps] = useState<Emp[]>([])
  const [items, setItems] = useState<TrainingItem[]>([])
  const [assigns, setAssigns] = useState<AssignRow[]>([])
  const [templates, setTemplates] = useState<TemplateRow[]>([])
  const [onbs, setOnbs] = useState<OnbRow[]>([])
  const [certs, setCerts] = useState<CertRow[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const [e, i, a, t, o, c] = await Promise.all([
      employeesQ.listActive(locationId),
      training.listItems(),
      training.listAssignments(),
      training.listTemplates(),
      training.listOnboarding(),
      training.listCertifications(),
    ])
    setEmps((e.data as Emp[] | null) ?? [])
    setItems((i.data as TrainingItem[] | null) ?? [])
    setAssigns((a.data as unknown as AssignRow[] | null) ?? [])
    setTemplates((t.data as unknown as TemplateRow[] | null) ?? [])
    setOnbs((o.data as unknown as OnbRow[] | null) ?? [])
    setCerts((c.data as unknown as CertRow[] | null) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  // An employee viewing their own page only sees their own records.
  const myEmployeeId = useMemo(
    () => emps.find((e) => e.user_id === profile?.id)?.id ?? null,
    [emps, profile?.id],
  )
  const visibleAssigns = isManager ? assigns : assigns.filter((a) => a.employee_id === myEmployeeId)
  const visibleCerts = isManager ? certs : certs.filter((c) => c.employee_id === myEmployeeId)
  const visibleOnbs = isManager ? onbs : onbs.filter((o) => o.employee_id === myEmployeeId)

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="Training"
        subtitle={
          isManager
            ? 'Training material, new-hire onboarding, and certifications for your team.'
            : 'Your assigned training, onboarding, and certifications.'
        }
      />

      <div className="flex flex-wrap gap-1 rounded-lg border border-border bg-content p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition',
              tab === t.key ? 'bg-accent text-white' : 'text-ink-muted hover:text-ink',
            )}
          >
            <t.icon className="size-4" />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : tab === 'training' ? (
        <TrainingTab
          isManager={isManager}
          items={items}
          assigns={visibleAssigns}
          emps={emps}
          accountId={profile?.account_id ?? ''}
          userId={profile?.id ?? ''}
          locationId={locationId}
          reload={load}
        />
      ) : tab === 'onboarding' ? (
        <OnboardingTab
          isManager={isManager}
          templates={templates}
          onbs={visibleOnbs}
          emps={emps}
          accountId={profile?.account_id ?? ''}
          locationId={locationId}
          userName={profile?.name ?? 'Manager'}
          reload={load}
        />
      ) : (
        <CertsTab
          isManager={isManager}
          certs={visibleCerts}
          emps={emps}
          accountId={profile?.account_id ?? ''}
          userId={profile?.id ?? ''}
          locationId={locationId}
          reload={load}
        />
      )}
    </div>
  )
}

// ---------------- Training tab ----------------

function TrainingTab({
  isManager, items, assigns, emps, accountId, userId, locationId, reload,
}: {
  isManager: boolean
  items: TrainingItem[]
  assigns: AssignRow[]
  emps: Emp[]
  accountId: string
  userId: string
  locationId: string
  reload: () => void
}) {
  const [itemModal, setItemModal] = useState<TrainingItem | 'new' | null>(null)
  const [assignModal, setAssignModal] = useState(false)

  const toggleComplete = async (a: AssignRow) => {
    await training.setComplete(a.id, !a.completed_at, userId)
    reload()
  }

  return (
    <div className="flex flex-col gap-5">
      {isManager && (
        <section className="rounded-md border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4">
            <h2 className="text-sm font-semibold text-ink">Training library</h2>
            <Button size="sm" onClick={() => setItemModal('new')}>
              <Plus className="size-4" /> Add training
            </Button>
          </div>
          {items.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">No training material yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-medium text-ink">{it.title}</span>
                      {it.required && <Badge tone="warn">required</Badge>}
                      {!it.active && <Badge tone="neutral">inactive</Badge>}
                    </div>
                    <p className="truncate text-xs text-ink-muted">
                      {it.category ?? 'Uncategorized'}
                      {it.url ? ' · has link' : it.body ? ' · written' : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {it.url && (
                      <a href={it.url} target="_blank" rel="noreferrer" className="text-accent hover:underline" title="Open">
                        <ExternalLink className="size-4" />
                      </a>
                    )}
                    <Button variant="secondary" size="sm" onClick={() => setItemModal(it)}>Edit</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-sm font-semibold text-ink">
            {isManager ? 'Assignments' : 'My training'}
          </h2>
          {isManager && (
            <Button size="sm" onClick={() => setAssignModal(true)} disabled={items.length === 0 || emps.length === 0}>
              <Plus className="size-4" /> Assign training
            </Button>
          )}
        </div>
        {assigns.length === 0 ? (
          <EmptyState
            icon={GraduationCap}
            title="Nothing assigned yet"
            description={isManager ? 'Assign training to your team to track completion.' : 'You have no assigned training right now.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  {isManager && <th className="px-3 py-2 font-medium">Employee</th>}
                  <th className="px-3 py-2 font-medium">Training</th>
                  <th className="px-3 py-2 font-medium">Due</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {assigns.map((a) => {
                  const overdue = !a.completed_at && a.due_date && a.due_date < new Date().toISOString().slice(0, 10)
                  return (
                    <tr key={a.id} className="border-t border-border">
                      {isManager && (
                        <td className="px-3 py-2 text-ink">
                          {a.employee ? `${a.employee.first_name} ${a.employee.last_name}` : '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 text-ink">
                        {a.training_item?.title ?? '—'}
                        {a.training_item?.required && <span className="ml-1 text-xs text-warn">required</span>}
                      </td>
                      <td className="px-3 py-2 text-ink-muted">{a.due_date ?? '—'}</td>
                      <td className="px-3 py-2">
                        {a.completed_at ? (
                          <Badge tone="ok">completed</Badge>
                        ) : overdue ? (
                          <Badge tone="danger">overdue</Badge>
                        ) : (
                          <Badge tone="neutral">assigned</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <Button variant="secondary" size="sm" onClick={() => void toggleComplete(a)}>
                            {a.completed_at ? 'Reopen' : 'Mark complete'}
                          </Button>
                          {isManager && (
                            <button
                              type="button"
                              onClick={async () => { await training.removeAssignment(a.id); reload() }}
                              className="rounded p-1 text-ink-subtle hover:text-danger"
                              title="Remove"
                            >
                              <Trash2 className="size-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {itemModal && (
        <ItemModal
          item={itemModal === 'new' ? null : itemModal}
          accountId={accountId}
          userId={userId}
          onClose={() => setItemModal(null)}
          onSaved={() => { setItemModal(null); reload() }}
        />
      )}
      {assignModal && (
        <AssignModal
          items={items}
          emps={emps}
          accountId={accountId}
          userId={userId}
          locationId={locationId}
          onClose={() => setAssignModal(false)}
          onSaved={() => { setAssignModal(false); reload() }}
        />
      )}
    </div>
  )
}

function ItemModal({
  item, accountId, userId, onClose, onSaved,
}: {
  item: TrainingItem | null
  accountId: string
  userId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [title, setTitle] = useState(item?.title ?? '')
  const [category, setCategory] = useState(item?.category ?? '')
  const [url, setUrl] = useState(item?.url ?? '')
  const [body, setBody] = useState(item?.body ?? '')
  const [required, setRequired] = useState(item?.required ?? false)
  const [active, setActive] = useState(item?.active ?? true)
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!title.trim()) return
    setBusy(true)
    const payload = {
      account_id: accountId,
      title: title.trim(),
      category: category.trim() || null,
      content_type: url.trim() ? 'link' : 'text',
      url: url.trim() || null,
      body: body.trim() || null,
      required,
      active,
    }
    if (item) await training.updateItem(item.id, payload)
    else await training.createItem({ ...payload, created_by: userId })
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={item ? 'Edit training' : 'Add training'} size="md">
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>Title</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Safety basics" />
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <input value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls} placeholder="Safety, Equipment, Customer service..." />
        </div>
        <div>
          <label className={labelCls}>Link (document or video)</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} placeholder="https://..." />
        </div>
        <div>
          <label className={labelCls}>Or written instructions</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="w-full rounded-md border border-border bg-content px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </div>
        <div className="flex items-center gap-4 text-sm text-ink">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} /> Required
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
          </label>
        </div>
        <div className="flex justify-between gap-2 pt-1">
          {item ? (
            <Button
              variant="danger"
              onClick={async () => { await training.deleteItem(item.id); onSaved() }}
            >
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !title.trim()}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function AssignModal({
  items, emps, accountId, userId, locationId, onClose, onSaved,
}: {
  items: TrainingItem[]
  emps: Emp[]
  accountId: string
  userId: string
  locationId: string
  onClose: () => void
  onSaved: () => void
}) {
  const active = items.filter((i) => i.active)
  const [itemId, setItemId] = useState(active[0]?.id ?? '')
  const [due, setDue] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!itemId || picked.size === 0) return
    setBusy(true)
    await training.assign(
      [...picked].map((employee_id) => ({
        account_id: accountId,
        training_item_id: itemId,
        employee_id,
        location_id: locationId,
        due_date: due || null,
        assigned_by: userId,
      })),
    )
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Assign training" size="md">
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>Training</label>
          <select value={itemId} onChange={(e) => setItemId(e.target.value)} className={inputCls}>
            {active.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Due date (optional)</label>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Employees ({picked.size} selected)</label>
          <div className="max-h-56 overflow-y-auto rounded-md border border-border p-2">
            {emps.map((e) => (
              <label key={e.id} className="flex items-center gap-2 py-1 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={picked.has(e.id)}
                  onChange={() =>
                    setPicked((p) => {
                      const n = new Set(p)
                      if (n.has(e.id)) n.delete(e.id)
                      else n.add(e.id)
                      return n
                    })
                  }
                />
                {e.first_name} {e.last_name}
              </label>
            ))}
          </div>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy || !itemId || picked.size === 0}>Assign</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Onboarding tab ----------------

function OnboardingTab({
  isManager, templates, onbs, emps, accountId, locationId, userName, reload,
}: {
  isManager: boolean
  templates: TemplateRow[]
  onbs: OnbRow[]
  emps: Emp[]
  accountId: string
  locationId: string
  userName: string
  reload: () => void
}) {
  const [tplModal, setTplModal] = useState<TemplateRow | 'new' | null>(null)
  const [startModal, setStartModal] = useState(false)

  const toggleStep = async (o: OnbRow, step: OnboardingStep) => {
    const state: StepState = { ...(o.step_state ?? {}) }
    const done = !state[step.key]?.done
    state[step.key] = done
      ? { done: true, by_name: userName, at: new Date().toISOString() }
      : { done: false }
    const total = o.template?.steps?.length ?? 0
    const doneCount = Object.values(state).filter((s) => s.done).length
    await training.updateOnboarding(o.id, {
      step_state: state,
      completed_at: total > 0 && doneCount >= total ? new Date().toISOString() : null,
    })
    reload()
  }

  return (
    <div className="flex flex-col gap-5">
      {isManager && (
        <section className="rounded-md border border-border bg-card">
          <div className="flex items-center justify-between gap-3 border-b border-border p-4">
            <h2 className="text-sm font-semibold text-ink">Onboarding checklists</h2>
            <Button size="sm" onClick={() => setTplModal('new')}>
              <Plus className="size-4" /> New checklist
            </Button>
          </div>
          {templates.length === 0 ? (
            <p className="p-4 text-sm text-ink-muted">No checklists yet. Create one to onboard new hires.</p>
          ) : (
            <ul className="divide-y divide-border">
              {templates.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 p-3">
                  <div>
                    <div className="text-sm font-medium text-ink">{t.name}</div>
                    <div className="text-xs text-ink-muted">{(t.steps ?? []).length} steps</div>
                  </div>
                  <Button variant="secondary" size="sm" onClick={() => setTplModal(t)}>Edit</Button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-sm font-semibold text-ink">{isManager ? 'In progress' : 'My onboarding'}</h2>
          {isManager && (
            <Button size="sm" onClick={() => setStartModal(true)} disabled={templates.length === 0 || emps.length === 0}>
              <Plus className="size-4" /> Start onboarding
            </Button>
          )}
        </div>
        {onbs.length === 0 ? (
          <EmptyState icon={ListChecks} title="No onboarding in progress" description={isManager ? 'Start a checklist for a new hire.' : 'You have no onboarding assigned.'} />
        ) : (
          <ul className="divide-y divide-border">
            {onbs.map((o) => {
              const steps = o.template?.steps ?? []
              const state = o.step_state ?? {}
              const doneCount = steps.filter((s) => state[s.key]?.done).length
              return (
                <li key={o.id} className="p-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-sm font-medium text-ink">
                        {o.employee ? `${o.employee.first_name} ${o.employee.last_name}` : 'Employee'}
                      </span>
                      <span className="ml-2 text-xs text-ink-muted">{o.template?.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {o.completed_at ? <Badge tone="ok">complete</Badge> : <Badge tone="neutral">{doneCount}/{steps.length}</Badge>}
                      {isManager && (
                        <button
                          type="button"
                          onClick={async () => { await training.deleteOnboarding(o.id); reload() }}
                          className="rounded p-1 text-ink-subtle hover:text-danger"
                          title="Remove"
                        >
                          <X className="size-4" />
                        </button>
                      )}
                    </div>
                  </div>
                  <ul className="flex flex-col gap-1">
                    {steps.map((s) => {
                      const st = state[s.key]
                      return (
                        <li key={s.key} className="flex items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            checked={!!st?.done}
                            disabled={!isManager}
                            onChange={() => void toggleStep(o, s)}
                          />
                          <span className={cn(st?.done ? 'text-ink-muted line-through' : 'text-ink')}>{s.label}</span>
                          {st?.done && st.by_name && (
                            <span className="text-xs text-ink-subtle">
                              — {st.by_name}{st.at ? ` · ${st.at.slice(0, 10)}` : ''}
                            </span>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      {tplModal && (
        <TemplateModal
          tpl={tplModal === 'new' ? null : tplModal}
          accountId={accountId}
          onClose={() => setTplModal(null)}
          onSaved={() => { setTplModal(null); reload() }}
        />
      )}
      {startModal && (
        <StartOnboardingModal
          templates={templates}
          emps={emps}
          accountId={accountId}
          locationId={locationId}
          onClose={() => setStartModal(false)}
          onSaved={() => { setStartModal(false); reload() }}
        />
      )}
    </div>
  )
}

function TemplateModal({
  tpl, accountId, onClose, onSaved,
}: {
  tpl: TemplateRow | null
  accountId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [name, setName] = useState(tpl?.name ?? '')
  const [text, setText] = useState((tpl?.steps ?? []).map((s) => s.label).join('\n'))
  const [busy, setBusy] = useState(false)

  const save = async () => {
    const labels = text.split('\n').map((l) => l.trim()).filter(Boolean)
    if (!name.trim() || labels.length === 0) return
    setBusy(true)
    const steps: OnboardingStep[] = labels.map((label, i) => ({ key: `s${i + 1}`, label }))
    if (tpl) await training.updateTemplate(tpl.id, { name: name.trim(), steps })
    else await training.createTemplate({ account_id: accountId, name: name.trim(), steps })
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={tpl ? 'Edit checklist' : 'New onboarding checklist'} size="md">
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>Checklist name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="New hire onboarding" />
        </div>
        <div>
          <label className={labelCls}>Steps (one per line)</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={8}
            className="w-full rounded-md border border-border bg-content px-2.5 py-2 text-sm text-ink outline-none focus:border-accent"
            placeholder={'Complete paperwork\nIssue uniform\nSite safety walkthrough\nRegister kiosk PIN'}
          />
        </div>
        <div className="flex justify-between gap-2 pt-1">
          {tpl ? (
            <Button variant="danger" onClick={async () => { await training.deleteTemplate(tpl.id); onSaved() }}>
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !name.trim()}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function StartOnboardingModal({
  templates, emps, accountId, locationId, onClose, onSaved,
}: {
  templates: TemplateRow[]
  emps: Emp[]
  accountId: string
  locationId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = useState(emps[0]?.id ?? '')
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!employeeId || !templateId) return
    setBusy(true)
    await training.startOnboarding({
      account_id: accountId,
      employee_id: employeeId,
      template_id: templateId,
      location_id: locationId,
      step_state: {},
    })
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Start onboarding" size="sm">
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
            {emps.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Checklist</label>
          <select value={templateId} onChange={(e) => setTemplateId(e.target.value)} className={inputCls}>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>Start</Button>
        </div>
      </div>
    </Modal>
  )
}

// ---------------- Certifications tab ----------------

function CertsTab({
  isManager, certs, emps, accountId, userId, locationId, reload,
}: {
  isManager: boolean
  certs: CertRow[]
  emps: Emp[]
  accountId: string
  userId: string
  locationId: string
  reload: () => void
}) {
  const [modal, setModal] = useState<CertRow | 'new' | null>(null)
  const expiringSoon = certs.filter((c) => certStatus(c.expires_on) === 'expiring').length
  const expired = certs.filter((c) => certStatus(c.expires_on) === 'expired').length

  return (
    <div className="flex flex-col gap-5">
      {(expired > 0 || expiringSoon > 0) && (
        <div className="rounded-md border border-warn/40 bg-warn-soft px-4 py-3 text-sm text-warn">
          {expired > 0 && <span className="font-semibold">{expired} expired</span>}
          {expired > 0 && expiringSoon > 0 && <span> · </span>}
          {expiringSoon > 0 && <span>{expiringSoon} expiring within 30 days</span>}
        </div>
      )}
      <section className="rounded-md border border-border bg-card">
        <div className="flex items-center justify-between gap-3 border-b border-border p-4">
          <h2 className="text-sm font-semibold text-ink">{isManager ? 'Certifications' : 'My certifications'}</h2>
          {isManager && (
            <Button size="sm" onClick={() => setModal('new')} disabled={emps.length === 0}>
              <Plus className="size-4" /> Add certification
            </Button>
          )}
        </div>
        {certs.length === 0 ? (
          <EmptyState icon={BadgeCheck} title="No certifications tracked" description="Add licenses and certifications to track their expiration." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr>
                  {isManager && <th className="px-3 py-2 font-medium">Employee</th>}
                  <th className="px-3 py-2 font-medium">Certification</th>
                  <th className="px-3 py-2 font-medium">Issuer</th>
                  <th className="px-3 py-2 font-medium">Issued</th>
                  <th className="px-3 py-2 font-medium">Expires</th>
                  <th className="px-3 py-2 font-medium">Status</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {certs.map((c) => {
                  const st = certStatus(c.expires_on)
                  return (
                    <tr key={c.id} className="border-t border-border">
                      {isManager && (
                        <td className="px-3 py-2 text-ink">
                          {c.employee ? `${c.employee.first_name} ${c.employee.last_name}` : '—'}
                        </td>
                      )}
                      <td className="px-3 py-2 text-ink">{c.name}</td>
                      <td className="px-3 py-2 text-ink-muted">{c.issuer ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-muted">{c.issued_on ?? '—'}</td>
                      <td className="px-3 py-2 text-ink-muted">{c.expires_on ?? '—'}</td>
                      <td className="px-3 py-2">
                        {st === 'expired' ? <Badge tone="danger">expired</Badge>
                          : st === 'expiring' ? <Badge tone="warn">expiring</Badge>
                          : st === 'valid' ? <Badge tone="ok">valid</Badge>
                          : <Badge tone="neutral">no expiry</Badge>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {isManager && <Button variant="secondary" size="sm" onClick={() => setModal(c)}>Edit</Button>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {modal && (
        <CertModal
          cert={modal === 'new' ? null : modal}
          emps={emps}
          accountId={accountId}
          userId={userId}
          locationId={locationId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); reload() }}
        />
      )}
    </div>
  )
}

function CertModal({
  cert, emps, accountId, userId, locationId, onClose, onSaved,
}: {
  cert: CertRow | null
  emps: Emp[]
  accountId: string
  userId: string
  locationId: string
  onClose: () => void
  onSaved: () => void
}) {
  const [employeeId, setEmployeeId] = useState(cert?.employee_id ?? emps[0]?.id ?? '')
  const [name, setName] = useState(cert?.name ?? '')
  const [issuer, setIssuer] = useState(cert?.issuer ?? '')
  const [issued, setIssued] = useState(cert?.issued_on ?? '')
  const [expires, setExpires] = useState(cert?.expires_on ?? '')
  const [url, setUrl] = useState(cert?.document_url ?? '')
  const [busy, setBusy] = useState(false)

  const save = async () => {
    if (!name.trim() || !employeeId) return
    setBusy(true)
    const payload = {
      account_id: accountId,
      employee_id: employeeId,
      location_id: locationId,
      name: name.trim(),
      issuer: issuer.trim() || null,
      issued_on: issued || null,
      expires_on: expires || null,
      document_url: url.trim() || null,
    }
    if (cert) await training.updateCertification(cert.id, payload)
    else await training.createCertification({ ...payload, created_by: userId })
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title={cert ? 'Edit certification' : 'Add certification'} size="md">
      <div className="flex flex-col gap-3">
        <div>
          <label className={labelCls}>Employee</label>
          <select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} className={inputCls}>
            {emps.map((e) => <option key={e.id} value={e.id}>{e.first_name} {e.last_name}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Certification</label>
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} placeholder="Forklift certification" />
        </div>
        <div>
          <label className={labelCls}>Issuer</label>
          <input value={issuer} onChange={(e) => setIssuer(e.target.value)} className={inputCls} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Issued</label>
            <input type="date" value={issued} onChange={(e) => setIssued(e.target.value)} className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Expires</label>
            <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} className={inputCls} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Document link</label>
          <input value={url} onChange={(e) => setUrl(e.target.value)} className={inputCls} placeholder="https://..." />
        </div>
        <div className="flex justify-between gap-2 pt-1">
          {cert ? (
            <Button variant="danger" onClick={async () => { await training.deleteCertification(cert.id); onSaved() }}>
              <Trash2 className="size-4" /> Delete
            </Button>
          ) : <span />}
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Cancel</Button>
            <Button onClick={() => void save()} disabled={busy || !name.trim()}>Save</Button>
          </div>
        </div>
      </div>
    </Modal>
  )
}

export default function TrainingPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
