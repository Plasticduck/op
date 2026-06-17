// send-push — fans out a notification to every device for every member of a
// conversation EXCEPT the sender. Triggered by the client after a message is
// inserted; we trust the auth, then re-validate that the sender is actually a
// member of the target conversation.
//
// Routes by endpoint scheme:
//   https://... → Web Push (VAPID, web-push library)
//   apns://...  → Apple Push Notification service for the native iOS app
//                 (HTTP/2 + JWT token auth, signed inline)
//
// Body: { conversation_id: string, message_id: string }  (or { test: true })
// Headers: Authorization: Bearer <user JWT>
//
// Required Supabase secrets:
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (web push)
//   APNS_AUTH_KEY (the .p8 private key contents, including header/footer)
//   APNS_KEY_ID   (10-char key id from Apple Developer)
//   APNS_TEAM_ID  (10-char team id)
//   APNS_TOPIC    (bundle id, e.g. WashLyfe-Media.WashLyfe-Operator)
//   APNS_USE_SANDBOX = "1" to send to api.sandbox.push.apple.com instead of
//                     production (use for TestFlight / debug builds)

import { createClient } from 'npm:@supabase/supabase-js@2'
import webpush from 'npm:web-push@3.6.7'

const ALLOWED_ORIGINS = new Set<string>([
  'https://operator.washlyfe.com',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:4173',
])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return {
    'Access-Control-Allow-Origin': allow,
    'Vary': 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (b: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

const VAPID_PUBLIC = Deno.env.get('VAPID_PUBLIC_KEY')
const VAPID_PRIVATE = Deno.env.get('VAPID_PRIVATE_KEY')
const VAPID_SUBJECT = Deno.env.get('VAPID_SUBJECT') ?? 'mailto:support@washlyfe.com'

if (VAPID_PUBLIC && VAPID_PRIVATE) {
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE)
}

// iOS / Apple Web Push works best when the sender sets `urgency: high` so APNs
// delivers immediately instead of coalescing on background, and a `topic` so
// repeated messages in the same chat replace rather than stack up. Both also
// help Chrome/Firefox on flaky networks.
const PUSH_OPTS = (tag: string) => ({
  urgency: 'high' as const,
  topic: tag.slice(0, 32), // RFC 8030: max 32 url-safe base64 chars
  TTL: 60 * 60 * 24,        // 24h — if the device is offline that long, drop it
})

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return json({ error: 'vapid_not_configured' }, 503, origin)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const senderId = u.user?.id
  if (!senderId) return json({ error: 'unauthorized' }, 401, origin)

  let body: { conversation_id?: string; message_id?: string; test?: boolean } = {}
  try { body = await req.json() } catch { /* empty */ }
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Test mode: send a sample push to the caller's own devices so they can
  // verify their iPhone PWA / desktop browser is actually receiving.
  if (body.test) {
    const { data: subs } = await svc
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', senderId)
    return await fanOut(svc, subs ?? [], JSON.stringify({
      title: 'WashLyfe',
      body: 'Notifications are working on this device.',
      url: '/app/messages',
      tag: 'test-' + senderId.slice(0, 8),
    }), origin)
  }

  const conversationId = body.conversation_id
  const messageId = body.message_id
  if (!conversationId || !messageId) return json({ error: 'bad_request' }, 400, origin)

  // Verify the sender is a member of the conversation.
  const { data: mem } = await userClient
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', conversationId)
    .eq('user_id', senderId)
    .maybeSingle()
  if (!mem) return json({ error: 'forbidden' }, 403, origin)

  // From here we use the service role to read the message + recipients +
  // subscriptions (which RLS would otherwise restrict to the caller).
  const { data: message } = await svc
    .from('messages')
    .select('id, body, attachment_path, sender_id, conversation_id')
    .eq('id', messageId)
    .single()
  if (!message || message.conversation_id !== conversationId) return json({ error: 'not_found' }, 404, origin)

  const { data: conv } = await svc
    .from('conversations')
    .select('id, kind, name, location_id, locations(name)')
    .eq('id', conversationId)
    .single()
  const { data: sender } = await svc.from('users').select('id, name, email').eq('id', senderId).single()

  const senderLabel = (sender?.name && sender.name.trim()) || sender?.email || 'Teammate'
  const convLabel = conv?.kind === 'site'
    ? (conv as { locations: { name: string } | null }).locations?.name ?? conv?.name ?? 'Team chat'
    : conv?.kind === 'group'
    ? (conv?.name ?? 'Group chat')
    : senderLabel

  const title = conv?.kind === 'dm' ? senderLabel : `${senderLabel} in ${convLabel}`
  const bodyText = (message.body ?? '').slice(0, 180) || (message.attachment_path ? 'Sent an image' : '')

  const { data: subs } = await svc
    .from('push_subscriptions')
    .select('id, user_id, endpoint, p256dh, auth')
    .neq('user_id', senderId)
    .in(
      'user_id',
      (await svc.from('conversation_members').select('user_id').eq('conversation_id', conversationId)).data?.map(
        (m: { user_id: string }) => m.user_id,
      ) ?? [],
    )

  const payload = JSON.stringify({
    title,
    body: bodyText,
    url: '/app/messages/' + conversationId,
    tag: 'conv-' + conversationId,
  })

  return await fanOut(svc, subs ?? [], payload, origin)
})

// Send the same payload to every subscription. Prunes 404/410 endpoints (which
// means the browser uninstalled / token rotated) and returns per-device counts.
// deno-lint-ignore no-explicit-any
async function fanOut(svc: any, subs: Array<{ id: string; endpoint: string; p256dh: string; auth: string }>, payload: string, origin: string | null) {
  if (subs.length === 0) {
    return json({ ok: true, sent: 0, pruned: 0, total: 0, note: 'no_subscriptions' }, 200, origin)
  }
  const tag = (JSON.parse(payload).tag as string | undefined) ?? 'msg'
  const opts = PUSH_OPTS(tag)
  let ok = 0
  const stale: string[] = []
  const errors: Array<{ host: string; status: number; body: string }> = []
  let apnsSkipped = 0
  await Promise.all(
    subs.map(async (s) => {
      try {
        // APNs path (native iOS app). Endpoint format: apns://<bundle>/<hex>
        if (s.endpoint.startsWith('apns://')) {
          const result = await sendAPNs(s.endpoint, payload)
          if (result === 'no_config') { apnsSkipped++; return }
          if (result === 'gone') { stale.push(s.id); return }
          if (result === 'ok') { ok++; return }
          errors.push({ host: 'apns', status: result.status, body: result.body })
          return
        }
        // Web Push path (https endpoints)
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          payload,
          opts,
        )
        ok++
      } catch (e) {
        const err = e as { statusCode?: number; body?: string; message?: string }
        const status = err.statusCode ?? 0
        if (status === 404 || status === 410) {
          stale.push(s.id)
        } else {
          const host = (() => { try { return new URL(s.endpoint).hostname } catch { return '?' } })()
          errors.push({ host, status, body: (err.body ?? err.message ?? '').toString().slice(0, 200) })
          console.error('push fail', host, status, err.body ?? err.message)
        }
      }
    }),
  )
  if (stale.length > 0) {
    await svc.from('push_subscriptions').delete().in('id', stale)
  }
  return json({ ok: true, sent: ok, pruned: stale.length, total: subs.length, apns_skipped: apnsSkipped, errors }, 200, origin)
}

// ---- APNs HTTP/2 with JWT token auth -------------------------------------
//
// Apple wants an ES256-signed JWT in the Authorization header. Token is valid
// for ~1h; we cache it across invocations of the same Edge Function instance
// to avoid re-signing on every push.

const APNS_AUTH_KEY = Deno.env.get('APNS_AUTH_KEY')        // .p8 contents
const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID')             // 10 chars
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID')           // 10 chars
const APNS_TOPIC = Deno.env.get('APNS_TOPIC') ?? 'WashLyfe-Media.WashLyfe-Operator'
const APNS_HOST = Deno.env.get('APNS_USE_SANDBOX') === '1'
  ? 'https://api.sandbox.push.apple.com'
  : 'https://api.push.apple.com'

let apnsJwt: { token: string; expires: number } | null = null
let apnsKey: CryptoKey | null = null

function b64urlFromBytes(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlFromString(s: string): string {
  return b64urlFromBytes(new TextEncoder().encode(s))
}

// Parse a PEM-encoded PKCS#8 private key (the .p8 Apple issues) into a usable
// CryptoKey for ES256 signing.
async function importApnsKey(): Promise<CryptoKey> {
  if (apnsKey) return apnsKey
  const pem = (APNS_AUTH_KEY ?? '').trim()
  const stripped = pem
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s+/g, '')
  const der = Uint8Array.from(atob(stripped), (c) => c.charCodeAt(0))
  apnsKey = await crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )
  return apnsKey
}

async function apnsToken(): Promise<string | null> {
  if (!APNS_AUTH_KEY || !APNS_KEY_ID || !APNS_TEAM_ID) return null
  const now = Math.floor(Date.now() / 1000)
  // Reuse the cached JWT for 50 minutes (Apple allows up to 60).
  if (apnsJwt && apnsJwt.expires - now > 600) return apnsJwt.token
  const header = b64urlFromString(JSON.stringify({ alg: 'ES256', kid: APNS_KEY_ID, typ: 'JWT' }))
  const claims = b64urlFromString(JSON.stringify({ iss: APNS_TEAM_ID, iat: now }))
  const signingInput = header + '.' + claims
  const key = await importApnsKey()
  const sig = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signingInput),
  ))
  const token = signingInput + '.' + b64urlFromBytes(sig)
  apnsJwt = { token, expires: now + 50 * 60 }
  return token
}

type ApnsResult = 'ok' | 'gone' | 'no_config' | { status: number; body: string }

async function sendAPNs(endpoint: string, payload: string): Promise<ApnsResult> {
  if (!APNS_AUTH_KEY || !APNS_KEY_ID || !APNS_TEAM_ID) return 'no_config'
  const m = endpoint.match(/^apns:\/\/[^/]+\/([0-9a-f]{32,})$/i)
  if (!m) return { status: 0, body: 'bad apns endpoint' }
  const deviceToken = m[1]

  // Map the web payload to Apple's APS dictionary. We put the original payload
  // into a top-level "data" key too so the native side can read tag / url if
  // it ever wants to deep-link.
  const p = JSON.parse(payload) as { title?: string; body?: string; url?: string; tag?: string }
  const apsBody = {
    aps: {
      alert: { title: p.title ?? 'WashLyfe', body: p.body ?? '' },
      sound: 'default',
      'thread-id': p.tag ?? 'washlyfe',
    },
    data: { url: p.url ?? '/app/messages', tag: p.tag ?? null },
  }

  const tok = await apnsToken()
  if (!tok) return 'no_config'

  const res = await fetch(APNS_HOST + '/3/device/' + deviceToken, {
    method: 'POST',
    headers: {
      'authorization': 'bearer ' + tok,
      'apns-topic': APNS_TOPIC,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': String(Math.floor(Date.now() / 1000) + 60 * 60 * 24),
      'content-type': 'application/json',
    },
    body: JSON.stringify(apsBody),
  })
  if (res.status === 200) return 'ok'
  const body = await res.text()
  // 410 Gone or BadDeviceToken / Unregistered → prune the row.
  if (res.status === 410 || /BadDeviceToken|Unregistered/.test(body)) return 'gone'
  console.error('apns fail', res.status, body)
  return { status: res.status, body: body.slice(0, 200) }
}
