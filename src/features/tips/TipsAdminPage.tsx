import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Banknote,
  CheckCircle2,
  ClipboardCopy,
  Download,
  ExternalLink,
  HandCoins,
  Loader2,
  RefreshCw,
} from 'lucide-react'
import { format } from 'date-fns'
import { PageHeader } from '@/components/layout/PageHeader'
import { LocationGate } from '@/components/layout/LocationGate'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Input } from '@/components/ui/Input'
import { useLocations } from '@/lib/locations'
import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'
import { tips, computeDisbursements, type DisbursementRow } from '@/lib/queries/tips'
import { POSTER_STYLES, tipPosterDataUrl, downloadTipPoster, type PosterStyle } from '@/lib/tipPoster'
import { cn } from '@/lib/utils'

const SITE = 'https://operator.washlyfe.com'

function Inner({ locationId }: { locationId: string }) {
  const { activeLocation } = useLocations()
  const [params] = useSearchParams()
  const tipUrl = `${SITE}/tip/${locationId}`

  // -- Bank / Connect status -------------------------------------------------
  const [ready, setReady] = useState<boolean | null>(activeLocation?.tips_enabled ? true : null)
  const [onboardBusy, setOnboardBusy] = useState(false)
  const [onboardError, setOnboardError] = useState<string | null>(null)

  const checkStatus = useCallback(async () => {
    const { data } = await supabase.functions.invoke('tips-admin', {
      body: { action: 'status', location_id: locationId },
    })
    setReady(!!data?.ready)
  }, [locationId])

  useEffect(() => {
    // Re-check on mount, and force a check when bouncing back from Stripe
    // onboarding (?onboard=done).
    void checkStatus()
  }, [checkStatus, params])

  const startOnboarding = async () => {
    setOnboardBusy(true)
    setOnboardError(null)
    const { data, error } = await supabase.functions.invoke('tips-admin', {
      body: { action: 'onboard', location_id: locationId },
    })
    setOnboardBusy(false)
    if (error || !data?.url) {
      setOnboardError(await fnErrorMessage(error, data, 'Could not start Stripe onboarding.'))
      return
    }
    window.location.href = data.url as string
  }

  // -- QR poster styles --------------------------------------------------------
  const [copied, setCopied] = useState(false)
  const [previews, setPreviews] = useState<Partial<Record<PosterStyle, string>>>({})
  const [downloading, setDownloading] = useState<PosterStyle | null>(null)
  const siteName = activeLocation?.name ?? 'This site'

  useEffect(() => {
    let alive = true
    // Render the four poster previews sequentially — canvas work is cheap but
    // doing them one at a time keeps first paint snappy.
    void (async () => {
      for (const s of POSTER_STYLES) {
        const url = await tipPosterDataUrl(s.key, { url: tipUrl, siteName })
        if (!alive) return
        setPreviews((prev) => ({ ...prev, [s.key]: url }))
      }
    })()
    return () => { alive = false }
  }, [tipUrl, siteName])

  const downloadPoster = async (style: PosterStyle) => {
    setDownloading(style)
    try {
      await downloadTipPoster(style, { url: tipUrl, siteName })
    } finally {
      setDownloading(null)
    }
  }

  // -- Daily report ------------------------------------------------------------
  const [day, setDay] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [poolCents, setPoolCents] = useState(0)
  const [tipCount, setTipCount] = useState(0)
  const [rows, setRows] = useState<DisbursementRow[]>([])
  const [reportLoading, setReportLoading] = useState(false)

  const loadReport = useCallback(async () => {
    setReportLoading(true)
    const dayStart = new Date(day + 'T00:00:00').toISOString()
    const dayEnd = new Date(day + 'T23:59:59.999').toISOString()
    // Reconcile first so tips paid without hitting the thanks page are pulled
    // in from Stripe before we compute the split.
    await supabase.functions.invoke('tips-admin', {
      body: { action: 'reconcile', location_id: locationId, from: dayStart, to: dayEnd },
    }).catch(() => {})
    const [{ data: tipRows }, { data: hourRows }] = await Promise.all([
      tips.forDay(locationId, dayStart, dayEnd),
      tips.hoursForDay(locationId, dayStart, dayEnd),
    ])
    const pool = (tipRows ?? []).reduce((a, t) => a + t.amount_cents, 0)
    setPoolCents(pool)
    setTipCount((tipRows ?? []).length)
    setRows(computeDisbursements(pool, (hourRows as never[]) ?? []))
    setReportLoading(false)
  }, [locationId, day])

  useEffect(() => { void loadReport() }, [loadReport])

  const totalHours = useMemo(() => rows.reduce((a, r) => a + r.hours, 0), [rows])

  const exportCsv = () => {
    const lines = [
      ['Date', 'Site', 'Employee', 'Hours Worked', 'Tip Share'].join(','),
      ...rows.map((r) => [day, csv(activeLocation?.name ?? ''), csv(r.name), r.hours.toFixed(2), (r.shareCents / 100).toFixed(2)].join(',')),
      ['', '', 'TOTAL', totalHours.toFixed(2), (poolCents / 100).toFixed(2)].join(','),
    ]
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `tips-${day}.csv`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Tips"
        subtitle="Cashless tips by QR code, deposited straight to this site's bank account."
      />

      {/* Setup / status */}
      <section className="rounded-md border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className={cn('grid size-10 place-items-center rounded-full', ready ? 'bg-ok-soft' : 'bg-warn-soft')}>
              <Banknote className={cn('size-5', ready ? 'text-ok' : 'text-warn')} />
            </span>
            <div>
              <div className="flex items-center gap-2 text-sm font-semibold text-ink">
                Bank deposits
                {ready == null ? <Loader2 className="size-3.5 animate-spin text-ink-subtle" />
                  : ready ? <Badge tone="ok">Connected</Badge>
                  : <Badge tone="warn">Not set up</Badge>}
              </div>
              <p className="text-xs text-ink-muted">
                {ready
                  ? 'Tips settle directly in this site’s bank account via Stripe.'
                  : 'Connect this site’s bank account so customer tips can be deposited.'}
              </p>
            </div>
          </div>
          <Button variant={ready ? 'secondary' : 'primary'} onClick={() => void startOnboarding()} disabled={onboardBusy}>
            {onboardBusy ? <Loader2 className="size-4 animate-spin" /> : <ExternalLink className="size-4" />}
            {ready ? 'Update bank details' : 'Set up deposits'}
          </Button>
        </div>
        {onboardError && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{onboardError}</p>}
      </section>

      {/* QR poster picker */}
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Tip QR code</h2>
          <Button
            variant="secondary"
            size="sm"
            onClick={async () => { await navigator.clipboard.writeText(tipUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
          >
            {copied ? <CheckCircle2 className="size-4 text-ok" /> : <ClipboardCopy className="size-4" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        </div>
        <p className="mb-4 max-w-xl text-sm text-ink-muted">
          Pick a design, download the print-ready PNG, and post it at pay stations,
          vacuums, and exits. All four point at the same tip page.
        </p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {POSTER_STYLES.map((s) => (
            <div key={s.key} className="flex flex-col overflow-hidden rounded-md border border-border bg-content/30">
              <div className="grid aspect-[10/13] place-items-center bg-content/50 p-2">
                {previews[s.key] ? (
                  <img
                    src={previews[s.key]}
                    alt={s.label}
                    className="max-h-full max-w-full rounded shadow-sm"
                  />
                ) : (
                  <Loader2 className="size-5 animate-spin text-ink-subtle" />
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-2.5">
                <div>
                  <div className="text-xs font-semibold text-ink">{s.label}</div>
                  <p className="text-[10px] leading-tight text-ink-subtle">{s.description}</p>
                </div>
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-auto w-full"
                  onClick={() => void downloadPoster(s.key)}
                  disabled={downloading === s.key || !previews[s.key]}
                >
                  {downloading === s.key ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                  Download
                </Button>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] text-ink-subtle">{tipUrl}</p>
      </section>

      {/* Daily disbursement report */}
      <section className="rounded-md border border-border bg-card p-4">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <HandCoins className="size-4 text-accent" /> Daily disbursement report
          </h2>
          <div className="flex items-center gap-2">
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="h-9 w-40 text-sm" />
            <Button variant="secondary" size="sm" onClick={() => void loadReport()} disabled={reportLoading}>
              {reportLoading ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            </Button>
            <Button size="sm" onClick={exportCsv} disabled={rows.length === 0}>
              <Download className="size-4" /> CSV for payroll
            </Button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3">
          <Stat label="Tip pool" value={`$${(poolCents / 100).toFixed(2)}`} />
          <Stat label="Tips received" value={String(tipCount)} />
          <Stat label="Hours on the clock" value={totalHours.toFixed(1)} />
        </div>

        {reportLoading ? (
          <p className="py-6 text-center text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Crunching the day...</p>
        ) : rows.length === 0 ? (
          <p className="rounded-md border border-dashed border-border bg-content/40 p-4 text-center text-sm text-ink-muted">
            No time-clock punches on {format(new Date(day + 'T12:00'), 'MMM d')} — nobody is eligible yet.
            Disbursements split the day's pool by hours worked at this site.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-content text-left text-[10px] uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Employee</th>
                  <th className="px-3 py-2 text-right font-medium">Hours worked</th>
                  <th className="px-3 py-2 text-right font-medium">% of pool</th>
                  <th className="px-3 py-2 text-right font-medium">Tip share</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} className="border-t border-border">
                    <td className="px-3 py-2 font-medium text-ink">{r.name}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-muted">{r.hours.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right tabular text-ink-muted">
                      {totalHours > 0 ? ((r.hours / totalHours) * 100).toFixed(1) : '0.0'}%
                    </td>
                    <td className="px-3 py-2 text-right tabular font-semibold text-ink">${(r.shareCents / 100).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-content text-xs">
                  <td className="px-3 py-2 font-semibold text-ink">Total</td>
                  <td className="px-3 py-2 text-right tabular font-semibold text-ink">{totalHours.toFixed(2)}</td>
                  <td className="px-3 py-2 text-right tabular text-ink-muted">100%</td>
                  <td className="px-3 py-2 text-right tabular font-semibold text-ink">${(poolCents / 100).toFixed(2)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-[11px] text-ink-subtle">
          Shares are weighted by hours clocked at this site that day (built-in time clock). Export the CSV and attach it to payroll so tips are reported properly.
        </p>
      </section>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-content/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-xl font-semibold tabular text-ink">{value}</div>
    </div>
  )
}

const csv = (s: string) => (s.includes(',') || s.includes('"') ? '"' + s.replace(/"/g, '""') + '"' : s)

export default function TipsAdminPage() {
  return <LocationGate>{(locationId) => <Inner locationId={locationId} />}</LocationGate>
}
