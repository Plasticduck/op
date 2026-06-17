import { CalendarRange, FileSpreadsheet, FileText, ArrowDownWideNarrow } from 'lucide-react'
import { Select } from '@/components/ui/Select'
import { Button } from '@/components/ui/Button'
import { RANGE_OPTIONS, type RangeKey } from '@/lib/dateRanges'
import type { SortKey } from './useOpsTable'

// Toolbar shared by all Ops Suite pages: Quick Reports timeframe, sort order,
// and Export to PDF / Excel of the currently-shown rows.
export function OpsToolbar({
  range, onRange, sort, onSort, onExportPdf, onExportExcel, count, disableExport,
}: {
  range: RangeKey
  onRange: (r: RangeKey) => void
  sort: SortKey
  onSort: (s: SortKey) => void
  onExportPdf: () => void
  onExportExcel: () => void
  count: number
  disableExport?: boolean
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card px-3 py-3">
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5" /> Quick Reports</span>
        <Select value={range} onChange={(e) => onRange(e.target.value as RangeKey)} className="h-9 w-44">
          {RANGE_OPTIONS.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
        <span className="inline-flex items-center gap-1"><ArrowDownWideNarrow className="size-3.5" /> Sort</span>
        <Select value={sort} onChange={(e) => onSort(e.target.value as SortKey)} className="h-9 w-40">
          <option value="newest">Newest first</option>
          <option value="oldest">Oldest first</option>
        </Select>
      </label>
      <span className="pb-2 text-xs text-ink-subtle">{count} record{count === 1 ? '' : 's'}</span>
      <div className="ml-auto flex items-end gap-2">
        <Button variant="secondary" size="sm" onClick={onExportPdf} disabled={disableExport || count === 0}>
          <FileText className="size-4" /> PDF
        </Button>
        <Button variant="secondary" size="sm" onClick={onExportExcel} disabled={disableExport || count === 0}>
          <FileSpreadsheet className="size-4" /> Excel
        </Button>
      </div>
    </div>
  )
}
