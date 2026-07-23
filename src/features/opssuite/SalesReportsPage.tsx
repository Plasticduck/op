import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Loader2,
  Upload,
  X,
} from 'lucide-react'
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { salesReports, type SalesReportFile } from '@/lib/queries/salesReports'

const iso = (d: Date) => format(d, 'yyyy-MM-dd')
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
  const [anchor, setAnchor] = useState<Date>(() => new Date())
  const [reports, setReports] = useState<SalesReportFile[]>([])
  const [monthReports, setMonthReports] = useState<SalesReportFile[]>([])
  const [loading, setLoading] = useState(false)
  const [uploadingDate, setUploadingDate] = useState<string | null>(null)
  const [uploadingMonth, setUploadingMonth] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmTarget, setConfirmTarget] = useState<SalesReportFile | null>(null)
  const [deleting, setDeleting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadTargetRef = useRef<{ kind: 'day' | 'month'; key: string } | null>(null)

  const siteName = locations.find((l) => l.id === locationId)?.name ?? ''

  // Default to the first available site once locations load.
  useEffect(() => {
    if (!locationId && locations.length > 0) setLocationId(locations[0].id)
  }, [locations, locationId])

  // The visible grid spans whole weeks, so include leading/trailing days.
  const days = useMemo(() => {
    const gridStart = startOfWeek(startOfMonth(anchor))
    const gridEnd = endOfWeek(endOfMonth(anchor))
    return eachDayOfInterval({ start: gridStart, end: gridEnd })
  }, [anchor])

  const load = useCallback(() => {
    if (!locationId || days.length === 0) {
      setReports([])
      setMonthReports([])
      return
    }
    setLoading(true)
    Promise.all([
      salesReports.listRange(locationId, iso(days[0]), iso(days[days.length - 1])),
      salesReports.listMonth(locationId, format(anchor, 'yyyy-MM')),
    ]).then(([range, month]) => {
      setReports((range.data as SalesReportFile[] | null) ?? [])
      setMonthReports((month.data as SalesReportFile[] | null) ?? [])
      setLoading(false)
    })
  }, [locationId, days, anchor])

  useEffect(() => { load() }, [load])

  // Group uploaded reports by their report day.
  const byDate = useMemo(() => {
    const m = new Map<string, SalesReportFile[]>()
    for (const r of reports) {
      const arr = m.get(r.label) ?? []
      arr.push(r)
      m.set(r.label, arr)
    }
    return m
  }, [reports])

  const pick = (target: { kind: 'day' | 'month'; key: string }) => {
    if (!locationId) {
      setError('Choose a site first.')
      return
    }
    setError(null)
    uploadTargetRef.current = target
    fileInputRef.current?.click()
  }
  const pickDay = (dayIso: string) => pick({ kind: 'day', key: dayIso })
  const pickMonth = () => pick({ kind: 'month', key: format(anchor, 'yyyy-MM') })

  const onFilesChosen = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    const target = uploadTargetRef.current
    if (!list.length || !target || !locationId || !profile) return
    setError(null)
    if (target.kind === 'month') setUploadingMonth(true)
    else setUploadingDate(target.key)
    for (const file of list) {
      const dataUri = await fileToDataUri(file)
      const { error: err } =
        target.kind === 'month'
          ? await salesReports.uploadMonth({
              account_id: profile.account_id,
              location_id: locationId,
              report_month: target.key,
              file_name: file.name,
              file_type: file.type,
              data_uri: dataUri,
            })
          : await salesReports.upload({
              account_id: profile.account_id,
              location_id: locationId,
              report_date: target.key,
              file_name: file.name,
              file_type: file.type,
              data_uri: dataUri,
            })
      if (err) {
        setUploadingMonth(false)
        setUploadingDate(null)
        setError(err.message)
        return
      }
    }
    setUploadingMonth(false)
    setUploadingDate(null)
    load()
  }

  // Fetch the stored file and trigger a download with its original name.
  const downloadFile = async (r: SalesReportFile) => {
    const { data } = await salesReports.getDataUri(r.id)
    const uri = (data as { data_uri?: string } | null)?.data_uri
    if (!uri) return
    const res = await fetch(uri)
    const blob = await res.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = r.file_name ?? 'sales-report'
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }

  const confirmRemove = async () => {
    if (!confirmTarget) return
    setDeleting(true)
    const { error: err } = await salesReports.remove(confirmTarget.id)
    setDeleting(false)
    setConfirmTarget(null)
    if (err) return setError(err.message)
    load()
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Sales Reports"
        subtitle="Upload each day's sales report onto the calendar. Uploaded files stay on the day, ready to download."
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <Field label="Site" className="w-full sm:w-64">
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
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="icon" onClick={() => setAnchor((a) => subMonths(a, 1))}>
            <ChevronLeft className="size-4" />
          </Button>
          <span className="min-w-[10rem] text-center text-sm font-medium text-ink">
            {format(anchor, 'MMMM yyyy')}
          </span>
          <Button variant="secondary" size="icon" onClick={() => setAnchor((a) => addMonths(a, 1))}>
            <ChevronRight className="size-4" />
          </Button>
          {loading && <Loader2 className="size-4 animate-spin text-ink-subtle" />}
        </div>
      </div>

      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="application/pdf,image/*,.csv,.xls,.xlsx,text/csv"
        className="hidden"
        onChange={(e) => {
          void onFilesChosen(e.target.files)
          e.target.value = ''
        }}
      />

      {error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {/* Whole-month report for this site + month */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Monthly report</h2>
            <p className="text-xs text-ink-muted">
              The full-month sales report for {siteName || 'this site'}, {format(anchor, 'MMMM yyyy')}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {monthReports.map((r) => (
              <div key={r.id} className="group flex items-center gap-1 rounded bg-accent-soft px-2 py-1">
                <button
                  type="button"
                  onClick={() => void downloadFile(r)}
                  title={`Download ${r.file_name ?? 'report'}`}
                  className="flex min-w-0 items-center gap-1 text-left"
                >
                  <FileText className="size-3.5 shrink-0 text-accent" />
                  <span className="max-w-[180px] truncate text-xs font-medium text-accent">
                    {r.file_name ?? 'Report'}
                  </span>
                </button>
                {isOwner && (
                  <button
                    type="button"
                    onClick={() => setConfirmTarget(r)}
                    title="Remove"
                    className="rounded p-0.5 text-accent hover:text-danger"
                  >
                    <X className="size-3" />
                  </button>
                )}
              </div>
            ))}
            <Button variant="secondary" size="sm" onClick={pickMonth} disabled={uploadingMonth}>
              {uploadingMonth ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Upload monthly report
            </Button>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="min-w-[760px]">
          <div className="grid grid-cols-7 border-b border-border text-xs font-medium uppercase tracking-wide text-ink-muted">
            {WEEKDAYS.map((w) => (
              <div key={w} className="px-2 py-2">{w}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const dayIso = iso(d)
              const inMonth = isSameMonth(d, anchor)
              const dayReports = byDate.get(dayIso) ?? []
              return (
                <div
                  key={dayIso}
                  className={cn(
                    'flex min-h-[108px] flex-col gap-1 border-b border-r border-border p-1.5 [&:nth-child(7n)]:border-r-0',
                    !inMonth && 'bg-content/40',
                  )}
                >
                  <div className="flex items-center justify-between">
                    <span
                      className={cn(
                        'grid size-6 place-items-center rounded-full text-xs font-medium',
                        isToday(d) ? 'bg-accent text-ink-invert' : 'text-ink',
                        !inMonth && 'text-ink-subtle',
                      )}
                    >
                      {format(d, 'd')}
                    </span>
                    {inMonth && (
                      <button
                        type="button"
                        onClick={() => pickDay(dayIso)}
                        title="Upload this day's report"
                        disabled={uploadingDate === dayIso}
                        className="rounded p-1 text-ink-subtle hover:bg-content hover:text-accent"
                      >
                        {uploadingDate === dayIso ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <Upload className="size-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-1">
                    {dayReports.map((r) => (
                      <div
                        key={r.id}
                        className="group flex items-center gap-1 rounded bg-accent-soft px-1.5 py-1"
                      >
                        <button
                          type="button"
                          onClick={() => void downloadFile(r)}
                          title={`Download ${r.file_name ?? 'report'}`}
                          className="flex min-w-0 flex-1 items-center gap-1 text-left"
                        >
                          <FileText className="size-3 shrink-0 text-accent" />
                          <span className="truncate text-[11px] font-medium text-accent">
                            {r.file_name ?? 'Report'}
                          </span>
                        </button>
                        {isOwner && (
                          <button
                            type="button"
                            onClick={() => setConfirmTarget(r)}
                            title="Remove"
                            className="hidden rounded p-0.5 text-accent hover:text-danger group-hover:block"
                          >
                            <X className="size-3" />
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <Modal
        open={confirmTarget != null}
        onClose={() => (deleting ? undefined : setConfirmTarget(null))}
        title="Delete sales report?"
        size="sm"
      >
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-muted">
            This permanently deletes{' '}
            <span className="font-medium text-ink">{confirmTarget?.file_name ?? 'this report'}</span>
            {confirmTarget?.label ? (
              <> for <span className="font-medium text-ink">{confirmTarget.label}</span></>
            ) : null}
            . This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmTarget(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => void confirmRemove()} disabled={deleting}>
              {deleting && <Loader2 className="size-4 animate-spin" />} Delete
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
