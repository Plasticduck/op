import { supabase } from '@/lib/supabase'

// IT Inventory device heartbeats. A tablet or kiosk browser that runs Operator
// is linked to its own asset once (from that asset's page, on the device), and
// keeps the key here. While Operator is open, signed in or not, it reports in
// every minute; the server marks it offline after twice its interval (two
// minutes) without one. Nothing happens on devices that aren't linked.

const STORAGE_KEY = 'it.deviceLink'
const EVENT = 'it-device-link'
const EVERY_MS = 60_000

export type DeviceLink = { key: string; assetId: string; tag: string; name: string }

export function getDeviceLink(): DeviceLink | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as DeviceLink) : null
  } catch {
    return null
  }
}

export function setDeviceLink(link: DeviceLink | null) {
  try {
    if (link) localStorage.setItem(STORAGE_KEY, JSON.stringify(link))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* storage blocked: the device just won't report in */
  }
  window.dispatchEvent(new Event(EVENT))
}

export function onDeviceLinkChange(fn: () => void): () => void {
  window.addEventListener(EVENT, fn)
  return () => window.removeEventListener(EVENT, fn)
}

// "iPad, Safari" and the like, so the Timeline says which device was linked.
export function describeDevice(): string {
  const ua = navigator.userAgent
  const device = /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad'
    : /iPhone/.test(ua) ? 'iPhone'
      : /Android/.test(ua) ? (/Mobile/.test(ua) ? 'Android phone' : 'Android tablet')
        : /Windows/.test(ua) ? 'Windows PC' : /Macintosh/.test(ua) ? 'Mac' : /CrOS/.test(ua) ? 'Chromebook' : 'browser'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Chrome\//.test(ua) ? 'Chrome' : /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : ''
  return browser ? `${device}, ${browser}` : device
}

let started = false

// Called once at startup (main.tsx).
export function startDeviceHeartbeat() {
  if (started) return
  started = true
  let last = 0
  const beat = async () => {
    const link = getDeviceLink()
    if (!link || Date.now() - last < 20_000) return
    last = Date.now()
    const { data } = await supabase.rpc('it_heartbeat', { p_key: link.key })
    // Unlinked from another device: stop reporting in.
    if ((data as { ok?: boolean; reason?: string } | null)?.reason === 'unlinked') setDeviceLink(null)
  }
  window.setInterval(() => void beat(), EVERY_MS)
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') void beat() })
  window.addEventListener('online', () => void beat())
  onDeviceLinkChange(() => { last = 0; void beat() })
  void beat()
}
