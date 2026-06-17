// Captures a fresh /app/dashboard screenshot for the marketing landing page.
//
// Auth flow: the on-demand demo is now lead-gated, so we sidestep it. Using
// the service-role key we mint a magiclink for the demo owner, verify the
// token-hash server-side to mint a real session, then inject that session
// into the browser's localStorage under the Supabase auth key BEFORE we hit
// /app/dashboard. The supabase-js client picks it up on init and renders the
// authed dashboard without any login flow.
//
// Run from the repo root:
//   node scripts/capture-dashboard.mjs
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { writeFileSync, readFileSync } from 'node:fs'

// Server secrets live in .env.server; the anon key ships to the client so it
// lives in .env.local under the VITE_ prefix. Read both.
const parseEnv = (file) => {
  try {
    return Object.fromEntries(
      readFileSync(file, 'utf8').split('\n').filter(Boolean).filter((l) => l.includes('=') && !l.startsWith('#'))
        .map((l) => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)] }),
    )
  } catch { return {} }
}
const env = { ...parseEnv('.env.server'), ...parseEnv('.env.local') }
const SUPABASE_URL = env.SUPABASE_URL || env.VITE_SUPABASE_URL
const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY
const ANON_KEY = env.SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY
if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
  console.error('Need SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.server) + VITE_SUPABASE_ANON_KEY (.env.local)')
  process.exit(1)
}

const SITE = 'https://operator.washlyfe.com'
const DEMO_EMAIL = 'owner@demo.washlyfe.com'
const OUT = 'public/dashboard-preview.png'
const VIEWPORT = { width: 1440, height: 900 }

const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } })

console.log('1) minting magic-link for', DEMO_EMAIL)
const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
  type: 'magiclink',
  email: DEMO_EMAIL,
})
if (linkErr) { console.error('generateLink failed:', linkErr.message); process.exit(1) }
const hashedToken = linkData?.properties?.hashed_token
if (!hashedToken) { console.error('no hashed_token in response'); process.exit(1) }

console.log('2) verifying token-hash to get a session')
const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false } })
const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
  token_hash: hashedToken,
  type: 'magiclink',
})
if (verifyErr || !verifyData?.session) {
  console.error('verifyOtp failed:', verifyErr?.message ?? 'no session')
  process.exit(1)
}
const session = verifyData.session
console.log('   got session for', session.user.email, 'expires', session.expires_at)

// The Supabase JS client stores sessions in localStorage under a key derived
// from the project ref: "sb-<ref>-auth-token". Match its shape so the client
// recognizes the session on the next page load.
const projectRef = new URL(SUPABASE_URL).hostname.split('.')[0]
const storageKey = `sb-${projectRef}-auth-token`
const storageValue = JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_in: session.expires_in,
  expires_at: session.expires_at,
  token_type: session.token_type,
  user: session.user,
})

console.log('3) launching headless chromium and injecting session')
const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'light',
})

// Inject the session token into localStorage before any JS runs on operator.washlyfe.com.
await ctx.addInitScript(({ key, value }) => {
  try { window.localStorage.setItem(key, value) } catch { /* ignore */ }
}, { key: storageKey, value: storageValue })

const page = await ctx.newPage()
page.on('console', (m) => { if (m.type() === 'error') console.error('  [browser-err]', m.text().slice(0, 200)) })
page.on('pageerror', (e) => console.error('  [page-err]', e.message))

// Pin the clock to 9:30 AM of the CURRENT day so the greeting reads
// "Good morning". Must stay BEFORE the access token's expiry (real now + 1h),
// so we only ever pin backward — pinning forward expires the session and the
// app bounces to /login. If it's already morning, skip pinning entirely.
const realNow = new Date()
const morning = new Date(realNow)
morning.setHours(9, 30, 0, 0)
if (morning < realNow) {
  await page.clock.install({ time: morning })
}

console.log('4) navigating to /app/dashboard')
await page.goto(SITE + '/app/dashboard', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle').catch(() => {})

// Wait for the dashboard to actually render (the sidebar logo + stat cards),
// not a redirect to /login.
const sawDashboard = await page.waitForSelector('text=/Good (morning|afternoon|evening)/i', { timeout: 12_000 })
  .then(() => true).catch(() => false)
if (!sawDashboard) {
  console.warn('   greeting not found, current url:', page.url())
  // Give realtime a bit longer in case it's slow.
  await page.waitForTimeout(3_000)
}
// Let realtime + lazy queries settle so the cards have numbers, not zeros.
await page.waitForTimeout(3_500)

// Hide the demo-mode banner for a clean marketing shot. It's the only
// element containing this copy; hiding the wrapper collapses the row.
await page.evaluate(() => {
  for (const el of document.querySelectorAll('div')) {
    if (el.textContent?.startsWith("You're exploring the WashLyfe demo") && el.childElementCount <= 3) {
      el.style.display = 'none'
      break
    }
  }
})
await page.waitForTimeout(300)

console.log('5) capturing on', page.url())
const buf = await page.screenshot({ fullPage: false, type: 'png' })
writeFileSync(OUT, buf)
console.log('   wrote', OUT, '-', buf.length, 'bytes')

await browser.close()
