import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Link2, Loader2, Unplug } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import {
  CONNECTORS, CONNECT_ACCOUNT_ID, PROVIDER_ORDER, connections, type ConnStatuses, type ProviderKey,
} from '@/lib/queries/connections'

// Operator AI header: Connections. Each person connects their own CoreNav and
// FlexWash logins here (Connect to CoreNav, Connect to FlexWash), sees which are
// connected, and disconnects them. Mighty Wash only, and not on the shared office
// login (a personal login doesn't belong on a shared screen).
export function ConnectionsMenu() {
  const { profile } = useAuth()
  const eligible = profile?.account_id === CONNECT_ACCOUNT_ID && profile?.role_category !== 'corporate_display'
  const email = profile?.email?.toLowerCase() ?? ''
  const providers = PROVIDER_ORDER.filter((k) => !CONNECTORS[k].previewEmails || CONNECTORS[k].previewEmails!.includes(email))
  const [status, setStatus] = useState<ConnStatuses | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState<ProviderKey | null>(null)
  const [confirming, setConfirming] = useState<ProviderKey | null>(null)
  const [errors, setErrors] = useState<Partial<Record<ProviderKey, string>>>({})
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!eligible) return
    let alive = true
    connections.status()
      .then((s) => { if (alive) setStatus(s) })
      .catch(() => { if (alive) setStatus({ corenav: { connected: false }, flexwash: { connected: false } }) })
    return () => { alive = false }
  }, [eligible])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setConfirming(null) } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!eligible || !status || providers.length === 0) return null

  const connect = async (k: ProviderKey) => {
    setBusy(k)
    setErrors((e) => ({ ...e, [k]: undefined }))
    try {
      const { url } = await connections.start(k)
      window.location.assign(url) // the provider's sign-in; it sends them back to its callback page
    } catch (e) {
      setErrors((x) => ({ ...x, [k]: e instanceof Error ? e.message : `Couldn't start the ${CONNECTORS[k].label} sign-in.` }))
      setBusy(null)
    }
  }

  const disconnect = async (k: ProviderKey) => {
    setBusy(k)
    setErrors((e) => ({ ...e, [k]: undefined }))
    try {
      await connections.disconnect(k)
      setStatus((s) => (s ? { ...s, [k]: { connected: false } } : s))
      setConfirming(null)
    } catch (e) {
      setErrors((x) => ({ ...x, [k]: e instanceof Error ? e.message : `Couldn't disconnect ${CONNECTORS[k].label}.` }))
    } finally {
      setBusy(null)
    }
  }

  const dot = (k: ProviderKey) => {
    const s = status[k]
    return s.connected ? (s.needs_reconnect ? 'bg-warn' : 'bg-ok') : 'bg-ink-subtle/40'
  }
  const anyExpired = providers.some((k) => status[k].connected && status[k].needs_reconnect)
  const date = (iso?: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '')

  return (
    <div ref={box} className="relative ml-auto">
      <button type="button" onClick={() => { setOpen((v) => !v); setConfirming(null) }} aria-expanded={open} aria-haspopup="dialog"
        className={cn('inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition',
          anyExpired ? 'border-warn/40 bg-warn-soft text-warn hover:border-warn' : 'border-border bg-card text-ink hover:border-accent/50')}>
        {anyExpired ? <AlertTriangle className="size-3.5" /> : <Link2 className="size-3.5" />}
        Connections
        <span className="flex items-center gap-1" aria-hidden>
          {providers.map((k) => <span key={k} className={cn('size-1.5 rounded-full', dot(k))} />)}
        </span>
        <ChevronDown className={cn('size-3.5 text-ink-subtle transition', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="dialog" aria-label="Connections"
          className="absolute right-0 top-10 z-20 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-card p-1.5 text-left shadow-lg">
          <p className="px-2.5 pb-1 pt-1.5 text-xs leading-relaxed text-ink-muted">
            Connect your own logins and Operator AI can use them next to your Operator data. It only reads; it can't change anything there.
          </p>
          {providers.map((k) => {
            const c = CONNECTORS[k]
            const s = status[k]
            const working = busy === k
            return (
              <div key={k} className="rounded-lg px-2.5 py-2.5 hover:bg-content/60">
                <div className="flex items-center gap-2">
                  <span className={cn('size-2 shrink-0 rounded-full', dot(k))} aria-hidden />
                  <span className="text-[13px] font-medium text-ink">{c.label}</span>
                  <span className="ml-auto text-[11px] text-ink-subtle">
                    {s.connected ? (s.needs_reconnect ? 'Sign-in expired' : `Connected ${date(s.connected_at)}`) : 'Not connected'}
                  </span>
                </div>
                <p className="mt-1 pl-4 text-xs leading-relaxed text-ink-muted">{c.blurb}</p>
                <div className="mt-2 pl-4">
                  {!s.connected || s.needs_reconnect ? (
                    <button type="button" onClick={() => void connect(k)} disabled={working}
                      className="inline-flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60">
                      {working ? <Loader2 className="size-3 animate-spin" /> : <Link2 className="size-3" />}
                      {s.connected ? `Reconnect ${c.label}` : `Connect to ${c.label}`}
                    </button>
                  ) : confirming === k ? (
                    <div className="flex items-center gap-2">
                      <button type="button" onClick={() => void disconnect(k)} disabled={working}
                        className="inline-flex items-center gap-1.5 rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60">
                        {working && <Loader2 className="size-3 animate-spin" />} Yes, disconnect
                      </button>
                      <button type="button" onClick={() => setConfirming(null)} className="text-xs text-ink-muted hover:text-ink">Keep it</button>
                    </div>
                  ) : (
                    <button type="button" onClick={() => setConfirming(k)}
                      className="inline-flex items-center gap-1.5 text-xs font-medium text-danger hover:underline">
                      <Unplug className="size-3.5" /> Disconnect
                    </button>
                  )}
                  {errors[k] && <p role="alert" className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">{errors[k]}</p>}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
