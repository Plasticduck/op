// Web Push enrollment. Idempotent: enroll() can be called every time the user
// signs in. It will register the service worker, ask for notification permission
// the first time, and store the resulting PushSubscription server-side.
//
// Also exposes registerAPNsToken() for the native iOS shell: when the native
// AppDelegate captures a device token, we store it as a row in
// push_subscriptions using a synthetic `apns://<token>` endpoint. The
// send-push edge function routes those endpoints through APNs HTTP/2 instead
// of the Web Push API.

import { supabase } from '@/lib/supabase'
import { nativeBundleId } from '@/lib/nativeBridge'

const VAPID_PUBLIC = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = window.atob(base64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

function bufToB64(buf: ArrayBuffer | null): string {
  if (!buf) return ''
  const bytes = new Uint8Array(buf)
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return window.btoa(s)
}

export function isPushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  if (typeof Notification === 'undefined') return 'unsupported'
  return Notification.permission
}

// Subscribe + persist the subscription. Returns the subscription object on
// success, null if push isn't supported, throws if the user denied permission.
export async function enrollForPush(userId: string): Promise<PushSubscription | null> {
  if (!isPushSupported()) return null
  if (!VAPID_PUBLIC) {
    console.warn('VITE_VAPID_PUBLIC_KEY missing; push disabled')
    return null
  }
  const reg = await navigator.serviceWorker.ready
  let sub = await reg.pushManager.getSubscription()
  if (!sub) {
    const perm = await Notification.requestPermission()
    if (perm !== 'granted') return null
    // BufferSource type for applicationServerKey requires ArrayBuffer, not
    // ArrayBufferLike. Pass the underlying buffer slice explicitly.
    const keyBytes = urlBase64ToUint8Array(VAPID_PUBLIC)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
    })
  }
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } }
  await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent,
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint' },
  )
  return sub
}

// Remove the local subscription + drop the server row. Used on sign-out.
export async function unenrollFromPush(userId: string): Promise<void> {
  if (!isPushSupported()) return
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (!sub) return
  const ep = sub.endpoint
  await sub.unsubscribe().catch(() => {})
  await supabase.from('push_subscriptions').delete().eq('user_id', userId).eq('endpoint', ep)
}

// Persist a native iOS APNs device token as a `push_subscriptions` row. We
// encode the token + bundle id into the endpoint URL ("apns://<bundle>/<hex>")
// and put placeholder values in the unused web-push key columns so the row
// satisfies the NOT NULL constraints without storing fake keys that could be
// mistaken for valid ones.
export async function registerAPNsToken(userId: string, token: string): Promise<void> {
  const bundle = nativeBundleId() || 'WashLyfe-Media.WashLyfe-Operator'
  const endpoint = 'apns://' + bundle + '/' + token
  await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint,
      p256dh: 'apns',
      auth: 'apns',
      user_agent: navigator.userAgent + ' [native iOS]',
      last_used_at: new Date().toISOString(),
    },
    { onConflict: 'user_id,endpoint' },
  )
}

// One-tap encode helper for tests.
export const __test = { bufToB64, urlBase64ToUint8Array }
