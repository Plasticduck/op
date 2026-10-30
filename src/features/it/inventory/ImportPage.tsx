import { useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { format } from 'date-fns'
import { ArrowLeft, CircleCheck, Download, FileUp, Loader2, Printer, TriangleAlert } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { PageHeader } from '@/components/layout/PageHeader'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { useAuth } from '@/lib/auth'
import { downloadCsv, readSpreadsheet, toCsv } from '@/lib/csv'
import { cn } from '@/lib/utils'
import { itInventory, type ImportEntity, type ImportResult, type ItAssetRow } from '@/lib/queries/itInventory'
import { PrintDialog } from './PrintDialog'
import { autoMap, ENTITY_LABEL, IMPORT_FIELDS, norm, type ImportField } from './importSchema'
import { friendlyError } from './format'
import { useItRefs } from './useItRefs'

// Bring in equipment, models or subscriptions from a spreadsheet: pick the
// file, check how its columns line up, check the file (a dry run that saves
// nothing), then import. Rows match existing records (by tag, serial, or site +
// name for equipment) and update them, so running the same file twice never
// makes duplicates. Rows with problems are skipped and listed in an error
// report you can download.

const CHUNK = 200
type Step = 'file' | 'checked' | 'done'
const CREATE_OPTIONS: { key: string; label: string; entities: ImportEntity[]; admin?: boolean }[] = [
  { key: 'manufacturers', label: 'Manufacturers', entities: ['assets', 'models'] },
  { key: 'models', label: 'Models', entities: ['assets'] },
  { key: 'areas', label: 'Areas at a site', entities: ['assets'] },
  { key: 'suppliers', label: 'Suppliers and providers', entities: ['assets', 'subscriptions'] },
  { key: 'categories', label: 'Categories', entities: ['assets', 'models', 'subscriptions'], admin: true },
]

export function ImportPage() {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const { refs, reload: reloadRefs } = useItRefs()
  const fileInput = useRef<HTMLInputElement>(null)
  const [entity, setEntity] = useState<ImportEntity>('assets')
  const [fileName, setFileName] = useState<string | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [data, setData] = useState<string[][]>([])
  const [mapping, setMapping] = useState<string[]>([])
  const [create, setCreate] = useState<Record<string, boolean>>({ manufacturers: true, models: true, areas: true, suppliers: true, categories: false })
  const [step, setStep] = useState<Step>('file')
  const [results, setResults] = useState<ImportResult[]>([])
  const [busy, setBusy] = useState<null | 'reading' | 'checking' | 'importing'>(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [printAssets, setPrintAssets] = useState<ItAssetRow[] | null>(null)
  const admin = profile?.role === 'owner'

  const fields: ImportField[] = useMemo(() => {
    const base = IMPORT_FIELDS[entity]
    if (entity !== 'assets' || !refs) return base
    return [...base, ...refs.fields.filter((f) => f.field_type !== 'secret').map((f) => ({
      key: `cf:${f.key}`, label: f.name, synonyms: [norm(f.name), norm(f.key)],
    }))]
  }, [entity, refs])

  const reset = (e: ImportEntity) => {
    setEntity(e)
    setFileName(null); setHeaders([]); setData([]); setMapping([]); setResults([]); setStep('file'); setError(null)
  }

  const pickFile = async (file: File) => {
    setBusy('reading')
    setError(null)
    try {
      const rows = await readSpreadsheet(file)
      if (rows.length < 2) throw new Error('That file has no rows under its header line.')
      const head = rows[0].map((h) => h.trim())
      setFileName(file.name)
      setHeaders(head)
      setData(rows.slice(1).map((r) => head.map((_, i) => (r[i] ?? '').trim())))
      setMapping(autoMap(head, fields))
      setResults([])
      setStep('file')
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't read that file.")
    } finally {
      setBusy(null)
    }
  }

  const missingRequired = fields.filter((f) => f.required && !mapping.includes(f.key))

  // Spreadsheet rows as the import functions expect them (row = line number in the file).
  const payload = () => data.map((r, i) => {
    const o: Record<string, unknown> = { row: i + 2 }
    const custom: Record<string, string> = {}
    mapping.forEach((key, c) => {
      if (!key || !r[c]) return
      if (key.startsWith('cf:')) custom[key.slice(3)] = r[c]
      else o[key] = r[c]
    })
    if (Object.keys(custom).length) o.custom = custom
    return o
  })

  const run = async (commit: boolean) => {
    if (missingRequired.length) { setError(`Match a column to ${missingRequired.map((f) => f.label).join(', ')} first.`); return }
    setBusy(commit ? 'importing' : 'checking')
    setError(null)
    setProgress(0)
    const rows = payload()
    const all: ImportResult[] = []
    const allowed = Object.fromEntries(CREATE_OPTIONS.filter((o) => o.entities.includes(entity)).map((o) => [o.key, !!create[o.key] && (!o.admin || admin)]))
    for (let i = 0; i < rows.length; i += CHUNK) {
      const { results: part, error: err } = await itInventory.importRows(entity, rows.slice(i, i + CHUNK), commit, allowed)
      if (err) { setBusy(null); setError(friendlyError(err)); return }
      all.push(...part)
      setProgress(Math.min(rows.length, i + CHUNK) / rows.length)
    }
    setResults(all)
    setBusy(null)
    if (!commit) { setStep('checked'); return }
    setStep('done')
    void reloadRefs() // new manufacturers, models, areas...
    if (profile) {
      const errors = all.filter((r) => r.action === 'error')
      const reportPath = errors.length ? await itInventory.uploadImportReport(profile.account_id, errorReportCsv(errors)) : null
      void itInventory.logImport({
        entity, file: fileName, rows: all.length,
        created: all.filter((r) => r.action === 'create').length,
        updated: all.filter((r) => r.action === 'update').length,
        errors: errors.length, report_path: reportPath,
      })
    }
  }

  const errorReportCsv = (errors: ImportResult[]) => {
    const byRow = new Map(errors.map((e) => [e.row, e.error ?? '']))
    return toCsv([[...headers, 'Problem'], ...data.flatMap((r, i) => (byRow.has(i + 2) ? [[...r, friendlyError(byRow.get(i + 2) ?? '')]] : []))])
  }
  const downloadErrors = () => {
    const errors = results.filter((r) => r.action === 'error')
    const byRow = new Map(errors.map((e) => [e.row, e.error ?? '']))
    downloadCsv(`import-problems-${format(new Date(), 'yyyy-MM-dd')}`, [
      [...headers, 'Problem'],
      ...data.flatMap((r, i) => (byRow.has(i + 2) ? [[...r, friendlyError(byRow.get(i + 2) ?? '')]] : [])),
    ])
  }
  const downloadTemplate = () => {
    const fs = IMPORT_FIELDS[entity]
    downloadCsv(`it-inventory-${entity}-template`, [fs.map((f) => f.label), fs.map((f) => f.example ?? '')])
  }

  const printNew = async () => {
    const ids = new Set(results.filter((r) => r.action === 'create' && r.asset_id).map((r) => r.asset_id as string))
    const { data: list } = await itInventory.listAssets()
    setPrintAssets(list.filter((a) => ids.has(a.id)))
  }

  const counts = {
    create: results.filter((r) => r.action === 'create').length,
    update: results.filter((r) => r.action === 'update').length,
    error: results.filter((r) => r.action === 'error').length,
  }
  const preview = data.slice(0, 20)
  const resultFor = (row: number) => results.find((r) => r.row === row)
  const shownCols = mapping.map((m, i) => ({ m, i })).filter((x) => x.m)

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to="/app/it-inventory" className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> IT Inventory
      </Link>
      <div className="mt-3">
        <PageHeader title="Import from a spreadsheet"
          subtitle="Bring in a list from Excel or a CSV. Nothing is saved until you check the file and choose Import." />
      </div>

      <section className="mt-5 rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="What's in the file" className="w-full sm:w-56">
            {(id) => (
              <Select id={id} value={entity} onChange={(e) => reset(e.target.value as ImportEntity)} disabled={!!busy}>
                {(Object.keys(ENTITY_LABEL) as ImportEntity[]).map((k) => <option key={k} value={k}>{ENTITY_LABEL[k]}</option>)}
              </Select>
            )}
          </Field>
          <input ref={fileInput} type="file" accept=".csv,.xlsx,.xls,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickFile(f); e.target.value = '' }} />
          <Button onClick={() => fileInput.current?.click()} disabled={!!busy}>
            {busy === 'reading' ? <Loader2 className="size-4 animate-spin" /> : <FileUp className="size-4" />} {fileName ? 'Pick another file' : 'Pick a file'}
          </Button>
          <Button variant="ghost" onClick={downloadTemplate}><Download className="size-4" /> Download a template</Button>
        </div>
        {fileName && <p className="mt-3 text-sm text-ink-muted"><span className="font-medium text-ink">{fileName}</span>: {data.length} row{data.length === 1 ? '' : 's'}.</p>}
      </section>

      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

      {headers.length > 0 && step !== 'done' && (
        <section className="mt-5 rounded-md border border-border bg-card p-4">
          <h2 className="text-sm font-semibold text-ink">Match the columns</h2>
          <p className="mt-1 text-xs text-ink-muted">We matched what we could. Fix anything that's wrong, or set a column to "Don't import".</p>
          <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {headers.map((h, i) => (
              <div key={i} className="flex items-center gap-2">
                <span className="w-32 shrink-0 truncate text-sm text-ink" title={h}>{h || `Column ${i + 1}`}</span>
                <Select value={mapping[i] ?? ''} className="h-9"
                  onChange={(e) => {
                    const v = e.target.value
                    setMapping((m) => m.map((x, j) => (j === i ? v : x === v && v ? '' : x)))
                    setStep('file')
                  }}>
                  <option value="">Don't import</option>
                  {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? ' (required)' : ''}</option>)}
                </Select>
              </div>
            ))}
          </div>
          {missingRequired.length > 0 && (
            <p className="mt-3 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              Every row needs {missingRequired.map((f) => f.label).join(' and ')}. Match a column to it.
            </p>
          )}

          <h2 className="mt-5 text-sm font-semibold text-ink">If something in the file is new</h2>
          <p className="mt-1 text-xs text-ink-muted">Allow these to be added. Otherwise rows that mention them are skipped.</p>
          <div className="mt-2 flex flex-wrap gap-x-5 gap-y-2">
            {CREATE_OPTIONS.filter((o) => o.entities.includes(entity)).map((o) => (
              <label key={o.key} className={cn('flex items-center gap-2 text-sm', o.admin && !admin ? 'text-ink-subtle' : 'text-ink')}>
                <input type="checkbox" checked={!!create[o.key] && (!o.admin || admin)} disabled={o.admin && !admin}
                  onChange={(e) => { setCreate((c) => ({ ...c, [o.key]: e.target.checked })); setStep('file') }}
                  className="size-4 rounded border-border text-accent focus:ring-accent" />
                {o.label}{o.admin && !admin ? ' (admins only)' : ''}
              </label>
            ))}
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button variant={step === 'checked' ? 'secondary' : 'primary'} onClick={() => void run(false)} disabled={!!busy || !data.length}>
              {busy === 'checking' ? <Loader2 className="size-4 animate-spin" /> : null} Check the file
            </Button>
            {step === 'checked' && (
              <Button onClick={() => void run(true)} disabled={!!busy || counts.create + counts.update === 0}>
                {busy === 'importing' ? <Loader2 className="size-4 animate-spin" /> : null}
                Import {counts.create + counts.update} row{counts.create + counts.update === 1 ? '' : 's'}
              </Button>
            )}
            {busy && data.length > CHUNK && (
              <div className="flex w-40 items-center gap-2 text-xs text-ink-muted">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-content"><div className="h-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} /></div>
                {Math.round(progress * 100)}%
              </div>
            )}
          </div>
        </section>
      )}

      {results.length > 0 && (
        <section className="mt-5 rounded-md border border-border bg-card p-4">
          {step === 'done' ? (
            <p className="flex items-start gap-2 text-sm text-ok">
              <CircleCheck className="mt-0.5 size-4 shrink-0" />
              Imported. {counts.create} added, {counts.update} updated{counts.error ? `, ${counts.error} skipped` : ''}.
            </p>
          ) : (
            <p className="text-sm text-ink">
              Checked: <span className="font-medium">{counts.create} new</span>, <span className="font-medium">{counts.update} updates</span>
              {counts.error > 0 && <>, <span className="font-medium text-danger">{counts.error} with problems</span> (they'll be skipped)</>}. Nothing is saved yet.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {counts.error > 0 && <Button size="sm" variant="secondary" onClick={downloadErrors}><TriangleAlert className="size-4" /> Download the problems</Button>}
            {step === 'done' && entity === 'assets' && counts.create > 0 && (
              <Button size="sm" onClick={() => void printNew()}><Printer className="size-4" /> Print stickers for the {counts.create} new</Button>
            )}
            {step === 'done' && <Button size="sm" variant="secondary" onClick={() => navigate('/app/it-inventory')}>Go to the list</Button>}
          </div>

          {step !== 'done' && (
            <>
              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">First {preview.length} rows</h3>
              <div className="mt-2 overflow-x-auto rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="border-b border-border bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                    <tr>
                      <th className="px-3 py-2 font-medium">Row</th>
                      <th className="px-3 py-2 font-medium">Result</th>
                      {shownCols.map(({ m, i }) => <th key={i} className="px-3 py-2 font-medium">{fields.find((f) => f.key === m)?.label ?? m}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {preview.map((r, i) => {
                      const res = resultFor(i + 2)
                      return (
                        <tr key={i} className={res?.action === 'error' ? 'bg-danger-soft/50' : undefined}>
                          <td className="px-3 py-2 tabular-nums text-ink-muted">{i + 2}</td>
                          <td className="px-3 py-2">
                            {res?.action === 'error' ? <span className="text-xs text-danger">{friendlyError(res.error ?? '')}</span>
                              : res ? <Badge tone={res.action === 'create' ? 'ok' : 'accent'}>{res.action === 'create' ? 'New' : 'Update'}</Badge> : null}
                          </td>
                          {shownCols.map(({ i: c }) => <td key={c} className="max-w-[220px] truncate px-3 py-2 text-ink">{r[c]}</td>)}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {counts.error > 0 && (
                <>
                  <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Every problem</h3>
                  <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto text-sm">
                    {results.filter((r) => r.action === 'error').map((r) => (
                      <li key={r.row} className="text-ink"><span className="tabular-nums text-ink-muted">Row {r.row}:</span> {friendlyError(r.error ?? '')}</li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </section>
      )}

      {printAssets && refs && (
        <PrintDialog refs={refs} assets={printAssets} onClose={() => setPrintAssets(null)}
          onPrinted={() => { setPrintAssets(null); navigate('/app/it-inventory') }} />
      )}
    </div>
  )
}
