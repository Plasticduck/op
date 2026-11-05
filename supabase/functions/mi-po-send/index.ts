// mi-po-send — Supabase Edge Function (Deno).
// Emails a Maintenance Inventory purchase order to its vendor, with the PDF the browser
// built attached (the same one Download gives you), then marks the PO sent.
//
// Runs as the caller: mi_mark_po_sent checks their role and that the PO is approved, and
// it runs first, so a PO can't be emailed by someone who couldn't send it. If the email
// then fails, the status goes back so it can be tried again.
//
// Body: { po_id, pdf_base64, to }
// Secrets: RESEND_API_KEY (503 no_key if absent), RESEND_FROM (optional).

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// deno-lint-ignore no-explicit-any
type Any = any

const ALLOWED_ORIGINS = new Set<string>(['https://operator.washlyfe.com', 'http://localhost:5173', 'http://localhost:5174', 'http://localhost:4173'])
function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : 'https://operator.washlyfe.com'
  return { 'Access-Control-Allow-Origin': allow, Vary: 'Origin', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
}
const json = (body: unknown, status: number, origin: string | null) => new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ error: 'no_key', message: 'Email is not configured.' }, 503, origin)
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

  const auth = req.headers.get('Authorization') ?? ''
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401, origin)

  let body: { po_id?: string; pdf_base64?: string; to?: string } = {}
  try { body = await req.json() } catch { /* empty */ }
  const to = (body.to ?? '').trim()
  if (!body.po_id || !body.pdf_base64 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(to)) {
    return json({ error: 'bad_request', message: 'A PO, its PDF and an email address are needed.' }, 400, origin)
  }

  const { error: markErr } = await userClient.rpc('mi_mark_po_sent', { p_po: body.po_id, p_sent_to: to })
  if (markErr) return json({ error: 'not_allowed', message: markErr.message }, 403, origin)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: basic } = await svc.from('mi_purchase_orders').select('number, sent_by, account_id, vendor_id').eq('id', body.po_id).single()
  const b = basic as Any
  const [{ data: acct }, { data: vendor }, { data: who }] = await Promise.all([
    svc.from('accounts').select('name').eq('id', b.account_id).single(),
    svc.from('vendors').select('name').eq('id', b.vendor_id).single(),
    svc.from('users').select('name, email').eq('id', b.sent_by).single(),
  ])
  const company = (acct as Any)?.name ?? 'Mighty Wash'
  const sender = who as Any

  const from = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'
  const { error } = await new Resend(resendKey).emails.send({
    from,
    to: [to],
    reply_to: sender?.email ?? undefined,
    subject: `Purchase Order ${b.number} from ${company}`,
    html: `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;font-size:14px;">
      <p>Hello ${(vendor as Any)?.name ?? ''},</p>
      <p>Attached is purchase order ${b.number} from ${company}. Please reply to confirm it and let us know when it will ship.</p>
      <p>Thank you,<br/>${sender?.name ?? company}</p></div>`,
    attachments: [{ filename: `PO-${b.number}.pdf`, content: body.pdf_base64 }],
  })
  if (error) {
    // Put it back to approved so it can be sent again.
    await svc.from('mi_purchase_orders').update({ status: 'approved', sent_by: null, sent_at: null, sent_to: null }).eq('id', body.po_id)
    return json({ error: 'send_failed', message: error.message }, 502, origin)
  }
  return json({ ok: true, to }, 200, origin)
})
