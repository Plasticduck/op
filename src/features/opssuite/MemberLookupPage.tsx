import { useState } from 'react'
import { SearchCheck, Car, CheckCircle2, XCircle, Snowflake, AlertTriangle, ChevronDown } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { memberLookup, type MemberLookupResult, type MemberSource } from '@/lib/queries/memberLookup'

// Active Member Lookup — a lube-center tool. Type a license plate and check both
// car-wash systems (DRB and FlexWash) for an active membership before giving a
// member benefit.

const fmtDate = (s: string | null | undefined) => {
  if (!s) return null
  const d = new Date(s.length <= 10 ? s + 'T00:00:00' : s)
  return Number.isNaN(d.getTime()) ? s : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}
const usd = (cents: number | null | undefined) =>
  cents == null ? null : (cents / 100).toLocaleString(undefined, { style: 'currency', currency: 'USD' })

// Map a source verdict to a badge tone + icon.
function tone(src: MemberSource): { cls: string; Icon: typeof CheckCircle2 } {
  if (src.active) return { cls: 'bg-ok-soft text-ok', Icon: CheckCircle2 }
  if (src.paused) return { cls: 'bg-accent-soft text-accent', Icon: Snowflake }
  if (src.error || src.label === 'Lookup failed' || src.label === 'Not configured') return { cls: 'bg-danger-soft text-danger', Icon: AlertTriangle }
  return { cls: 'bg-content text-ink-muted', Icon: XCircle }
}

function SourceCard({ title, src }: { title: string; src: MemberSource }) {
  const { cls, Icon } = tone(src)
  const [showDiag, setShowDiag] = useState(false)
  const diag = src.diagnostics
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">{title}</h2>
        <span className={cn('inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold', cls)}>
          <Icon className="size-3.5" /> {src.label}
        </span>
      </div>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
        {src.name && (<><dt className="text-ink-subtle">Member</dt><dd className="font-medium text-ink">{src.name}</dd></>)}
        {src.plan && (<><dt className="text-ink-subtle">Plan</dt><dd className="text-ink">{src.plan}{usd(src.priceCents) ? ` · ${usd(src.priceCents)}/mo` : ''}</dd></>)}
        {src.memberSince && (<><dt className="text-ink-subtle">Member since</dt><dd className="text-ink">{fmtDate(src.memberSince)}</dd></>)}
        {src.lastBillingDate && (<><dt className="text-ink-subtle">Last billed</dt><dd className="text-ink">{fmtDate(src.lastBillingDate)}</dd></>)}
        {src.status && (<><dt className="text-ink-subtle">Status</dt><dd className="text-ink">{src.status}</dd></>)}
        {src.error && (<><dt className="text-ink-subtle">Note</dt><dd className="text-danger">{src.error}</dd></>)}
        {!src.name && !src.plan && !src.error && (
          <dd className="col-span-2 text-ink-muted">No membership found for this plate.</dd>
        )}
      </dl>
      {diag && Object.keys(diag).length > 0 && (
        <div className="border-t border-border pt-2">
          <button type="button" onClick={() => setShowDiag((v) => !v)} className="flex items-center gap-1 text-[11px] font-medium text-ink-subtle hover:text-ink">
            <ChevronDown className={cn('size-3.5 transition', showDiag && 'rotate-180')} /> Match details
          </button>
          {showDiag && (
            <pre className="mt-2 max-h-48 overflow-auto rounded-md bg-content p-2 text-[11px] leading-relaxed text-ink-muted">{JSON.stringify(diag, null, 2)}</pre>
          )}
        </div>
      )}
    </section>
  )
}

export default function MemberLookupPage() {
  const [plate, setPlate] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<MemberLookupResult | null>(null)

  const run = async () => {
    const p = plate.trim()
    if (p.length < 2) { setError('Enter a license plate.'); return }
    setLoading(true); setError(null); setResult(null)
    try {
      const { data, error: err } = await memberLookup(p)
      if (err) throw new Error(err.message)
      if (!data || data.error) throw new Error(data?.message ?? data?.error ?? 'Lookup failed.')
      setResult(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Lookup failed.')
    } finally {
      setLoading(false)
    }
  }

  const anyActive = result?.anyActive ?? false

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Active Member Lookup"
        subtitle="Type a customer's license plate to check whether they're an active wash member in DRB or FlexWash."
      />

      <form
        onSubmit={(e) => { e.preventDefault(); void run() }}
        className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-card p-4"
      >
        <label className="flex-1 min-w-[220px] text-xs font-medium text-ink-subtle">
          License plate
          <div className="relative mt-1">
            <Car className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input
              value={plate}
              onChange={(e) => setPlate(e.target.value.toUpperCase())}
              placeholder="e.g. ABC1234"
              autoFocus
              autoCapitalize="characters"
              className="h-11 pl-9 text-base uppercase tracking-wide"
            />
          </div>
        </label>
        <Button type="submit" disabled={loading} className="h-11">
          <SearchCheck className="size-4" /> {loading ? 'Checking…' : 'Check membership'}
        </Button>
      </form>

      {error && <div className="rounded-md border border-danger/40 bg-danger-soft px-4 py-3 text-sm text-danger">{error}</div>}

      {loading && <div className="h-28 animate-pulse rounded-xl bg-content" />}

      {result && !loading && (
        <>
          {/* Verdict banner */}
          <div className={cn(
            'flex items-center gap-3 rounded-xl border p-4',
            anyActive ? 'border-ok/40 bg-ok-soft' : 'border-border bg-card',
          )}>
            {anyActive ? <CheckCircle2 className="size-8 shrink-0 text-ok" /> : <XCircle className="size-8 shrink-0 text-ink-muted" />}
            <div>
              <div className={cn('text-lg font-bold', anyActive ? 'text-ok' : 'text-ink')}>
                {anyActive ? 'Active member' : 'No active membership found'}
              </div>
              <div className="text-sm text-ink-muted">
                Plate <span className="font-semibold text-ink">{result.plate}</span>
                {anyActive ? ' is an active member at a Mighty Wash location.' : ' is not an active member in DRB or FlexWash.'}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <SourceCard title="DRB" src={result.drb} />
            <SourceCard title="FlexWash" src={result.flexwash} />
          </div>
        </>
      )}

      {!result && !loading && !error && (
        <p className="px-1 text-sm text-ink-muted">
          Enter a plate above. We check both wash systems and show whether the vehicle has an active membership, the plan, and when it started.
        </p>
      )}
    </div>
  )
}
