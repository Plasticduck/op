// Offline tests of Operator AI's connections: the MCP client and its read-only
// rule (against a local MCP server built with the same SDK), and the sign-in
// pieces in connect.ts. No CoreNav or FlexWash login needed. Run from op/:
//   DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock --allow-net --allow-env --allow-read supabase/functions/_shared/mcp_test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import { encodeBase64Url } from 'jsr:@std/encoding@1/base64url'
import { createServer } from 'node:http'
import { z } from 'npm:zod@3'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1/server/mcp.js'
import { StreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1/server/streamableHttp.js'
import { McpSession, McpUnavailable, apiNameFor, cleanMcpError, isReadOnlyTool, toTools } from './mcp.ts'
import { PROVIDERS, authorizeUrl, getOAuthClient, pkceChallenge, signInProblem } from './connect.ts'

Deno.test('read-only rule: annotations first, then the name', () => {
  const ro = (name: string, annotations?: Record<string, boolean>) => isReadOnlyTool({ name, annotations })
  assert(ro('anything', { readOnlyHint: true }))
  assert(!ro('get_deal', { readOnlyHint: false }))
  assert(!ro('list_deals', { destructiveHint: true }))
  for (const n of ['get_deal', 'listAccounts', 'search', 'search_targets', 'deals.list', 'get_activity_log', 'find_contacts', 'whoami', 'corenav_search', 'accounts_query', 'get_email_threads', 'pipeline_summary', 'memberships_getChurnPercentages', 'customers_searchCustomers']) assert(ro(n), n)
  for (const n of ['create_deal', 'updateContact', 'delete_target', 'log_call', 'send_email', 'deals_create', 'add_note', 'mark_won', 'run_report', 'set_stage', 'move_deal', 'thing', 'deals', 'customers_updateCustomer']) assert(!ro(n), n)
})

Deno.test('tool names fit Claude: prefixed, cleaned, unique, at most 64', () => {
  const taken = new Set<string>()
  assertEquals(apiNameFor('corenav', 'deals.list', taken), 'corenav_deals_list')
  assertEquals(apiNameFor('corenav', 'deals/list', taken), 'corenav_deals_list_2')
  const long = apiNameFor('flexwash_mcp', 'x'.repeat(100), taken)
  assert(long.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(long))
  const { tools, skipped } = toTools('corenav', 'CoreNav', [
    { name: 'get_deal', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'create_deal' },
    { name: 'list_accounts' },
  ])
  assertEquals(tools.map((t) => t.apiName), ['corenav_get_deal', 'corenav_list_accounts'])
  assertEquals(skipped, ['create_deal'])
  assertEquals(tools[1].inputSchema, { type: 'object', properties: {} })
  assertStringIncludes(tools[0].description, 'CoreNav: ')
})

Deno.test("CoreNav's reviewed list: its unmarked read tools in, its writes and link/map out", () => {
  // CoreNav's real tool list (2026-11-10); none carry annotations.
  const names = ['describe', 'query', 'save_view', 'map_config', 'save_map', 'record', 'link', 'images', 'map']
  const { tools, skipped } = toTools('corenav', 'CoreNav', names.map((name) => ({ name })), PROVIDERS.corenav.toolRules)
  assertEquals(tools.map((t) => t.name).sort(), ['describe', 'images', 'map_config', 'query', 'record'])
  assertEquals(skipped.sort(), ['link', 'map', 'save_map', 'save_view'])
  // Without the list, the name rule alone would have dropped record, map_config and images.
  const plain = toTools('corenav', 'CoreNav', names.map((name) => ({ name })))
  assertEquals(plain.tools.map((t) => t.name).sort(), ['describe', 'query'])
  // A skip entry wins even over a server's own read-only mark.
  assertEquals(toTools('x', 'X', [{ name: 'link', annotations: { readOnlyHint: true } }], { skip: ['link'] }).tools.length, 0)
})

Deno.test('PKCE challenge is base64url(SHA-256(verifier)), unpadded', async () => {
  const v = 'dBjftJeZ4CVP-mJ0kz7eV2Ou4xVuZ8AR9KoJxLc2NMs'
  const expected = encodeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))
  assertEquals(await pkceChallenge(v), expected)
})

Deno.test('sign-in addresses: CoreNav and FlexWash', async () => {
  const fw = PROVIDERS.flexwash
  // FlexWash identifies Operator by its client ID metadata document, unless FlexWash issues an ID.
  Deno.env.delete('FLEXWASH_MCP_CLIENT_ID')
  const c = await getOAuthClient({} as never, fw)
  assertEquals(c, { client_id: 'https://operator.washlyfe.com/oauth/flexwash-client.json', client_secret: null })
  Deno.env.set('FLEXWASH_MCP_CLIENT_ID', 'issued-id')
  Deno.env.set('FLEXWASH_MCP_CLIENT_SECRET', 'issued-secret')
  assertEquals(await getOAuthClient({} as never, fw), { client_id: 'issued-id', client_secret: 'issued-secret' })
  Deno.env.delete('FLEXWASH_MCP_CLIENT_ID')
  Deno.env.delete('FLEXWASH_MCP_CLIENT_SECRET')

  const u = new URL(authorizeUrl(fw, c, fw.redirectUris[0], 'st', 'ch'))
  assertEquals(u.origin + u.pathname, 'https://flex-wash.us.auth0.com/authorize')
  assertEquals(u.searchParams.get('client_id'), 'https://operator.washlyfe.com/oauth/flexwash-client.json')
  assertEquals(u.searchParams.get('redirect_uri'), 'https://operator.washlyfe.com/app/flexwash/callback')
  assertEquals(u.searchParams.get('scope'), 'openid offline_access') // offline_access: a refresh token
  assertEquals(u.searchParams.get('resource'), 'https://api.flexwash.com/mcp')
  assertEquals(u.searchParams.get('code_challenge_method'), 'S256')

  const cn = PROVIDERS.corenav
  const v = new URL(authorizeUrl(cn, { client_id: 'abc', client_secret: 's' }, cn.redirectUris[0], 'st', 'ch'))
  assertEquals(v.searchParams.get('resource'), 'https://expand.corenav.ai/api/mcp')
  assertEquals(v.searchParams.get('scope'), null)
  assert(!v.toString().includes('client_secret'))

  // The published client document lists the same return address the function uses.
  const doc = JSON.parse(await Deno.readTextFile(new URL('../../../public/oauth/flexwash-client.json', import.meta.url)))
  assertEquals(doc.client_id, fw.clientIdUrl)
  assertEquals(doc.redirect_uris, fw.redirectUris)
  assertEquals(doc.token_endpoint_auth_method, 'none')
})

Deno.test({
  name: "sign-in check: FlexWash's refusal becomes a message; a login page passes",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const http = createServer((req, res) => {
      if (req.url?.includes('unknown')) {
        res.writeHead(400, { 'Content-Type': 'text/html' }).end('<html><body><h1>Oops!</h1><p>invalid_request : Unknown client: https://operator.washlyfe.com/oauth/flexwash-client.json</p></body></html>')
      } else if (req.url?.includes('mismatch')) {
        res.writeHead(403, { 'Content-Type': 'text/html' }).end('<p>Callback URL mismatch. https://x/cb is not in the list of allowed callback URLs</p>')
      } else {
        res.writeHead(302, { Location: '/u/login?state=abc' }).end()
      }
    })
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()))
    const base = `http://127.0.0.1:${(http.address() as { port: number }).port}`
    try {
      assertStringIncludes((await signInProblem(`${base}/authorize?unknown=1`))!, 'Unknown client')
      assertStringIncludes((await signInProblem(`${base}/authorize?mismatch=1`))!, 'Callback URL mismatch')
      assertEquals(await signInProblem(`${base}/authorize?ok=1`), null)
    } finally {
      await new Promise((r) => http.close(r))
    }
  },
})

// A stand-in MCP server: needs a bearer token, has read and write tools.
function standIn(token: string) {
  const calls: string[] = []
  const make = () => {
    const s = new McpServer({ name: 'stand-in', version: '1.0.0' }, { instructions: 'Deals live in the deals table.' })
    s.registerTool('get_deal', { description: 'One deal by id.', inputSchema: { id: z.string() }, annotations: { readOnlyHint: true } },
      ({ id }: { id: string }) => { calls.push('get_deal:' + id); return { content: [{ type: 'text', text: JSON.stringify({ id, name: 'Lubbock West', stage: 'LOI' }) }] } })
    s.registerTool('list_deals', { description: 'All deals.', inputSchema: {} },
      () => { calls.push('list_deals'); return { content: [{ type: 'text', text: JSON.stringify({ deals: [{ id: '1' }, { id: '2' }, { id: '3' }] }) }] } })
    s.registerTool('create_deal', { description: 'Make a deal.', inputSchema: { name: z.string() } },
      () => { calls.push('create_deal'); return { content: [{ type: 'text', text: 'made' }] } })
    s.registerTool('update_stage', { description: 'Change a stage.', inputSchema: { id: z.string() }, annotations: { readOnlyHint: false } },
      () => { calls.push('update_stage'); return { content: [{ type: 'text', text: 'changed' }] } })
    s.registerTool('big_export', { description: 'Lots of text.', inputSchema: {}, annotations: { readOnlyHint: true } },
      () => ({ content: [{ type: 'text', text: 'x'.repeat(50000) }] }))
    s.registerTool('broken_report', { description: 'Fails.', inputSchema: {}, annotations: { readOnlyHint: true } },
      () => ({ isError: true, content: [{ type: 'text', text: 'Report not available' }] }))
    return s
  }
  const http = createServer(async (req, res) => {
    if (req.headers.authorization !== `Bearer ${token}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' }).end('{"error":"invalid_token"}')
      return
    }
    // Stateless, like the SDK's own example: no standing GET stream.
    if (req.method !== 'POST') {
      res.writeHead(405, { Allow: 'POST' }).end()
      return
    }
    let raw = ''
    for await (const chunk of req) raw += chunk
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    const server = make()
    res.on('close', () => { void transport.close(); void server.close() })
    await server.connect(transport)
    await transport.handleRequest(req, res, raw ? JSON.parse(raw) : undefined)
  })
  return { http, calls }
}

Deno.test({
  name: 'MCP session: bearer token, read-only tools only, calls and results',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const { http, calls } = standIn('good-token')
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/mcp`
    try {
      await assertRejects(() => McpSession.open(url, 'wrong-token', 'corenav', 'CoreNav'))

      const s = await McpSession.open(url, 'good-token', 'corenav', 'CoreNav')
      assertEquals(s.tools.map((t) => t.name).sort(), ['big_export', 'broken_report', 'get_deal', 'list_deals'])
      assertEquals(s.skipped.sort(), ['create_deal', 'update_stage'])
      assertEquals(s.instructions, 'Deals live in the deals table.')
      assertStringIncludes(s.byApiName.get('corenav_get_deal')!.description, 'CoreNav: One deal by id.')
      assertEquals((s.byApiName.get('corenav_get_deal')!.inputSchema as { required?: string[] }).required, ['id'])

      const one = await s.call('corenav_get_deal', { id: 'd7' })
      assertEquals(JSON.parse(one.text).stage, 'LOI')
      assertEquals(one.isError, false)
      const byName = await s.callByName('list_deals', {})
      assertEquals(JSON.parse(byName.text).deals.length, 3)
      const big = await s.call('corenav_big_export', {})
      assert(big.text.length < 20200 && big.text.includes('truncated: 50,000 characters'))
      const bad = await s.call('corenav_broken_report', {})
      assertEquals(bad.isError, true)
      assertStringIncludes(bad.text, 'Report not available')
      // A write tool can't be reached, by either name.
      assertEquals((await s.call('corenav_create_deal', { name: 'x' })).isError, true)
      assertEquals((await s.callByName('update_stage', { id: '1' })).isError, true)
      assert(!calls.includes('create_deal') && !calls.includes('update_stage'))
      assertEquals(calls, ['get_deal:d7', 'list_deals'])
      await s.close()
    } finally {
      await new Promise((r) => http.close(r))
    }
  },
})

Deno.test('failures read as one plain sentence, never a host error page', () => {
  const page = '<!DOCTYPE html><html><head><title>502</title></head><body><h1>Bad Gateway</h1><p>This service is currently unavailable.</p></body></html>'
  const down = cleanMcpError('CoreNav', Object.assign(new Error(`Streamable HTTP error: Error POSTing to endpoint: ${page}`), { code: 502 }))
  assert(down instanceof McpUnavailable)
  assertEquals(down.message, "CoreNav isn't answering right now (its server returned 502). That's on CoreNav's side; try again in a few minutes.")
  assert(cleanMcpError('CoreNav', new Error(page)) instanceof McpUnavailable)
  assert(cleanMcpError('CoreNav', new Error('Error POSTing to endpoint (HTTP 503): busy')) instanceof McpUnavailable)
  const slow = cleanMcpError('CoreNav', new Error('Connecting to CoreNav timed out'))
  assert(slow instanceof McpUnavailable)
  assertStringIncludes(slow.message, 'taking too long')
  assert(cleanMcpError('CoreNav', new TypeError('fetch failed')) instanceof McpUnavailable)
  const denied = cleanMcpError('CoreNav', Object.assign(new Error('{"error":"invalid_token"}'), { code: 401 }))
  assert(!(denied instanceof McpUnavailable))
  assertStringIncludes(denied.message, 'Reconnect CoreNav')
  // Anything else: tags gone, short.
  const other = cleanMcpError('CoreNav', new Error(`Binder Error: <b>no</b> column ${'x'.repeat(400)}`))
  assert(!other.message.includes('<b>') && other.message.length <= 301)
  assertEquals(cleanMcpError('CoreNav', down), down)
})

Deno.test({
  name: 'MCP session: a down server (HTML 502) fails with a plain message',
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    const http = createServer((_req, res) => {
      res.writeHead(502, { 'Content-Type': 'text/html' }).end('<!DOCTYPE html><html><body><h1>Bad Gateway</h1></body></html>')
    })
    await new Promise<void>((r) => http.listen(0, '127.0.0.1', () => r()))
    const url = `http://127.0.0.1:${(http.address() as { port: number }).port}/api/mcp`
    try {
      const e = await assertRejects(() => McpSession.open(url, 'any', 'corenav', 'CoreNav'))
      assert(e instanceof McpUnavailable)
      assertEquals((e as Error).message, "CoreNav isn't answering right now (its server returned 502). That's on CoreNav's side; try again in a few minutes.")
    } finally {
      await new Promise((r) => http.close(r))
    }
  },
})
