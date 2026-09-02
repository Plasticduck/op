// email-site-review — Supabase Edge Function (Deno).
// Emails a submitted RM Site Review PDF (built client-side so its photo links
// resolve) to the reviews recipient. Best-effort side-effect: the review row is
// written client-side first, so a missing key just returns 503 { error: 'no_key' }.
//
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM, SITE_REVIEW_EMAIL_TO
// (comma-separated fixed recipients; falls back to lkeith + kjowers). Each site
// also gets a copy at its own address, derived from the site name (MW01 ->
// mw01@mighty-wash.com).
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
  const baseTo = (Deno.env.get('SITE_REVIEW_EMAIL_TO') ?? 'lkeith@mighty-wash.com,kjowers@mighty-wash.com')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  const callerId = u.user?.id
  if (!callerId) return json({ error: 'unauthorized' }, 401, origin)

  let body: {
    review_id?: string
    pdf_base64?: string
    filename?: string
    site_name?: string | null
    submitted_by?: string | null
    date?: string | null
  } = {}
  try { body = await req.json() } catch { /* empty */ }
  const reviewId = body.review_id
  const pdfB64 = body.pdf_base64
  if (!reviewId || !pdfB64) return json({ error: 'bad_request' }, 400, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // Caller must be a manager+ (Regional Manager / Executive are managers too).
  const { data: caller } = await svc.from('users').select('account_id, role').eq('id', callerId).maybeSingle()
  // deno-lint-ignore no-explicit-any
  const callerRow = caller as any
  if (!callerRow || !(callerRow.role === 'owner' || callerRow.role === 'manager')) {
    return json({ error: 'forbidden' }, 403, origin)
  }

  // The review must exist and belong to the caller's account.
  const { data: review } = await svc
    .from('site_evaluations')
    .select('id, account_id, submitted_by')
    .eq('id', reviewId)
    .maybeSingle()
  // deno-lint-ignore no-explicit-any
  const reviewRow = review as any
  if (!reviewRow || reviewRow.account_id !== callerRow.account_id) {
    return json({ error: 'not_found' }, 404, origin)
  }

  // The person who filled out the review also gets a copy.
  let submitterEmail: string | null = null
  if (reviewRow.submitted_by) {
    const { data: sub } = await svc.from('users').select('email').eq('id', reviewRow.submitted_by).maybeSingle()
    // deno-lint-ignore no-explicit-any
    submitterEmail = ((sub as any)?.email ?? '').trim() || null
  }

  const site = (body.site_name ?? '').trim()
  const submittedBy = (body.submitted_by ?? '').trim()
  const when = (body.date ?? '').trim()
  const filename = (body.filename ?? 'site-review.pdf').replace(/[^a-zA-Z0-9._-]/g, '-')

  // Each site also gets a copy at its own address, e.g. "MW01" -> mw01@mighty-wash.com.
  const siteLocal = site.toLowerCase().replace(/[^a-z0-9]/g, '')
  const siteEmail = siteLocal ? `${siteLocal}@mighty-wash.com` : null
  const recipients = Array.from(
    new Set([...baseTo, ...(siteEmail ? [siteEmail] : []), ...(submitterEmail ? [submitterEmail] : [])]),
  )

  const rows: [string, string][] = [
    ['Site', site || '—'],
    ['Submitted by', submittedBy || '—'],
    ['Date', when ? new Date(when).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—'],
  ]
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:560px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 16px;font-size:20px;">New RM Site Review${site ? ' — ' + esc(site) : ''}</h2>
      <table style="border-collapse:collapse;width:100%;font-size:14px;">
        ${rows
          .map(
            ([k, v]) =>
              `<tr><td style="padding:6px 12px 6px 0;color:#666;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:6px 0;font-weight:600;">${esc(v)}</td></tr>`,
          )
          .join('')}
      </table>
      <p style="margin:20px 0 0;font-size:14px;">The full review is attached as a PDF. Photos are included as clickable links.</p>
      <p style="margin:20px 0 0;color:#888;font-size:12px;">Submitted from WashLyfe Operator.</p>
    </div>
  `

  const resend = new Resend(resendKey)
  try {
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: recipients,
      subject: `RM Site Review${site ? ' — ' + site : ''}`,
      html,
      attachments: [{ filename, content: pdfB64 }],
    })
    if (error) return json({ ok: false, error: (error as { message?: string }).message ?? 'send_failed' }, 502, origin)
    return json({ ok: true }, 200, origin)
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : 'send_failed' }, 502, origin)
  }
})
