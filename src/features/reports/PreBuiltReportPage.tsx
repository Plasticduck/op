import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowUpDown, Download, Printer, Star } from 'lucide-react'
import { subDays } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { StatCardRow } from '@/components/data/StatCardRow'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { savedReports } from '@/lib/queries/reports'
import { reportByKey } from './registry'
import type { ReportResult } from './types'

type RangeType = '7d' | '30d' | '90d' | 'custom'

export default function ReportPage() {
  const { reportKey } = useParams<{ reportKey: string }>()
  const { profile } = useAuth()
  const { locations, activeId } = useLocations()
  const def = reportByKey(reportKey ?? '')

  const [range, setRange] = useState<RangeType>('30d')
  const [customStart, setCustomStart] = useState('')
  const [customEnd, setCustomEnd] = useState('')
  const [locSel, setLocSel] = useState<string>('active')
  const [result, setResult] = useState<ReportResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null)
  const [saved, setSaved] = useState(false)

  const { startIso, endIso } = useMemo(() => {
    const end = range === 'custom' && customEnd ? new Date(customEnd + 'T23:59:59') : new Date()
    const start =
      range === 'custom' && customStart
        ? new Date(customStart + 'T00:00:00')
        : subDays(end, range === '7d' ? 7 : range === '90d' ? 90 : 30)
    return { startIso: start.toISOString(), endIso: end.toISOString() }
  }, [range, customStart, customEnd])

  const locationIds = useMemo(() => {
    if (locSel === 'all') return locations.map((l) => l.id)
    if (locSel === 'active') return activeId ? [activeId] : locations.map((l) => l.id)
    return [locSel]
  }, [locSel, activeId, locations])

  const run = useCallback(async () => {
    if (!def || locationIds.length === 0) return
    setLoading(true)
    const res = await def.load(locationIds, startIso, endIso)
    setResult(res)
    setLoading(false)
  }, [def, locationIds, startIso, endIso])

  useEffect(() => { void run() }, [run])

  const sortedRows = useMemo(() => {
    if (!result) return []
    if (!sort) return result.rows
    return [...result.rows].sort((a, b) => {
      const av = a[sort.key], bv = b[sort.key]
      const an = Number(String(av).replace(/[^0-9.-]/g, ''))
      const bn = Number(String(bv).replace(/[^0-9.-]/g, ''))
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return (an - bn) * sort.dir
      return String(av).localeCompare(String(bv)) * sort.dir
    })
  }, [result, sort])

  if (!def) return <p className="text-sm text-ink-muted">Report not found.</p>

  const exportCsv = () => {
    if (!result) return
    const header = def.columns.map((c) => c.header).join(',')
    const lines = sortedRows.map((r) => def.columns.map((c) => `"${String(r[c.key] ?? '').replace(/"/g, '""')}"`).join(','))
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${def.key}-report.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const saveFavorite = async () => {
    if (!profile) return
    await savedReports.create({
      account_id: profile.account_id,
      created_by: profile.id,
      name: def.title,
      module: def.module,
      report_key: def.key,
      date_range_type: range,
      filters: { locSel },
    })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div className="flex flex-col gap-6">
      <Link to="/app/reports" className="inline-flex items-center gap-1 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> Reports
      </Link>

      <PageHeader
        title={def.title}
        subtitle={def.description}
        actions={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={saveFavorite}>
              <Star className={cn('size-4', saved && 'fill-warn text-warn')} /> {saved ? 'Saved' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={() => window.print()}><Printer className="size-4" /> Print / PDF</Button>
            <Button variant="secondary" onClick={exportCsv}><Download className="size-4" /> CSV</Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-end gap-2">
        <Select value={range} onChange={(e) => setRange(e.target.value as RangeType)} className="w-36">
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
          <option value="90d">Last 90 days</option>
          <option value="custom">Custom</option>
        </Select>
        {range === 'custom' && (
          <>
            <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-40" />
            <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-40" />
          </>
        )}
        <Select value={locSel} onChange={(e) => setLocSel(e.target.value)} className="w-48">
          <option value="active">Active location</option>
          {profile?.role === 'owner' && <option value="all">All locations</option>}
          {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </Select>
      </div>

      {result && <StatCardRow items={result.stats} />}

      <div className="overflow-x-auto rounded-md border border-border bg-card">
        <table className="w-full text-sm">
          <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              {def.columns.map((c) => (
                <th key={c.key} className={cn('px-3 py-2.5 font-medium', c.numeric && 'text-right')}>
                  <button
                    className="inline-flex items-center gap-1 hover:text-ink"
                    onClick={() => setSort((s) => (s?.key === c.key ? { key: c.key, dir: s.dir === 1 ? -1 : 1 } : { key: c.key, dir: 1 }))}
                  >
                    {c.header}
                    <ArrowUpDown className="size-3" />
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={def.columns.length} className="px-3 py-8 text-center text-ink-muted">Loading…</td></tr>
            ) : sortedRows.length === 0 ? (
              <tr><td colSpan={def.columns.length} className="px-3 py-8 text-center text-ink-muted">No data for this period.</td></tr>
            ) : (
              sortedRows.map((r, i) => (
                <tr key={i} className="border-t border-border hover:bg-content">
                  {def.columns.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2 text-ink', c.numeric && 'numeric tabular text-right')}>
                      {String(r[c.key] ?? '—')}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
