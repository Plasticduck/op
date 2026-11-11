import { useMemo, useState } from 'react'
import { Download, Upload } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { downloadCsv, readSpreadsheet } from '@/lib/csv'
import { miEquipment, type EquipmentImportResult } from '@/lib/queries/miEquipment'
import { useMi } from '../context'
import { errText } from '../format'
import { Card, Chips, ErrorNote, Muted } from '../ui'

// Equipment from a spreadsheet: one row per machine or component. The preview runs the
// real import and rolls it back, so it shows exactly what will happen. Importing is all
// or nothing.

const COLUMNS = ['site', 'name', 'type', 'parent', 'zone', 'status', 'criticality', 'manufacturer', 'model', 'serial', 'installed', 'bought', 'warranty', 'vendor', 'use_counted', 'tag', 'asset_number', 'maintainx_id', 'notes']
const EXAMPLES = [
  ['MW02', '#02 - Top Brush 3', 'Top Brush 3', '', 'Wash', 'running', 'A', 'Sonny\'s', 'Top Brush XL', 'SN-1234', '2026-03-01', '2026-02-15', '2028-03-01', '', 'every car', '', '', '', ''],
  ['MW02', '#02 - Top Brush 3 - Motor', 'Top Brush 3 - Motor', '#02 - Top Brush 3', 'Wash', 'running', 'B', '', '', '', '', '', '', '', '', '', '', '', ''],
]
const MAX_ROWS = 3000

export default function ImportPage() {
  const { me, notify } = useMi()
  const [rows, setRows] = useState<Array<Record<string, string>> | null>(null)
  const [fileName, setFileName] = useState('')
  const [unknown, setUnknown] = useState<string[]>([])
  const [preview, setPreview] = useState<EquipmentImportResult | null>(null)
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
      if (!heads.includes('site')) throw new Error('It needs a site column.')
      if (data.length - 1 > MAX_ROWS) throw new Error(`That's ${data.length - 1} rows. Split it into files of ${MAX_ROWS} or fewer.`)
      const out = data.slice(1).filter((r) => r.some((c) => (c ?? '').trim())).map((r) => Object.fromEntries(heads.map((h, i) => [h, (r[i] ?? '').trim()])))
      setRows(out)
      setPreview(await miEquipment.importEquipment(out, false))
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
      const r = await miEquipment.importEquipment(rows, true)
      setPreview(r)
      if (r.committed) {
        notify(`Imported: ${r.created} added, ${r.updated} updated.`)
        setRows(null)
        window.dispatchEvent(new Event('mi-changed'))
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

  if (me.rank < 4) return <ErrorNote>Only a corporate maintenance director or admin can import equipment.</ErrorNote>
  return (
    <div className="flex flex-col gap-3">
      <Card title="Your spreadsheet" actions={<Button size="sm" variant="ghost" onClick={() => downloadCsv('maintenance-equipment-template', [COLUMNS, ...EXAMPLES])}><Download className="size-4" /> Template</Button>}>
        <div className="mb-3 space-y-1 text-sm text-ink-muted">
          <p>One row per machine or component. A row updates the machine with the same sticker tag, asset number, MaintainX id, or site and name; anything else is added. Blank cells leave what's there.</p>
          <p><b>parent</b> names the machine a component belongs to (its name or sticker, at the same site; it can be a row above). <b>tag</b> claims a blank sticker or records one already on it. <b>status</b>: running, down for maintenance, broken down or retired. <b>use_counted</b>: every car, some packages or no.</p>
        </div>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border px-4 text-sm font-medium text-ink hover:bg-content">
          <Upload className="size-4" /> Choose a CSV or Excel file
          <input type="file" accept=".csv,.xlsx,.xls" className="hidden" disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = '' }} />
        </label>
        {busy && <Muted>Working...</Muted>}
        {error && <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>}
        {unknown.length > 0 && <p className="mt-2 text-xs text-warn">Ignoring columns we don't use: {unknown.join(', ')}</p>}
        {preview && (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-ink">
              <b>{fileName}</b>: {preview.created} to add, {preview.updated} to update, <span className={preview.errors ? 'font-semibold text-danger' : ''}>{preview.errors} problems</span>.
              {preview.committed ? ' Imported.' : ' Nothing has changed yet.'}
            </p>
            {!preview.committed && (
              <div className="flex flex-wrap items-center gap-2">
                <Chips value={show} onChange={setShow} options={[{ value: 'all', label: 'All' }, { value: 'error', label: 'Problems', count: preview.errors }, { value: 'create', label: 'New', count: preview.created }, { value: 'update', label: 'Updates', count: preview.updated }]} />
                <Button className="sm:ml-auto" disabled={busy || preview.errors > 0 || !rows} onClick={() => void commit()}>
                  {preview.errors > 0 ? 'Fix the problems to import' : `Import ${preview.rows.length} rows`}
                </Button>
              </div>
            )}
            <div className="max-h-96 overflow-auto rounded-md border border-border">
              <table className="w-full min-w-[560px] text-sm">
                <thead className="sticky top-0 bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr><th className="px-2 py-1 font-medium">Row</th><th className="px-2 py-1 font-medium">Result</th><th className="px-2 py-1 font-medium">Machine</th><th className="px-2 py-1 font-medium">Site</th><th className="px-2 py-1 font-medium">Problem</th></tr>
                </thead>
                <tbody>
                  {shown.slice(0, 500).map((r) => (
                    <tr key={r.row} className="border-t border-border">
                      <td className="px-2 py-1 tabular-nums text-ink-muted">{r.row + 1}</td>
                      <td className="px-2 py-1"><Badge tone={tone[r.status]}>{r.status}</Badge></td>
                      <td className="px-2 py-1 text-ink">{r.machine}</td>
                      <td className="px-2 py-1 text-ink-muted">{r.site}</td>
                      <td className="px-2 py-1 text-danger">{r.message}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
