import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { BarChart3, Star, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { savedReports, type SavedReport } from '@/lib/queries/reports'
import { REPORTS } from '../registry'

// The "Library" tab brings back the pre-built reports we had before the
// MaintainX-style Reporting rebuild. Each card opens the per-report page at
// /app/reports/:reportKey where the user can pick a date range, location,
// sort, and export to CSV/PDF.

export function LibraryTab() {
  const [favorites, setFavorites] = useState<SavedReport[]>([])

  useEffect(() => {
    void (async () => {
      const { data } = await savedReports.list()
      setFavorites((data as SavedReport[] | null) ?? [])
    })()
  }, [])

  const ops = REPORTS.filter((r) => r.module === 'ops')
  const people = REPORTS.filter((r) => r.module === 'people')

  return (
    <div className="flex flex-col gap-6">
      {favorites.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-ink">Favorites</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {favorites.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-md border border-border bg-card p-3">
                <Link to={`/app/reports/${f.report_key}`} className="flex items-center gap-2 text-sm font-medium text-ink hover:text-accent">
                  <Star className="size-4 text-warn" /> {f.name}
                </Link>
                <button
                  type="button"
                  onClick={async () => { await savedReports.remove(f.id); setFavorites((prev) => prev.filter((p) => p.id !== f.id)) }}
                  className="text-ink-subtle hover:text-danger"
                  aria-label="Remove favorite"
                ><Trash2 className="size-4" /></button>
              </div>
            ))}
          </div>
        </section>
      )}

      <ReportSection title="Operations" reports={ops} />
      <ReportSection title="People" reports={people} />
    </div>
  )
}

function ReportSection({ title, reports }: { title: string; reports: typeof REPORTS }) {
  if (reports.length === 0) return null
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {reports.map((r) => (
          <Link
            key={r.key}
            to={`/app/reports/${r.key}`}
            className="group flex flex-col gap-1 rounded-md border border-border bg-card p-4 hover:border-accent/40"
          >
            <div className="flex items-center justify-between">
              <span className="grid size-8 place-items-center rounded-md bg-accent/15 text-accent">
                <BarChart3 className="size-4" />
              </span>
              <Badge tone="neutral">{r.module}</Badge>
            </div>
            <h3 className="mt-1 text-sm font-semibold text-ink group-hover:text-accent">{r.title}</h3>
            <p className="text-xs text-ink-muted">{r.description}</p>
          </Link>
        ))}
      </div>
    </section>
  )
}
