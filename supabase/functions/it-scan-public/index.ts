// it-scan-public — Supabase Edge Function (Deno). PUBLIC (verify_jwt = false).
// Backs the page an IT Inventory sticker's QR opens (/t/<short>/<tag>) for
// anyone who isn't signed in, and the Report a problem form for everyone. It
// shows only an asset's name, category and site (never serial, IP, cost or who
// has it) and files a problem as a Work Request linked to the asset, with a
// problem_reported row on the asset's Timeline. Service role throughout.
//
// Actions:
//   info           { short, tag }                               -> { ok, company, asset: { tag, name, category, site } }
//   report         { short, tag, description, name?, contact?, down? } -> { ok }
//                  down: "it's not working at all" also marks it down (health)
//   report_unknown { tag, description, location_id }            -> { ok }   (signed in only: a sticker we can't find)
// A signed-in caller (Authorization: Bearer <jwt>) from the same company is
// recorded as the reporter; anyone else is anonymous.
//
// Deploy: npx supabase functions deploy it-scan-public --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2'

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
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' } })

// Per asset, so a stuck page or a prank can't flood the Work Requests list.
const MAX_REPORTS_PER_HOUR = 5
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = String(body.action ?? '')
  const tag = String(body.tag ?? '').trim().toUpperCase().slice(0, 40)

  // Who's asking, if they're signed in (the anon key is not a user).
  let caller: { id: string; account_id: string; name: string | null; email: string | null } | null = null
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (jwt) {
    const { data } = await svc.auth.getUser(jwt)
    if (data.user) {
      const { data: u } = await svc.from('users').select('id, account_id, name, email').eq('id', data.user.id).maybeSingle()
      caller = u ?? null
    }
  }

  if (action === 'report_unknown') {
    if (!caller) return json({ error: 'unauthorized', message: 'Sign in to report this.' }, 401, origin)
    const description = String(body.description ?? '').trim().slice(0, 2000)
    const locationId = String(body.location_id ?? '')
    if (!description) return json({ error: 'bad_request', message: "Say what's wrong." }, 400, origin)
    const { data: loc } = await svc.from('locations').select('id').eq('id', locationId).eq('account_id', caller.account_id).maybeSingle()
    if (!loc) return json({ error: 'bad_request', message: 'Pick a site.' }, 400, origin)
    const { error } = await svc.from('work_requests').insert({
      account_id: caller.account_id,
      location_id: locationId,
      title: `Unknown sticker ${tag || '(unreadable)'}`.slice(0, 200),
      description: `${description}\n\nThis sticker isn't in IT Inventory.`,
      priority: 'none',
      requester_name: caller.name,
      requester_email: caller.email,
    })
    if (error) return json({ error: 'insert_failed', message: error.message }, 500, origin)
    return json({ ok: true }, 200, origin)
  }

  // ---- Everything else is about one asset, found by its sticker ----
  const short = String(body.short ?? '').trim().toLowerCase().slice(0, 32)
  const notFound = () => json({ error: 'not_found', message: "We couldn't find this sticker. It may have been removed." }, 404, origin)
  if (!short || !tag) return notFound()
  const { data: settings } = await svc.from('it_settings').select('account_id').eq('short_code', short).maybeSingle()
  if (!settings) return notFound()
  const { data: tagRow } = await svc
    .from('it_asset_tags')
    .select('asset_id')
    .eq('account_id', settings.account_id)
    .eq('tag', tag)
    .maybeSingle()
  if (!tagRow?.asset_id) return notFound()
  const { data: asset } = await svc
    .from('it_assets')
    .select('id, account_id, location_id, name, asset_tag, category_id, deleted_at')
    .eq('id', tagRow.asset_id)
    .maybeSingle()
  if (!asset || asset.deleted_at) return notFound()

  if (action === 'info') {
    const [{ data: cat }, { data: loc }, { data: acct }] = await Promise.all([
      svc.from('it_categories').select('name').eq('id', asset.category_id).maybeSingle(),
      svc.from('locations').select('name').eq('id', asset.location_id).maybeSingle(),
      svc.from('accounts').select('name').eq('id', asset.account_id).maybeSingle(),
    ])
    return json({
      ok: true,
      company: acct?.name ?? null,
      asset: { tag: asset.asset_tag, name: asset.name, category: cat?.name ?? null, site: loc?.name ?? null },
    }, 200, origin)
  }

  if (action === 'report') {
    const description = String(body.description ?? '').trim().slice(0, 2000)
    if (!description) return json({ error: 'bad_request', message: "Say what's wrong." }, 400, origin)
    const since = new Date(Date.now() - 3600_000).toISOString()
    const { count } = await svc
      .from('work_requests')
      .select('id', { count: 'exact', head: true })
      .eq('it_asset_id', asset.id)
      .gte('created_at', since)
    if ((count ?? 0) >= MAX_REPORTS_PER_HOUR) {
      return json({ error: 'rate_limited', message: 'This item was reported several times in the last hour. The team already has it.' }, 429, origin)
    }

    const member = caller && caller.account_id === asset.account_id ? caller : null
    const name = member?.name ?? (String(body.name ?? '').trim().slice(0, 100) || null)
    const contact = String(body.contact ?? '').trim().slice(0, 200)
    const email = member?.email ?? (EMAIL_RE.test(contact) ? contact : null)
    const extra = contact && !EMAIL_RE.test(contact) ? `\nContact: ${contact}` : ''
    const down = body.down === true
    const { data: wr, error } = await svc.from('work_requests').insert({
      account_id: asset.account_id,
      location_id: asset.location_id,
      title: `${asset.name} (${asset.asset_tag}): ${down ? 'not working' : 'problem reported'}`.slice(0, 200),
      description: `${description}${down ? "\n\nIt's not working at all." : ''}\n\nReported by scanning sticker ${asset.asset_tag}.${extra}`,
      priority: 'none',
      requester_name: name,
      requester_email: email,
      it_asset_id: asset.id,
    }).select('id').single()
    if (error) return json({ error: 'insert_failed', message: error.message }, 500, origin)

    await svc.from('it_activity_log').insert({
      account_id: asset.account_id,
      location_id: asset.location_id,
      asset_id: asset.id,
      entity_type: 'asset',
      entity_id: asset.id,
      action: 'problem_reported',
      actor_user_id: member?.id ?? null,
      actor_name: name,
      actor_system: member ? null : 'Sticker scan',
      after: { work_request_id: wr.id, description: description.slice(0, 500) },
    })
    // "Not working at all" marks it down (a manual health report, which holds
    // until someone marks it working, even if the device keeps reporting in).
    if (down) {
      await svc.from('it_health_events').insert({
        account_id: asset.account_id,
        asset_id: asset.id,
        state: 'offline',
        source: 'manual',
        note: `Reported not working${name ? ` by ${name}` : ''}`.slice(0, 200),
        created_by: member?.id ?? null,
      })
    }
    return json({ ok: true }, 200, origin)
  }

  return json({ error: 'bad_request', message: 'Unknown action.' }, 400, origin)
})
