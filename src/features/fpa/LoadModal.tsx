import { useState } from 'react'
import { FileSpreadsheet, Loader2 } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { FPA_SHEETS, FpaFormatError, parseFpaWorkbook, type FpaDataset } from '@/lib/fpa/parse'
import { fpa, type FpaVersion } from '@/lib/queries/fpa'
import { money, monthLabel } from './model'

type Step =
  | { s: 'pick' }
  | { s: 'reading'; name: string }
  | { s: 'ready'; d: FpaDataset }
  | { s: 'loading'; d: FpaDataset; done: number; total: number }
  | { s: 'done'; d: FpaDataset }

// Read a new FP&A workbook in the browser, show what's in it, then load it as
// the current version. Until it's fully in, the current version stays.
export function LoadModal({ current, onClose, onLoaded }: { current: FpaVersion | null; onClose: () => void; onLoaded: () => void }) {
  const { profile } = useAuth()
  const [step, setStep] = useState<Step>({ s: 'pick' })
  const [error, setError] = useState<string | null>(null)
  const busy = step.s === 'reading' || step.s === 'loading'

  const read = async (file: File | null) => {
    if (!file) return
    setError(null)
    setStep({ s: 'reading', name: file.name })
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.read(await file.arrayBuffer(), {
        type: 'array', sheets: [...FPA_SHEETS], cellDates: false, cellFormula: false, cellHTML: false, cellText: false, cellStyles: false, cellNF: false,
      })
      setStep({ s: 'ready', d: parseFpaWorkbook(XLSX.utils as never, wb as never, file.name) })
    } catch (e) {
      setStep({ s: 'pick' })
      setError(e instanceof FpaFormatError ? e.message : `Could not read that file: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const load = async (d: FpaDataset) => {
    if (!profile) return
    setError(null)
    setStep({ s: 'loading', d, done: 0, total: 1 })
    try {
      await fpa.load(profile.account_id, d, (done, total) => setStep({ s: 'loading', d, done, total }))
      setStep({ s: 'done', d })
    } catch (e) {
      setStep({ s: 'ready', d })
      setError(`The load stopped, so the current version is unchanged: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  const summary = (d: FpaDataset) => {
    const lc = d.lastClosed
    const rev = lc ? d.metrics.find((m) => m.e === 'G_CONS' && m.m === 'Net Revenue' && m.d === lc)?.v ?? null : null
    const ebitda = lc ? d.metrics.find((m) => m.e === 'G_CONS' && m.m === 'EBITDA' && m.d === lc)?.v ?? null : null
    return (
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 rounded-md border border-border bg-content px-3 py-2 text-sm">
        <dt className="text-ink-muted">Version</dt><dd className="font-medium text-ink">{d.label}</dd>
        <dt className="text-ink-muted">Last closed</dt><dd className="text-ink">{lc ? monthLabel(lc, 'long') : 'not found'}</dd>
        <dt className="text-ink-muted">P&L</dt><dd className="text-ink">{d.pl.length.toLocaleString()} QuickBooks lines, {d.info.months.first ? monthLabel(d.info.months.first) : '?'} to {d.info.months.last ? monthLabel(d.info.months.last) : '?'}</dd>
        <dt className="text-ink-muted">Engine</dt><dd className="text-ink">{d.metrics.length.toLocaleString()} values for {d.entities.length} entities</dd>
        <dt className="text-ink-muted">Budget / forecast</dt><dd className="text-ink">{d.budget.length} locations · {d.forecast.length.toLocaleString()} forecast values</dd>
        {lc && <><dt className="text-ink-muted">{monthLabel(lc)} company</dt><dd className="text-ink">Net revenue {money(rev)} · EBITDA {money(ebitda)}</dd></>}
      </dl>
    )
  }

  return (
    <Modal open onClose={() => !busy && onClose()} title="Load a new version" size="md">
      <div className="flex flex-col gap-4 text-sm">
        {step.s === 'pick' && (
          <>
            <p className="text-ink">
              Choose the FP&A workbook (Mighty_Wash_FPA_Model_*.xlsx). It’s read here in your browser; you’ll see what’s in it before anything changes.
            </p>
            <label className="flex cursor-pointer flex-col items-center gap-2 rounded-md border border-dashed border-border px-4 py-6 text-ink-muted hover:bg-content">
              <FileSpreadsheet className="size-6" />
              <span className="font-medium text-ink">Choose the workbook</span>
              <input type="file" accept=".xlsx,.xlsm" className="hidden" onChange={(e) => { void read(e.target.files?.[0] ?? null); e.target.value = '' }} />
            </label>
          </>
        )}
        {step.s === 'reading' && <p className="flex items-center gap-2 text-ink"><Loader2 className="size-4 animate-spin" /> Reading {step.name}… (a large workbook takes several seconds)</p>}
        {(step.s === 'ready' || step.s === 'loading') && summary(step.d)}
        {step.s === 'ready' && current && (
          <p className="text-ink-muted">This replaces <b className="text-ink">{current.label}</b> for everyone who reads the model, including Operator AI.</p>
        )}
        {step.s === 'loading' && (
          <div>
            <p className="mb-1 flex items-center gap-2 text-ink"><Loader2 className="size-4 animate-spin" /> Loading… {Math.round((step.done / Math.max(1, step.total)) * 100)}%</p>
            <div className="h-2 overflow-hidden rounded-full bg-content">
              <div className="h-full bg-accent transition-all" style={{ width: `${(step.done / Math.max(1, step.total)) * 100}%` }} />
            </div>
          </div>
        )}
        {step.s === 'done' && <p className="rounded-md bg-ok-soft px-3 py-2 text-ok">{step.d.label} is now the current version.</p>}
        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          {step.s === 'done' ? (
            <Button onClick={onLoaded}>Show it</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
              {step.s === 'ready' && <Button variant="secondary" onClick={() => setStep({ s: 'pick' })}>Choose another file</Button>}
              {(step.s === 'ready' || step.s === 'loading') && (
                <Button onClick={() => step.s === 'ready' && void load(step.d)} disabled={busy}>{busy ? 'Loading…' : 'Load this version'}</Button>
              )}
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
