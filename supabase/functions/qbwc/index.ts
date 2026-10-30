// qbwc — Supabase Edge Function (Deno). The SOAP service Intuit's QuickBooks
// Web Connector checks in with, for QuickBooks Enterprise (Desktop), which has
// no cloud API (migration 0199 has the tables and the flow).
//
// Each check-in: authenticate (the account's Web Connector user name and
// password from the QuickBooks page) -> sendRequestXML (we hand over qbXML)
// -> receiveResponseXML (QuickBooks' answer) -> repeat while there's work ->
// closeConnection. Work is, in order: refreshing the vendor, account and class
// lists when they're over 12 hours old or someone asked, then queued bills (up
// to BILLS_PER_ROUND a round). A bill QuickBooks accepts marks its invoice
// exported. A bill that was handed over but never answered for is marked
// unknown and never sent again by itself, so nothing is entered twice.
//
// No Supabase JWT (the Web Connector can't send one): deploy with
// --no-verify-jwt. The login is checked by qb_check_login (bcrypt).
// Auto-provided: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2'

const NS = 'http://developer.intuit.com/'
const BILLS_PER_ROUND = 20
const LISTS_MAX_AGE_MS = 12 * 3600_000

type Conn = {
  account_id: string
  company_file: string | null
  lists_requested_at: string | null
  lists_synced_at: string | null
  session_ticket: string | null
  session_stage: 'lists' | 'bills' | null
  last_error: string | null
}
type Ref = { list_id: string; name?: string; full_name?: string }
type Payload = {
  vendor: Ref
  txn_date: string
  due_date: string | null
  ref_number: string
  memo: string
  lines: { account: Ref; amount: number; class: Ref | null }[]
}

const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]!))
const unesc = (s: string) =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')

// The text of the first <tag>...</tag> (any namespace prefix), unescaped.
function field(xml: string, tag: string): string | null {
  const m = xml.match(new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${tag}>`))
  if (m) {
    const cdata = m[1].match(/^\s*<!\[CDATA\[([\s\S]*)\]\]>\s*$/)
    return cdata ? cdata[1] : unesc(m[1])
  }
  return new RegExp(`<(?:\\w+:)?${tag}(?:\\s[^>]*)?/>`).test(xml) ? '' : null
}
const attr = (open: string, name: string) => {
  const m = open.match(new RegExp(`\\b${name}="([^"]*)"`))
  return m ? unesc(m[1]) : null
}
// Every <tag ...>...</tag> block, with its opening tag.
function blocks(xml: string, tag: string): { open: string; body: string }[] {
  const out: { open: string; body: string }[] = []
  const re = new RegExp(`(<${tag}\\b[^>]*?)(?:/>|>([\\s\\S]*?)</${tag}>)`, 'g')
  for (const m of xml.matchAll(re)) out.push({ open: m[1], body: m[2] ?? '' })
  return out
}

function soap(method: string, inner: string): Response {
  const xml = '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    `<soap:Body><${method}Response xmlns="${NS}"><${method}Result>${inner}</${method}Result></${method}Response></soap:Body></soap:Envelope>`
  return new Response(xml, { headers: { 'Content-Type': 'text/xml; charset=utf-8' } })
}

function qbxml(version: string, requests: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><?qbxml version="${version}"?>` +
    `<QBXML><QBXMLMsgsRq onError="continueOnError">${requests}</QBXMLMsgsRq></QBXML>`
}

const LISTS_RQ =
  '<VendorQueryRq requestID="vendor"><ActiveStatus>All</ActiveStatus>' +
  '<IncludeRetElement>ListID</IncludeRetElement><IncludeRetElement>Name</IncludeRetElement><IncludeRetElement>IsActive</IncludeRetElement></VendorQueryRq>' +
  '<AccountQueryRq requestID="account"><ActiveStatus>All</ActiveStatus>' +
  '<IncludeRetElement>ListID</IncludeRetElement><IncludeRetElement>Name</IncludeRetElement><IncludeRetElement>FullName</IncludeRetElement>' +
  '<IncludeRetElement>IsActive</IncludeRetElement><IncludeRetElement>AccountType</IncludeRetElement><IncludeRetElement>AccountNumber</IncludeRetElement></AccountQueryRq>' +
  '<ClassQueryRq requestID="class"><ActiveStatus>All</ActiveStatus>' +
  '<IncludeRetElement>ListID</IncludeRetElement><IncludeRetElement>Name</IncludeRetElement><IncludeRetElement>FullName</IncludeRetElement><IncludeRetElement>IsActive</IncludeRetElement></ClassQueryRq>'

// A bill, by QuickBooks' own ids. Element order follows the qbXML schema.
function billAdd(jobId: string, p: Payload): string {
  const memo = (p.memo ?? '').slice(0, 4000)
  const lines = p.lines.map((l) =>
    '<ExpenseLineAdd>' +
    `<AccountRef><ListID>${esc(l.account.list_id)}</ListID></AccountRef>` +
    `<Amount>${(Math.round(l.amount * 100) / 100).toFixed(2)}</Amount>` +
    (memo ? `<Memo>${esc(memo)}</Memo>` : '') +
    (l.class ? `<ClassRef><ListID>${esc(l.class.list_id)}</ListID></ClassRef>` : '') +
    '</ExpenseLineAdd>').join('')
  return `<BillAddRq requestID="${esc(jobId)}"><BillAdd>` +
    `<VendorRef><ListID>${esc(p.vendor.list_id)}</ListID></VendorRef>` +
    `<TxnDate>${esc(p.txn_date)}</TxnDate>` +
    (p.due_date ? `<DueDate>${esc(p.due_date)}</DueDate>` : '') +
    (p.ref_number ? `<RefNumber>${esc(p.ref_number.slice(0, 20))}</RefNumber>` : '') +
    (memo ? `<Memo>${esc(memo)}</Memo>` : '') +
    lines + '</BillAdd></BillAddRq>'
}

const listsDue = (c: Conn) =>
  !c.lists_synced_at
  || Date.now() - Date.parse(c.lists_synced_at) > LISTS_MAX_AGE_MS
  || (!!c.lists_requested_at && Date.parse(c.lists_requested_at) > Date.parse(c.lists_synced_at))

async function hasQueued(svc: SupabaseClient, account: string): Promise<boolean> {
  const { count } = await svc.from('qb_jobs').select('id', { count: 'exact', head: true })
    .eq('account_id', account).eq('status', 'queued')
  return (count ?? 0) > 0
}

async function connByTicket(svc: SupabaseClient, ticket: string | null): Promise<Conn | null> {
  if (!ticket) return null
  const { data } = await svc.from('qb_connections')
    .select('account_id, company_file, lists_requested_at, lists_synced_at, session_ticket, session_stage, last_error')
    .eq('session_ticket', ticket).maybeSingle()
  return (data as Conn | null) ?? null
}

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const svc = createClient(url, serviceKey, { auth: { persistSession: false } })

  // The .qwc file's support link (the Web Connector wants one on this host).
  if (req.method === 'GET') {
    return new Response('<!doctype html><title>Operator QuickBooks connector</title><p>This is Operator\'s QuickBooks Web Connector service. Set it up and see what it sent in Operator, on the QuickBooks page.</p>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const body = await req.text()
  const method = body.match(/<(?:\w+:)?Body[^>]*>\s*<(?:\w+:)?(\w+)/)?.[1] ?? ''
  const ticket = field(body, 'ticket')

  switch (method) {
    case 'serverVersion':
      return soap(method, 'Operator 1.0')
    case 'clientVersion':
      return soap(method, '')

    case 'authenticate': {
      const user = field(body, 'strUserName') ?? ''
      const pass = field(body, 'strPassword') ?? ''
      const { data: account } = await svc.rpc('qb_check_login', { p_username: user, p_password: pass })
      if (!account) return soap(method, '<string></string><string>nvu</string>')
      const t = crypto.randomUUID()
      // Bills handed over in an earlier check-in that never came back: don't
      // guess, flag them for a person to check in QuickBooks.
      await svc.from('qb_jobs').update({
        status: 'unknown', done_at: new Date().toISOString(),
        error: "The Web Connector didn't report back on this bill. Check QuickBooks for it before sending it again.",
      }).eq('account_id', account).eq('status', 'sent')
      const { data: c } = await svc.from('qb_connections')
        .update({ session_ticket: t, session_stage: null, session_started_at: new Date().toISOString(), last_contact_at: new Date().toISOString() })
        .eq('account_id', account)
        .select('account_id, company_file, lists_requested_at, lists_synced_at, session_ticket, session_stage, last_error').single()
      const conn = c as Conn
      const work = listsDue(conn) || await hasQueued(svc, conn.account_id)
      // With work: the company file to open ('' = the one open in QuickBooks).
      return soap(method, `<string>${esc(t)}</string><string>${work ? esc(conn.company_file ?? '') : 'none'}</string>`)
    }

    case 'sendRequestXML': {
      const conn = await connByTicket(svc, ticket)
      if (!conn) return soap(method, '')
      const file = field(body, 'strCompanyFileName')
      const major = Number(field(body, 'qbXMLMajorVers')) || 13
      const minor = Number(field(body, 'qbXMLMinorVers')) || 0
      // 13.0 has everything used here and every recent Enterprise reads it.
      const version = major >= 13 ? '13.0' : `${major}.0`
      await svc.from('qb_connections').update({
        ...(file ? { company_file: file } : {}), qbxml_version: `${major}.${minor}`, last_contact_at: new Date().toISOString(),
      }).eq('account_id', conn.account_id)

      if (listsDue(conn)) {
        await svc.from('qb_connections').update({ session_stage: 'lists' }).eq('account_id', conn.account_id)
        return soap(method, esc(qbxml(version, LISTS_RQ)))
      }

      const { data: queued } = await svc.from('qb_jobs').select('id, invoice_id, payload')
        .eq('account_id', conn.account_id).eq('status', 'queued').order('created_at').limit(BILLS_PER_ROUND)
      const ids = (queued ?? []).map((j) => j.invoice_id).filter(Boolean) as string[]
      const { data: invs } = ids.length
        ? await svc.from('ops_invoices').select('id, status').in('id', ids)
        : { data: [] as { id: string; status: string }[] }
      const approved = new Set((invs ?? []).filter((i) => i.status === 'approved').map((i) => i.id))
      const rqs: string[] = []
      for (const j of queued ?? []) {
        // Exported from Invoice Approval (or changed) after it was queued.
        if (!j.invoice_id || !approved.has(j.invoice_id)) {
          await svc.from('qb_jobs').update({
            status: 'failed', done_at: new Date().toISOString(),
            error: 'This invoice is no longer approved and waiting (it was exported or changed in Invoice Approval), so it was not sent.',
          }).eq('id', j.id)
          continue
        }
        const { data: claimed } = await svc.from('qb_jobs').update({ status: 'sent', ticket, sent_at: new Date().toISOString() })
          .eq('id', j.id).eq('status', 'queued').select('attempts').maybeSingle()
        if (!claimed) continue
        await svc.from('qb_jobs').update({ attempts: (claimed.attempts ?? 0) + 1 }).eq('id', j.id)
        rqs.push(billAdd(j.id, j.payload as Payload))
      }
      await svc.from('qb_connections').update({ session_stage: 'bills' }).eq('account_id', conn.account_id)
      // Nothing left after all: a harmless request keeps the Web Connector happy.
      return soap(method, esc(qbxml(version, rqs.length ? rqs.join('') : '<CompanyQueryRq requestID="noop"></CompanyQueryRq>')))
    }

    case 'receiveResponseXML': {
      const conn = await connByTicket(svc, ticket)
      if (!conn) return soap(method, '-1')
      const response = field(body, 'response') ?? ''
      const hresult = field(body, 'hresult') ?? ''
      const message = field(body, 'message') ?? ''
      const now = new Date().toISOString()

      if (hresult) {
        // QuickBooks couldn't run the request at all, so nothing was entered.
        const why = `QuickBooks couldn't read the request: ${message || hresult}`
        await svc.from('qb_connections').update({ last_error: why }).eq('account_id', conn.account_id)
        if (conn.session_stage === 'bills') {
          await svc.from('qb_jobs').update({ status: 'failed', error: why, done_at: now }).eq('ticket', ticket).eq('status', 'sent')
        }
        return soap(method, '-1')
      }

      if (conn.session_stage === 'lists') {
        for (const type of ['vendor', 'account', 'class'] as const) {
          const tag = type === 'vendor' ? 'Vendor' : type === 'account' ? 'Account' : 'Class'
          const rs = blocks(response, `${tag}QueryRs`)[0]
          const code = rs ? attr(rs.open, 'statusCode') : null
          if (!rs || (code !== '0' && code !== '1')) continue // 1 = the list is empty
          const items = blocks(rs.body, `${tag}Ret`).map(({ body: b }) => ({
            list_id: field(b, 'ListID'), name: field(b, 'Name'), full_name: field(b, 'FullName') ?? field(b, 'Name'),
            account_number: field(b, 'AccountNumber'), account_type: field(b, 'AccountType'),
            is_active: (field(b, 'IsActive') ?? 'true') === 'true',
          }))
          await svc.rpc('qb_replace_list', { p_account: conn.account_id, p_type: type, p_items: items })
        }
        await svc.from('qb_connections').update({ lists_synced_at: now, last_error: null }).eq('account_id', conn.account_id)
      } else if (conn.session_stage === 'bills') {
        for (const { open, body: b } of blocks(response, 'BillAddRs')) {
          const id = attr(open, 'requestID')
          if (!id) continue
          if (attr(open, 'statusSeverity') === 'Error') {
            await svc.from('qb_jobs').update({
              status: 'failed', done_at: now,
              error: `QuickBooks said: ${attr(open, 'statusMessage') ?? 'error'} (code ${attr(open, 'statusCode') ?? '?'})`,
            }).eq('id', id).eq('ticket', ticket)
            continue
          }
          const { data: job } = await svc.from('qb_jobs')
            .update({ status: 'posted', qb_txn_id: field(b, 'TxnID'), error: null, done_at: now })
            .eq('id', id).eq('ticket', ticket).select('invoice_id, created_by').maybeSingle()
          if (job?.invoice_id) {
            const { data: who } = job.created_by
              ? await svc.from('users').select('name').eq('id', job.created_by).maybeSingle()
              : { data: null }
            await svc.from('ops_invoices').update({
              status: 'exported', exported_at: now, exported_by: job.created_by,
              exported_by_name: `${who?.name ?? 'Operator'} (sent to QuickBooks)`,
            }).eq('id', job.invoice_id).eq('status', 'approved')
          }
        }
        // Handed over but missing from the answer: don't guess.
        await svc.from('qb_jobs').update({
          status: 'unknown', done_at: now,
          error: "QuickBooks didn't answer for this bill. Check QuickBooks for it before sending it again.",
        }).eq('ticket', ticket).eq('status', 'sent')
        await svc.from('qb_connections').update({ last_error: null }).eq('account_id', conn.account_id)
      }

      await svc.from('qb_connections').update({ session_stage: null }).eq('account_id', conn.account_id)
      // Less than 100 asks for another round.
      return soap(method, (await hasQueued(svc, conn.account_id)) ? '50' : '100')
    }

    case 'getLastError': {
      const conn = await connByTicket(svc, ticket)
      return soap(method, esc(conn?.last_error ?? 'Something went wrong. See the QuickBooks page in Operator.'))
    }

    case 'connectionError': {
      const conn = await connByTicket(svc, ticket)
      const message = field(body, 'message') ?? field(body, 'hresult') ?? 'unknown error'
      if (conn) {
        await svc.from('qb_connections').update({
          last_error: `The Web Connector couldn't open QuickBooks: ${message}`, session_ticket: null, session_stage: null,
        }).eq('account_id', conn.account_id)
      }
      return soap(method, 'done')
    }

    case 'closeConnection': {
      const conn = await connByTicket(svc, ticket)
      let summary = 'Done.'
      if (conn) {
        const { data: jobs } = await svc.from('qb_jobs').select('status').eq('ticket', ticket)
        const posted = (jobs ?? []).filter((j) => j.status === 'posted').length
        const failed = (jobs ?? []).filter((j) => j.status === 'failed').length
        summary = jobs?.length
          ? `Done: ${posted} bill${posted === 1 ? '' : 's'} entered${failed ? `, ${failed} not (see Operator)` : ''}.`
          : 'Done: QuickBooks lists are up to date.'
        await svc.from('qb_connections').update({ session_ticket: null, session_stage: null }).eq('account_id', conn.account_id)
      }
      return soap(method, esc(summary))
    }

    default:
      return soap(method || 'unknown', '')
  }
})
