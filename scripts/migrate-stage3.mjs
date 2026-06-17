// Stage 3: copy the data-rich modules from Neon into the new Supabase tables.
// Resolves old free-text location ("17", "Site #19") -> Site N location id, and
// old submitter text (name or email) -> user id, preserving the original text.
// Run: node --env-file=.env.server scripts/migrate-stage3.mjs
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const maps = JSON.parse(readFileSync(new URL('./migrate-maps.json', import.meta.url)))
const ACCT = maps.account
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const neon = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await neon.connect()

const siteKey = (t) => {
  if (t == null) return null
  const m = String(t).match(/\d+/)
  return m ? `Site ${parseInt(m[0], 10)}` : null
}
const resolveLoc = (t) => maps.locationsByName[siteKey(t)] ?? null

// user resolver (name OR email -> uid), preserving original text
const oldUsers = (await neon.query('select full_name, lower(email) email from users')).rows
const nameToUid = {}
for (const u of oldUsers) {
  const uid = maps.emailToUser[u.email]
  if (uid && u.full_name) nameToUid[u.full_name.toLowerCase().trim()] = uid
}
const resolveUser = (t) => {
  if (!t) return { uid: null, name: null }
  const s = String(t).trim()
  const uid = maps.emailToUser[s.toLowerCase()] ?? nameToUid[s.toLowerCase()] ?? null
  return { uid, name: s }
}

async function insertChunked(table, rows) {
  if (rows.length === 0) { console.log(`${table}: 0`); return }
  let n = 0
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400)
    const { error } = await svc.from(table).insert(chunk)
    if (error) { console.log(`${table}: FAIL at ${i}: ${error.message}`); return }
    n += chunk.length
  }
  console.log(`${table}: ${n}`)
}

// idempotency: clear any prior import for this account
for (const t of ['site_evaluations','site_audits','ops_notes','ops_invoices','inventory_items','inventory_counts']) {
  await svc.from(t).delete().eq('account_id', ACCT)
}

// 1) Monthly Site Review
{
  const r = (await neon.query('select * from evaluations')).rows
  await insertChunked('site_evaluations', r.map((e) => {
    const u = resolveUser(e.submitted_by)
    return { account_id: ACCT, location_id: resolveLoc(e.location), answers: e.answers ?? {},
      additional_notes: e.additional_notes, follow_up_instructions: e.follow_up_instructions,
      submitted_by: u.uid, submitted_by_name: u.name, submitted_at: e.submitted_at }
  }))
}
// 2) Site Audit
{
  const r = (await neon.query('select * from site_audits')).rows
  await insertChunked('site_audits', r.map((a) => {
    const u = resolveUser(a.submitted_by)
    return { account_id: ACCT, location_id: resolveLoc(a.location), initial_observations: a.initial_observations,
      primary_section: a.primary_section, secondary_section: a.secondary_section, priority_section: a.priority_section,
      final_thoughts: a.final_thoughts, section_comments: a.section_comments, photos: a.photos,
      explanation: a.explanation, submitted_by: u.uid, submitted_by_name: u.name, created_at: a.created_at }
  }))
}
// 3) Notes
{
  const r = (await neon.query('select * from notes')).rows
  await insertChunked('ops_notes', r.map((n) => {
    const u = resolveUser(n.submitted_by)
    return { account_id: ACCT, location_id: resolveLoc(n.location), department: n.department, note_type: n.note_type,
      other_description: n.other_description, additional_notes: n.additional_notes,
      submitted_by: u.uid, submitted_by_name: u.name, created_at: n.created_at }
  }))
}
// 4) Invoices
{
  const normStatus = (s) => {
    const x = (s ?? '').toLowerCase()
    if (x.startsWith('appro')) return 'approved'
    if (x.startsWith('rej') || x.startsWith('den')) return 'rejected'
    return 'pending'
  }
  const r = (await neon.query('select * from invoices')).rows
  await insertChunked('ops_invoices', r.map((iv) => {
    const sub = resolveUser(iv.submitted_by_email ?? iv.submitted_by)
    const asg = resolveUser(iv.assigned_to)
    const dec = resolveUser(iv.decided_by)
    return { account_id: ACCT, location_id: resolveLoc(iv.site), vendor_name: iv.vendor_name,
      invoice_date: iv.invoice_date, amount: iv.amount ?? 0, gl_code: iv.gl_code, status: normStatus(iv.status),
      file_name: iv.file_name, file_type: iv.file_type,
      assigned_to: asg.uid, assigned_to_name: asg.name, submitted_by: sub.uid, submitted_by_name: sub.name,
      submitted_at: iv.submitted_at, decided_by: dec.uid, decided_by_name: dec.name,
      decided_at: iv.decided_at, decision_reason: iv.decision_reason }
  }))
}
// 5) Inventory catalog (use the MightyCount catalog — the live one)
{
  const r = (await neon.query('select * from inventory_items_mightycount')).rows
  await insertChunked('inventory_items', r.map((it) => ({
    account_id: ACCT, category: it.category, brand: it.brand, item: it.item, created_at: it.created_at,
  })))
}
// 6) Inventory counts (MightyCount)
{
  const r = (await neon.query('select * from inventory_counts_mightycount')).rows
  await insertChunked('inventory_counts', r.map((c) => {
    const u = resolveUser(c.submitted_by)
    return { account_id: ACCT, location_id: resolveLoc(c.site_location), category: c.category, brand: c.brand,
      item: c.item, quantity: c.quantity ?? 0, submitted_by: u.uid, submitted_by_name: u.name, created_at: c.created_at }
  }))
}

await neon.end()
console.log('Stage 3 complete.')
