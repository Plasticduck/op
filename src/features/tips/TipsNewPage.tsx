import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Upload } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { currency } from '@/lib/format'
import { tipsHours, type TipsHoursEmployee } from '@/lib/queries/isolved'
import { flexwashSales, type FlexSite } from '@/lib/queries/flexwashSales'

// "Tips NEW": hours-weighted tip distribution for FlexWash sites. Hours come from
// iSolved (worked hours per employee), tips from FlexWash (tips collected). Each
// employee's share = their hours / total hours * the tip pool. The tip pool and
// the hours can each be overridden (a pasted/entered figure, or an uploaded hours
// file) so the integration numbers can be cross-checked against source exports.

const norm = (s: string) => s.trim().toLowerCase()
const fmtPct = (f: number) => `${(f * 100).toFixed(1)}%`

export default function TipsNewPage() {
  const [sites, setSites] = useState<FlexSite[]>([])
  const [siteNum, setSiteNum] = useState<number | ''>('')
  const [start, setStart] = useState(format(subDays(new Date(), 13), 'yyyy-MM-dd'))
  const [end, setEnd] = useState(format(new Date(), 'yyyy-MM-dd'))

  const [hoursEmps, setHoursEmps] = useState<TipsHoursEmployee[] | null>(null)
  const [flexTips, setFlexTips] = useState<number | null>(null)
  const [tipPool, setTipPool] = useState('')
  const [uploaded, setUploaded] = useState<Map<string, number> | null>(null)
  const [uploadName, setUploadName] = useState<string | null>(null)
  const [hoursSource, setHoursSource] = useState<'isolved' | 'uploaded'>('isolved')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void flexwashSales.sites().then((s) => {
      setSites(s)
      if (s.length) setSiteNum(s[0].site_number)
    })
  }, [])

  const selectedSite = sites.find((s) => s.site_number === siteNum)
  const siteCode = selectedSite ? `MW${String(selectedSite.site_number).padStart(2, '0')}` : ''

  const pull = useCallback(async () => {
    if (!selectedSite) { setError('Pick a site.'); return }
    setBusy(true)
    setError(null)
    const [hoursRes, tips] = await Promise.all([
      tipsHours(start, end, siteCode),
      flexwashSales.tips([selectedSite.car_wash_id], start, end).catch(() => null),
    ])
    const hr = hoursRes.data
    if (hoursRes.error || hr?.error) {
      setError(hr?.message || hoursRes.error?.message || 'Could not pull hours from iSolved.')
      setBusy(false)
      return
    }
    setHoursEmps(hr?.employees ?? [])
    setFlexTips(tips)
    setTipPool(tips != null ? tips.toFixed(2) : '')
    setBusy(false)
  }, [selectedSite, siteCode, start, end])

  const onUpload = async (file: File | null) => {
    if (!file) return
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    if (!lines.length) return
    const first = lines[0].toLowerCase()
    const hasHeader = first.includes('name') || first.includes('hour')
    const header = hasHeader ? lines[0].split(',').map((c) => c.trim().toLowerCase()) : null
    const nameCol = header ? Math.max(0, header.findIndex((h) => h.includes('name'))) : 0
    const hoursCol = header ? (header.findIndex((h) => h.includes('hour')) === -1 ? 1 : header.findIndex((h) => h.includes('hour'))) : 1
    const map = new Map<string, number>()
    for (let i = hasHeader ? 1 : 0; i < lines.length; i++) {
      const cols = lines[i].split(',')
      const name = (cols[nameCol] ?? '').trim().replace(/^"|"$/g, '')
      const hours = Number((cols[hoursCol] ?? '').replace(/[^0-9.]/g, ''))
      if (name && hours) map.set(norm(name), (map.get(norm(name)) ?? 0) + hours)
    }
    setUploaded(map)
    setUploadName(file.name)
    setHoursSource('uploaded')
  }

  const rows = useMemo(() => {
    if (!hoursEmps) return []
    const list = hoursEmps.map((e) => {
      const up = uploaded?.get(norm(e.name)) ?? null
      const hoursUsed = hoursSource === 'uploaded' ? (up ?? 0) : e.hours
      return { number: e.number, name: e.name, isolvedHours: e.hours, uploadedHours: up, hoursUsed }
    })
    const totalUsed = list.reduce((a, r) => a + r.hoursUsed, 0)
    const pool = Number(tipPool) || 0
    return list
      .map((r) => ({ ...r, share: totalUsed > 0 ? r.hoursUsed / totalUsed : 0, tip: totalUsed > 0 ? (r.hoursUsed / totalUsed) * pool : 0 }))
      .sort((a, b) => b.hoursUsed - a.hoursUsed)
  }, [hoursEmps, uploaded, hoursSource, tipPool])

  const totals = useMemo(() => ({
    hours: Math.round(rows.reduce((a, r) => a + r.hoursUsed, 0) * 100) / 100,
    tip: rows.reduce((a, r) => a + r.tip, 0),
  }), [rows])

  const exportCsv = () => {
    const head = ['Employee', 'iSolved hours', 'Uploaded hours', 'Hours used', 'Share', 'Tip']
    const lines = [head.join(',')]
    for (const r of rows) {
      lines.push([`"${r.name}"`, r.isolvedHours, r.uploadedHours ?? '', r.hoursUsed, (r.share * 100).toFixed(2) + '%', r.tip.toFixed(2)].join(','))
    }
    lines.push(['Total', '', '', totals.hours, '', totals.tip.toFixed(2)].join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tips-${siteCode}-${start}-to-${end}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-4 lg:px-8">
      <PageHeader title="Tips NEW" subtitle="Hours-weighted tip distribution from iSolved hours and FlexWash tips." />

      <section className="mt-4 rounded-xl border border-border bg-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
            Site
            <Select value={siteNum === '' ? '' : String(siteNum)} onChange={(e) => setSiteNum(e.target.value ? Number(e.target.value) : '')} className="h-9 w-48">
              <option value="">Select…</option>
              {sites.map((s) => <option key={s.site_number} value={s.site_number}>{s.name ?? `MW${String(s.site_number).padStart(2, '0')}`}</option>)}
            </Select>
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
            From
            <Input type="date" value={start} max={end} onChange={(e) => setStart(e.target.value)} className="h-9 w-40" />
          </label>
          <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
            To
            <Input type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} className="h-9 w-40" />
          </label>
          <Button onClick={() => void pull()} disabled={busy || !selectedSite}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null} Pull from iSolved + FlexWash
          </Button>
        </div>
        {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </section>

      {hoursEmps && (
        <section className="mt-4 rounded-xl border border-border bg-card p-4">
          {/* Tip pool + compare controls */}
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                Tip pool ($)
                <Input value={tipPool} onChange={(e) => setTipPool(e.target.value)} className="h-9 w-32" inputMode="decimal" />
              </label>
              <p className="pb-1 text-xs text-ink-subtle">
                FlexWash reported <span className="font-medium text-ink">{flexTips != null ? currency(flexTips) : '—'}</span> in tips.
              </p>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                Hours source
                <Select value={hoursSource} onChange={(e) => setHoursSource(e.target.value as 'isolved' | 'uploaded')} className="h-9 w-40" disabled={!uploaded}>
                  <option value="isolved">iSolved (pulled)</option>
                  <option value="uploaded" disabled={!uploaded}>Uploaded file</option>
                </Select>
              </label>
              <label className="inline-flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-content px-3 text-sm font-medium text-ink-muted hover:border-accent hover:text-ink">
                <Upload className="size-4" /> {uploadName ? 'Replace hours' : 'Upload hours'}
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => { void onUpload(e.target.files?.[0] ?? null); e.target.value = '' }} />
              </label>
              <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>Export CSV</Button>
            </div>
          </div>
          {uploadName && <p className="mt-2 text-xs text-ink-subtle">Comparing against uploaded file: <span className="font-medium text-ink">{uploadName}</span> (matched to employees by name).</p>}

          <div className="mt-4 overflow-x-auto rounded-lg border border-border">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 text-right font-medium">iSolved hrs</th>
                  {uploaded && <th className="px-3 py-2 text-right font-medium">Uploaded hrs</th>}
                  <th className="px-3 py-2 text-right font-medium">Hours used</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                  <th className="px-3 py-2 text-right font-medium">Tip</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.number}>
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{r.isolvedHours.toFixed(1)}</td>
                    {uploaded && (
                      <td className={`px-3 py-2 text-right tabular-nums ${r.uploadedHours == null ? 'text-danger' : Math.abs((r.uploadedHours ?? 0) - r.isolvedHours) > 0.05 ? 'text-warn' : 'text-ink-muted'}`}>
                        {r.uploadedHours == null ? 'not found' : r.uploadedHours.toFixed(1)}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-ink">{r.hoursUsed.toFixed(1)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{fmtPct(r.share)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-ink">{currency(r.tip)}</td>
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr><td colSpan={uploaded ? 6 : 5} className="px-3 py-6 text-center text-ink-subtle">No worked hours for this site and period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-content/60 font-semibold text-ink">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{hoursEmps.reduce((a, e) => a + e.hours, 0).toFixed(1)}</td>
                  {uploaded && <td className="px-3 py-2" />}
                  <td className="px-3 py-2 text-right tabular-nums">{totals.hours.toFixed(1)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{currency(totals.tip)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          <p className="mt-3 text-xs text-ink-subtle">
            Hours are worked hours from iSolved timecards (PTO excluded) for staff at this site; tips are what FlexWash
            collected for the period. Each person's tip = their hours ÷ total hours × the tip pool. Override the tip pool
            or upload an hours file to cross-check against your source reports.
          </p>
        </section>
      )}
    </div>
  )
}
