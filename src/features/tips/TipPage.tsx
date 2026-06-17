import { useEffect, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Heart, Loader2 } from 'lucide-react'
import { Logo } from '@/components/ui/Logo'
import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'
import { cn } from '@/lib/utils'

// Public, mobile-first tip page. Customers land here by scanning the site's
// printed QR code — no login. Money flows through the site's own Stripe
// Connect account (see tips-public edge fn), so it never touches the platform.

const PRESETS = [200, 500, 1000, 2000] // cents

export default function TipPage() {
  const { locationId } = useParams<{ locationId: string }>()
  const [siteName, setSiteName] = useState<string | null>(null)
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [amount, setAmount] = useState<number>(500)
  const [custom, setCustom] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!locationId) return
    void supabase.functions
      .invoke('tips-public', { body: { action: 'info', location_id: locationId } })
      .then(({ data, error: err }) => {
        if (err || !data?.name) { setEnabled(false); return }
        setSiteName(data.name as string)
        setEnabled(!!data.tips_enabled)
      })
  }, [locationId])

  const effectiveCents = custom
    ? Math.round(Number(custom) * 100)
    : amount

  const pay = async () => {
    if (!locationId) return
    setBusy(true)
    setError(null)
    const { data, error: err } = await supabase.functions.invoke('tips-public', {
      body: { action: 'checkout', location_id: locationId, amount_cents: effectiveCents },
    })
    if (err || !data?.url) {
      setBusy(false)
      setError(await fnErrorMessage(err, data, 'Could not start the payment. Try again.'))
      return
    }
    window.location.href = data.url as string
  }

  return (
    <div className="flex min-h-dvh flex-col items-center bg-content px-4 py-8">
      <Logo size="md" />
      {enabled === null ? (
        <div className="mt-20 text-ink-muted"><Loader2 className="size-6 animate-spin" /></div>
      ) : !enabled ? (
        <div className="mt-16 max-w-sm text-center">
          <p className="text-lg font-semibold text-ink">Tips aren't set up here yet.</p>
          <p className="mt-1 text-sm text-ink-muted">Ask the site manager to enable cashless tipping.</p>
        </div>
      ) : (
        <div className="mt-8 w-full max-w-sm">
          <div className="text-center">
            <span className="mx-auto grid size-14 place-items-center rounded-full bg-accent-soft">
              <Heart className="size-7 text-accent" />
            </span>
            <h1 className="mt-3 text-2xl font-semibold text-ink">Tip the crew</h1>
            <p className="mt-1 text-sm text-ink-muted">
              at <span className="font-medium text-ink">{siteName}</span>. 100% of your tip goes to the team.
            </p>
          </div>

          <div className="mt-6 grid grid-cols-4 gap-2">
            {PRESETS.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => { setAmount(c); setCustom('') }}
                className={cn(
                  'rounded-xl border py-3 text-lg font-semibold transition',
                  !custom && amount === c
                    ? 'border-accent bg-accent text-white'
                    : 'border-border bg-card text-ink hover:border-accent/50',
                )}
              >
                ${c / 100}
              </button>
            ))}
          </div>

          <div className="mt-3">
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-lg text-ink-subtle">$</span>
              <input
                type="number"
                inputMode="decimal"
                min="1"
                max="500"
                step="0.50"
                placeholder="Custom amount"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="w-full rounded-xl border border-border bg-card py-3 pl-8 pr-3 text-lg text-ink focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/40"
              />
            </div>
          </div>

          {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

          <button
            type="button"
            onClick={() => void pay()}
            disabled={busy || !Number.isFinite(effectiveCents) || effectiveCents < 100 || effectiveCents > 50_000}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-accent py-3.5 text-lg font-semibold text-white transition hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-5 animate-spin" /> : <Heart className="size-5" />}
            Tip {Number.isFinite(effectiveCents) && effectiveCents >= 100 ? `$${(effectiveCents / 100).toFixed(2)}` : ''}
          </button>

          <p className="mt-4 text-center text-[11px] text-ink-subtle">
            Secure payment by Stripe. Tips are split among the on-shift team.
          </p>
        </div>
      )}
    </div>
  )
}

// Post-payment landing. Records the paid session (idempotent server-side) and
// thanks the customer.
export function TipThanksPage() {
  const { locationId } = useParams<{ locationId: string }>()
  const [params] = useSearchParams()
  const sessionId = params.get('session_id')
  const [state, setState] = useState<'recording' | 'ok' | 'fail'>('recording')
  const [cents, setCents] = useState<number | null>(null)

  useEffect(() => {
    if (!locationId || !sessionId) { setState('fail'); return }
    void supabase.functions
      .invoke('tips-public', { body: { action: 'record', location_id: locationId, session_id: sessionId } })
      .then(({ data, error }) => {
        if (error || !data?.ok) { setState('fail'); return }
        setCents((data.amount_cents as number) ?? null)
        setState('ok')
      })
  }, [locationId, sessionId])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-content px-4">
      {state === 'recording' ? (
        <Loader2 className="size-7 animate-spin text-ink-muted" />
      ) : state === 'ok' ? (
        <div className="max-w-sm text-center">
          <CheckCircle2 className="mx-auto size-14 text-ok" />
          <h1 className="mt-4 text-2xl font-semibold text-ink">
            {cents != null ? `$${(cents / 100).toFixed(2)} — ` : ''}thank you!
          </h1>
          <p className="mt-2 text-sm text-ink-muted">
            Your tip goes straight to the crew working today. They appreciate you.
          </p>
        </div>
      ) : (
        <div className="max-w-sm text-center">
          <p className="text-lg font-semibold text-ink">We couldn't confirm the payment.</p>
          <p className="mt-1 text-sm text-ink-muted">If you were charged, the team will still receive it — every payment is reconciled daily.</p>
        </div>
      )}
    </div>
  )
}
