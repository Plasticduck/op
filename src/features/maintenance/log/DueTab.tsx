import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarPlus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { ml, type ScheduleRow, type ScheduleStatus } from '@/lib/queries/maintenanceLog'
import { useMi } from '../inventory/context'
import { errText } from '../inventory/format'
import { ErrorNote, Loading, Muted } from '../inventory/ui'
import { LOG_CHANGED, useLog } from './context'
import { ScheduleCard } from './ScheduleCard'

const GROUPS: Array<{ status: ScheduleStatus; label: string }> = [
  { status: 'overdue', label: 'Overdue' },
  { status: 'due', label: 'Due now' },
  { status: 'soon', label: 'Coming up' },
]

// The to-do list: everything late, due, or inside its warning window.
export default function DueTab() {
  const { refs, me } = useMi()
  const { openSchedule } = useLog()
  const [site, setSite] = useState('')
  const [rows, setRows] = useState<ScheduleRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setRows(await ml.schedules({ site: site || null, status: 'attention' }))
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [site])
  useEffect(() => {
    void load()
    window.addEventListener(LOG_CHANGED, load)
    window.addEventListener('mi-changed', load)
    return () => {
      window.removeEventListener(LOG_CHANGED, load)
      window.removeEventListener('mi-changed', load)
    }
  }, [load])

  const groups = useMemo(() => GROUPS.map((g) => ({ ...g, rows: (rows ?? []).filter((r) => r.status === g.status) })).filter((g) => g.rows.length), [rows])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Select value={site} onChange={(e) => setSite(e.target.value)} className="w-full sm:w-44" aria-label="Site">
          <option value="">All my sites</option>
          {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </Select>
        {me.rank >= 2 && <Button variant="secondary" onClick={() => openSchedule({ site_id: site || null })}><CalendarPlus className="size-4" /> New schedule</Button>}
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
      {!rows && !error && <Loading />}
      {rows && rows.length === 0 && (
        <Muted>Nothing is due. Scheduled maintenance shows here when it's coming up{me.rank >= 2 ? ': set one up with New schedule, or from a part\'s or machine\'s page' : ''}.</Muted>
      )}
      {groups.map((g) => (
        <section key={g.status} className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">{g.label} <span className="font-normal text-ink-muted">({g.rows.length})</span></h2>
          <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
            {g.rows.map((s) => <ScheduleCard key={s.id} s={s} showSite={!site} />)}
          </div>
        </section>
      ))}
    </div>
  )
}
