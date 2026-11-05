import { useMemo, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { downloadCsv, readSpreadsheet } from '@/lib/csv'
import { mi, type ImportResult } from '@/lib/queries/maintenanceInventory'
import { useMi } from './context'
import { errText } from './format'
import { Card, Chips, ErrorNote, Muted } from './ui'

// CSV or Excel import: one row per part per location. Preview runs the real import and
// rolls it back, so what it shows is exactly what commit will do. Commit is all or nothing.

const COLUMNS = ['sku', 'name', 'description', 'category', 'manufacturer', 'mfr_part_number', 'uom', 'is_critical', 'location', 'bin', 'on_hand', 'min_qty', 'max_qty', 'unit_cost', 'vendor', 'vendor_part_number', 'lead_time_days', 'barcode']
const EXAMPLE = ['RLR-100', 'Conveyor roller assembly', '', 'Tunnel Parts', 'Sonnys', '10031', 'ea', 'yes', 'Main stockroom', 'A-1', '4', '2', '6', '42.50', 'Sonny\'s Car Wash', 'SCW-10031', '5', '']

const MAX_ROWS = 2000

export function ImportPanel() {
  const { notify, reload } = useMi()
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null)
  const [fileName, setFileName] = useState('')
  const [unknown, setUnknown] = useState<string[]>([])
  const [preview, setPreview] = useState<ImportResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [show, setShow] = useState<'all' | 'error' | 'create' | 'update'>('all')

  const open = async (file: File) => {
    setBusy(true)
    setError(null)
    setPreview(null)
    setFileName(file.name)
    try {
      const data = await readSpreadsheet(file)
      if (data.length < 2) throw new Error('That file has no rows under its heading.')
      const heads = data[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_'))
      setUnknown(heads.filter((h) => h && !COLUMNS.includes(h)))
      if (!heads.includes('name') && !heads.includes('sku')) throw new Error('It needs a name or sku column.')
      if (data.length - 1 > MAX_ROWS) throw new Error(`That's ${data.length - 1} rows. Split it into files of ${MAX_ROWS} or fewer.`)
      const out = data.slice(1).map((r) => Object.fromEntries(heads.map((h, i) => [h, (r[i] ?? '').trim()])))
      setRows(out)
      setPreview(await mi.importParts(out, false))
      setShow('all')
    } catch (e) {
      setRows(null)
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const commit = async () => {
    if (!rows) return
    setBusy(true)
    setError(null)
    try {
      const r = await mi.importParts(rows, true)
      setPreview(r)
      if (r.committed) {
        notify(`Imported: ${r.created} new parts, ${r.updated} rows updated.`)
        setRows(null)
        await reload()
      } else {
        setError('Nothing was imported: some rows have problems. Fix them and try again.')
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const shown = useMemo(() => (preview?.rows ?? []).filter((r) => show === 'all' || r.status === show), [preview, show])
  const tone = { create: 'ok', update: 'accent', error: 'danger' } as const

  return (
    <Card title="Import parts" actions={<Button size="sm" variant="ghost" onClick={() => downloadCsv('maintenance-inventory-template', [COLUMNS, EXAMPLE])}><Download className="size-4" /> Template</Button>}>
      <p className="mb-3 text-sm text-ink-muted">One row per part per location. Existing parts match on SKU, then manufacturer part number, then barcode. A row's on hand becomes the stock count, with the change recorded in the history.</p>
      <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-ink hover:bg-content">
        <Upload className="size-4" /> Choose a CSV or Excel file
        <input type="file" accept=".csv,.xlsx,.xls" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = '' }} />
      </label>
      {busy && <Muted>Working...</Muted>}
      {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
      {unknown.length > 0 && <p className="mt-2 text-xs text-warn">Ignoring columns we don't use: {unknown.join(', ')}</p>}
      {preview && !preview.committed && (
        <div className="mt-4 flex flex-col gap-3">
          <p className="text-sm text-ink">
            <b>{fileName}</b>: {preview.created} new parts, {preview.updated} updates, <span className={preview.errors ? 'font-semibold text-danger' : ''}>{preview.errors} problems</span>. Nothing has changed yet.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Chips value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'error', label: 'Problems', count: preview.errors }, { value: 'create', label: 'New', count: preview.created }, { value: 'update', label: 'Updates', count: preview.updated }]} />
            <Button className="sm:ml-auto" disabled={busy || preview.errors > 0 || !rows} onClick={() => void commit()}>
              {preview.errors > 0 ? 'Fix the problems to import' : `Import ${preview.rows.length} rows`}
            </Button>
          </div>
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full min-w-[520px] text-sm">
              <thead className="sticky top-0 bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                <tr><th className="px-2 py-1 font-medium">Row</th><th className="px-2 py-1 font-medium">Result</th><th className="px-2 py-1 font-medium">Part</th><th className="px-2 py-1 font-medium">Location</th><th className="px-2 py-1 font-medium">Problem</th></tr>
              </thead>
              <tbody>
                {shown.slice(0, 500).map((r) => (
                  <tr key={r.row} className="border-t border-border">
                    <td className="px-2 py-1 tabular-nums text-ink-muted">{r.row + 1}</td>
                    <td className="px-2 py-1"><Badge tone={tone[r.status]}>{r.status}</Badge></td>
                    <td className="px-2 py-1 text-ink">{r.part}</td>
                    <td className="px-2 py-1 text-ink-muted">{r.location}</td>
                    <td className="px-2 py-1 text-danger">{r.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Card>
  )
}
