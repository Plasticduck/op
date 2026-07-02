// google-calendar-events — Supabase Edge Function (Deno).
// Returns the calling user's Google Calendar events for a time range (read
// only), refreshing the access token as needed. Returns connected:false when
// the user hasn't linked Google. Deploy with --no-verify-jwt (auth done here).

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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  const json = (b: unknown, status = 200) =>
    new Response(JSON.stringify(b), {
      status,
      headers: { ...corsHeaders(origin), 'Content-Type': 'application/json' },
    })
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
  const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')

  const userClient = createClient(url, anonKey, {
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user) return json({ error: 'unauthorized' }, 401)

  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data: conn } = await svc
    .from('google_calendar_connections')
    .select('*')
    .eq('user_id', u.user.id)
    .maybeSingle()

  if (!conn) return json({ connected: false, events: [] })
  if (!clientId || !clientSecret) return json({ connected: true, email: conn.email, events: [] })

  // Refresh the access token if missing or within a minute of expiring.
  let accessToken = conn.access_token as string | null
  const expired =
    !conn.token_expiry || new Date(conn.token_expiry).getTime() < Date.now() + 60_000
  if (!accessToken || expired) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: conn.refresh_token,
        grant_type: 'refresh_token',
      }),
    })
    const t = await r.json()
    if (!t.access_token) {
      return json({ connected: true, email: conn.email, events: [], error: 'refresh_failed' })
    }
    accessToken = t.access_token
    await svc
      .from('google_calendar_connections')
      .update({
        access_token: t.access_token,
        token_expiry: new Date(Date.now() + (t.expires_in ?? 3600) * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', u.user.id)
  }

  let body: { timeMin?: string; timeMax?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  const evUrl = new URL(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(conn.calendar_id)}/events`,
  )
  if (body.timeMin) evUrl.searchParams.set('timeMin', body.timeMin)
  if (body.timeMax) evUrl.searchParams.set('timeMax', body.timeMax)
  evUrl.searchParams.set('singleEvents', 'true')
  evUrl.searchParams.set('orderBy', 'startTime')
  evUrl.searchParams.set('maxResults', '250')

  const res = await fetch(evUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  })
  const data = await res.json()
  if (!res.ok) {
    return json({ connected: true, email: conn.email, events: [], error: 'fetch_failed' })
  }

  type GEvent = {
    id: string
    summary?: string
    start?: { dateTime?: string; date?: string }
    end?: { dateTime?: string; date?: string }
  }
  const events = ((data.items ?? []) as GEvent[])
    .map((e) => {
      const start = e.start?.dateTime ?? e.start?.date ?? null
      const end = e.end?.dateTime ?? e.end?.date ?? null
      return {
        id: e.id,
        title: e.summary ?? '(no title)',
        start,
        end,
        allDay: !!e.start?.date,
      }
    })
    .filter((e) => e.start)

  return json({ connected: true, email: conn.email, events })
})
