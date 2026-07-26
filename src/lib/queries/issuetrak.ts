import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Issuetrak API v2 (Mighty Wash instance) proxied through the `issuetrak` edge
// function. Shapes below follow the real OpenAPI spec (public/issuetrak api.json):
//   - List/search responses are { values: T[], pagingInformation: {page, itemTotal, pageCount} }.
//   - The read Issue uses NESTED reference objects ({ name, id, iid }), not flat
//     *Iid fields. Editing still uses the reference's iid.
//   - Search takes an AdvancedIssueFilter { sortField, sortDirection, pageNumber,
//     pageSize, filter: IssueFilter }.
//   - Create is POST /Issues/Create (CreateIssue: subject, description, issueTypeIid required).

// A resolved reference on an issue (priority, class, subStatus, assignedToUser, ...).
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
  submittedDate?: string | null
  targetDate?: string | null
  requiredByDate?: string | null
  closedDate?: string | null
  priority?: ItRef | null
  class?: ItRef | null
  issueType?: ItRef | null
  subStatus?: ItRef | null
  cause?: ItRef | null
  organization?: ItRef | null
  location?: ItRef | null
  severity?: ItRef | null
  responsibleDepartment?: ItRef | null
  assignedToUser?: ItRef | null
  submittedByUser?: ItRef | null
  enteredByUser?: ItRef | null
  [key: string]: unknown
}

// A reference-list entry (Priority, Substatus, IssueType, Class, User, Org).
export type ItLookupItem = { iid: number; name?: string | null; [key: string]: unknown }

export type ItLookups = {
  priorities: ItLookupItem[]
  substatuses: ItLookupItem[]
  issueTypes: ItLookupItem[]
  classes: ItLookupItem[]
  organizations: ItLookupItem[]
  users: ItLookupItem[]
}

type PagingData = { page?: number; itemTotal?: number; pageCount?: number }
type Paged<T> = { values?: T[]; pagingInformation?: PagingData; [k: string]: unknown }
type ProxyResult<T> = { status: number; data: T }

// A single call to the edge proxy. Throws on transport or upstream (>=400)
// failure with a human-readable message.
async function call<T = unknown>(
  path: string,
  opts?: { method?: string; body?: unknown },
): Promise<T> {
  const { data, error } = await supabase.functions.invoke('issuetrak', {
    body: { path, method: opts?.method, body: opts?.body },
  })
  if (error) {
    throw new Error(
      await fnErrorMessage(error, data as { message?: string; error?: string } | null, 'Issuetrak request failed'),
    )
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

function rows<T>(paged: Paged<T> | T[] | null): T[] {
  if (!paged) return []
  if (Array.isArray(paged)) return paged
  return paged.values ?? []
}

export const issuetrak = {
  // Cheap connectivity + credential check.
  test: () => call('/Authenticate/test'),

  // Newest-first page of issues. openOnly filters server-side on isOpen.
  searchIssues: async (opts?: { pageNumber?: number; pageSize?: number; openOnly?: boolean }) => {
    const body: Record<string, unknown> = {
      sortField: 'EnteredDate',
      sortDirection: 'Desc',
      pageNumber: opts?.pageNumber ?? 1,
      pageSize: opts?.pageSize ?? 100,
      filter: opts?.openOnly ? { isOpen: { type: 'IsTrue' } } : {},
    }
    const res = await call<Paged<ItIssue>>('/Issues/Search', { method: 'POST', body })
    return { issues: rows<ItIssue>(res), total: res.pagingInformation?.itemTotal ?? rows<ItIssue>(res).length }
  },

  getIssue: (iid: number) => call<ItIssue>(`/Issues/${iid}`),

  // CreateIssue: subject, description, issueTypeIid are required.
  createIssue: (body: Record<string, unknown>) =>
    call<ItIssue>('/Issues/Create', { method: 'POST', body }),

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

  // Reference lists for edit dropdowns and the create form. Each is best-effort:
  // a resource the token can't list resolves to an empty array rather than
  // failing the whole page.
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

// Display name for a reference or lookup item, tolerating the name-ish fields
// Issuetrak uses (users expose displayName / firstName+lastName / id).
export function refName(r: ItRef | null | undefined): string {
  if (!r) return '—'
  return (r.name ?? '').toString().trim() || String(r.iid ?? r.id ?? '—')
}

export function lookupName(it: ItLookupItem): string {
  const name =
    (it.name as string) ||
    (it.displayName as string) ||
    [it.firstName, it.lastName].filter(Boolean).join(' ') ||
    (it.id as string) ||
    String(it.iid)
  return (name ?? '').toString().trim() || String(it.iid)
}
