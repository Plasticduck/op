import { useEffect, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { supabase } from '@/lib/supabase'
import { useLocations } from '@/lib/locations'
import { useAuth } from '@/lib/auth'
import { useAcademy } from './context'
import { errText } from './helpers'

type Emp = { id: string; first_name: string; last_name: string | null; location_id: string | null }

const inputCls = 'h-9 w-full rounded-md border border-border bg-content px-2.5 text-sm text-ink outline-none focus:border-accent'

// A leader picks a team member (most have no Operator login) and trains them on this
// device. Everything they do saves to that person until the leader taps Done training.
export function TraineePicker({ onClose, onStarted }: { onClose: () => void; onStarted?: () => void }) {
  const { startTrainee, toast } = useAcademy()
  const { locations, activeLocation } = useLocations()
  const { profile } = useAuth()
  const [emps, setEmps] = useState<Emp[] | null>(null)
  const [site, setSite] = useState<string>(activeLocation?.id ?? '')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Sites this leader leads (an Admin leads them all).
  const mySites = useMemo(() => {
    const all = locations
    if (profile?.role === 'owner') return all
    const mine = new Set(profile?.location_ids ?? [])
    return all.filter((l) => mine.has(l.id))
  }, [locations, profile?.role, profile?.location_ids])

  useEffect(() => {
    if (!site && mySites[0]) setSite(mySites[0].id)
  }, [site, mySites])

  useEffect(() => {
    if (!site) return
    setEmps(null)
    void supabase
      .from('employees')
      .select('id, first_name, last_name, location_id')
      .eq('location_id', site)
      .eq('status', 'active')
      .order('first_name')
      .then(({ data, error: e }) => {
        if (e) setError(e.message)
        setEmps((data as Emp[] | null) ?? [])
      })
  }, [site])

  const shown = (emps ?? []).filter((e) => `${e.first_name} ${e.last_name ?? ''}`.toLowerCase().includes(q.trim().toLowerCase()))

  const start = async (e: Emp) => {
    setBusy(e.id)
    setError(null)
    try {
      await startTrainee(e.id)
      toast(`Training ${e.first_name} on this device`)
      onStarted?.()
      onClose()
    } catch (err) {
      setError(errText(err))
    } finally {
      setBusy(null)
    }
  }

  return (
    <Modal open onClose={onClose} title="Train a team member" description="Pick who is taking the training on this device. Their progress saves to them until you tap Done training.">
      <div className="flex flex-col gap-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <select value={site} onChange={(e) => setSite(e.target.value)} className={inputCls} aria-label="Site">
            {mySites.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
          <div className="relative w-full">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-ink-subtle" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names" className={`${inputCls} pl-8`} />
          </div>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="max-h-[50vh] overflow-y-auto rounded-lg border border-border">
          {emps == null ? (
            <p className="p-3 text-sm text-ink-muted">Loading…</p>
          ) : shown.length === 0 ? (
            <p className="p-3 text-sm text-ink-muted">No active team members{q ? ' match' : ' at this site'}.</p>
          ) : (
            <ul className="divide-y divide-border">
              {shown.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="text-sm text-ink">{e.first_name} {e.last_name}</span>
                  <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => void start(e)}>
                    {busy === e.id ? 'Starting…' : 'Start'}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  )
}
