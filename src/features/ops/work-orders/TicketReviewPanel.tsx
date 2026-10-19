import { useEffect, useMemo, useState } from 'react'
import { CheckCircle2, Loader2, Sparkles } from 'lucide-react'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { displayRole, type Role, type RoleCategory } from '@/lib/rbac'
import { listUsers } from '@/lib/queries/account'
import {
  workOrders,
  PRIORITY_OPTIONS,
  WORK_TYPE_OPTIONS,
  type WorkOrderIntake,
  type WorkOrderPriority,
  type WorkOrderWorkType,
} from '@/lib/queries/workOrders'
import { DEPARTMENT_OPTIONS, canReviewTicket, departmentOf, type Department } from '@/lib/workOrderIntake'
import { MultiPicker } from './NewWorkOrderModal'

// Reviewer triage for a submitted ticket: set who does it, when, how urgent, and
// what kind of work it is, then accept it out of the New queue. Stays available
// after acceptance so reviewers can keep adjusting priority and the rest.

type Ticket = WorkOrderIntake & {
  id: string
  location_id: string
  priority: WorkOrderPriority
  work_type: WorkOrderWorkType
  due_at: string | null
  start_at: string | null
  assignees: Array<{ user_id: string; user_name: string }>
}

type DirUser = { id: string; label: string; sub: string }

// Dates are picked as calendar days; store them at local noon so the day doesn't
// shift when rendered in another US time zone.
const toInputDate = (iso: string | null) => (iso ? format(new Date(iso), 'yyyy-MM-dd') : '')
const fromInputDate = (d: string) => (d ? new Date(d + 'T12:00:00').toISOString() : null)

export function TicketReviewPanel({ ticket, onSaved }: { ticket: Ticket; onSaved: () => void }) {
  const { profile } = useAuth()
  const [dir, setDir] = useState<DirUser[]>([])
  const [department, setDepartment] = useState<Department>(departmentOf(ticket.department))
  const [priority, setPriority] = useState<WorkOrderPriority>(ticket.priority)
  const [workType, setWorkType] = useState<WorkOrderWorkType>(ticket.work_type)
  const [dueDate, setDueDate] = useState(toInputDate(ticket.due_at))
  const [startDate, setStartDate] = useState(toInputDate(ticket.start_at))
  const [assigneeIds, setAssigneeIds] = useState<string[]>(ticket.assignees.map((a) => a.user_id))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await listUsers()
      const rows = (data ?? []) as Array<{ id: string; name: string | null; email: string; role: Role; role_category: RoleCategory | null }>
      setDir(
        rows
          .map((u) => ({ id: u.id, label: (u.name ?? '').trim() || u.email, sub: displayRole(u.role, u.role_category) }))
          .sort((a, b) => a.label.localeCompare(b.label)),
      )
    })()
  }, [])

  // A reviewer may reroute a misfiled ticket, but only to departments they also
  // review at this site (the database enforces the same rule).
  const departmentChoices = useMemo(
    () => DEPARTMENT_OPTIONS.filter((d) => d.value === department || canReviewTicket(profile, d.value, ticket.location_id)),
    [profile, department, ticket.location_id],
  )

  const isNew = !ticket.reviewed_at

  const save = async (accept: boolean) => {
    if (!profile) return
    setError(null)
    setBusy(true)
    const myName = (profile.name ?? '').trim() || profile.email
    const { error: err } = await workOrders.reviewTicket(ticket.id, {
      department,
      priority,
      work_type: workType,
      // A person choosing the type stops the classifier from ever writing it.
      ...(workType !== ticket.work_type || ticket.work_type_source === 'default' ? { work_type_source: 'manual' as const } : {}),
      due_at: fromInputDate(dueDate),
      start_at: fromInputDate(startDate),
      ...(accept ? { reviewed_at: new Date().toISOString(), reviewed_by: profile.id, reviewed_by_name: myName } : {}),
    })
    if (err) {
      setBusy(false)
      return setError(err.message)
    }
    const before = [...ticket.assignees.map((a) => a.user_id)].sort().join(',')
    if ([...assigneeIds].sort().join(',') !== before) {
      await workOrders.setAssignees(
        ticket.id,
        assigneeIds.map((id) => ({ user_id: id, user_name: dir.find((u) => u.id === id)?.label ?? 'Unknown' })),
      )
    }
    setBusy(false)
    onSaved()
  }

  return (
    <section className="mb-4 rounded-md border border-accent/30 bg-accent-soft/20 p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-accent">Review ticket</div>
        {isNew ? (
          <Badge tone="warn">Awaiting review</Badge>
        ) : (
          <span className="text-xs text-ink-subtle">
            Accepted{ticket.reviewed_by_name ? ` by ${ticket.reviewed_by_name}` : ''}
            {ticket.reviewed_at ? ` on ${format(new Date(ticket.reviewed_at), 'MM/dd/yyyy')}` : ''}
          </span>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <MultiPicker
          label="Assign to"
          placeholder="Type a name"
          options={dir}
          selectedIds={assigneeIds}
          onChange={setAssigneeIds}
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Start Date">{(id) => <Input id={id} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="Due Date">{(id) => <Input id={id} type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />}</Field>
          <Field label="Work Type">
            {(id) => (
              <div>
                <Select id={id} value={workType} onChange={(e) => setWorkType(e.target.value as WorkOrderWorkType)}>
                  {WORK_TYPE_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </Select>
                {ticket.work_type_source === 'ai' && workType === ticket.work_type && (
                  <p className="mt-1 inline-flex items-center gap-1 text-xs text-ink-subtle">
                    <Sparkles className="size-3" /> Suggested by AI
                  </p>
                )}
                {ticket.work_type_source === 'default' && (
                  <p className="mt-1 text-xs text-ink-subtle">Not classified yet. Pick the type.</p>
                )}
              </div>
            )}
          </Field>
          <Field label="Department">
            {(id) => (
              <Select id={id} value={department} onChange={(e) => setDepartment(e.target.value as Department)}>
                {departmentChoices.map((d) => <option key={d.value} value={d.value}>{d.label}</option>)}
              </Select>
            )}
          </Field>
        </div>

        <div>
          <div className="mb-1.5 text-sm font-medium text-ink">Priority</div>
          <div className="inline-flex overflow-hidden rounded-md border border-border">
            {PRIORITY_OPTIONS.map((p) => (
              <button
                key={p.value}
                type="button"
                onClick={() => setPriority(p.value)}
                className={cn(
                  'border-l border-border px-4 py-1.5 text-sm font-medium first:border-l-0',
                  priority === p.value
                    ? (p.tone === 'danger' ? 'bg-danger-soft text-danger' : p.tone === 'warn' ? 'bg-warn-soft text-warn' : p.tone === 'ok' ? 'bg-ok-soft text-ok' : 'bg-accent-soft text-accent')
                    : 'bg-card text-ink-muted hover:text-ink',
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          {isNew ? (
            <>
              <Button variant="secondary" size="sm" onClick={() => void save(false)} disabled={busy}>Save draft</Button>
              <Button size="sm" onClick={() => void save(true)} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}
                Accept ticket
              </Button>
            </>
          ) : (
            <Button size="sm" onClick={() => void save(false)} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              Save changes
            </Button>
          )}
        </div>
      </div>
    </section>
  )
}
