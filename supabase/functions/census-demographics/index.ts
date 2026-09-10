// census-demographics — Supabase Edge Function (Deno).
// Resolves a tapped map point to US Census demographics for Market Explorer.
// The Census geocoder (geocoding.geo.census.gov) does not send CORS headers, so
// the browser can't call it directly; this proxy does it server-side. Flow:
// geocode lat/lon -> FIPS, then ACS 5-year for the incorporated place (falling
// back to the county for unincorporated land). Returns raw ACS values keyed by
// variable code; the client formats them. Optional secret: CENSUS_API_KEY.

import { createClient } from 'npm:@supabase/supabase-js@2'

// deno-lint-ignore no-explicit-any
type Any = any

const ACS = '2023'
const VARS = ['B01003_001E', 'B01002_001E', 'B25010_001E', 'B19013_001E', 'B25077_001E', 'B25064_001E']

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

Deno.serve(async (req) => {
  const origin = req.headers.get('Origin')
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) })

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!

  // Any authenticated user in the account may look up demographics; the page
  // itself is already gated to managers+ at the route.
  const auth = req.headers.get('Authorization') ?? ''
  if (!auth.startsWith('Bearer ')) return json({ error: 'unauthorized' }, 401, origin)
  const userClient = createClient(url, anonKey, { global: { headers: { Authorization: auth } } })
  const { data: u } = await userClient.auth.getUser()
  if (!u.user?.id) return json({ error: 'unauthorized' }, 401, origin)

  let body: { lat?: number; lon?: number } = {}
  try {
    body = await req.json()
  } catch {
    /* empty */
  }
  const lat = Number(body.lat)
  const lon = Number(body.lon)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'bad_request' }, 400, origin)

  const censusKey = Deno.env.get('CENSUS_API_KEY')
  const keyParam = censusKey ? `&key=${censusKey}` : ''
  // Census fronts these hosts with a WAF that serves an HTML challenge to
  // datacenter/unknown user-agents; a browser-like UA gets the JSON API.
  const uaHeaders = {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
    Accept: 'application/json,text/plain,*/*',
  }

  try {
    const geoRes = await fetch(
      `https://geocoding.geo.census.gov/geocoder/geographies/coordinates?x=${lon}&y=${lat}` +
        `&benchmark=Public_AR_Current&vintage=Current_Current&layers=all&format=json`,
      { headers: uaHeaders },
    )
    if (!geoRes.ok) return json({ error: 'geocoder', message: `geocoder ${geoRes.status}` }, 502, origin)
    const geo = (await geoRes.json()) as { result?: { geographies?: Record<string, Array<Record<string, string>>> } }
    const g = geo.result?.geographies ?? {}
    const place = g['Incorporated Places']?.[0] ?? g['Census Designated Places']?.[0]
    const county = g['Counties']?.[0]

    let scope: 'place' | 'county'
    let where: string
    let name: string
    if (place?.STATE && place.PLACE) {
      scope = 'place'
      where = `for=place:${place.PLACE}&in=state:${place.STATE}`
      name = place.NAME ?? 'Selected place'
    } else if (county?.STATE && county.COUNTY) {
      scope = 'county'
      where = `for=county:${county.COUNTY}&in=state:${county.STATE}`
      name = county.NAME ?? 'Selected county'
    } else {
      return json({ error: 'no_area' }, 200, origin)
    }

    const acsRes = await fetch(`https://api.census.gov/data/${ACS}/acs/acs5?get=NAME,${VARS.join(',')}&${where}${keyParam}`, {
      headers: uaHeaders,
    })
    // api.census.gov returns an HTML "Missing Key" / error page (status 200) when
    // the request is rejected, so guard on content-type before parsing JSON.
    const ct = acsRes.headers.get('content-type') ?? ''
    if (!acsRes.ok || !ct.includes('json')) {
      return json({ error: 'acs_unavailable', message: censusKey ? 'ACS rejected the request.' : 'Census API key not configured.' }, 502, origin)
    }
    const rows = (await acsRes.json()) as string[][]
    const header = rows[0]
    const vals = rows[1]
    if (!vals) return json({ error: 'no_data' }, 200, origin)

    const values: Record<string, string> = {}
    header.forEach((h: string, i: number) => (values[h] = vals[i]))
    return json({ name, scope, values }, 200, origin)
  } catch (e) {
    return json({ error: 'fetch_failed', message: e instanceof Error ? e.message : String(e) }, 502, origin)
  }
})
