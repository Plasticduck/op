import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ClipboardCheck, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { miEquipment, type AuditsList } from '@/lib/queries/miEquipment'
import { useMi } from '../context'
import { day, errText } from '../format'
import { Card, ErrorNote, Loading, Muted } from '../ui'

// Equipment audits: walk a site, scan each machine's sticker or tick it off, and find
// out what's missing, what moved and which stickers need replacing.

const BASE = '/app/maintenance-inventory/audits'

export default function AuditsPage() {
  const { notify } = useMi()
  const navigate = useNavigate()
  const [d, setD] = useState<AuditsList | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [scope, setScope] = useState<'all' | 'stickered'>('all')
  const [starting, setStarting] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      setD(await miEquipment.audits())
      setError(null)
    } catch (e) {
      setError(errText(e))
    }
  }, [])
  useEffect(() => { void load() }, [load])

  const start = async (site: string) => {
    setStarting(site)
    try {
      const id = await miEquipment.auditStart(site, scope)
      navigate(`${BASE}/${id}`)
    } catch (e) {
      notify(errText(e), 'danger')
    } finally {
      setStarting(null)
    }
  }

  if (error) return <ErrorNote>{error}</ErrorNote>
  if (!d) return <Loading />
  const open = d.runs.filter((r) => r.status === 'in_progress')
  const past = d.runs.filter((r) => r.status !== 'in_progress')

  return (
    <div className="flex flex-col gap-4">
      {open.length > 0 && (
        <Card title="In progress">
          {open.map((r) => (
            <Link key={r.id} to={`${BASE}/${r.id}`} className="flex items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0 hover:bg-content">
              <span className="min-w-0">
                <span className="block font-medium text-ink">{r.site_name}</span>
                <span className="block text-xs text-ink-muted">Started {day(r.started_at)} by {r.started_by_name ?? 'someone'}</span>
              </span>
              <span className="shrink-0 tabular-nums text-ink-muted">{r.progress.checked} of {r.progress.expected}</span>
            </Link>
          ))}
        </Card>
      )}

      <Card title="Sites" actions={
        <Select value={scope} onChange={(e) => setScope(e.target.value as 'all' | 'stickered')} aria-label="What to audit" className="h-8 w-56 text-sm">
          <option value="all">Every machine</option>
          <option value="stickered">Only machines with stickers</option>
        </Select>
      }>
        <div className="divide-y divide-border">
          {d.sites.filter((s) => s.machines > 0).map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
              <span className="min-w-0 flex-1">
                <span className="block font-medium text-ink">{s.name}</span>
                <span className="block text-xs text-ink-muted">
                  {s.machines} machines, {s.stickered} with stickers · {s.last_completed ? `last audited ${day(s.last_completed)}` : 'never audited'}
                </span>
              </span>
              {s.open_run ? (
                <Link to={`${BASE}/${s.open_run}`} className="inline-flex h-8 items-center rounded-md bg-accent px-3 text-sm font-medium text-white hover:bg-accent-hover">Continue</Link>
              ) : (
                <Button size="sm" variant="secondary" disabled={!!starting} onClick={() => void start(s.id)}>
                  {starting === s.id ? <Loader2 className="size-3.5 animate-spin" /> : <ClipboardCheck className="size-3.5" />} Start
                </Button>
              )}
            </div>
          ))}
          {d.sites.every((s) => s.machines === 0) && <Muted>No machines at your sites yet.</Muted>}
        </div>
      </Card>

      <Card title="Past audits">
        {past.length === 0 ? <Muted>None yet.</Muted> : past.map((r) => (
          <Link key={r.id} to={`${BASE}/${r.id}`} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0 hover:bg-content">
            <span className="min-w-0">
              <span className="block font-medium text-ink">{r.site_name}</span>
              <span className="block text-xs text-ink-muted">{day(r.completed_at ?? r.started_at)} · {r.completed_by_name ?? r.started_by_name ?? ''}</span>
            </span>
            {r.status === 'cancelled' ? <Badge>Cancelled</Badge> : r.summary && (
              <span className="flex flex-wrap gap-1">
                <Badge tone="ok">{r.summary.found} found</Badge>
                {r.summary.missing > 0 && <Badge tone="danger">{r.summary.missing} missing</Badge>}
                {r.summary.moved > 0 && <Badge tone="accent">{r.summary.moved} moved</Badge>}
                {r.summary.stickers_bad > 0 && <Badge tone="warn">{r.summary.stickers_bad} stickers to replace</Badge>}
              </span>
            )}
          </Link>
        ))}
      </Card>
    </div>
  )
}
