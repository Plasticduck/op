import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Issuetrak API v2 (Mighty Wash instance) proxied through the `issuetrak` edge
// function. Field names follow the Issuetrak schema; the IID references
// (priorityIid, substatusIid, etc.) are resolved to labels via the lookup
// endpoints. Types are intentionally loose where the schema is broad — we read
// defensively and only depend on the documented core fields.

export type ItIssue = {
  iid: number
  id?: number | null
  subject?: string | null
  description?: string | null
  solution?: string | null
  priorityIid?: number | null
  issueTypeIid?: number | null
  classIid?: number | null
  substatusIid?: number | null
  statusIid?: number | null
  assignedToUserIid?: number | null
  submittedByUserIid?: number | null
  enteredByUserIid?: number | null
  organizationIid?: number | null
  locationIid?: number | null
  enteredDate?: string | null
  modifiedDate?: string | null
  targetDate?: string | null
  closedDate?: string | null
  isOpen?: boolean | null
  notes?: ItNote[] | null
  [key: string]: unknown
}

export type ItNote = {
  iid?: number
  note?: string | null
  body?: string | null
  enteredDate?: string | null
  enteredByUserIid?: number | null
  [key: string]: unknown
}

// A reference-list entry (Priority, Substatus, IssueType, Class, User, ...).
export type ItLookupItem = { iid: number; name?: string | null; [key: string]: unknown }

export type ItLookups = {
  priorities: ItLookupItem[]
  substatuses: ItLookupItem[]
  issueTypes: ItLookupItem[]
  classes: ItLookupItem[]
  organizations: ItLookupItem[]
  users: ItLookupItem[]
}

type Paged<T> = { data?: T[]; items?: T[]; results?: T[]; totalCount?: number; total?: number; [k: string]: unknown }
type ProxyResult<T> = { status: number; data: T }

// A single JSON-RPC-ish call to the edge proxy. Throws on transport or
// upstream (>=400) failure with a human-readable message.
async function call<T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown },
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('issuetrak', {
    body: { path, method: opts?.method, body: opts?.body },
  })
  if (error) {
    throw new Error(await fnErrorMessage(error, data as { message?: string; error?: string } | null, 'Issuetrak request failed'))
  }
  const res = data as ProxyResult<T>
  if (!res || typeof res.status !== 'number') throw new Error('Unexpected Issuetrak response')
  if (res.status >= 400) {
    const body = res.data as { title?: string; message?: string; information?: string[] } | null
    const detail = body?.title || body?.message || body?.information?.join('; ')
    throw new Error(detail ? `Issuetrak: ${detail}` : `Issuetrak returned ${res.status}`)
  }
  return res.data
}

// Search/list endpoints return a paged envelope whose array field name varies.
function rows<T>(paged: Paged<T> | T[] | null): T[] {
  if (!paged) return []
  if (Array.isArray(paged)) return paged
  return paged.data ?? paged.items ?? paged.results ?? []
}

function total<T>(paged: Paged<T> | T[] | null, fallback: number): number {
  if (!paged || Array.isArray(paged)) return fallback
  return paged.totalCount ?? paged.total ?? fallback
}

export const issuetrak = {
  // Cheap connectivity + credential check.
  test: () => call('/Authenticate/test'),

  // Paged issue search. All filter fields are optional; we sort newest-first
  // client-side since the sort-field enum is instance-specific.
  searchIssues: async (filter: Record<string, unknown>) => {
    const res = await call<Paged<ItIssue>>('/Issues/Search', { method: 'POST', body: filter })
    return { issues: rows<ItIssue>(res), total: total(res, rows<ItIssue>(res).length) }
  },

  getIssue: (iid: number) => call<ItIssue>(`/Issues/${iid}`),

  createIssue: (body: Record<string, unknown>) =>
    call<ItIssue>('/Issues', { method: 'POST', body }),

  // Partial update via PATCH. `ops` is an array of { op, path, value }.
  patchIssue: (iid: number, ops: Array<{ op: string; path: string; value: unknown }>) =>
    call<ItIssue>(`/Issues/${iid}`, { method: 'PATCH', body: ops }),

  addNote: (iid: number, note: string) =>
    call<ItIssue>(`/Issues/${iid}`, { method: 'PATCH', body: [{ op: 'Add', path: '/Note', value: note }] }),

  setSubstatus: (iid: number, substatusIid: number | null) =>
    call<ItIssue>(`/Issues/${iid}`, {
      method: 'PATCH',
      body: [{ op: 'Replace', path: '/Substatus', value: substatusIid }],
    }),

  assign: (iid: number, userIid: number | null) =>
    call<ItIssue>(`/Issues/${iid}`, {
      method: 'PATCH',
      body: [{ op: 'Replace', path: '/AssignedToUser', value: userIid }],
    }),

  // Reference lists for resolving IIDs to labels and for form dropdowns. Each
  // is best-effort: a resource the token can't list resolves to an empty array
  // rather than failing the whole page.
  lookups: async (): Promise<ItLookups> => {
    const get = async (path: string): Promise<ItLookupItem[]> => {
      try {
        return rows<ItLookupItem>(await call<Paged<ItLookupItem>>(`${path}?PageSize=100`))
      } catch {
        return []
      }
    }
    const [priorities, substatuses, issueTypes, classes, organizations, users] = await Promise.all([
      get('/Priorities'),
      get('/Substatuses'),
      get('/IssueTypes'),
      get('/Classes'),
      get('/Organizations'),
      get('/Users'),
    ])
    return { priorities, substatuses, issueTypes, classes, organizations, users }
  },
}

// Build a { iid -> display name } map from a lookup list, tolerating the several
// name-ish fields Issuetrak uses across resources.
export function nameMap(items: ItLookupItem[]): Map<number, string> {
  const m = new Map<number, string>()
  for (const it of items) {
    const name =
      (it.name as string) ||
      (it.description as string) ||
      [it.firstName, it.lastName].filter(Boolean).join(' ') ||
      (it.userId as string) ||
      (it.displayName as string) ||
      String(it.iid)
    if (typeof it.iid === 'number') m.set(it.iid, name.trim() || String(it.iid))
  }
  return m
}
