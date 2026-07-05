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
  const [loading, setLoading] = useState(false)
  const [uploadingDate, setUploadingDate] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const uploadDateRef = useRef<string | null>(null)

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
      return
    }
    setLoading(true)
    salesReports
      .listRange(locationId, iso(days[0]), iso(days[days.length - 1]))
      .then(({ data }) => {
        setReports((data as SalesReportFile[] | null) ?? [])
        setLoading(false)
      })
  }, [locationId, days])

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

  const pickDay = (dayIso: string) => {
    if (!locationId) {
      setError('Choose a site first.')
      return
    }
    setError(null)
    uploadDateRef.current = dayIso
    fileInputRef.current?.click()
  }

  const onFilesChosen = async (files: FileList | null) => {
    const list = Array.from(files ?? [])
    const date = uploadDateRef.current
    if (!list.length || !date || !locationId || !profile) return
    setError(null)
    setUploadingDate(date)
    for (const file of list) {
      const dataUri = await fileToDataUri(file)
      const { error: err } = await salesReports.upload({
        account_id: profile.account_id,
        location_id: locationId,
        report_date: date,
        file_name: file.name,
        file_type: file.type,
        data_uri: dataUri,
      })
      if (err) {
        setUploadingDate(null)
        setError(err.message)
        return
      }
    }
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

  const removeReport = async (id: string) => {
    const { error: err } = await salesReports.remove(id)
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
                            onClick={() => void removeReport(r.id)}
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
    </div>
  )
}
