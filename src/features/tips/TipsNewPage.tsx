import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Upload, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { format, subDays } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { currency } from '@/lib/format'
import { tipsHours, type TipsHoursEmployee } from '@/lib/queries/isolved'
import { flexwashSales, type FlexSite } from '@/lib/queries/flexwashSales'

// "Tips NEW": tip pool used to replenish an hourly pay reduction.
//
// The model: every hourly employee's rate is cut by $X/hr (default $4). Tips
// collected are pooled and used to build pay back to the previous rate, split by
// hours worked. So:
//   • Amount to build back  = reduction/hr x total hours worked
//   • Each person's tip share = (their hours / total hours) x tip pool
//   • If the pool covers the build-back, everyone is made whole and the surplus
//     is shared by hours. If it falls short, the gap is the "True-Up" that Mighty
//     Wash must cover so every rate is still restored.
// Salaried staff are excluded upstream (tips-hours edge function). Hours come
// from iSolved; tips from FlexWash. Either can be overridden to cross-check.

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
  const [reduction, setReduction] = useState('4.00')
  const [uploaded, setUploaded] = useState<Map<string, number> | null>(null)
  const [uploadName, setUploadName] = useState<string | null>(null)
  const [hoursSource, setHoursSource] = useState<'isolved' | 'uploaded'>('isolved')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [rosterWarn, setRosterWarn] = useState(false)

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
    setRosterWarn(!!hr?.rosterError)
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

  const reductionNum = Number(reduction) || 0
  const pool = Number(tipPool) || 0

  const rows = useMemo(() => {
    if (!hoursEmps) return []
    const list = hoursEmps.map((e) => {
      const up = uploaded?.get(norm(e.name)) ?? null
      const hoursUsed = hoursSource === 'uploaded' ? (up ?? 0) : e.hours
      return { number: e.number, name: e.name, isolvedHours: e.hours, uploadedHours: up, hoursUsed }
    })
    const totalUsed = list.reduce((a, r) => a + r.hoursUsed, 0)
    return list
      .map((r) => {
        const payCut = reductionNum * r.hoursUsed
        const tipShare = totalUsed > 0 ? (r.hoursUsed / totalUsed) * pool : 0
        return { ...r, share: totalUsed > 0 ? r.hoursUsed / totalUsed : 0, payCut, tipShare, net: tipShare - payCut }
      })
      .sort((a, b) => b.hoursUsed - a.hoursUsed)
  }, [hoursEmps, uploaded, hoursSource, reductionNum, pool])

  const t = useMemo(() => {
    const hours = rows.reduce((a, r) => a + r.hoursUsed, 0)
    const buildBack = reductionNum * hours // amount needed to restore pay
    const net = pool - buildBack
    return {
      hours: Math.round(hours * 100) / 100,
      buildBack,
      pool,
      perHourTips: hours > 0 ? pool / hours : 0,
      trueUp: Math.max(0, -net),
      surplus: Math.max(0, net),
      covered: net >= 0,
    }
  }, [rows, reductionNum, pool])

  const shortfall = !t.covered
  const netLabel = shortfall ? 'True-Up' : 'Surplus'

  const exportCsv = () => {
    const head = ['Employee', 'iSolved hours', 'Uploaded hours', 'Hours used', 'Share', `Pay cut (${currency(reductionNum)}/hr)`, 'Tip share', netLabel]
    const lines = [head.join(',')]
    for (const r of rows) {
      lines.push([
        `"${r.name}"`, r.isolvedHours, r.uploadedHours ?? '', r.hoursUsed,
        (r.share * 100).toFixed(2) + '%', r.payCut.toFixed(2), r.tipShare.toFixed(2),
        (shortfall ? Math.max(0, -r.net) : Math.max(0, r.net)).toFixed(2),
      ].join(','))
    }
    lines.push(['Total', '', '', t.hours, '', t.buildBack.toFixed(2), t.pool.toFixed(2), (shortfall ? t.trueUp : t.surplus).toFixed(2)].join(','))
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `tips-${siteCode}-${start}-to-${end}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-4 lg:px-8">
      <PageHeader title="Tips NEW" subtitle="Use the tip pool to replenish an hourly pay reduction, split by hours worked." />

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
        <>
          {rosterWarn && (
            <p className="mt-4 flex items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              <AlertTriangle className="size-4 shrink-0" /> Could not read the iSolved roster this time, so salaried staff may not be filtered out. Pull again to retry.
            </p>
          )}

          {/* Inputs that drive the calc */}
          <section className="mt-4 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-wrap items-end gap-4">
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                Hourly reduction ($/hr)
                <Input value={reduction} onChange={(e) => setReduction(e.target.value)} className="h-9 w-28" inputMode="decimal" />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                Tip pool ($)
                <Input value={tipPool} onChange={(e) => setTipPool(e.target.value)} className="h-9 w-32" inputMode="decimal" />
              </label>
              <p className="pb-1.5 text-xs text-ink-subtle">
                FlexWash reported <span className="font-medium text-ink">{flexTips != null ? currency(flexTips) : '—'}</span> in tips.
              </p>
              <div className="ml-auto flex items-end gap-2">
                <label className="flex flex-col gap-1 text-xs font-medium text-ink-muted">
                  Hours source
                  <Select value={hoursSource} onChange={(e) => setHoursSource(e.target.value as 'isolved' | 'uploaded')} className="h-9 w-36" disabled={!uploaded}>
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
          </section>

          {/* The three headline calcs */}
          <section className="mt-4 grid gap-3 sm:grid-cols-3">
            <Stat label="Hourly staff hours" value={t.hours.toFixed(1)} sub={`${rows.length} employees, salaried excluded`} />
            <Stat label="Pay to build back" value={currency(t.buildBack)} sub={`${currency(reductionNum)}/hr × ${t.hours.toFixed(1)} hrs`} />
            <Stat label="Tip pool" value={currency(t.pool)} sub={`${currency(t.perHourTips)}/hr across all hours`} />
          </section>

          {/* Result banner */}
          <section className={`mt-3 flex items-start gap-3 rounded-xl border p-4 ${shortfall ? 'border-danger/40 bg-danger-soft' : 'border-ok/40 bg-ok-soft'}`}>
            {shortfall ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-danger" /> : <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-ok" />}
            <div>
              <p className={`text-sm font-semibold ${shortfall ? 'text-danger' : 'text-ok'}`}>
                {shortfall
                  ? `Shortfall — True-Up of ${currency(t.trueUp)} that Mighty Wash must cover`
                  : `Fully replenished — ${currency(t.surplus)} surplus shared among employees by hours`}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {shortfall
                  ? `Tips (${currency(t.pool)}) cover part of the ${currency(t.buildBack)} pay reduction; Mighty Wash tops up the remaining ${currency(t.trueUp)} so every rate is still restored to the previous level.`
                  : `Tips (${currency(t.pool)}) cover the full ${currency(t.buildBack)} pay reduction with ${currency(t.surplus)} left over, distributed to employees by hours worked.`}
              </p>
            </div>
          </section>

          {/* Per-employee breakdown */}
          <section className="mt-4 overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="bg-content text-left text-[11px] uppercase tracking-wide text-ink-subtle">
                <tr>
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 text-right font-medium">iSolved hrs</th>
                  {uploaded && <th className="px-3 py-2 text-right font-medium">Uploaded hrs</th>}
                  <th className="px-3 py-2 text-right font-medium">Hours used</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                  <th className="px-3 py-2 text-right font-medium">Pay cut</th>
                  <th className="px-3 py-2 text-right font-medium">Tip share</th>
                  <th className="px-3 py-2 text-right font-medium">{netLabel}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const netVal = shortfall ? Math.max(0, -r.net) : Math.max(0, r.net)
                  return (
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
                      <td className="px-3 py-2 text-right tabular-nums text-ink-muted">{currency(r.payCut)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-ink">{currency(r.tipShare)}</td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold ${shortfall ? 'text-danger' : 'text-ok'}`}>{currency(netVal)}</td>
                    </tr>
                  )
                })}
                {rows.length === 0 && (
                  <tr><td colSpan={uploaded ? 8 : 7} className="px-3 py-6 text-center text-ink-subtle">No worked hours for this site and period.</td></tr>
                )}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-content/60 font-semibold text-ink">
                  <td className="px-3 py-2">Total</td>
                  <td className="px-3 py-2 text-right tabular-nums">{hoursEmps.reduce((a, e) => a + e.hours, 0).toFixed(1)}</td>
                  {uploaded && <td className="px-3 py-2" />}
                  <td className="px-3 py-2 text-right tabular-nums">{t.hours.toFixed(1)}</td>
                  <td className="px-3 py-2" />
                  <td className="px-3 py-2 text-right tabular-nums">{currency(t.buildBack)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{currency(t.pool)}</td>
                  <td className={`px-3 py-2 text-right tabular-nums ${shortfall ? 'text-danger' : 'text-ok'}`}>{currency(shortfall ? t.trueUp : t.surplus)}</td>
                </tr>
              </tfoot>
            </table>
          </section>

          <p className="mt-3 text-xs text-ink-subtle">
            Hours are worked hours from iSolved timecards (PTO and salaried staff excluded). <b>Pay cut</b> = reduction/hr × the
            employee's hours (what their pay was lowered by). <b>Tip share</b> = their hours ÷ total hours × the tip pool. In a
            shortfall the <b>True-Up</b> column is what Mighty Wash owes each person on top of their tips to restore their pay; in a
            surplus it is the extra each person keeps beyond the restored amount.
          </p>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-subtle">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  )
}
