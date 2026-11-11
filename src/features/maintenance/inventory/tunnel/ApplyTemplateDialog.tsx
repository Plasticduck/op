import { useState } from 'react'
import { CheckCircle2, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { miTunnel, type ApplyReport } from '@/lib/queries/miTunnel'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { errText } from '../format'
import { ErrorNote } from '../ui'

// Copy a drawing (a template, or another site's) to sites. "Check" runs it and undoes it,
// so the report shows what each site would get, which shapes found their machine and
// which didn't, before anything is saved.

type Props = {
  source: { id: string; name: string }
  // Sites to offer, with whether each already has a drawing.
  sites: Array<{ id: string; name: string; has: boolean }>
  preselect?: string[]
  onClose: () => void
  onDone: (report: ApplyReport) => void
}

export function ApplyTemplateDialog({ source, sites, preselect, onClose, onDone }: Props) {
  const { me } = useMi()
  const [picked, setPicked] = useState<Set<string>>(new Set(preselect ?? []))
  const [mode, setMode] = useState<'skip_existing' | 'replace'>('skip_existing')
  const [setZones, setSetZones] = useState(true)
  const [report, setReport] = useState<ApplyReport | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const many = me.rank >= 4

  const run = async (commit: boolean) => {
    setBusy(true)
    setError(null)
    try {
      const r = await miTunnel.apply(source.id, [...picked], { mode, set_zones: setZones }, commit)
      setReport(r)
      if (commit) onDone(r)
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const toggle = (id: string) => {
    setReport(null)
    setPicked((s) => {
      const next = many ? new Set(s) : new Set<string>()
      if (s.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <Modal open onClose={onClose} title={`Set up diagrams from ${source.name}`} size="lg"
      description="Each shape links to the site's machine of the same type. Check first to see what each site gets; nothing is saved until you apply.">
      <div className="flex flex-col gap-4">
        {sites.length > 1 && (
          <div>
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{many ? 'Sites' : 'Site'}</span>
              {many && (
                <span className="flex gap-2 text-xs">
                  <button type="button" className="text-accent hover:underline" onClick={() => { setReport(null); setPicked(new Set(sites.filter((s) => !s.has).map((s) => s.id))) }}>All without one</button>
                  <button type="button" className="text-accent hover:underline" onClick={() => { setReport(null); setPicked(new Set()) }}>None</button>
                </span>
              )}
            </div>
            <div className="grid max-h-56 grid-cols-2 gap-1 overflow-y-auto rounded-md border border-border p-2 sm:grid-cols-3">
              {sites.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-content">
                  <input type={many ? 'checkbox' : 'radio'} checked={picked.has(s.id)} onChange={() => toggle(s.id)} className="size-4 border-border text-accent focus:ring-accent" />
                  <span className="truncate text-ink">{s.name}</span>
                  {s.has && <span className="ml-auto shrink-0 text-[11px] text-ink-subtle">has one</span>}
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="flex flex-col gap-2 text-sm">
          <label className="flex items-center gap-2 text-ink">
            <input type="checkbox" checked={mode === 'replace'} onChange={(e) => { setReport(null); setMode(e.target.checked ? 'replace' : 'skip_existing') }} className="size-4 rounded border-border text-accent focus:ring-accent" />
            Replace a site's diagram if it already has one
          </label>
          <label className="flex items-center gap-2 text-ink">
            <input type="checkbox" checked={setZones} onChange={(e) => { setReport(null); setSetZones(e.target.checked) }} className="size-4 rounded border-border text-accent focus:ring-accent" />
            Add the drawing's zones to each site, and give machines without a zone the zone they sit in
          </label>
        </div>

        {report && (
          <div className="flex flex-col gap-2">
            <div className="text-sm font-medium text-ink">{report.committed ? 'Done' : 'What would happen'}</div>
            <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
              {report.sites.map((s) => (
                <li key={s.site_id} className="px-3 py-2 text-sm">
                  <div className="flex items-center gap-2">
                    {s.result === 'skipped' ? <span className="size-4" /> : (s.unmatched?.length ?? 0) > 0 ? <TriangleAlert className="size-4 text-warn" /> : <CheckCircle2 className="size-4 text-ok" />}
                    <span className="font-medium text-ink">{s.site_name}</span>
                    <span className={cn('text-xs', s.result === 'skipped' ? 'text-ink-subtle' : 'text-ink-muted')}>
                      {s.result === 'skipped' ? 'already has a diagram, left alone' : `${s.result === 'replaced' ? 'replaced' : 'new'}: ${s.linked} of ${s.items} shapes linked`}
                      {s.zones_created ? `, ${s.zones_created} zones added` : ''}{s.areas_set ? `, ${s.areas_set} machines given a zone` : ''}
                    </span>
                  </div>
                  {(s.unmatched?.length ?? 0) > 0 && <p className="ml-6 text-xs text-ink-muted">No machine for: {s.unmatched!.join(', ')}. They're drawn dashed until someone links them.</p>}
                  {(s.ambiguous?.length ?? 0) > 0 && <p className="ml-6 text-xs text-warn">More than one match, picked the first: {s.ambiguous!.join(', ')}.</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>{report?.committed ? 'Close' : 'Cancel'}</Button>
          {!report?.committed && (
            <>
              <Button variant="secondary" disabled={busy || picked.size === 0} onClick={() => void run(false)}>{busy && !report && <Loader2 className="size-4 animate-spin" />} Check</Button>
              <Button disabled={busy || picked.size === 0 || !report} onClick={() => void run(true)}>{busy && report && <Loader2 className="size-4 animate-spin" />} Apply to {picked.size} site{picked.size === 1 ? '' : 's'}</Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
