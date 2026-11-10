// Offline tests of the CoreNav MCP client and its read-only rule, against a local
// MCP server built with the same SDK (no CoreNav login needed). Run from op/:
//   DENO_NO_PACKAGE_JSON=1 npx deno test --no-lock --allow-net --allow-env --allow-read supabase/functions/_shared/corenav_test.ts
import { assert, assertEquals, assertRejects, assertStringIncludes } from 'jsr:@std/assert@1'
import { createServer } from 'node:http'
import { encodeBase64Url } from 'jsr:@std/encoding@1/base64url'
import { z } from 'npm:zod@3'
import { McpServer } from 'npm:@modelcontextprotocol/sdk@1/server/mcp.js'
import { StreamableHTTPServerTransport } from 'npm:@modelcontextprotocol/sdk@1/server/streamableHttp.js'
import { CoreNavSession, apiNameFor, isReadOnlyTool, pkceChallenge, toTools } from './corenav.ts'

Deno.test('read-only rule: annotations first, then the name', () => {
  const ro = (name: string, annotations?: Record<string, boolean>) => isReadOnlyTool({ name, annotations })
  assert(ro('anything', { readOnlyHint: true }))
  assert(!ro('get_deal', { readOnlyHint: false }))
  assert(!ro('list_deals', { destructiveHint: true }))
  for (const n of ['get_deal', 'listAccounts', 'search', 'search_targets', 'deals.list', 'get_activity_log', 'find_contacts', 'whoami', 'corenav_search', 'accounts_query', 'get_email_threads', 'pipeline_summary']) assert(ro(n), n)
  for (const n of ['create_deal', 'updateContact', 'delete_target', 'log_call', 'send_email', 'deals_create', 'add_note', 'mark_won', 'run_report', 'set_stage', 'move_deal', 'thing', 'deals']) assert(!ro(n), n)
})

Deno.test('tool names fit Claude: prefixed, cleaned, unique, at most 64', () => {
  const taken = new Set<string>()
  assertEquals(apiNameFor('deals.list', taken), 'corenav_deals_list')
  assertEquals(apiNameFor('deals/list', taken), 'corenav_deals_list_2')
  const long = apiNameFor('x'.repeat(100), taken)
  assert(long.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(long))
  const { tools, skipped } = toTools([
    { name: 'get_deal', inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
    { name: 'create_deal' },
    { name: 'list_accounts' },
  ])
  assertEquals(tools.map((t) => t.apiName), ['corenav_get_deal', 'corenav_list_accounts'])
  assertEquals(skipped, ['create_deal'])
  assertEquals(tools[1].inputSchema, { type: 'object', properties: {} })
})

Deno.test('PKCE challenge is base64url(SHA-256(verifier)), unpadded', async () => {
  const v = 'dBjftJeZ4CVP-mJ0kz7eV2Ou4xVuZ8AR9KoJxLc2NMs'
  const expected = encodeBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v))))
  assertEquals(await pkceChallenge(v), expected)
  assert(!expected.includes('=') && !/[+/]/.test(expected))
})

// A stand-in CoreNav: needs a bearer token, has read and write tools.
function standIn(token: string) {
  const calls: string[] = []
  const make = () => {
    const s = new McpServer({ name: 'corenav-stand-in', version: '1.0.0' })
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
    const port = (http.address() as { port: number }).port
    const url = `http://127.0.0.1:${port}/api/mcp`
    try {
      await assertRejects(() => CoreNavSession.open('wrong-token', url))

      const s = await CoreNavSession.open('good-token', url)
      assertEquals(s.tools.map((t) => t.name).sort(), ['big_export', 'broken_report', 'get_deal', 'list_deals'])
      assertEquals(s.skipped.sort(), ['create_deal', 'update_stage'])
      assertStringIncludes(s.byApiName.get('corenav_get_deal')!.description, 'CoreNav: One deal by id.')
      assertEquals((s.byApiName.get('corenav_get_deal')!.inputSchema as { required?: string[] }).required, ['id'])

      const one = await s.call('corenav_get_deal', { id: 'd7' })
      assertEquals(JSON.parse(one.text).stage, 'LOI')
      assertEquals(one.isError, false)
      const list = await s.call('corenav_list_deals', {})
      assertEquals(JSON.parse(list.text).deals.length, 3)
      const big = await s.call('corenav_big_export', {})
      assert(big.text.length < 20200 && big.text.includes('truncated: 50,000 characters'))
      const bad = await s.call('corenav_broken_report', {})
      assertEquals(bad.isError, true)
      assertStringIncludes(bad.text, 'Report not available')
      // A write tool can't be reached even by name.
      const w = await s.call('corenav_create_deal', { name: 'x' })
      assertEquals(w.isError, true)
      assert(!calls.includes('create_deal') && !calls.includes('update_stage'))
      assertEquals(calls, ['get_deal:d7', 'list_deals'])
      await s.close()
    } finally {
      await new Promise((r) => http.close(r))
    }
  },
})
