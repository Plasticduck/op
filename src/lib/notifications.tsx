import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'

export type Notification = {
  id: string
  kind: string
  payload: Record<string, unknown>
  read_at: string | null
  created_at: string
}

type NotificationState = {
  items: Notification[]
  unread: number
  markRead: (id: string) => Promise<void>
  markAllRead: () => Promise<void>
}

const Ctx = createContext<NotificationState | undefined>(undefined)

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const { profile } = useAuth()
  const [items, setItems] = useState<Notification[]>([])

  const load = useCallback(async () => {
    if (!profile) return
    const { data } = await supabase
      .from('notifications')
      .select('id, kind, payload, read_at, created_at')
      .order('created_at', { ascending: false })
      .limit(30)
    setItems((data as Notification[] | null) ?? [])
  }, [profile])

  useEffect(() => {
    void load()
    if (!profile) return
    const channel = supabase
      .channel('notifications')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `user_id=eq.${profile.id}`,
        },
        (payload) => {
          setItems((prev) => [payload.new as Notification, ...prev].slice(0, 30))
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
  }, [profile, load])

  const markRead = async (id: string) => {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read_at: new Date().toISOString() } : n)))
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
  }

  const markAllRead = async () => {
    const now = new Date().toISOString()
    setItems((prev) => prev.map((n) => (n.read_at ? n : { ...n, read_at: now })))
    await supabase.from('notifications').update({ read_at: now }).is('read_at', null)
  }

  const unread = items.filter((n) => !n.read_at).length

  return (
    <Ctx.Provider value={{ items, unread, markRead, markAllRead }}>
      {children}
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications(): NotificationState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useNotifications must be used within <NotificationsProvider>')
  return ctx
}
