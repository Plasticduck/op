// Stage 1 of the Mighty Wash migration.
//  - wipe showcase data + delete Test Loco (cascades all seeded rows)
//  - create 31 real sites (Site 1..31)
//  - create user profiles for the 28 old-app users (no passwords; invite later)
//  - write scripts/migrate-maps.json (site name -> id, lower(email) -> user id)
// Run: node --env-file=.env.server scripts/migrate-stage1.mjs
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync } from 'node:fs'

const ACCT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
const TEST_LOCO = '389bb8b0-120b-4485-98dd-6a434e93c35a'

const svc = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const neon = new pg.Client({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: false } })
await neon.connect()

// 1) Wipe showcase. Deleting Test Loco cascades equipment/parts/work_orders/
//    checklists/schedules/time_entries/employees/etc. via ON DELETE CASCADE.
await svc.from('ai_insights').delete().eq('account_id', ACCT)
const { error: delErr } = await svc.from('locations').delete().eq('id', TEST_LOCO)
console.log('deleted Test Loco:', delErr ? 'FAIL ' + delErr.message : 'OK')

// 2) Create 31 sites (skip any that already exist for idempotency).
const { data: existingLocs } = await svc.from('locations').select('id, name').eq('account_id', ACCT)
const locByName = new Map((existingLocs ?? []).map((l) => [l.name, l.id]))
for (let n = 1; n <= 31; n++) {
  const name = `Site ${n}`
  if (locByName.has(name)) continue
  const { data, error } = await svc
    .from('locations')
    .insert({ account_id: ACCT, name, timezone: 'America/Chicago' })
    .select('id')
    .single()
  if (error) { console.log('site', n, 'FAIL', error.message); continue }
  locByName.set(name, data.id)
}
console.log('locations now:', locByName.size)

// 3) Users from the old app.
const oldUsers = (await neon.query(
  'select full_name, lower(email) as email, is_admin from users order by is_admin desc, full_name',
)).rows

// existing Supabase auth users (to reuse instead of duplicate)
const { data: authList } = await svc.auth.admin.listUsers({ perPage: 1000 })
const authByEmail = new Map((authList?.users ?? []).map((u) => [u.email?.toLowerCase(), u.id]))

const allSiteIds = [...locByName.entries()]
  .filter(([n]) => n.startsWith('Site '))
  .map(([, id]) => id)

const emailToUser = {}
for (const u of oldUsers) {
  if (!u.email) continue
  let uid = authByEmail.get(u.email)
  if (!uid) {
    const { data: created, error } = await svc.auth.admin.createUser({
      email: u.email,
      email_confirm: true,
      password: crypto.randomUUID() + 'Aa1!', // unusable; they reset/invite later
      user_metadata: { name: u.full_name },
    })
    if (error || !created?.user) { console.log('auth create FAIL', u.email, error?.message); continue }
    uid = created.user.id
    authByEmail.set(u.email, uid)
  }
  const role = u.is_admin ? 'owner' : 'manager'
  const { error: upErr } = await svc.from('users').upsert({
    id: uid,
    account_id: ACCT,
    location_ids: role === 'owner' ? [] : allSiteIds,
    role,
    name: u.full_name,
    email: u.email,
  })
  if (upErr) { console.log('profile FAIL', u.email, upErr.message); continue }
  emailToUser[u.email] = uid
}
console.log('users mapped:', Object.keys(emailToUser).length)

// 4) Save maps for the data-migration stage.
const maps = {
  account: ACCT,
  locationsByName: Object.fromEntries(locByName),
  emailToUser,
}
writeFileSync('scripts/migrate-maps.json', JSON.stringify(maps, null, 2))
console.log('wrote scripts/migrate-maps.json')

await neon.end()
