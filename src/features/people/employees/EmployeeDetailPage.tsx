import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, KeyRound, Pencil, Plus } from 'lucide-react'
import { addDays } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { currency, shortDate } from '@/lib/format'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import {
  employees,
  reviews as reviewsQ,
  counseling as counselingQ,
  uniforms as uniformsQ,
  type Employee,
  type Review,
  type CounselingRecord,
  type UniformRequest,
} from '@/lib/queries/people'
import { EmployeeModal } from './EmployeeModal'

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const [emp, setEmp] = useState<Employee | null>(null)
  const [reviews, setReviews] = useState<Review[]>([])
  const [counseling, setCounseling] = useState<CounselingRecord[]>([])
  const [uniforms, setUniforms] = useState<UniformRequest[]>([])
  const [hours, setHours] = useState(0)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [modal, setModal] = useState<null | 'pin' | 'review' | 'counsel' | 'uniform'>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const e = await employees.get(id)
    setEmp((e.data as Employee | null) ?? null)
    const [r, c, u] = await Promise.all([
      reviewsQ.forEmployee(id),
      counselingQ.forEmployee(id),
      uniformsQ.forEmployee(id),
    ])
    setReviews((r.data as Review[] | null) ?? [])
    setCounseling((c.data as CounselingRecord[] | null) ?? [])
    setUniforms((u.data as UniformRequest[] | null) ?? [])

    // Hours this pay period (last 14 days as a simple proxy).
    const since = addDays(new Date(), -14).toISOString()
    const { data: te } = await supabase
      .from('time_entries')
      .select('clock_in, clock_out')
      .eq('employee_id', id)
      .gte('clock_in', since)
    const total = ((te as { clock_in: string; clock_out: string | null }[] | null) ?? []).reduce((a, t) => {
      if (!t.clock_out) return a
      return a + (new Date(t.clock_out).getTime() - new Date(t.clock_in).getTime()) / 3600000
    }, 0)
    setHours(total)
    setLoading(false)
  }, [id])

  useEffect(() => { void load() }, [load])

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>
  if (!emp) return <p className="text-sm text-ink-muted">Employee not found.</p>

  const lastReview = reviews.find((r) => r.status === 'completed')

  return (
    <div className="flex flex-col gap-6">
      <Link to="/app/employees" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Employees
      </Link>

      <PageHeader
        title={`${emp.first_name} ${emp.last_name}`}
        subtitle={emp.role_title ?? undefined}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setModal('pin')}><KeyRound className="size-4" /> Set PIN</Button>
            <Button variant="secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
        <Badge tone={emp.status === 'active' ? 'ok' : 'neutral'}>{emp.status}</Badge>
        {emp.email && <span>{emp.email}</span>}
        {emp.phone && <span>· {emp.phone}</span>}
        {emp.start_date && <span>· started {shortDate(emp.start_date)}</span>}
      </div>

      <StatCardRow
        items={[
          { label: 'Hours (14d)', value: hours.toFixed(1) },
          { label: 'Hourly rate', value: emp.hourly_rate ? currency(emp.hourly_rate) : '—' },
          { label: 'Last review', value: lastReview ? shortDate(lastReview.review_date) : 'None' },
          { label: 'Counseling records', value: counseling.length },
        ]}
      />

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Section title="Reviews" onAdd={() => setModal('review')}>
          {reviews.length === 0 ? <Empty text="No reviews yet." /> : reviews.map((r) => (
            <Row key={r.id} left={`${r.status === 'completed' ? 'Completed' : 'Scheduled'}${r.rating ? ` · ${r.rating}/5` : ''}`} right={shortDate(r.review_date ?? r.due_date)} note={r.notes} />
          ))}
        </Section>

        <Section title="Counseling" onAdd={() => setModal('counsel')}>
          {counseling.length === 0 ? <Empty text="No records." /> : counseling.map((c) => (
            <Row key={c.id} left={<Badge tone={c.type === 'pip' || c.type === 'final' ? 'danger' : 'warn'}>{c.type}</Badge>} right={shortDate(c.date)} note={c.description} />
          ))}
        </Section>

        <Section title="Uniform requests" onAdd={() => setModal('uniform')}>
          {uniforms.length === 0 ? <Empty text="No requests." /> : uniforms.map((u) => (
            <Row key={u.id} left={`${u.item}${u.size ? ` (${u.size})` : ''} ×${u.quantity}`} right={<Badge tone={u.status === 'fulfilled' ? 'ok' : 'warn'}>{u.status}</Badge>} />
          ))}
        </Section>
      </div>

      {editing && <EmployeeModal locationId={emp.location_id} existing={emp} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load() }} />}
      {modal === 'pin' && <PinModal employeeId={emp.id} onClose={() => setModal(null)} />}
      {modal === 'review' && <ReviewModal employeeId={emp.id} reviewerId={profile?.id ?? null} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load() }} />}
      {modal === 'counsel' && <CounselModal employeeId={emp.id} recorderId={profile?.id ?? null} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load() }} />}
      {modal === 'uniform' && <UniformModal employeeId={emp.id} onClose={() => setModal(null)} onSaved={() => { setModal(null); void load() }} />}
    </div>
  )
}

function Section({ title, onAdd, children }: { title: string; onAdd: () => void; children: React.ReactNode }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onAdd}><Plus className="size-4" /> Add</Button>
      </div>
      <div className="divide-y divide-border text-sm">{children}</div>
    </section>
  )
}
function Empty({ text }: { text: string }) {
  return <p className="py-2 text-sm text-ink-muted">{text}</p>
}
function Row({ left, right, note }: { left: React.ReactNode; right: React.ReactNode; note?: string | null }) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between">
        <span className="text-ink">{left}</span>
        <span className="text-xs text-ink-muted">{right}</span>
      </div>
      {note && <p className="mt-0.5 text-xs text-ink-muted">{note}</p>}
    </div>
  )
}

function PinModal({ employeeId, onClose }: { employeeId: string; onClose: () => void }) {
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const save = async () => {
    setError(null)
    const { error: err } = await employees.setPin(employeeId, pin)
    if (err) return setError(err.message)
    setDone(true)
  }
  return (
    <Modal open onClose={onClose} title="Set kiosk PIN" size="sm">
      <div className="flex flex-col gap-4">
        {done ? (
          <p className="rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">PIN set. The employee can now clock in at the kiosk.</p>
        ) : (
          <>
            <Field label="4-digit PIN" hint="Used at the time clock kiosk">
              {(id) => <Input id={id} inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />}
            </Field>
            {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          </>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>{done ? 'Close' : 'Cancel'}</Button>
          {!done && <Button onClick={save} disabled={pin.length !== 4}>Set PIN</Button>}
        </div>
      </div>
    </Modal>
  )
}

function ReviewModal({ employeeId, reviewerId, onClose, onSaved }: { employeeId: string; reviewerId: string | null; onClose: () => void; onSaved: () => void }) {
  const [rating, setRating] = useState('5')
  const [date, setDate] = useState('')
  const [notes, setNotes] = useState('')
  const [goals, setGoals] = useState('')
  const save = async () => {
    await reviewsQ.create({
      employee_id: employeeId, reviewed_by: reviewerId,
      rating: Number(rating), review_date: date || null, notes: notes.trim() || null,
      goals: goals.trim() || null, status: 'completed',
    })
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Add review">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Rating">{(id) => <Select id={id} value={rating} onChange={(e) => setRating(e.target.value)}>{[1,2,3,4,5].map(n => <option key={n} value={n}>{n}/5</option>)}</Select>}</Field>
          <Field label="Review date">{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <Field label="Notes">{(id) => <Input id={id} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
        <Field label="Goals">{(id) => <Input id={id} value={goals} onChange={(e) => setGoals(e.target.value)} />}</Field>
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save review</Button></div>
      </div>
    </Modal>
  )
}

function CounselModal({ employeeId, recorderId, onClose, onSaved }: { employeeId: string; recorderId: string | null; onClose: () => void; onSaved: () => void }) {
  const [type, setType] = useState('verbal')
  const [date, setDate] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setError(null)
    if (!date) return setError('Pick a date')
    const { error: err } = await counselingQ.create({ employee_id: employeeId, recorded_by: recorderId, type, date, description: description.trim() || null })
    if (err) return setError(err.message)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Add counseling record">
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">{(id) => <Select id={id} value={type} onChange={(e) => setType(e.target.value)}><option value="verbal">Verbal</option><option value="written">Written</option><option value="final">Final</option><option value="pip">PIP</option></Select>}</Field>
          <Field label="Date" required>{(id) => <Input id={id} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
        </div>
        <Field label="Description">{(id) => <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Save record</Button></div>
      </div>
    </Modal>
  )
}

function UniformModal({ employeeId, onClose, onSaved }: { employeeId: string; onClose: () => void; onSaved: () => void }) {
  const [item, setItem] = useState('')
  const [size, setSize] = useState('')
  const [quantity, setQuantity] = useState('1')
  const [error, setError] = useState<string | null>(null)
  const save = async () => {
    setError(null)
    if (!item.trim()) return setError('Enter an item')
    const { error: err } = await uniformsQ.create({ employee_id: employeeId, item: item.trim(), size: size.trim() || null, quantity: Number(quantity) || 1 })
    if (err) return setError(err.message)
    onSaved()
  }
  return (
    <Modal open onClose={onClose} title="Request uniform">
      <div className="flex flex-col gap-4">
        <Field label="Item" required>{(id) => <Input id={id} value={item} onChange={(e) => setItem(e.target.value)} placeholder="Shirt, hat…" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Size">{(id) => <Input id={id} value={size} onChange={(e) => setSize(e.target.value)} />}</Field>
          <Field label="Quantity">{(id) => <Input id={id} type="number" value={quantity} onChange={(e) => setQuantity(e.target.value)} />}</Field>
        </div>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2"><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save}>Submit request</Button></div>
      </div>
    </Modal>
  )
}
