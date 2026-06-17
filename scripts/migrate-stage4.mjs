// Stage 4: corrections + attachments.
//  - rename locations "Site N" -> "Site #N"; add the "Spotless" site
//  - the old `notes` table is really the Site Violations app (113/117 are
//    violation types) -> migrate notes -> site_violations (was mis-routed into
//    ops_notes); clear ops_notes
//  - migrate base64 attachments into ops_attachments:
//      notes.image_pdf (53 PDFs) -> violation attachments
//      invoices.file_data (6)    -> invoice attachments
//      site_audits.photos (4)    -> audit attachments
//    (audits/invoices are re-inserted so we can attach to the fresh row ids)
// Run: node --env-file=.env.server scripts/migrate-stage4.mjs
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync } from 'node:fs'

const maps = JSON.parse(readFileSync(new URL('./migrate-maps.json', import.meta.url)))
const ACCT = maps.account
const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const neon = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await neon.connect()

// ---- resolvers (same logic as stage 3) -------------------------------------
const siteKey = (t) => {
  if (t == null) return null
  const m = String(t).match(/\d+/)
  return m ? `Site ${parseInt(m[0], 10)}` : null
}
const resolveLoc = (t) => maps.locationsByName[siteKey(t)] ?? null

const oldUsers = (await neon.query('select full_name, lower(email) email from users')).rows
const nameToUid = {}
for (const u of oldUsers) {
  const uid = maps.emailToUser[u.email]
  if (uid && u.full_name) nameToUid[u.full_name.toLowerCase().trim()] = uid
}
const resolveUser = (t) => {
  if (!t) return { uid: null, name: null }
  const s = String(t).trim()
  return { uid: maps.emailToUser[s.toLowerCase()] ?? nameToUid[s.toLowerCase()] ?? null, name: s }
}

// ---- attachment helpers ----------------------------------------------------
function parseDataUri(s) {
  if (!s || typeof s !== 'string' || !s.startsWith('data:')) return null
  const comma = s.indexOf(',')
  if (comma < 0) return null
  const header = s.slice(5, comma) // e.g. "application/pdf;filename=x.pdf;base64"
  const fileType = header.split(';')[0] || 'application/octet-stream'
  const fn = header.match(/filename=([^;]+)/)
  return { fileType, fileName: fn ? fn[1] : null, dataUri: s }
}
// Recursively collect every "data:" string in a jsonb value (audit photos).
function collectDataUris(obj, path = [], out = []) {
  if (obj == null) return out
  if (typeof obj === 'string') { if (obj.startsWith('data:')) out.push({ label: path.join(' / ') || null, value: obj }); return out }
  if (Array.isArray(obj)) { obj.forEach((v, i) => collectDataUris(v, [...path, String(i)], out)); return out }
  if (typeof obj === 'object') { for (const [k, v] of Object.entries(obj)) collectDataUris(v, [...path, k], out); return out }
  return out
}
const attachments = []
const addAttachment = (entity_type, entity_id, parsed, label = null) => {
  if (!parsed || !entity_id) return
  attachments.push({
    account_id: ACCT, entity_type, entity_id, label,
    file_name: parsed.fileName, file_type: parsed.fileType, data_uri: parsed.dataUri,
  })
}

// ---- 0) org structure: rename + add Spotless -------------------------------
{
  for (let n = 1; n <= 31; n++) {
    const id = maps.locationsByName[`Site ${n}`]
    if (id) await svc.from('locations').update({ name: `Site #${n}` }).eq('id', id)
  }
  // Spotless (idempotent)
  let spotless = maps.locationsByName['Spotless']
  if (!spotless) {
    const { data: existing } = await svc.from('locations').select('id').eq('account_id', ACCT).eq('name', 'Spotless').maybeSingle()
    if (existing) spotless = existing.id
    else {
      const { data } = await svc.from('locations').insert({ account_id: ACCT, name: 'Spotless', timezone: 'America/Chicago' }).select('id').single()
      spotless = data.id
    }
    maps.locationsByName['Spotless'] = spotless
  }
  writeFileSync(new URL('./migrate-maps.json', import.meta.url), JSON.stringify(maps, null, 2))
  console.log('org: renamed Site 1..31 -> Site #N; Spotless ready')
}

// ---- clear prior import for these entities ---------------------------------
await svc.from('ops_attachments').delete().eq('account_id', ACCT)
await svc.from('site_violations').delete().eq('account_id', ACCT)
await svc.from('ops_notes').delete().eq('account_id', ACCT)
await svc.from('site_audits').delete().eq('account_id', ACCT)
await svc.from('ops_invoices').delete().eq('account_id', ACCT)

// ---- 1) Site Audits (re-insert; photos -> attachments) ---------------------
{
  const r = (await neon.query('select * from site_audits')).rows
  let n = 0
  for (const a of r) {
    const u = resolveUser(a.submitted_by)
    const { data, error } = await svc.from('site_audits').insert({
      account_id: ACCT, location_id: resolveLoc(a.location), initial_observations: a.initial_observations,
      primary_section: a.primary_section, secondary_section: a.secondary_section, priority_section: a.priority_section,
      final_thoughts: a.final_thoughts, section_comments: a.section_comments, photos: null,
      explanation: a.explanation, submitted_by: u.uid, submitted_by_name: u.name, created_at: a.created_at,
    }).select('id').single()
    if (error) { console.log('audit FAIL', a.id, error.message); continue }
    n++
    for (const f of collectDataUris(a.photos)) addAttachment('audit', data.id, parseDataUri(f.value), f.label)
  }
  console.log('site_audits:', n)
}

// ---- 2) Invoices (re-insert; file_data -> attachments) ---------------------
{
  const normStatus = (s) => {
    const x = (s ?? '').toLowerCase()
    if (x.startsWith('appro')) return 'approved'
    if (x.startsWith('rej') || x.startsWith('den')) return 'rejected'
    return 'pending'
  }
  const r = (await neon.query('select * from invoices')).rows
  let n = 0
  for (const iv of r) {
    const sub = resolveUser(iv.submitted_by_email ?? iv.submitted_by)
    const asg = resolveUser(iv.assigned_to)
    const dec = resolveUser(iv.decided_by)
    const { data, error } = await svc.from('ops_invoices').insert({
      account_id: ACCT, location_id: resolveLoc(iv.site), vendor_name: iv.vendor_name,
      invoice_date: iv.invoice_date, amount: iv.amount ?? 0, gl_code: iv.gl_code, status: normStatus(iv.status),
      file_name: iv.file_name, file_type: iv.file_type,
      assigned_to: asg.uid, assigned_to_name: asg.name, submitted_by: sub.uid, submitted_by_name: sub.name,
      submitted_at: iv.submitted_at, decided_by: dec.uid, decided_by_name: dec.name,
      decided_at: iv.decided_at, decision_reason: iv.decision_reason,
    }).select('id').single()
    if (error) { console.log('invoice FAIL', iv.id, error.message); continue }
    n++
    addAttachment('invoice', data.id, parseDataUri(iv.file_data), iv.file_name)
  }
  console.log('ops_invoices:', n)
}

// ---- 3) Violations (from notes; image_pdf -> attachments) ------------------
{
  // severity heuristic: the old app had none, so derive a defensible default
  // from the violation type. Users can adjust per row.
  const severityFor = (type) => {
    const t = (type ?? '').toLowerCase()
    if (/safety|compliance/.test(t)) return 'critical'
    if (/cash|payroll|card|expense|ticket/.test(t)) return 'major'
    return 'minor'
  }
  const r = (await neon.query('select * from notes')).rows
  let n = 0
  for (const note of r) {
    const u = resolveUser(note.submitted_by)
    const description = [note.other_description, note.additional_notes].filter(Boolean).join('\n\n') || null
    const { data, error } = await svc.from('site_violations').insert({
      account_id: ACCT, location_id: resolveLoc(note.location),
      violation_type: note.note_type, department: note.department, severity: severityFor(note.note_type),
      description, status: 'open', reported_by: u.uid, reported_by_name: u.name,
      reported_at: note.created_at, created_at: note.created_at,
    }).select('id').single()
    if (error) { console.log('violation FAIL', note.id, error.message); continue }
    n++
    addAttachment('violation', data.id, parseDataUri(note.image_pdf), note.note_type)
    addAttachment('violation', data.id, parseDataUri(note.pdf_attachment), note.note_type)
  }
  console.log('site_violations:', n)
}

// ---- 4) flush attachments --------------------------------------------------
{
  let n = 0
  for (let i = 0; i < attachments.length; i += 50) {
    const chunk = attachments.slice(i, i + 50)
    const { error } = await svc.from('ops_attachments').insert(chunk)
    if (error) { console.log('attachments FAIL at', i, error.message); break }
    n += chunk.length
  }
  console.log('ops_attachments:', n, 'of', attachments.length)
}

await neon.end()
console.log('Stage 4 complete.')
