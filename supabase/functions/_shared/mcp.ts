// An MCP session with someone's own login (CoreNav, FlexWash), for Operator AI.
// Opens the server with their bearer token, lists its tools, keeps the read-only
// ones, and runs them. Sign-in and tokens are in connect.ts.

import { Client } from 'npm:@modelcontextprotocol/sdk@1/client/index.js'
import { StreamableHTTPClientTransport } from 'npm:@modelcontextprotocol/sdk@1/client/streamableHttp.js'

export type McpToolInfo = {
  name: string
  title?: string
  description?: string
  inputSchema?: Record<string, unknown>
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; title?: string }
}
export type McpTool = {
  name: string // the server's name for it
  apiName: string // the name Claude sees: <prefix>_<name>, cleaned
  description: string
  inputSchema: Record<string, unknown>
}

// Verbs that change something wherever they appear in a name.
const WRITE_ANY = new Set(['create', 'update', 'delete', 'remove', 'add', 'insert', 'edit', 'modify', 'archive', 'unarchive',
  'assign', 'unassign', 'upload', 'import', 'merge', 'rename', 'save', 'submit', 'approve', 'reject', 'cancel', 'reopen', 'upsert',
  'enroll', 'invite', 'publish', 'send', 'write', 'set', 'move', 'mark'])
// Words that are verbs that change something only when they lead the name
// ("log_call" writes; "get_activity_log" reads).
const WRITE_FIRST = new Set(['post', 'put', 'patch', 'run', 'execute', 'trigger', 'start', 'stop', 'schedule', 'close', 'complete',
  'link', 'unlink', 'tag', 'untag', 'share', 'email', 'message', 'notify', 'log', 'record', 'convert', 'clone', 'copy', 'generate'])
const READ_WORDS = new Set(['get', 'list', 'search', 'find', 'query', 'read', 'fetch', 'lookup', 'look', 'describe', 'count',
  'summarize', 'summarise', 'summary', 'show', 'view', 'browse', 'retrieve', 'explore', 'analyze', 'analyse', 'compare', 'whoami',
  'me', 'stats', 'report', 'details', 'detail', 'overview', 'info', 'schema', 'profile', 'history', 'timeline'])
const wordsOf = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

// Operator AI only reads. A tool counts as read-only when the server marks it so;
// unmarked tools go by their name: the leading verb decides, then any word, and
// anything unclear is left out.
export function isReadOnlyTool(t: McpToolInfo): boolean {
  if (t.annotations?.readOnlyHint === true) return true
  if (t.annotations?.readOnlyHint === false || t.annotations?.destructiveHint === true) return false
  const w = wordsOf(t.name)
  if (!w.length) return false
  if (WRITE_ANY.has(w[0]) || WRITE_FIRST.has(w[0])) return false
  if (READ_WORDS.has(w[0])) return true
  if (w.some((x) => WRITE_ANY.has(x))) return false
  return w.some((x) => READ_WORDS.has(x))
}

// Claude tool names: letters, digits, _ and -, at most 64 characters.
export function apiNameFor(prefix: string, name: string, taken: Set<string>): string {
  const base = (`${prefix}_` + name.replace(/[^a-zA-Z0-9_-]+/g, '_')).slice(0, 64)
  let n = base
  for (let i = 2; taken.has(n); i++) n = `${base.slice(0, 60)}_${i}`
  taken.add(n)
  return n
}

// A provider's reviewed tool list, for servers that don't mark their tools:
// `read` are checked to only read; `skip` stay out whatever their name says.
export type ToolRules = { read?: string[]; skip?: string[] }

export function toTools(prefix: string, label: string, list: McpToolInfo[], rules: ToolRules = {}): { tools: McpTool[]; skipped: string[] } {
  const taken = new Set<string>()
  const tools: McpTool[] = []
  const skipped: string[] = []
  for (const t of list) {
    const ok = rules.skip?.includes(t.name) ? false : rules.read?.includes(t.name) ? true : isReadOnlyTool(t)
    if (!ok) { skipped.push(t.name); continue }
    const schema = t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : {}
    tools.push({
      name: t.name,
      apiName: apiNameFor(prefix, t.name, taken),
      description: `${label}: ${(t.description ?? t.title ?? t.annotations?.title ?? t.name).slice(0, 4000)}`,
      inputSchema: { ...schema, type: 'object', properties: (schema as { properties?: unknown }).properties ?? {} },
    })
  }
  return { tools, skipped }
}

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${what} timed out`)), ms))])

// The server is down, slow or unreachable (not a problem with the request).
export class McpUnavailable extends Error {}

// A failure as one plain sentence. When a server is down its host answers with a
// whole HTML error page, and the MCP client puts all of it in the message.
export function cleanMcpError(label: string, e: unknown): Error {
  if (e instanceof McpUnavailable) return e
  const raw = e instanceof Error ? e.message : String(e)
  const code = Number((e as { code?: unknown })?.code)
  const status = code >= 100 && code < 600 ? code : Number(raw.match(/\b(?:HTTP|status)\s*\(?(\d{3})\b/i)?.[1] ?? NaN)
  const html = /<(!doctype|html|head|body)\b/i.test(raw)
  if (status >= 500 || (html && !(status >= 400))) {
    return new McpUnavailable(`${label} isn't answering right now${status ? ` (its server returned ${status})` : ''}. That's on ${label}'s side; try again in a few minutes.`)
  }
  if (/timed out/i.test(raw)) return new McpUnavailable(`${label} is taking too long to answer right now. Try again in a few minutes.`)
  if (/fetch failed|network|ECONN|ENOTFOUND|EAI_AGAIN|connection (refused|reset|closed)/i.test(raw)) {
    return new McpUnavailable(`Couldn't reach ${label} right now. Try again in a few minutes.`)
  }
  if (status === 401 || status === 403) return new Error(`${label} turned down your sign-in (${status}). Reconnect ${label} and try again.`)
  const text = raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  return new Error(text.length > 300 ? `${text.slice(0, 300)}…` : text || `${label} failed.`)
}

export class McpSession {
  readonly byApiName: Map<string, McpTool>
  readonly byName: Map<string, McpTool>
  private constructor(
    private client: Client,
    readonly label: string,
    readonly tools: McpTool[],
    readonly skipped: string[],
    // What the server says about using it (its tables, joins, tips), if anything.
    readonly instructions: string | null,
  ) {
    this.byApiName = new Map(tools.map((t) => [t.apiName, t]))
    this.byName = new Map(tools.map((t) => [t.name, t]))
  }

  static async open(server: string, token: string, prefix: string, label: string, rules: ToolRules = {}): Promise<McpSession> {
    const transport = new StreamableHTTPClientTransport(new URL(server), {
      requestInit: { headers: { Authorization: `Bearer ${token}` } },
    })
    const client = new Client({ name: 'operator-ai', version: '1.0.0' })
    try {
      await withTimeout(client.connect(transport), 12_000, `Connecting to ${label}`)
      const all: McpToolInfo[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page++) {
        const r = (await withTimeout(client.listTools(cursor ? { cursor } : undefined), 12_000, `Listing ${label} tools`)) as {
          tools: McpToolInfo[]
          nextCursor?: string
        }
        all.push(...r.tools)
        cursor = r.nextCursor
        if (!cursor) break
      }
      const { tools, skipped } = toTools(prefix, label, all, rules)
      return new McpSession(client, label, tools, skipped, client.getInstructions()?.trim() || null)
    } catch (e) {
      await client.close().catch(() => {})
      throw cleanMcpError(label, e)
    }
  }

  // Runs one tool (by its server name) and returns its text, cut to `max` characters.
  async callByName(name: string, args: unknown, max = 20000): Promise<{ text: string; isError: boolean }> {
    if (!this.byName.has(name)) return { text: `That ${this.label} tool is not available.`, isError: true }
    const r = (await withTimeout(
      this.client.callTool({ name, arguments: (args && typeof args === 'object' ? args : {}) as Record<string, unknown> }),
      60_000, `${this.label} ${name}`,
    ).catch((e) => { throw cleanMcpError(this.label, e) })) as { content?: unknown[]; structuredContent?: unknown; isError?: boolean }
    const parts: string[] = []
    for (const c of (r.content ?? []) as { type: string; text?: string; resource?: { text?: string; uri?: string } }[]) {
      if (c.type === 'text' && c.text) parts.push(c.text)
      else if (c.type === 'resource' && c.resource) parts.push(c.resource.text ?? `[resource ${c.resource.uri ?? ''}]`)
      else parts.push(`[${c.type}]`)
    }
    if (!parts.length && r.structuredContent) parts.push(JSON.stringify(r.structuredContent))
    let text = parts.join('\n')
    if (text.length > max) text = `${text.slice(0, max)}…(truncated: ${text.length.toLocaleString('en-US')} characters in all. Ask for less.)`
    return { text, isError: r.isError === true }
  }

  // Same, by the name Claude sees.
  call(apiName: string, args: unknown, max = 20000): Promise<{ text: string; isError: boolean }> {
    const t = this.byApiName.get(apiName)
    if (!t) return Promise.resolve({ text: `That ${this.label} tool is not available.`, isError: true })
    return this.callByName(t.name, args, max)
  }

  async close(): Promise<void> {
    await this.client.close().catch(() => {})
  }
}
