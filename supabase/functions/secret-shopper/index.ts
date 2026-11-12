// secret-shopper — Supabase Edge Function (Deno).
// Backs the Secret Shopper phone app (/shop, shop.html) and its admin page
// (/app/secret-shoppers). A shopper opens the app from their home screen, signs
// in with their PIN, fills in a 1-5 star report about one visit with photos and
// videos, and it's emailed to leadership.
//
// Shoppers have no Operator login: the PIN alone says who they are and which
// company they report to. So this function runs without the gateway's JWT
// check (config.toml, --no-verify-jwt), wrong PINs are capped per IP address
// and overall, and the admin actions check the caller's Operator session here.
// Service role throughout: the tables are RLS-locked (migrations 0232, 0233).
//
// Actions (shopper, PIN only):
//   sign_in      { pin }                                -> { ok, shopper: { id, name }, sites: [{ id, name }] }
//   start        { pin, report, files: [{ name, type, size }] }
//                                                       -> { ok, visit_id, uploads: [{ path, token }] }
//                Saves the report as 'uploading' and hands out one signed
//                upload URL per photo/video.
//   finish       { pin, visit_id }                      -> { ok, emailed, sent_to?, message? }
//                Keeps the files that actually arrived, marks it submitted and
//                emails it.
// Actions (signed-in Operator user on ADMIN_EMAILS):
//   admin_list   {}                                     -> { ok, shoppers: [...] }
//   admin_save   { id?, name, phone?, email?, pin?, active? } -> { ok, id }
//
// report = { location_id, visited_at (ISO), wash_package?, team_members?,
//            ratings: { [key]: { stars: 1-5, comment? } }, comments }
//
// Required secret: RESEND_API_KEY. Optional: RESEND_FROM.
// Deploy: npx supabase functions deploy secret-shopper --project-ref ppwjqifyyihesuoubixk --use-api --no-verify-jwt

import { createClient } from 'npm:@supabase/supabase-js@2'
import { Resend } from 'npm:resend@4'

// Who gets every submitted report while it's being tested (Kevan, 2026-11-11).
const RECIPIENTS = ['kevan@washlyfe.com', 'kjowers@mighty-wash.com', 'jjowers@mighty-wash.com']

// Who can add shoppers and set PINs. Keep in step with
// src/features/secretshoppers/access.ts.
const ADMIN_EMAILS = ['kevan@washlyfe.com', 'jjowers@mighty-wash.com']

// The star questions, in form order. Keep keys in step with
// src/features/secretshoppers/ratings.ts.
const CATEGORIES: { key: string; label: string }[] = [
  { key: 'greeting', label: 'Greeting and friendliness' },
  { key: 'speed', label: 'Speed of service' },
  { key: 'membership', label: 'Packages and membership offer' },
  { key: 'wash', label: 'Wash quality' },
  { key: 'drying', label: 'Drying' },
  { key: 'site', label: 'Site cleanliness' },
  { key: 'overall', label: 'Overall experience' },
]
const WORDS = ['', 'Poor', 'Fair', 'Good', 'Very good', 'Excellent']

const BUCKET = 'secret-shopper-media'
const MAX_FILES = 20
const MAX_FILE_BYTES = 50 * 1024 * 1024 // the project's upload limit
const PIN_RE = /^\d{6,8}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Wrong PINs allowed from one IP address per 15 minutes, and from everyone
// together per hour. The overall cap is what keeps PINs from being guessed
// from many addresses at once; while it's hit, PIN sign-in pauses for everyone.
const MAX_BAD_PINS_PER_IP = 8
const MAX_BAD_PINS_PER_HOUR = 20

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

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n)

// The caller's address as the Supabase gateway passes it on.
function clientIp(req: Request): string {
  const fwd = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return (fwd || req.headers.get('cf-connecting-ip') || req.headers.get('x-real-ip') || 'unknown').slice(0, 64)
}

type Rating = { key: string; label: string; stars: number; comment: string }
type Media = { path: string; kind: 'image' | 'video'; name: string; size: number }

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false },
  })

  let body: Record<string, unknown> = {}
  try { body = await req.json() } catch { /* empty */ }
  const action = String(body.action ?? '')

  // ---- Managing shoppers (signed-in Operator admins) -----------------------------
  if (action === 'admin_list' || action === 'admin_save') {
    const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
    const { data: authData } = jwt ? await svc.auth.getUser(jwt) : { data: { user: null } }
    const { data: caller } = authData.user
      ? await svc.from('users').select('id, account_id, email').eq('id', authData.user.id).maybeSingle()
      : { data: null }
    if (!caller) return json({ error: 'unauthorized', message: 'Sign in to Operator first.' }, 401, origin)
    if (!ADMIN_EMAILS.includes((caller.email ?? '').toLowerCase())) {
      return json({ error: 'forbidden', message: "You can't manage secret shoppers." }, 403, origin)
    }
    const accountId: string = caller.account_id

    if (action === 'admin_list') {
      const [{ data: shoppers, error }, { data: visits }] = await Promise.all([
        svc
          .from('secret_shoppers')
          .select('id, name, phone, email, active, last_sign_in_at, created_at')
          .eq('account_id', accountId)
          .order('name'),
        svc.from('secret_shopper_visits').select('shopper_id').eq('account_id', accountId).eq('status', 'submitted'),
      ])
      if (error) return json({ error: 'load_failed', message: error.message }, 500, origin)
      const counts = new Map<string, number>()
      for (const v of visits ?? []) counts.set(v.shopper_id, (counts.get(v.shopper_id) ?? 0) + 1)
      return json({ ok: true, shoppers: (shoppers ?? []).map((s) => ({ ...s, reports: counts.get(s.id) ?? 0 })) }, 200, origin)
    }

    const id = body.id ? String(body.id) : null
    const name = clip(body.name, 100)
    const phone = clip(body.phone, 40) || null
    const email = clip(body.email, 200).toLowerCase() || null
    const pin = clip(body.pin, 20)
    if (!name) return json({ error: 'bad_request', message: "Enter the shopper's name." }, 400, origin)
    if (!id && !pin) return json({ error: 'bad_request', message: 'Give the shopper a PIN.' }, 400, origin)
    if (pin && !PIN_RE.test(pin)) return json({ error: 'bad_request', message: 'A PIN is 6 to 8 digits.' }, 400, origin)
    if (id) {
      const { data: existing } = await svc.from('secret_shoppers').select('id').eq('id', id).eq('account_id', accountId).maybeSingle()
      if (!existing) return json({ error: 'not_found', message: 'That shopper is gone.' }, 404, origin)
    }
    let pinHash: string | null = null
    if (pin) {
      const { data: taken } = await svc.rpc('secret_shopper_pin_in_use', { p_pin: pin, p_except: id })
      if (taken) return json({ error: 'pin_taken', message: 'That PIN is already in use. Pick a different one.' }, 409, origin)
      const { data: hash, error: hashErr } = await svc.rpc('secret_shopper_hash_pin', { p_pin: pin })
      if (hashErr || !hash) return json({ error: 'save_failed', message: hashErr?.message ?? 'Could not set the PIN.' }, 500, origin)
      pinHash = hash as string
    }

    if (!id) {
      const { data: row, error } = await svc
        .from('secret_shoppers')
        .insert({ account_id: accountId, name, phone, email, pin_hash: pinHash!, created_by: caller.id })
        .select('id')
        .single()
      if (error) return json({ error: 'save_failed', message: error.message }, 500, origin)
      return json({ ok: true, id: row.id }, 200, origin)
    }
    const patch: Record<string, unknown> = { name, phone, email, updated_at: new Date().toISOString() }
    if (pinHash) patch.pin_hash = pinHash
    if (typeof body.active === 'boolean') patch.active = body.active
    const { error } = await svc.from('secret_shoppers').update(patch).eq('id', id).eq('account_id', accountId)
    if (error) return json({ error: 'save_failed', message: error.message }, 500, origin)
    return json({ ok: true, id }, 200, origin)
  }

  // ---- Everything a shopper does starts with their PIN -------------------------
  if (!['sign_in', 'start', 'finish'].includes(action)) {
    return json({ error: 'bad_request', message: 'Unknown action.' }, 400, origin)
  }
  const ip = clientIp(req)
  const { count: mine } = await svc
    .from('secret_shopper_bad_pins')
    .select('id', { count: 'exact', head: true })
    .eq('ip', ip)
    .gte('created_at', new Date(Date.now() - 15 * 60_000).toISOString())
  if ((mine ?? 0) >= MAX_BAD_PINS_PER_IP) {
    return json({ error: 'rate_limited', message: 'Too many wrong PINs. Wait 15 minutes and try again.' }, 429, origin)
  }

  // finish needs an existing report (an unguessable id) before the PIN is even
  // checked, so it can't be used to guess PINs; sign_in and start can, so they
  // also stop while the overall cap is hit.
  // deno-lint-ignore no-explicit-any
  let visit: any = null
  if (action === 'finish') {
    const visitId = String(body.visit_id ?? '')
    const { data: v } = UUID_RE.test(visitId)
      ? await svc.from('secret_shopper_visits').select('*, location:location_id(name, timezone)').eq('id', visitId).maybeSingle()
      : { data: null }
    if (!v) return json({ error: 'not_found', message: 'That report is gone.' }, 404, origin)
    visit = v
  } else {
    const { count: everyone } = await svc
      .from('secret_shopper_bad_pins')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', new Date(Date.now() - 60 * 60_000).toISOString())
    if ((everyone ?? 0) >= MAX_BAD_PINS_PER_HOUR) {
      return json({ error: 'rate_limited', message: 'PIN sign-in is paused for a little while after too many wrong PINs. Try again later.' }, 429, origin)
    }
  }

  const pin = clip(body.pin, 20)
  const { data: shopperId } = PIN_RE.test(pin)
    ? await svc.rpc('secret_shopper_find_by_pin', { p_pin: pin })
    : { data: null }
  if (!shopperId || (visit && visit.shopper_id !== shopperId)) {
    await svc.from('secret_shopper_bad_pins').insert({ ip })
    return json({ error: 'bad_pin', message: "That PIN didn't work." }, 401, origin)
  }
  const { data: shopper } = await svc
    .from('secret_shoppers')
    .select('id, name, account_id')
    .eq('id', shopperId as string)
    .single()
  if (!shopper) return json({ error: 'bad_pin', message: "That PIN didn't work." }, 401, origin)
  const accountId: string = shopper.account_id

  if (action === 'sign_in') {
    await svc.from('secret_shoppers').update({ last_sign_in_at: new Date().toISOString() }).eq('id', shopper.id)
    // Any open site in the shopper's company.
    const { data: sites } = await svc
      .from('locations')
      .select('id, name')
      .eq('account_id', accountId)
      .eq('archived', false)
      .order('name')
    return json({ ok: true, shopper: { id: shopper.id, name: shopper.name }, sites: sites ?? [] }, 200, origin)
  }

  if (action === 'start') {
    const r = (body.report ?? {}) as Record<string, unknown>
    const locationId = String(r.location_id ?? '')
    const { data: loc } = UUID_RE.test(locationId)
      ? await svc
        .from('locations')
        .select('id')
        .eq('id', locationId)
        .eq('account_id', accountId)
        .eq('archived', false)
        .maybeSingle()
      : { data: null }
    if (!loc) return json({ error: 'bad_request', message: 'Pick the site you visited.' }, 400, origin)

    const visited = new Date(String(r.visited_at ?? ''))
    if (isNaN(visited.getTime())) return json({ error: 'bad_request', message: 'Enter when you visited.' }, 400, origin)
    if (visited.getTime() > Date.now() + 60 * 60_000) {
      return json({ error: 'bad_request', message: "The visit time can't be in the future." }, 400, origin)
    }

    const given = (r.ratings ?? {}) as Record<string, { stars?: unknown; comment?: unknown }>
    const ratings: Rating[] = []
    for (const c of CATEGORIES) {
      const stars = Number(given[c.key]?.stars)
      if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
        return json({ error: 'bad_request', message: `Rate "${c.label}" from 1 to 5 stars.` }, 400, origin)
      }
      ratings.push({ key: c.key, label: c.label, stars, comment: clip(given[c.key]?.comment, 1000) })
    }
    const comments = clip(r.comments, 5000)
    if (!comments) return json({ error: 'bad_request', message: 'Tell us about your visit.' }, 400, origin)

    const files = Array.isArray(body.files) ? (body.files as { name?: unknown; type?: unknown; size?: unknown }[]) : []
    if (files.length > MAX_FILES) return json({ error: 'bad_request', message: `Up to ${MAX_FILES} photos and videos.` }, 400, origin)
    const visitId = crypto.randomUUID()
    const media: Media[] = []
    for (const f of files) {
      const type = String(f.type ?? '').toLowerCase()
      const name = clip(f.name, 200) || 'file'
      const size = Number(f.size) || 0
      const kind = type.startsWith('video/') ? 'video' : type.startsWith('image/') ? 'image' : null
      if (!kind) return json({ error: 'bad_request', message: `${name} isn't a photo or video.` }, 400, origin)
      if (size > MAX_FILE_BYTES) return json({ error: 'too_large', message: `${name} is over 50 MB.` }, 400, origin)
      const ext = (/\.([a-z0-9]{1,5})$/i.exec(name)?.[1] ?? (kind === 'video' ? 'mp4' : 'jpg')).toLowerCase()
      media.push({ path: `${accountId}/${visitId}/${crypto.randomUUID()}.${ext}`, kind, name, size })
    }

    const { error: insErr } = await svc.from('secret_shopper_visits').insert({
      id: visitId,
      account_id: accountId,
      location_id: loc.id,
      shopper_id: shopper.id,
      shopper_name: shopper.name,
      visited_at: visited.toISOString(),
      wash_package: clip(r.wash_package, 200) || null,
      team_members: clip(r.team_members, 500) || null,
      ratings,
      overall_rating: ratings.find((x) => x.key === 'overall')!.stars,
      comments,
      media,
    })
    if (insErr) return json({ error: 'save_failed', message: insErr.message }, 500, origin)

    const uploads: { path: string; token: string }[] = []
    for (const m of media) {
      const { data, error } = await svc.storage.from(BUCKET).createSignedUploadUrl(m.path)
      if (error || !data) return json({ error: 'upload_setup_failed', message: error?.message ?? 'Could not prepare the upload.' }, 500, origin)
      uploads.push({ path: m.path, token: data.token })
    }
    return json({ ok: true, visit_id: visitId, uploads }, 200, origin)
  }

  // ---- finish ---------------------------------------------------------------
  if (visit.emailed_at) return json({ ok: true, emailed: true, sent_to: RECIPIENTS }, 200, origin)


  // Keep only the photos and videos that made it up. A submitted report whose
  // email failed comes back through here to try the email again.
  const planned: Media[] = Array.isArray(visit.media) ? visit.media : []
  let media = planned
  if (visit.status !== 'submitted') {
    const { data: stored } = await svc.storage.from(BUCKET).list(`${accountId}/${visit.id}`, { limit: 100 })
    const arrived = new Set((stored ?? []).map((o) => `${accountId}/${visit.id}/${o.name}`))
    media = planned.filter((m) => arrived.has(m.path))
    const { error: upErr } = await svc
      .from('secret_shopper_visits')
      .update({ media, status: 'submitted', submitted_at: new Date().toISOString() })
      .eq('id', visit.id)
    if (upErr) return json({ error: 'save_failed', message: upErr.message }, 500, origin)
  }

  const resendKey = Deno.env.get('RESEND_API_KEY')
  if (!resendKey) return json({ ok: true, emailed: false, message: 'Saved, but email is not configured.' }, 200, origin)
  const fromAddr = Deno.env.get('RESEND_FROM') ?? 'WashLyfe Operator <notifications@washlyfe.com>'

  const site = (visit.location?.name ?? '').trim() || 'Site'
  const tz = visit.location?.timezone || 'America/Chicago'
  const when = new Date(visit.visited_at).toLocaleString('en-US', {
    timeZone: tz, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  })
  const ratings: Rating[] = Array.isArray(visit.ratings) ? visit.ratings : []
  const overall = Number(visit.overall_rating) || 0
  const avg = ratings.length ? ratings.reduce((a, x) => a + x.stars, 0) / ratings.length : 0

  // Photos show in the email (a small copy from Storage's resizer, linked to
  // the full one); videos are links. Links last 5 years, like Site Audits.
  const LONG = 60 * 60 * 24 * 365 * 5
  const photos: { thumb: string; full: string; name: string }[] = []
  const videos: { url: string; name: string }[] = []
  for (const m of media) {
    const { data: full } = await svc.storage.from(BUCKET).createSignedUrl(m.path, LONG)
    if (!full?.signedUrl) continue
    if (m.kind === 'video') { videos.push({ url: full.signedUrl, name: m.name }); continue }
    const { data: thumb } = await svc.storage
      .from(BUCKET)
      .createSignedUrl(m.path, LONG, { transform: { width: 560, height: 560, resize: 'contain', quality: 70 } })
    photos.push({ thumb: thumb?.signedUrl ?? full.signedUrl, full: full.signedUrl, name: m.name })
  }

  const starHtml = (n: number, size = 16) =>
    `<span style="color:#f59e0b;font-size:${size}px;letter-spacing:1px;">${'★'.repeat(n)}</span>` +
    `<span style="color:#d1d5db;font-size:${size}px;letter-spacing:1px;">${'★'.repeat(5 - n)}</span>`
  const ratingRows = ratings.map((x) => `
      <tr>
        <td style="padding:10px 12px;border-top:1px solid #eee;font-size:14px;font-weight:600;vertical-align:top;">${esc(x.label)}</td>
        <td style="padding:10px 12px;border-top:1px solid #eee;white-space:nowrap;vertical-align:top;">${starHtml(x.stars)}<div style="font-size:12px;color:#666;">${esc(WORDS[x.stars])}</div></td>
        <td style="padding:10px 12px;border-top:1px solid #eee;font-size:13px;color:#444;vertical-align:top;">${esc(x.comment) || '<span style="color:#aaa;">No comment</span>'}</td>
      </tr>`).join('')
  const detail = (label: string, value: string | null) =>
    value ? `<p style="margin:6px 0 0;font-size:14px;"><strong>${esc(label)}:</strong> ${esc(value)}</p>` : ''
  const photoBlock = photos.length
    ? `<h3 style="margin:22px 0 8px;font-size:15px;">Photos (${photos.length})</h3>
       <div>${photos.map((p) => `<a href="${esc(p.full)}" style="display:inline-block;margin:0 6px 6px 0;"><img src="${esc(p.thumb)}" alt="${esc(p.name)}" width="180" style="width:180px;max-width:100%;border-radius:6px;border:1px solid #ddd;display:block;" /></a>`).join('')}</div>`
    : ''
  const videoBlock = videos.length
    ? `<h3 style="margin:22px 0 8px;font-size:15px;">Videos (${videos.length})</h3>
       ${videos.map((x, i) => `<p style="margin:4px 0;font-size:14px;"><a href="${esc(x.url)}" style="color:#2563eb;">Watch video ${i + 1}</a> <span style="color:#888;">(${esc(x.name)})</span></p>`).join('')}`
    : ''
  const lost = planned.length - media.length
  const html = `
    <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#111;max-width:640px;margin:0 auto;padding:24px;">
      <h2 style="margin:0 0 4px;font-size:20px;">Secret Shopper report: ${esc(site)}</h2>
      <p style="margin:0;color:#555;font-size:14px;">${esc(visit.shopper_name)} · Visited ${esc(when)}</p>
      <div style="margin:16px 0 0;padding:14px 16px;border:1px solid #fde68a;background:#fffbeb;border-radius:8px;">
        <div style="font-size:13px;color:#92400e;font-weight:600;">Overall experience</div>
        <div style="margin-top:2px;">${starHtml(overall, 24)} <span style="font-size:15px;font-weight:600;margin-left:6px;">${overall} of 5, ${esc(WORDS[overall])}</span></div>
        <div style="margin-top:4px;font-size:12px;color:#666;">Average across all ${ratings.length} ratings: ${avg.toFixed(1)}</div>
      </div>
      ${detail('Wash package', visit.wash_package)}
      ${detail('Team members', visit.team_members)}
      <table cellpadding="0" cellspacing="0" style="margin:18px 0 0;width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;">
        ${ratingRows}
      </table>
      <h3 style="margin:22px 0 6px;font-size:15px;">About the visit</h3>
      <p style="margin:0;font-size:14px;line-height:1.5;white-space:pre-wrap;">${esc(visit.comments)}</p>
      ${photoBlock}
      ${videoBlock}
      ${lost > 0 ? `<p style="margin:14px 0 0;font-size:12px;color:#b45309;">${lost} photo or video upload${lost === 1 ? '' : 's'} didn't finish and ${lost === 1 ? 'is' : 'are'} not included.</p>` : ''}
      <p style="margin:22px 0 0;color:#888;font-size:12px;">Sent from WashLyfe Operator, Secret Shoppers.</p>
    </div>`

  try {
    const resend = new Resend(resendKey)
    const { error } = await resend.emails.send({
      from: fromAddr,
      to: RECIPIENTS,
      subject: `Secret Shopper: ${site}, ${overall} of 5 stars`,
      html,
    })
    if (error) {
      return json({ ok: true, emailed: false, message: (error as { message?: string }).message ?? 'The email did not send.' }, 200, origin)
    }
  } catch (e) {
    return json({ ok: true, emailed: false, message: e instanceof Error ? e.message : 'The email did not send.' }, 200, origin)
  }
  await svc.from('secret_shopper_visits').update({ emailed_at: new Date().toISOString() }).eq('id', visit.id)
  return json({ ok: true, emailed: true, sent_to: RECIPIENTS }, 200, origin)
})
