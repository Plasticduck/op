// seed.ts — creates demo auth users + their profile rows via the service role.
// Run AFTER `supabase db push` and after `seed.sql` has loaded business data:
//   npm run seed
//
// Needs SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in the environment (.env.server).
// The service-role client bypasses RLS, which is required to create users and
// link them to the demo account/locations.

import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !serviceKey) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.')
  process.exit(1)
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const ACCOUNT = '00000000-0000-0000-0000-0000000000a1'
const LOC_HW40 = '00000000-0000-0000-0000-0000000000b1'
const LOC_DT = '00000000-0000-0000-0000-0000000000b2'

const PEOPLE = [
  { email: 'owner@demo.tunnelsync.app', name: 'Demo Owner', role: 'owner', locs: [LOC_HW40, LOC_DT] },
  { email: 'manager@demo.tunnelsync.app', name: 'Demo Manager', role: 'manager', locs: [LOC_HW40] },
  { email: 'employee@demo.tunnelsync.app', name: 'Demo Employee', role: 'employee', locs: [LOC_HW40] },
] as const

const PASSWORD = 'tunnelsync-demo'

async function upsertUser(p: (typeof PEOPLE)[number]) {
  // Create (or find) the auth user with a confirmed email.
  const { data: created, error } = await admin.auth.admin.createUser({
    email: p.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { name: p.name },
  })

  let userId = created?.user?.id
  if (error && !userId) {
    // Already exists — look it up by listing.
    const { data: list } = await admin.auth.admin.listUsers()
    userId = list?.users.find((u) => u.email === p.email)?.id
  }
  if (!userId) throw new Error(`could not create/find ${p.email}`)

  const { error: upErr } = await admin.from('users').upsert({
    id: userId,
    account_id: ACCOUNT,
    location_ids: p.locs,
    role: p.role,
    name: p.name,
    email: p.email,
  })
  if (upErr) throw upErr

  console.log(`✓ ${p.role.padEnd(8)} ${p.email}`)
  return userId
}

async function main() {
  for (const p of PEOPLE) await upsertUser(p)

  // Link the employee login to an existing employee HR record at Highway 40.
  const employeeUser = (await admin.auth.admin.listUsers()).data.users.find(
    (u) => u.email === 'employee@demo.tunnelsync.app',
  )
  if (employeeUser) {
    await admin
      .from('employees')
      .update({ user_id: employeeUser.id })
      .eq('email', 'marcus@demo.tunnelsync.app')
  }

  console.log(`\nDemo logins ready. Password for all: ${PASSWORD}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
