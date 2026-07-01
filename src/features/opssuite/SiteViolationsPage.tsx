import { useEffect, useMemo, useState } from 'react'
import { Download, Plus, ShieldAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { EmptyState } from '@/components/ui/EmptyState'
import { shortDate } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useLocations } from '@/lib/locations'
import { siteViolations, type SiteViolation } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { AddViolationModal } from './violations/AddViolationModal'
import {
  ALL_VIOLATION_TYPES,
  DEPARTMENTS,
  DEPARTMENT_COLOR,
  groupLocationsByRegion,
} from './violations/config'

type Row = SiteViolation & { location: { name: string } | null }

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Department', value: (r) => r.department },
  { header: 'Violation Type', value: (r) => r.violation_type },
  { header: 'Notes', value: (r) => r.description },
  { header: 'Reported by', value: (r) => r.reported_by_name },
  { header: 'Reported', value: (r) => shortDate(r.reported_at) },
]

export default function SiteViolationsPage() {
  const { locations } = useLocations()
  const [rows, setRows] = useState<Row[]>([])
  const [adding, setAdding] = useState(false)

  const load = () =>
    siteViolations.list().then(({ data }) => setRows((data as unknown as Row[]) ?? []))
  useEffect(() => { void load() }, [])

  const groups = useMemo(() => groupLocationsByRegion(locations), [locations])
  const allSiteIds = useMemo(
    () => groups.flatMap((g) => g.locations.map((l) => l.id)),
    [groups],
  )

  // Filter selections (default: everything selected).
  const [sites, setSites] = useState<Set<string>>(new Set())
  const [depts, setDepts] = useState<Set<string>>(new Set(DEPARTMENTS))
  const [types, setTypes] = useState<Set<string>>(new Set(ALL_VIOLATION_TYPES))
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [report, setReport] = useState<Row[] | null>(null)

  useEffect(() => {
    if (allSiteIds.length) setSites(new Set(allSiteIds))
  }, [allSiteIds])

  const deptCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const d of DEPARTMENTS) c[d] = 0
    for (const r of rows) if (r.department) c[r.department] = (c[r.department] ?? 0) + 1
    return c
  }, [rows])

  const computeFiltered = (): Row[] =>
    rows.filter((r) => {
      if (!r.location_id || !sites.has(r.location_id)) return false
      if (!depts.has(r.department ?? '')) return false
      if (!types.has(r.violation_type ?? '')) return false
      const day = r.reported_at.slice(0, 10)
      if (from && day < from) return false
      if (to && day > to) return false
      return true
    })

  const toggle = (
    setFn: React.Dispatch<React.SetStateAction<Set<string>>>,
    key: string,
  ) =>
    setFn((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const quickRange = (span: 'month' | 'year') => {
    const now = new Date()
    const start =
      span === 'month'
        ? new Date(now.getFullYear(), now.getMonth(), 1)
        : new Date(now.getFullYear(), 0, 1)
    setFrom(start.toISOString().slice(0, 10))
    setTo(now.toISOString().slice(0, 10))
  }

  const cards = [
    { label: 'Total Violations', value: rows.length, color: DEPARTMENT_COLOR.Total },
    ...DEPARTMENTS.map((d) => ({
      label: d,
      value: deptCounts[d] ?? 0,
      color: DEPARTMENT_COLOR[d],
    })),
  ]

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Violations"
        subtitle="Log site violations and generate reports across regions and departments."
        actions={
          <Button onClick={() => setAdding(true)}>
            <Plus className="size-4" /> Add Site Violation
          </Button>
        }
      />

      {/* Department stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border bg-card p-5">
            <span
              className="block h-1 w-8 rounded-full"
              style={{ backgroundColor: c.color }}
            />
            <p className="mt-3 text-3xl font-semibold tracking-tight text-ink">{c.value}</p>
            <p className="mt-1 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              {c.label}
            </p>
          </div>
        ))}
      </div>

      {/* Generate report */}
      <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
        <h2 className="text-base font-semibold text-ink">Generate Report</h2>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-4">
          {/* Regions / sites */}
          <FilterColumn title="Regions / Sites">
            <div className="max-h-72 overflow-y-auto rounded-md border border-border p-2">
              <CheckRow
                label="Select All"
                checked={sites.size === allSiteIds.length && allSiteIds.length > 0}
                onChange={() =>
                  setSites((prev) =>
                    prev.size === allSiteIds.length ? new Set() : new Set(allSiteIds),
                  )
                }
                strong
              />
              {groups.map((g) => {
                const ids = g.locations.map((l) => l.id)
                const allOn = ids.every((id) => sites.has(id))
                return (
                  <div key={g.region} className="mt-1">
                    <CheckRow
                      label={g.region}
                      checked={allOn}
                      onChange={() =>
                        setSites((prev) => {
                          const next = new Set(prev)
                          if (allOn) ids.forEach((id) => next.delete(id))
                          else ids.forEach((id) => next.add(id))
                          return next
                        })
                      }
                      accent
                    />
                    <div className="ml-4">
                      {g.locations.map((l) => (
                        <CheckRow
                          key={l.id}
                          label={l.name}
                          checked={sites.has(l.id)}
                          onChange={() => toggle(setSites, l.id)}
                        />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          </FilterColumn>

          {/* Departments */}
          <FilterColumn title="Departments">
            <div className="rounded-md border border-border p-2">
              {DEPARTMENTS.map((d) => (
                <CheckRow
                  key={d}
                  label={d}
                  checked={depts.has(d)}
                  onChange={() => toggle(setDepts, d)}
                />
              ))}
            </div>
          </FilterColumn>

          {/* Violation types */}
          <FilterColumn title="Violation Types">
            <div className="max-h-72 overflow-y-auto rounded-md border border-border p-2">
              <CheckRow
                label="Select All"
                checked={types.size === ALL_VIOLATION_TYPES.length}
                onChange={() =>
                  setTypes((prev) =>
                    prev.size === ALL_VIOLATION_TYPES.length
                      ? new Set()
                      : new Set(ALL_VIOLATION_TYPES),
                  )
                }
                strong
              />
              {ALL_VIOLATION_TYPES.map((t) => (
                <CheckRow
                  key={t}
                  label={t}
                  checked={types.has(t)}
                  onChange={() => toggle(setTypes, t)}
                />
              ))}
            </div>
          </FilterColumn>

          {/* Date range + quick reports */}
          <FilterColumn title="Date Range">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col gap-2">
                <Input
                  type="date"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  aria-label="From date"
                  className="min-w-0"
                />
                <span className="text-center text-xs text-ink-muted">to</span>
                <Input
                  type="date"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  aria-label="To date"
                  className="min-w-0"
                />
              </div>
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-ink-subtle">
                  Quick Reports
                </p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" onClick={() => quickRange('month')}>
                    Monthly
                  </Button>
                  <Button variant="secondary" size="sm" onClick={() => quickRange('year')}>
                    Yearly
                  </Button>
                </div>
              </div>
            </div>
          </FilterColumn>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <Button onClick={() => setReport(computeFiltered())}>View Report</Button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => exportExcel('violations', EXPORT_COLUMNS, computeFiltered())}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-ok px-4 text-sm font-medium text-white transition hover:opacity-90"
            >
              <Download className="size-4" /> Export Excel
            </button>
            <button
              type="button"
              onClick={() => exportPdf('Violations', EXPORT_COLUMNS, computeFiltered())}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-danger px-4 text-sm font-medium text-white transition hover:opacity-90"
            >
              <Download className="size-4" /> Export PDF
            </button>
          </div>
        </div>
      </div>

      {/* Report results */}
      {report && (
        <div className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold text-ink">
            Report results
            <span className="ml-2 text-ink-muted">{report.length}</span>
          </h2>
          {report.length === 0 ? (
            <EmptyState
              icon={ShieldAlert}
              title="No violations match"
              description="Adjust the filters or date range and generate again."
            />
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-card">
              <table className="w-full min-w-[820px] text-sm">
                <thead className="border-b border-border bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">Site</th>
                    <th className="px-4 py-3 font-medium">Department</th>
                    <th className="px-4 py-3 font-medium">Violation Type</th>
                    <th className="px-4 py-3 font-medium">Notes</th>
                    <th className="px-4 py-3 font-medium">Reported by</th>
                    <th className="px-4 py-3 font-medium">Reported</th>
                  </tr>
                </thead>
                <tbody>
                  {report.map((r) => (
                    <tr key={r.id} className="border-t border-border hover:bg-content">
                      <td className="px-4 py-3 font-medium text-ink">
                        {r.location?.name ?? '—'}
                      </td>
                      <td className="px-4 py-3 text-ink-muted">{r.department ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-muted">{r.violation_type ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-muted">{r.description ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-muted">{r.reported_by_name ?? '—'}</td>
                      <td className="px-4 py-3 text-ink-muted">{shortDate(r.reported_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {adding && (
        <AddViolationModal
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            void load()
          }}
        />
      )}
    </div>
  )
}

function FilterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">{title}</p>
      {children}
    </div>
  )
}

function CheckRow({
  label,
  checked,
  onChange,
  strong,
  accent,
}: {
  label: string
  checked: boolean
  onChange: () => void
  strong?: boolean
  accent?: boolean
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 hover:bg-content">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        className="size-4 rounded border-border text-accent focus:ring-accent"
      />
      <span
        className={cn(
          'text-sm',
          accent
            ? 'font-semibold uppercase tracking-wide text-accent'
            : strong
              ? 'font-medium text-ink'
              : 'text-ink',
        )}
      >
        {label}
      </span>
    </label>
  )
}
