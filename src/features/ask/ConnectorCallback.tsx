import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { CONNECTORS, connections, type ConnFinish, type ProviderKey } from '@/lib/queries/connections'

// Where CoreNav and FlexWash send people back after they sign in
// (/app/corenav/callback, /app/flexwash/callback). Finishes the connection, says
// what Operator AI can now read, and goes back. Which provider comes from the
// path (lazy route pages don't take props here).
type State =
  | { kind: 'working' }
  | { kind: 'done'; result: ConnFinish }
  | { kind: 'failed'; message: string }

const BACK_LABELS: Record<string, string> = { '/app/ask': 'Back to Operator AI', '/app/corenav-map': 'Back to CoreNav Map' }

// The code is single use; React's dev double-run of effects must not spend it twice.
const finished = new Set<string>()

export default function ConnectorCallback() {
  const { pathname } = useLocation()
  const provider: ProviderKey = pathname.includes('/flexwash/') ? 'flexwash' : 'corenav'
  const label = CONNECTORS[provider].label
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const code = params.get('code')
  const state = params.get('state')
  const denied = params.get('error')
  const [view, setView] = useState<State>(() =>
    denied
      ? { kind: 'failed', message: denied === 'access_denied' ? `The ${label} sign-in was cancelled.` : `${label} said: ${params.get('error_description') ?? denied}.` }
      : !code || !state
        ? { kind: 'failed', message: `This page is where ${label} sends you after signing in. Start from Connections in Operator AI.` }
        : { kind: 'working' })
  const [retrying, setRetrying] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (!code || !state || denied || ran.current || finished.has(state)) return
    ran.current = true
    finished.add(state)
    connections.finish(provider, code, state)
      .then((result) => setView({ kind: 'done', result }))
      .catch((e) => setView({ kind: 'failed', message: e instanceof Error ? e.message : `Couldn't finish connecting ${label}.` }))
  }, [code, state, denied, provider, label])

  // Where they started the sign-in (the CoreNav Map page sets this), else Operator AI.
  const [backTo] = useState(() => {
    try {
      const v = sessionStorage.getItem('connect.back')
      return v && /^\/app\/[a-z0-9/-]+$/.test(v) ? v : '/app/ask'
    } catch { return '/app/ask' }
  })
  const backLabel = BACK_LABELS[backTo] ?? 'Back'
  const back = () => {
    try { sessionStorage.removeItem('connect.back') } catch { /* private mode */ }
    navigate(backTo, { replace: true })
  }
  const retry = async () => {
    setRetrying(true)
    try {
      const { url } = await connections.start(provider)
      window.location.assign(url)
    } catch (e) {
      setView({ kind: 'failed', message: e instanceof Error ? e.message : `Couldn't start the ${label} sign-in.` })
      setRetrying(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {view.kind === 'working' && (
        <>
          <Loader2 className="size-8 animate-spin text-accent" />
          <h1 className="mt-4 text-lg font-semibold text-ink">Connecting {label}…</h1>
          <p className="mt-1 text-sm text-ink-muted">Finishing the sign-in and checking what Operator AI can read.</p>
        </>
      )}

      {view.kind === 'done' && (
        <>
          <CheckCircle2 className="size-9 text-ok" />
          <h1 className="mt-4 text-lg font-semibold text-ink">{label} is connected</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {view.result.tools == null
              ? `Operator AI will use your ${label} login when you ask about ${label}. It couldn't list ${label}'s tools just now, so it will try again when you ask.`
              : view.result.tools.length
                ? `Operator AI can now read ${label} with your login: ${view.result.tools.length} ${label} tool${view.result.tools.length === 1 ? '' : 's'}. Ask about anything in ${label}, alongside your Operator data.`
                : `You're connected, but your ${label} login doesn't offer anything Operator AI can read.`}
          </p>
          {view.result.skipped.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
              Left out because they change data in {label}: {view.result.skipped.join(', ')}. Operator AI only reads.
            </p>
          )}
          <Button className="mt-6" onClick={back}>{backLabel}</Button>
        </>
      )}

      {view.kind === 'failed' && (
        <>
          <XCircle className="size-9 text-danger" />
          <h1 className="mt-4 text-lg font-semibold text-ink">{label} isn't connected</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{view.message}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={back}>{backLabel}</Button>
            <Button onClick={() => void retry()} disabled={retrying}>
              {retrying && <Loader2 className="size-4 animate-spin" />} Try again
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
