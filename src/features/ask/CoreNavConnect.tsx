import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Link2, Loader2, Unplug } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { cn } from '@/lib/utils'
import { CORENAV_ACCOUNT_ID, corenav, type CoreNavStatus } from '@/lib/queries/corenav'

// Operator AI header control: Connect to CoreNav with your own CoreNav login, or
// see that it's connected and disconnect it. Mighty Wash only, and not on the
// shared office login (a personal login doesn't belong on a shared screen).
export function CoreNavConnect() {
  const { profile } = useAuth()
  const eligible = profile?.account_id === CORENAV_ACCOUNT_ID && profile?.role_category !== 'corporate_display'
  const [status, setStatus] = useState<CoreNavStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!eligible) return
    let alive = true
    corenav.status().then((s) => { if (alive) setStatus(s) }).catch(() => { if (alive) setStatus({ connected: false }) })
    return () => { alive = false }
  }, [eligible])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setConfirming(false) } }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  if (!eligible || !status) return null

  const connect = async () => {
    setBusy(true)
    setError(null)
    try {
      const { url } = await corenav.start()
      window.location.assign(url) // CoreNav's sign-in page; it sends them back to /app/corenav/callback
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the CoreNav sign-in.")
      setBusy(false)
    }
  }

  const disconnect = async () => {
    setBusy(true)
    setError(null)
    try {
      await corenav.disconnect()
      setStatus({ connected: false })
      setOpen(false)
      setConfirming(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't disconnect CoreNav.")
    } finally {
      setBusy(false)
    }
  }

  const pill = 'inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition disabled:opacity-60'

  return (
    <div ref={box} className="relative ml-auto">
      {!status.connected ? (
        <button type="button" onClick={() => void connect()} disabled={busy}
          className={cn(pill, 'border-border bg-card text-ink hover:border-accent/50 hover:text-accent')}>
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Link2 className="size-3.5" />}
          Connect to CoreNav
        </button>
      ) : status.needs_reconnect ? (
        <button type="button" onClick={() => void connect()} disabled={busy}
          className={cn(pill, 'border-warn/40 bg-warn-soft text-warn hover:border-warn')}
          title="Your CoreNav sign-in expired. Sign in again to keep using CoreNav in Operator AI.">
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <AlertTriangle className="size-3.5" />}
          Reconnect CoreNav
        </button>
      ) : (
        <button type="button" onClick={() => { setOpen((v) => !v); setConfirming(false) }} aria-expanded={open}
          className={cn(pill, 'border-border bg-card text-ink hover:border-accent/50')}>
          <span className="size-2 rounded-full bg-ok" aria-hidden />
          CoreNav
          <ChevronDown className={cn('size-3.5 text-ink-subtle transition', open && 'rotate-180')} />
        </button>
      )}

      {open && status.connected && (
        <div className="absolute right-0 top-10 z-20 w-64 rounded-xl border border-border bg-card p-3 text-left shadow-lg">
          <p className="text-[13px] font-medium text-ink">CoreNav is connected</p>
          <p className="mt-1 text-xs leading-relaxed text-ink-muted">
            Operator AI reads CoreNav with your own login{status.connected_at ? `, connected ${new Date(status.connected_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}. It only reads; it can't change anything there.
          </p>
          {!confirming ? (
            <button type="button" onClick={() => setConfirming(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-danger hover:underline">
              <Unplug className="size-3.5" /> Disconnect
            </button>
          ) : (
            <div className="mt-3 flex items-center gap-2">
              <button type="button" onClick={() => void disconnect()} disabled={busy}
                className="inline-flex items-center gap-1.5 rounded-md bg-danger px-2.5 py-1 text-xs font-medium text-white disabled:opacity-60">
                {busy && <Loader2 className="size-3 animate-spin" />} Yes, disconnect
              </button>
              <button type="button" onClick={() => setConfirming(false)} className="text-xs text-ink-muted hover:text-ink">Keep it</button>
            </div>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="absolute right-0 top-10 z-20 w-64 rounded-md border border-danger/40 bg-danger-soft px-3 py-2 text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  )
}
