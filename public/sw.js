// Minimal service worker: makes the app installable (PWA), handles Web Push
// notifications, and routes notification clicks back into the app. No offline
// caching by design - the app needs live Supabase data.

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {
  // network passthrough; presence of this handler enables install prompts
})

// Web Push: shows a system notification. Payload shape (set by send-push fn):
//   { title, body, url, tag, icon }
// iOS Safari requires that EVERY push event call showNotification(); silent
// pushes will be rate-limited and eventually disable the subscription. So we
// always fire a notification, even with a fallback title, if the payload is
// unparseable or empty.
self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch (_e) {
    payload = { title: 'WashLyfe', body: event.data ? event.data.text() : '' }
  }
  const title = payload.title || 'WashLyfe'
  const options = {
    body: payload.body || 'New activity',
    icon: payload.icon || '/icon-192.png',
    badge: '/icon-192.png',
    tag: payload.tag || 'washlyfe',
    data: { url: payload.url || '/app/messages' },
    renotify: true,
    requireInteraction: false,
  }
  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const targetUrl = (event.notification.data && event.notification.data.url) || '/app/dashboard'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) {
          c.focus()
          if ('navigate' in c) c.navigate(targetUrl)
          return
        }
      }
      return self.clients.openWindow(targetUrl)
    }),
  )
})
