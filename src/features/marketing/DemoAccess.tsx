import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'

// Landing target for the emailed demo magic link. Supabase verifies the link
// (via detectSessionInUrl) and signs the visitor in as themselves. We then call
// the `enter-demo` edge function, which validates the JWT/lead and returns a
// one-time magic-link verify URL for the demo account; navigating there swaps
// the visitor's session for the demo session. The demo password is never
// shipped to the browser.
export default function DemoAccess() {
  const [params] = useSearchParams()
  const [invalid, setInvalid] = useState(false)

  useEffect(() => {
    const lead = params.get('lead')
    if (!lead) {
      setInvalid(true)
      return
    }

    let done = false
    const enterDemo = async () => {
      done = true
      const { data, error } = await supabase.functions.invoke('enter-demo', { body: { lead } })
      if (error || !data?.url) {
        setInvalid(true)
        return
      }
      // Top-level navigation: Supabase's verify endpoint sets the demo session
      // and bounces back to /app/dashboard.
      window.location.replace(data.url)
    }

    // Poll for the session Supabase establishes from the magic-link hash.
    const check = async () => {
      if (done) return
      const { data } = await supabase.auth.getSession()
      if (data.session) await enterDemo()
    }
    void check()
    const id = setInterval(() => void check(), 500)
    const timeout = setTimeout(() => {
      if (!done) {
        clearInterval(id)
        setInvalid(true)
      }
    }, 8000)
    return () => {
      clearInterval(id)
      clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="grid min-h-dvh place-items-center bg-content px-4 text-center">
      {invalid ? (
        <div className="max-w-sm">
          <p className="text-sm text-ink">This demo link is invalid or has expired.</p>
          <Link to="/demo" className="mt-3 inline-block text-sm text-accent hover:underline">
            Request a new demo link
          </Link>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-ink-muted">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Opening your demo…</p>
        </div>
      )}
    </div>
  )
}
