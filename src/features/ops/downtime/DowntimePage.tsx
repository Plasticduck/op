import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Field } from '@/components/forms/Field'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { dateTime, durationHm } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { downtime, equipment as equipQ, type DowntimeEvent, type Equipment } from '@/lib/queries/ops'

type Row = DowntimeEvent & { equipment: { name: string } | null }

function Inner({ locationId }: { locationId: string }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [logging, setLogging] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await downtime.list(locationId)
    setRows((data as unknown as Row[]) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const since30 = Date.now() - 30 * 24 * 3600 * 1000
  const recent = rows.filter((r) => new Date(r.started_at).getTime() >= since30)
  const totalHours = recent.reduce((a, r) => {
    const end = r.ended_at ? new Date(r.ended_at).getTime() : Date.now()
    return a + Math.max(0, end - new Date(r.started_at).getTime()) / 3600000
  }, 0)
  const active = rows.filter((r) => !r.ended_at)

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Downtime"
        subtitle="Log and resolve equipment outages."
        actions={<Button onClick={() => setLogging(true)}><Plus className="size-4" /> Log downtime</Button>}
      />

      <StatCardRow
        items={[
          { label: 'Active outages', value: active.length },
          { label: 'Events (30d)', value: recent.length },
          { label: 'Downtime hours (30d)', value: totalHours.toFixed(1) },
        ]}
      />

      {active.length > 0 && (
        <div className="flex items-center gap-2 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
          <AlertTriangle className="size-4" />
          {active.length} active outage{active.length === 1 ? '' : 's'} — resolve to stop the clock.
        </div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState icon={AlertTriangle} title="No downtime logged" description="Log an outage when equipment goes down." action={<Button onClick={() => setLogging(true)}>Log downtime</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Equipment</th>
                <th className="px-3 py-2.5 font-medium">Reason</th>
                <th className="px-3 py-2.5 font-medium">Started</th>
                <th className="px-3 py-2.5 font-medium">Duration</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.equipment?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.reason ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{dateTime(r.started_at)}</td>
                  <td className="px-3 py-2.5">
                    {r.ended_at ? (
                      <span className="tabular text-ink-muted">{durationHm(r.started_at, r.ended_at)}</span>
                    ) : (
                      <Badge tone="danger">ongoing</Badge>
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {!r.ended_at && (
                      <Button variant="secondary" size="sm" onClick={async () => { await downtime.end(r.id); void load() }}>
                        Mark resolved
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {logging && <LogModal locationId={locationId} onClose={() => setLogging(false)} onSaved={() => { setLogging(false); void load() }} />}
    </div>
  )
}

function LogModal({ locationId, onClose, onSaved }: { locationId: string; onClose: () => void; onSaved: () => void }) {
  const { profile } = useAuth()
  const [equip, setEquip] = useState<Equipment[]>([])
  const [equipmentId, setEquipmentId] = useState('')
  const [reason, setReason] = useState('')
  const [category, setCategory] = useState('mechanical')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    equipQ.list(locationId).then(({ data }) => setEquip((data as Equipment[] | null) ?? []))
  }, [locationId])

  const save = async () => {
    setError(null)
    if (!equipmentId) return setError('Select equipment')
    const { error: err } = await downtime.create({
      location_id: locationId,
      equipment_id: equipmentId,
      reason: reason.trim() || null,
      reason_category: category,
      reported_by: profile?.id ?? null,
    })
    if (err) return setError(err.message)
    // Mark the equipment as down for visibility.
    await equipQ.update(equipmentId, { status: 'down' })
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Log downtime">
      <div className="flex flex-col gap-4">
        <Field label="Equipment" required>
          {(id) => (
            <Select id={id} value={equipmentId} onChange={(e) => setEquipmentId(e.target.value)}>
              <option value="">Select…</option>
              {equip.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Reason category">
          {(id) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="mechanical">Mechanical</option>
              <option value="electrical">Electrical</option>
              <option value="chemical">Chemical</option>
              <option value="weather">Weather</option>
              <option value="other">Other</option>
            </Select>
          )}
        </Field>
        <Field label="Reason">{(id) => <Input id={id} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="What happened?" />}</Field>
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={save}>Start downtime</Button>
        </div>
      </div>
    </Modal>
  )
}

export default function DowntimePage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
