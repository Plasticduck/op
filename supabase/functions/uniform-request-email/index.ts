// uniform-request-email — Supabase Edge Function (Deno).
// Emails a newly submitted uniform request to info@washlyfe.com (same recipient
// as signage orders). Best-effort side-effect: the request row is written
// client-side first, so a missing key just returns 503 { error: 'no_key' }.
//
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM, UNIFORM_EMAIL_TO
// (falls back to SIGNAGE_EMAIL_TO, then info@washlyfe.com).
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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'Email is not configured.' }, 503, origin)

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const fromAddr = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const toAddr = Deno.env.get('UNIFORM_EMAIL_TO') ?? Deno.env.get('SIGNAGE_EMAIL_TO') ?? 'info@washlyfe.com'

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

  const { data: caller } = await svc.from('users').select('account_id, name').eq('id', callerId).maybeSingle()
  // deno-lint-ignore no-explicit-any
  const callerRow = caller as any
  if (!callerRow) return json({ error: 'forbidden' }, 403, origin)

  const { data: r } = await svc
    .from('uniform_requests')
    .select('*, employees:employee_id(first_name, last_name), locations:location_id(name, account_id)')
    .eq('id', requestId)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const req0 = r as any
  const emp = req0?.employees
  const loc = req0?.locations
  if (!req0 || !loc || loc.account_id !== callerRow.account_id) {
    return json({ error: 'not_found' }, 404, origin)
  }

  // No employee = a Store Stock (general inventory) order.
  const employeeName = emp ? (`${emp.first_name ?? ''} ${emp.last_name ?? ''}`.trim() || '—') : 'Store Stock'
  const siteName = (loc.name ?? '').trim()
  const requester = (callerRow.name ?? '').trim() || '—'

  const rows: [string, string][] = [
    ['Employee', employeeName],
    ['Site', siteName || '—'],
    ['Requested by', requester],
    ['Item', req0.item ?? '—'],
    ['Size / Color', req0.size ?? '—'],
    ['Quantity', String(req0.quantity ?? '—')],
  ]

  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">New Operator Uniform Request${siteName ? ' — ' + esc(siteName) : ''}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`,
          )
          .join('')}
      </table>
      <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
    </div>
  `

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: [toAddr],
      subject: `Operator Uniform Request${siteName ? ' ' + siteName : ''}`,
      html,
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502, origin)
  }
})
