// signage-request-email — Supabase Edge Function (Deno).
// Emails a newly submitted signage request (with the artwork PDF attached) to
// info@washlyfe.com. Best-effort side-effect: the request row is written
// client-side first, so a missing key just returns 503 { error: 'no_key' }.
//
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM, SIGNAGE_EMAIL_TO.
// Auto-provided: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

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
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  }
}
const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
  })

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'Email is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const fromAddr = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const toAddr = Deno.env.get('SIGNAGE_EMAIL_TO') ?? 'info@washlyfe.com'

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerId = u.user?.id
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  let body: { request_id?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const requestId = body.request_id
  if (!requestId) return json({ error: 'bad_request' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  const { data: caller } = await svc
    .from('users')
    .select('account_id')
    .eq('id', callerId)
    .maybeSingle()
  if (!caller) return json({ error: 'forbidden' }, 403, origin)

  const { data: r } = await svc
    .from('signage_requests')
    .select('*, locations:location_id(name)')
    .eq('id', requestId)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const req0 = r as any
  if (!req0 || req0.account_id !== caller.account_id) {
    return json({ error: 'not_found' }, 404, origin)
  }

  const siteName = (req0.locations?.name ?? '').trim()
  const size = req0.size_option
    ? `${req0.size_option}${req0.sided ? ` (${req0.sided} sided)` : ''}`
    : req0.width && req0.height
      ? `${req0.width} x ${req0.height} ${req0.size_unit === 'ft' ? 'ft' : 'in'}`
      : '—'
  const requester = `${req0.first_name ?? ''} ${req0.last_name ?? ''}`.trim() || '—'

  const rows: [string, string][] = [
    ['Site', siteName || '—'],
    ['Requested by', requester],
    ['Sign category', req0.sign_category ?? '—'],
    ['Sign type', req0.sign_type ?? '—'],
    ['Size', size],
    ['Quantity', String(req0.quantity ?? '—')],
    ['Artwork', req0.artwork_name ?? (req0.artwork_path ? 'attached' : 'none')],
  ]

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">New Operator Signage Order${siteName ? ' — ' + esc(siteName) : ''}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`,
          )
          .join('')}
      </table>
      <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.${
        req0.artwork_path ? ' Artwork PDF attached.' : ''
      }</p>
    </div>
  `

  // Attach the artwork PDF if present.
  // deno-lint-ignore no-explicit-any
  const attachments: any[] = []
  if (req0.artwork_path) {
    const { data: blob } = await svc.storage.from('signage-artwork').download(req0.artwork_path)
    if (blob) {
      const bytes = new Uint8Array(await blob.arrayBuffer())
      attachments.push({
        filename: req0.artwork_name ?? 'artwork.pdf',
        content: toBase64(bytes),
      })
    }
  }

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: [toAddr],
      subject: `Operator Signage Order${siteName ? ' ' + siteName : ''}`,
      html,
      attachments: attachments.length ? attachments : undefined,
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502, origin)
  }
})
