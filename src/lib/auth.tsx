import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Role } from '@/lib/rbac'

export type Profile = {
  id: string
  account_id: string
  location_ids: string[]
  role: Role
  name: string
  email: string
  avatar_url: string | null
}

type AuthState = {
  session: Session | null
  profile: Profile | null
  loading: boolean
  refreshProfile: () => Promise<void>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | undefined>(undefined)

async function loadProfile(userId: string): Promise<Profile | null> {
  const { data, error } = await supabase
    .from('users')
    .select('id, account_id, location_ids, role, name, email, avatar_url')
    .eq('id', userId)
    .maybeSingle()
  if (error) {
    // eslint-disable-next-line no-console
    console.error('[auth] failed to load profile', error)
    return null
  }
  return (data as Profile | null) ?? null
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<Profile | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    let settled = false
    const settle = () => {
      if (active && !settled) {
        settled = true
        setLoading(false)
      }
    }

    // Safety net: never let the app hang on the auth loader, no matter what
    // (network stall, token-refresh wedge, etc.). Routes treat this as
    // "logged out" if no session resolved by then.
    const safety = setTimeout(() => {
      // eslint-disable-next-line no-console
      console.warn('[auth] resolution timed out — rendering app without auth')
      settle()
    }, 4000)

    // IMPORTANT: this callback runs while supabase-js holds its auth lock.
    // Do NOT await another supabase call inside it (e.g. loadProfile →
    // supabase.from) — that deadlocks the lock. Update session synchronously
    // and defer the profile fetch to a new task.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      if (!next) {
        setProfile(null)
        settle()
        return
      }
      setTimeout(() => {
        loadProfile(next.user.id)
          .then((p) => {
            if (active) setProfile(p)
          })
          .finally(settle)
      }, 0)
    })

    // Fallback in case onAuthStateChange doesn't emit INITIAL_SESSION promptly.
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!active || settled) return
        if (!data.session) {
          settle()
          return
        }
        setSession(data.session)
        loadProfile(data.session.user.id)
          .then((p) => {
            if (active) setProfile(p)
          })
          .finally(settle)
      })
      .catch(settle)

    return () => {
      active = false
      clearTimeout(safety)
      sub.subscription.unsubscribe()
    }
  }, [])

  const value: AuthState = {
    session,
    profile,
    loading,
    refreshProfile: async () => {
      // Read the session fresh rather than from this closure — during signup
      // the session changes between render and when this is called.
      const { data } = await supabase.auth.getSession()
      setProfile(data.session ? await loadProfile(data.session.user.id) : null)
    },
    signOut: async () => {
      await supabase.auth.signOut()
    },
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}
