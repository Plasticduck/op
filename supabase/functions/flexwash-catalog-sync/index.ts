// flexwash-catalog-sync: keeps Operator AI's FlexWash catalog current (migration
// 0255). Every 6 hours (cron) it reads FlexWash's published partner API docs,
// builds the catalog of read endpoints (_shared/flexwash_catalog_build.ts) and,
// when it differs from the newest saved version, saves a new one to
// flexwash_catalog, which ask-operator reads. If an endpoint went away or an input
// became required (what broke Operator's FlexWash pages on 2026-11-20), the super
// admin gets a bell notification naming it.
//
// Body: {} to sync, { dryRun: true } to build and compare without saving.
// Auth: service role only.
import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  FLEX_DOCS_URL, buildFlexCatalog, canon, diffFlexCatalog, parseDocs, type FlexEndpoint,
} from '../_shared/flexwash_catalog_build.ts'
import { FLEX_ENDPOINTS } from '../ask-operator/flexwash_catalog.ts'

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { 'Content-Type': 'application/json' } })
const KEEP_VERSIONS = 60
const SUPER_ADMIN = 'kevan@washlyfe.com'

function jwtRole(auth: string): string | null {
  const t = auth.replace(/^Bearer\s+/i, '').split('.')
  if (t.length !== 3) return null
  try { return JSON.parse(atob(t[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null } catch { return null }
}

async function sha256(s: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (jwtRole(req.headers.get('Authorization') ?? '') !== 'service_role') return json({ error: 'forbidden' }, 403)
  const body = await req.json().catch(() => ({})) as { dryRun?: boolean }
  const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })

  let docs = ''
  for (let i = 0; i < 3 && !docs; i++) {
    try {
      const res = await fetch(FLEX_DOCS_URL)
      if (res.ok) docs = await res.text()
    } catch { /* retry */ }
    if (!docs) await new Promise((r) => setTimeout(r, 2000 * (i + 1)))
  }
  if (!docs) return json({ error: 'docs_unavailable' }, 502)

  let built
  try {
    built = buildFlexCatalog(parseDocs(docs))
  } catch (e) {
    return json({ error: 'docs_unreadable', message: e instanceof Error ? e.message : String(e) }, 502)
  }
  // An empty or tiny catalog means the docs page changed shape, not that FlexWash
  // dropped its API: keep the last good version.
  const count = Object.keys(built.endpoints).length
  if (count < 50) return json({ error: 'too_few_endpoints', count }, 502)

  const { data: last } = await svc.from('flexwash_catalog')
    .select('id, endpoints, held').order('fetched_at', { ascending: false }).limit(1).maybeSingle()
  const prev = (last?.endpoints ?? FLEX_ENDPOINTS) as Record<string, FlexEndpoint>
  const changes = diffFlexCatalog(prev, built.endpoints)
  const same = last && canon(last.endpoints) === canon(built.endpoints) && canon(last.held) === canon(built.held)
  const summary = { count, held: built.held.map((h) => h.name), ...changes, saved: false, notified: false }

  if (body.dryRun) return json({ ...summary, dryRun: true })
  if (same) {
    await svc.from('flexwash_catalog').update({ checked_at: new Date().toISOString() }).eq('id', last!.id)
    return json(summary)
  }

  const { error } = await svc.from('flexwash_catalog').insert({
    docs_sha256: await sha256(docs),
    endpoint_count: count,
    endpoints: built.endpoints,
    held: built.held,
    changes,
  })
  if (error) return json({ error: 'save_failed', message: error.message }, 500)
  summary.saved = true

  const { data: old } = await svc.from('flexwash_catalog').select('id').order('fetched_at', { ascending: false }).range(KEEP_VERSIONS, KEEP_VERSIONS + 100)
  if (old?.length) await svc.from('flexwash_catalog').delete().in('id', old.map((r) => r.id))

  // Only against a saved version: the first run compares with the bundled copy,
  // which may be older than fixes already made in Operator.
  const alert = last ? [...changes.breaking] : []
  const newHeld = built.held.filter((h) => !((last?.held ?? []) as { name: string }[]).some((x) => x.name === h.name))
  if (alert.length || (last && newHeld.length)) {
    const { data: admins } = await svc.from('users').select('id').ilike('email', SUPER_ADMIN)
    const parts = [
      ...alert.map((b) => `${b.path.replace('/external/', '')} ${b.detail}`),
      ...(last ? newHeld.map((h) => `new endpoint ${h.path.replace('/external/', '')} held for review`) : []),
    ]
    const tail = alert.length ? "Operator's FlexWash pages may need a fix." : "Operator AI won't use it until it's reviewed."
    const text = `FlexWash changed its API: ${parts.slice(0, 3).join('; ')}${parts.length > 3 ? `; and ${parts.length - 3} more` : ''}. ${tail}`
    for (const a of admins ?? []) {
      await svc.from('notifications').insert({ user_id: a.id, kind: 'flexwash_api_change', payload: { text, breaking: alert, held: newHeld } })
    }
    summary.notified = (admins ?? []).length > 0
  }
  return json(summary)
})
