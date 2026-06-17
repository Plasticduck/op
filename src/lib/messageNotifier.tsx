import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/lib/auth'
import { isNativeShell, notify, onAPNsToken } from '@/lib/nativeBridge'
import { registerAPNsToken } from '@/lib/push'

// Global incoming-message notifier. Mounted in AppShell so it runs on every
// authenticated page. Subscribes to all message INSERTs the user has RLS
// access to (i.e. messages in conversations they're a member of), then:
//   - Skips messages the user just sent themselves
//   - Skips messages in the conversation they're currently viewing
//   - Looks up the sender + conversation name for the notification text
//   - Inside the native iOS WKWebView shell: fires a local notification via
//     `NotificationBridge.swift` (real iOS banner, sound, lock-screen entry)
//   - In a regular browser tab that isn't focused: fires a Notification via
//     the service worker (banner / system notification)
//
// The Web Push pipeline (send-push edge function) still fires for the
// "device is offline / app is fully suspended" case — this just plugs the
// "app is actively running" gap where SW push would be redundant or
// suppressed by the OS.

export function MessageNotifier() {
  const { profile } = useAuth()
  const location = useLocation()
  const activeConvId = location.pathname.startsWith('/app/messages/')
    ? location.pathname.replace('/app/messages/', '').split('/')[0]
    : null
  const activeConvRef = useRef(activeConvId)
  useEffect(() => { activeConvRef.current = activeConvId }, [activeConvId])
  const isPageVisibleRef = useRef(typeof document !== 'undefined' ? document.visibilityState === 'visible' : true)

  useEffect(() => {
    const onVis = () => { isPageVisibleRef.current = document.visibilityState === 'visible' }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])

  // Native iOS shell: persist the APNs device token as a push_subscriptions
  // row the moment iOS hands it to us. The token may arrive before or after
  // this effect runs; onAPNsToken replays the most recent value.
  useEffect(() => {
    if (!profile?.id) return
    if (!isNativeShell()) return
    return onAPNsToken((token) => {
      void registerAPNsToken(profile.id, token).catch((e) =>
        console.warn('APNs registration failed', e),
      )
    })
  }, [profile?.id])

  useEffect(() => {
    if (!profile?.id) return
    const userId = profile.id

    const ch = supabase
      .channel('global-msg-notifier')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        async (payload) => {
          const m = payload.new as {
            id: string
            conversation_id: string
            sender_id: string
            body: string | null
            attachment_path: string | null
          }
          if (m.sender_id === userId) return
          // Skip the active conversation when the user is looking at it.
          if (m.conversation_id === activeConvRef.current && isPageVisibleRef.current) return

          // Look up sender + conversation labels for the banner text.
          const [{ data: sender }, { data: conv }] = await Promise.all([
            supabase.from('users').select('name, email').eq('id', m.sender_id).maybeSingle(),
            supabase
              .from('conversations')
              .select('kind, name, location_id, location:locations(name)')
              .eq('id', m.conversation_id)
              .maybeSingle(),
          ])
          const senderLabel = (sender?.name && sender.name.trim()) || sender?.email || 'Teammate'
          const convLabel = conv?.kind === 'site'
            ? (conv as { location: { name: string } | null }).location?.name ?? conv?.name ?? 'Team chat'
            : conv?.kind === 'group'
            ? (conv?.name ?? 'Group chat')
            : senderLabel
          const title = conv?.kind === 'dm' ? senderLabel : `${senderLabel} in ${convLabel}`
          const body = (m.body ?? '').slice(0, 180) || (m.attachment_path ? 'Sent an image' : '')

          if (isNativeShell()) {
            // Fires a real iOS local notification through NotificationBridge.swift.
            // Works while the WebView is alive (foregrounded + short background grace).
            void notify({ title, body, id: 'msg-' + m.id })
            return
          }

          // Browser path: if the tab is in the background, fire a Notification
          // via the service worker (the same SW that handles Web Push).
          if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
          if (isPageVisibleRef.current) return
          const reg = await navigator.serviceWorker.getRegistration()
          await reg?.showNotification(title, {
            body,
            icon: '/icon-192.png',
            badge: '/icon-192.png',
            tag: 'conv-' + m.conversation_id,
            data: { url: '/app/messages/' + m.conversation_id },
          })
        },
      )
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [profile?.id])

  return null
}
