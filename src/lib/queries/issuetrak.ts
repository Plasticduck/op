import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Issuetrak (Mighty Wash) via the server-enforced `issuetrak` edge function.
// The function owns scoping: admins (owner/technician) see all open tickets,
// managers see only their own site's. Read-only tracking + submit; IT works
// tickets in Issuetrak itself.

export type ItRef = { name?: string | null; id?: number | string | null; iid?: number | null }

export type ItIssue = {
  iid: number
  id?: number | null
  issueNumber?: number | null
  subject?: string | null
  description?: string | null
  solution?: string | null
  isOpen?: boolean | null
  enteredDate?: string | null
  targetDate?: string | null
  priority?: ItRef | null
  subStatus?: ItRef | null
  issueType?: ItRef | null
  location?: ItRef | null
  organization?: ItRef | null
  submittedByUser?: ItRef | null
  [key: string]: unknown
}

export type ItSite = { number: number; name: string; locationIid?: number; organizationIid?: number }
export type ItOption = { iid: number; name?: string | null }

export type ItBootstrap = {
  ok: true
  isAdmin: boolean
  role: string
  siteKind: 'location' | 'organization'
  sites: ItSite[]
  issueTypes: ItOption[]
  priorities: ItOption[]
}

// Every response the function returns on success carries ok:true. Upstream
// Issuetrak failures come back as { ok:false, status, data } with HTTP 200;
// proxy/auth failures come back as non-2xx with { error, message }.
async function invoke<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('issuetrak', { body })
  if (error) {
    throw new Error(
      await fnErrorMessage(error, data as { message?: string; error?: string } | null, 'Issuetrak request failed'),
    )
  }
  const res = data as { ok?: boolean; status?: number; data?: unknown; error?: string; message?: string }
  if (res?.ok === false) {
    const d = res.data as { title?: string; message?: string; information?: string[] } | null
    const detail = d?.title || d?.message || (Array.isArray(d?.information) ? d.information.join('; ') : null)
    throw new Error(detail ? `Issuetrak: ${detail}` : `Issuetrak returned ${res.status}`)
  }
  if (res?.error) throw new Error(res.message || res.error)
  return res as T
}

export const issuetrak = {
  // Token-shape + live auth diagnostic (temporary).
  diag: () => invoke<Record<string, unknown>>({ action: 'diag' }),

  // Sites the caller may see/submit for, plus form option lists.
  bootstrap: () => invoke<ItBootstrap>({ action: 'bootstrap' }),

  // Open tickets, already scoped to the caller by the server.
  list: () => invoke<{ ok: true; issues: ItIssue[]; total: number }>({ action: 'list' }),

  get: (iid: number) => invoke<{ ok: true; issue: ItIssue }>({ action: 'get', iid }),

  create: (payload: {
    siteNumber: number
    subject: string
    description: string
    issueTypeIid: number
    priorityIid?: number
  }) => invoke<{ ok: true; issue: ItIssue }>({ action: 'create', ...payload }),
}

// Display name for an issue reference, falling back to iid/id.
export function refName(r: ItRef | null | undefined): string {
  if (!r) return '—'
  return (r.name ?? '').toString().trim() || String(r.iid ?? r.id ?? '—')
}

// The site label carried on a ticket (Location or Organization name).
export function ticketSite(issue: ItIssue): string {
  const name = issue.location?.name || issue.organization?.name
  return (name ?? '').toString().trim() || '—'
}
