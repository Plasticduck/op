import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { CheckCircle2, Loader2, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { corenav, type CoreNavFinish } from '@/lib/queries/corenav'

// Where CoreNav sends people back after they sign in (/app/corenav/callback).
// Finishes the connection, says what Operator AI can now read, and goes back.
type State =
  | { kind: 'working' }
  | { kind: 'done'; result: CoreNavFinish }
  | { kind: 'failed'; message: string }

// The code is single use; React's dev double-run of effects must not spend it twice.
const finished = new Set<string>()

export default function CoreNavCallback() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const code = params.get('code')
  const state = params.get('state')
  const denied = params.get('error')
  const [view, setView] = useState<State>(() =>
    denied
      ? { kind: 'failed', message: denied === 'access_denied' ? 'The CoreNav sign-in was cancelled.' : `CoreNav said: ${params.get('error_description') ?? denied}.` }
      : !code || !state
        ? { kind: 'failed', message: 'This page is where CoreNav sends you after signing in. Start from Connect to CoreNav in Operator AI.' }
        : { kind: 'working' })
  const [retrying, setRetrying] = useState(false)
  const ran = useRef(false)

  useEffect(() => {
    if (!code || !state || denied || ran.current || finished.has(state)) return
    ran.current = true
    finished.add(state)
    corenav.finish(code, state)
      .then((result) => setView({ kind: 'done', result }))
      .catch((e) => setView({ kind: 'failed', message: e instanceof Error ? e.message : "Couldn't finish connecting CoreNav." }))
  }, [code, state, denied])

  const back = () => navigate('/app/ask', { replace: true })
  const retry = async () => {
    setRetrying(true)
    try {
      const { url } = await corenav.start()
      window.location.assign(url)
    } catch (e) {
      setView({ kind: 'failed', message: e instanceof Error ? e.message : "Couldn't start the CoreNav sign-in." })
      setRetrying(false)
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col items-center justify-center px-4 py-10 text-center">
      {view.kind === 'working' && (
        <>
          <Loader2 className="size-8 animate-spin text-accent" />
          <h1 className="mt-4 text-lg font-semibold text-ink">Connecting CoreNav…</h1>
          <p className="mt-1 text-sm text-ink-muted">Finishing the sign-in and checking what Operator AI can read.</p>
        </>
      )}

      {view.kind === 'done' && (
        <>
          <CheckCircle2 className="size-9 text-ok" />
          <h1 className="mt-4 text-lg font-semibold text-ink">CoreNav is connected</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">
            {view.result.tools == null
              ? "Operator AI will use your CoreNav login when you ask about CoreNav. It couldn't list CoreNav's tools just now, so it will try again when you ask."
              : view.result.tools.length
                ? `Operator AI can now read CoreNav with your login: ${view.result.tools.length} CoreNav tool${view.result.tools.length === 1 ? '' : 's'}. Ask about anything in CoreNav.`
                : "You're connected, but your CoreNav login doesn't offer anything Operator AI can read."}
          </p>
          {view.result.skipped.length > 0 && (
            <p className="mt-2 text-xs leading-relaxed text-ink-subtle">
              Left out because they change data in CoreNav: {view.result.skipped.join(', ')}. Operator AI only reads.
            </p>
          )}
          <Button className="mt-6" onClick={back}>Back to Operator AI</Button>
        </>
      )}

      {view.kind === 'failed' && (
        <>
          <XCircle className="size-9 text-danger" />
          <h1 className="mt-4 text-lg font-semibold text-ink">CoreNav isn't connected</h1>
          <p className="mt-2 text-sm leading-relaxed text-ink-muted">{view.message}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button variant="secondary" onClick={back}>Back to Operator AI</Button>
            <Button onClick={() => void retry()} disabled={retrying}>
              {retrying && <Loader2 className="size-4 animate-spin" />} Try again
            </Button>
          </div>
        </>
      )}
    </div>
  )
}
