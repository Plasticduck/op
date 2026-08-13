// poll-invoices-mailbox — Supabase Edge Function (Deno), CRON.
// Reads unread messages that have attachments from the invoice mailbox via
// Microsoft Graph (app-only client credentials), posts each to the
// invoice-inbound webhook (which files it as an Unassigned invoice with the AI
// vendor match + stored attachment), then marks the message read so it is not
// re-imported. A message that fails is left unread to retry next run rather than
// aborting the batch. Capped per run; the next run picks up the rest.
//
// Secrets: GRAPH_TENANT_ID, GRAPH_CLIENT_ID, GRAPH_CLIENT_SECRET,
//   INVOICE_MAILBOX (e.g. mwinvoices@washlyfe.com). Reuses INVOICE_INBOUND_SECRET
//   and SUPABASE_URL (for the webhook URL).
// Auth: service-role JWT only (called by pg_cron).

const GRAPH = 'https://graph.microsoft.com/v1.0'
const MAX_PER_RUN = 25

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
function jwtRole(auth: string): string | null {
  const token = auth.replace(/^Bearer\s+/i, '')
  const parts = token.split('.')
  if (parts.length !== 3) return null
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'))).role ?? null
  } catch {
    return null
  }
}

async function graphToken(tenant: string, clientId: string, secret: string): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    }),
  })
  const j = await res.json().catch(() => ({}))
  if (!res.ok || !j.access_token) throw new Error(`graph token failed (${res.status}: ${j.error_description ?? ''})`)
  return j.access_token as string
}

Deno.serve(async (req) => {
  if (jwtRole(req.headers.get('Authorization') ?? '') !== 'service_role') {
    return json({ error: 'unauthorized' }, 401)
  }

  const tenant = Deno.env.get('GRAPH_TENANT_ID')
  const clientId = Deno.env.get('GRAPH_CLIENT_ID')
  const secret = Deno.env.get('GRAPH_CLIENT_SECRET')
  const mailbox = Deno.env.get('INVOICE_MAILBOX')
  const inboundSecret = Deno.env.get('INVOICE_INBOUND_SECRET')
  const supaUrl = Deno.env.get('SUPABASE_URL')
  if (!tenant || !clientId || !secret || !mailbox || !inboundSecret || !supaUrl) {
    return json({ error: 'no_key', message: 'Graph credentials or INVOICE_MAILBOX not configured.' }, 503)
  }
  const webhook = `${supaUrl.replace(/\/$/, '')}/functions/v1/invoice-inbound`
  const mb = encodeURIComponent(mailbox)

  let token: string
  try {
    token = await graphToken(tenant, clientId, secret)
  } catch (e) {
    return json({ error: 'auth_failed', message: e instanceof Error ? e.message : String(e) }, 502)
  }
  const gh = { Authorization: `Bearer ${token}` }

  const listUrl = `${GRAPH}/users/${mb}/mailFolders/inbox/messages` +
    `?$filter=${encodeURIComponent('isRead eq false and hasAttachments eq true')}` +
    `&$top=${MAX_PER_RUN}&$select=id,subject,from,internetMessageId,bodyPreview`
  const listRes = await fetch(listUrl, { headers: gh })
  // deno-lint-ignore no-explicit-any
  const listJson: any = await listRes.json().catch(() => ({}))
  if (!listRes.ok) return json({ error: 'list_failed', message: listJson?.error?.message ?? String(listRes.status) }, 502)
  const messages = (listJson.value ?? []) as Array<Record<string, unknown>>

  let filed = 0
  let failed = 0
  const errors: string[] = []

  for (const m of messages) {
    const id = m.id as string
    try {
      // No $select here: Graph omits contentBytes from an attachments-collection
      // response whenever $select is present, so the bytes must be fetched with
      // the full projection or they come back empty.
      const attRes = await fetch(
        `${GRAPH}/users/${mb}/messages/${id}/attachments?$top=25`,
        { headers: gh },
      )
      // deno-lint-ignore no-explicit-any
      const attJson: any = await attRes.json().catch(() => ({}))
      // A real file attachment is the only kind that carries contentBytes
      // (item/reference attachments don't), so that presence is a more reliable
      // filter than @odata.type — which Graph omits when we narrow $select.
      // Keep inline PDFs: some senders flag an attached invoice as inline; only
      // non-PDF inline parts (signature images, etc.) are dropped as noise.
      const attachments = (attJson.value ?? [])
        // deno-lint-ignore no-explicit-any
        .filter((a: any) => a.contentBytes && (a.contentType === 'application/pdf' || !a.isInline))
        // deno-lint-ignore no-explicit-any
        .map((a: any) => ({ name: a.name, contentType: a.contentType, contentBytes: a.contentBytes }))

      // deno-lint-ignore no-explicit-any
      const fromAddr = (m.from as any)?.emailAddress
      const payload = {
        to: mailbox,
        from: fromAddr ? { name: fromAddr.name ?? '', email: fromAddr.address ?? '' } : '',
        subject: (m.subject as string) ?? '',
        text: (m.bodyPreview as string) ?? '',
        messageId: (m.internetMessageId as string) ?? id,
        attachments,
      }

      const postRes = await fetch(webhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-webhook-secret': inboundSecret },
        body: JSON.stringify(payload),
      })
      // deno-lint-ignore no-explicit-any
      const postJson: any = await postRes.json().catch(() => ({}))
      if (!postRes.ok || postJson.error) {
        failed++
        errors.push(`${id}: ${postJson.error ?? postRes.status}`)
        continue // leave unread to retry
      }

      // Mark read so it is not re-imported.
      await fetch(`${GRAPH}/users/${mb}/messages/${id}`, {
        method: 'PATCH',
        headers: { ...gh, 'Content-Type': 'application/json' },
        body: JSON.stringify({ isRead: true }),
      })
      filed++
    } catch (e) {
      failed++
      errors.push(`${id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }

  return json({ found: messages.length, filed, failed, errors: errors.slice(0, 5) }, 200)
})
