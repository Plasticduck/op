import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Users } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { StatCardRow } from '@/components/data/StatCardRow'
import { WeatherOutlook } from '@/components/data/WeatherOutlook'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { shortDate } from '@/lib/format'
import { useLocations } from '@/lib/locations'
import { employees, type Employee } from '@/lib/queries/people'
import { EmployeeModal } from './EmployeeModal'

function Inner({ locationId }: { locationId: string }) {
  const { activeLocation } = useLocations()
  const [rows, setRows] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [showInactive, setShowInactive] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await employees.list(locationId)
    setRows((data as Employee[] | null) ?? [])
    setLoading(false)
  }, [locationId])

  useEffect(() => { void load() }, [load])

  const visible = showInactive ? rows : rows.filter((r) => r.status === 'active')
  const active = rows.filter((r) => r.status === 'active').length

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Employees"
        subtitle="Staff roster for scheduling, time tracking, and HR. Includes staff who don't log in. For app logins and roles, see Settings, Team."
        actions={<Button onClick={() => setCreating(true)}><Plus className="size-4" /> Add employee</Button>}
      />

      <WeatherOutlook
        latitude={activeLocation?.latitude ?? null}
        longitude={activeLocation?.longitude ?? null}
      />

      <StatCardRow
        items={[
          { label: 'Active', value: active },
          { label: 'Inactive', value: rows.length - active },
          { label: 'Total', value: rows.length },
        ]}
      />

      <label className="flex items-center gap-2 text-sm text-ink-muted">
        <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
        Show inactive
      </label>

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : visible.length === 0 ? (
        <EmptyState icon={Users} title="No employees" description="Add your team to manage schedules, time, and HR records." action={<Button onClick={() => setCreating(true)}>Add employee</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Name</th>
                <th className="px-3 py-2.5 font-medium">Role</th>
                <th className="px-3 py-2.5 font-medium">Start date</th>
                <th className="px-3 py-2.5 font-medium">Status</th>
                <th className="px-3 py-2.5 font-medium">App access</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5">
                    <Link to={`/app/employees/${e.id}`} className="font-medium text-ink hover:text-accent">
                      {e.first_name} {e.last_name}
                    </Link>
                    {e.email && <p className="text-xs text-ink-muted">{e.email}</p>}
                  </td>
                  <td className="px-3 py-2.5 text-ink-muted">{e.role_title ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(e.start_date)}</td>
                  <td className="px-3 py-2.5">
                    <Badge tone={e.status === 'active' ? 'ok' : 'neutral'}>{e.status}</Badge>
                  </td>
                  <td className="px-3 py-2.5">
                    {e.user_id ? (
                      <Badge tone="accent">Has login</Badge>
                    ) : (
                      <span className="text-xs text-ink-subtle">Roster only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {creating && <EmployeeModal locationId={locationId} existing={null} onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load() }} />}
    </div>
  )
}

export default function EmployeesPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
