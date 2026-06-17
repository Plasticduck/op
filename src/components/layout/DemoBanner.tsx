import { useEffect, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { billing, type Account } from '@/lib/queries/billing'
import { cn } from '@/lib/utils'

const ROLES = ['owner', 'manager', 'employee'] as const
type DemoRole = (typeof ROLES)[number]

// Shown only on the shared demo account (is_demo). Lets visitors role-switch
// and convert to a real trial. Role switches go through the `enter-demo` edge
// function so no demo credentials ship in the browser bundle.
export function DemoBanner() {
  const { profile } = useAuth()
  const [isDemo, setIsDemo] = useState<boolean | null>(null)

  useEffect(() => {
    if (!profile) return
    billing.account().then(({ data }) => setIsDemo(((data as Account | null)?.is_demo) ?? false))
  }, [profile])

  if (!isDemo) return null

  const switchRole = async (role: DemoRole) => {
    const { data, error } = await supabase.functions.invoke('enter-demo', { body: { role } })
    if (error || !data?.url) return
    window.location.replace(data.url)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 bg-shell px-4 py-2 text-sm text-ink-invert">
      <span className="inline-flex items-center gap-2">
        <Sparkles className="size-4 text-accent" />
        You're exploring the WashLyfe demo. Switch role:
        <span className="ml-1 inline-flex gap-1">
          {ROLES.map((r) => (
            <button
              key={r}
              onClick={() => switchRole(r)}
              className={cn(
                'rounded px-2 py-0.5 text-xs capitalize',
                profile?.role === r
                  ? 'bg-accent text-white'
                  : 'bg-white/10 text-ink-invert-muted hover:bg-white/20',
              )}
            >
              {r}
            </button>
          ))}
        </span>
      </span>
      <a
        href="/signup"
        className="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover"
      >
        Start your free trial
      </a>
    </div>
  )
}
