// Thin shim that lets PWA-style notification code work the same whether the
// page is running in a normal browser or inside the WashLyfe Operator iOS
// native shell. The native shell injects `window.__washlyfeNative = true` at
// document-start and exposes a `washlyfeBridge` message handler that schedules
// real iOS local notifications (UNNotificationRequest) — see
// `NotificationBridge.swift`. In a browser the same calls fall back to the
// standard Notification API and service-worker showNotification().

type NotifyPayload = { title: string; body: string; when?: number; id?: string }

type WebkitMessageHandler = { postMessage(message: unknown): void }
type WashlyfeWindow = Window & {
  __washlyfeNative?: boolean
  __washlyfeBundleId?: string
  __washlyfeAPNsToken?: (token: string) => void
  webkit?: {
    messageHandlers?: {
      washlyfeBridge?: WebkitMessageHandler
    }
  }
}

const w = (typeof window === 'undefined' ? undefined : (window as WashlyfeWindow))

export function isNativeShell(): boolean {
  return !!(w?.__washlyfeNative && w?.webkit?.messageHandlers?.washlyfeBridge)
}

export function nativeBundleId(): string | null {
  return w?.__washlyfeBundleId ?? null
}

// The native shell calls window.__washlyfeAPNsToken(token) once iOS hands us
// the device token. It may arrive before or after the page boots; we expose a
// subscribe helper so the registration code can attach a listener that fires
// either way (the token is replayed to late subscribers).
const apnsListeners = new Set<(token: string) => void>()
let lastApnsToken: string | null = null

if (w) {
  w.__washlyfeAPNsToken = (token: string) => {
    if (!token || token === lastApnsToken) return
    lastApnsToken = token
    for (const l of apnsListeners) {
      try { l(token) } catch { /* never let one bad listener block the rest */ }
    }
  }
}

export function onAPNsToken(handler: (token: string) => void): () => void {
  apnsListeners.add(handler)
  if (lastApnsToken) handler(lastApnsToken)
  return () => { apnsListeners.delete(handler) }
}

export function currentAPNsToken(): string | null {
  return lastApnsToken
}

// Returns 'granted' on native (the iOS app handles permission in the onboarding
// wizard; if the user denied, local notifications silently fail — same UX as a
// browser where permission has been denied). On the web, requests the real
// browser permission.
export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (isNativeShell()) return 'granted'
  if (typeof Notification === 'undefined') return 'denied'
  if (Notification.permission === 'granted' || Notification.permission === 'denied') {
    return Notification.permission
  }
  return Notification.requestPermission()
}

// Fires a notification now (or at `when` in the future, if provided). On native
// posts to the bridge so iOS schedules a real UNNotificationRequest — works
// foreground and backgrounded. On web uses the existing SW / Notification API
// path (foreground only).
export async function notify(payload: NotifyPayload): Promise<void> {
  const bridge = w?.webkit?.messageHandlers?.washlyfeBridge
  if (w?.__washlyfeNative && bridge) {
    bridge.postMessage({ type: 'notify', ...payload })
    return
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return
  const fire = () => {
    const reg = (navigator.serviceWorker as ServiceWorkerContainer | undefined)
    void reg?.getRegistration().then((r) => {
      if (r) r.showNotification(payload.title, { body: payload.body, icon: '/icon.svg', tag: payload.id ?? payload.title })
      else new Notification(payload.title, { body: payload.body })
    })
  }
  if (payload.when && payload.when > Date.now()) {
    setTimeout(fire, payload.when - Date.now())
  } else {
    fire()
  }
}
