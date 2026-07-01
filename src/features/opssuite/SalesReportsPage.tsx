import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Loader2, Trash2, Upload } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { shortDate } from '@/lib/format'
import { salesReports, type SalesReportFile } from '@/lib/queries/salesReports'

function todayIso() {
  return new Date().toISOString().slice(0, 10)
}

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

export default function SalesReportsPage() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const isOwner = profile?.role === 'owner'

  const [locationId, setLocationId] = useState('')
  const [reportDate, setReportDate] = useState(todayIso)
  const [pending, setPending] = useState<File[]>([])
  const [uploaded, setUploaded] = useState<SalesReportFile[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Default to the first available site once locations load.
  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id)
  }, [locations, locationId])

  const load = useCallback(() => {
    if (!locationId || !reportDate) {
      setUploaded([])
      return
    }
    setLoading(true)
    salesReports.list(locationId, reportDate).then(({ data }) => {
      setUploaded((data as SalesReportFile[] | null) ?? [])
      setLoading(false)
    })
  }, [locationId, reportDate])

  useEffect(() => { load() }, [load])

  const addFiles = (files: FileList | null) => {
    const list = Array.from(files ?? [])
    if (list.length > 0) setPending((prev) => [...prev, ...list])
  }

  const upload = async () => {
    setError(null)
    if (!profile) return
    if (!locationId) return setError('Choose a site first.')
    if (pending.length === 0) return setError('Choose at least one file.')
    setBusy(true)
    for (const file of pending) {
      const dataUri = await fileToDataUri(file)
      const { error: err } = await salesReports.upload({
        account_id: profile.account_id,
        location_id: locationId,
        report_date: reportDate,
        file_name: file.name,
        file_type: file.type,
        data_uri: dataUri,
      })
      if (err) {
        setBusy(false)
        return setError(err.message)
      }
    }
    setBusy(false)
    setPending([])
    load()
  }

  const openFile = async (id: string) => {
    const { data } = await salesReports.getDataUri(id)
    const uri = (data as { data_uri?: string } | null)?.data_uri
    if (!uri) return
    const res = await fetch(uri)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    window.open(url, '_blank', 'noopener')
  }

  const removeUploaded = async (id: string) => {
    const { error: err } = await salesReports.remove(id)
    if (err) return setError(err.message)
    load()
  }

  const siteName = locations.find((l) => l.id === locationId)?.name ?? ''

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales Reports"
        subtitle="Upload your general sales reports for the day."
      />

      {/* Upload */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Site">
            {(id) => (
              <Select
                id={id}
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
                disabled={locations.length === 0}
              >
                {locations.length === 0 && <option value="">No sites</option>}
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Report date">
            {(id) => (
              <Input
                id={id}
                type="date"
                value={reportDate}
                onChange={(e) => setReportDate(e.target.value)}
              />
            )}
          </Field>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="application/pdf,image/*,.csv,.xls,.xlsx,text/csv"
          className="hidden"
          onChange={(e) => {
            addFiles(e.target.files)
            e.target.value = ''
          }}
        />
        <div>
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>
            <Upload className="size-4" /> Choose files
          </Button>
        </div>

        {pending.length > 0 && (
          <ul className="flex flex-col gap-1 rounded-md border border-border bg-content px-3 py-2 text-sm">
            {pending.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center justify-between gap-2">
                <span className="truncate text-ink">{f.name}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setPending((prev) => prev.filter((_, idx) => idx !== i))}
                >
                  <Trash2 className="size-4" /> Remove
                </Button>
              </li>
            ))}
          </ul>
        )}

        {error && (
          <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
        )}

        <div className="flex justify-end">
          <Button onClick={upload} disabled={busy || pending.length === 0}>
            {busy ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Uploading…
              </>
            ) : (
              <>
                <Upload className="size-4" /> Upload{' '}
                {pending.length > 0 ? `${pending.length} file${pending.length > 1 ? 's' : ''}` : ''}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Uploaded for the selected site + day */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-ink">
          Uploaded for {siteName || 'this site'} on {shortDate(reportDate)}
        </h2>
        {loading ? (
          <p className="text-sm text-ink-muted">Loading…</p>
        ) : uploaded.length === 0 ? (
          <EmptyState
            icon={FileText}
            title="No reports uploaded"
            description="Sales reports uploaded for this site and day will appear here."
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {uploaded.map((f) => (
              <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-3">
                <button
                  type="button"
                  onClick={() => openFile(f.id)}
                  className="flex min-w-0 items-center gap-3 text-left"
                >
                  <FileText className="size-4 shrink-0 text-ink-subtle" />
                  <span className="truncate text-sm font-medium text-ink hover:text-accent">
                    {f.file_name ?? 'Report'}
                  </span>
                </button>
                <div className="flex items-center gap-3">
                  <span className="whitespace-nowrap text-xs text-ink-muted">
                    {shortDate(f.created_at)}
                  </span>
                  {isOwner && (
                    <Button variant="ghost" size="sm" onClick={() => removeUploaded(f.id)}>
                      <Trash2 className="size-4" />
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
