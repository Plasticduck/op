import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Site Audit NEW (migration 0244). A row is the auditor's draft from the moment
// they start; submitting it stores the grade and locks it. Photos live in the
// site-audit-photos bucket (siteAuditPhotos in ./opsSuite) under the audit's id.

type T = Database['public']['Tables']['site_audits_v2']
export type SiteAuditV2 = T['Row'] & { location: { name: string } | null }

const SEL = '*, location:locations(name)'
const tbl = () => supabase.from('site_audits_v2')

export type SubmitAudit = Pick<T['Update'], 'answers' | 'location_id' | 'score' | 'grade' | 'safety_failed' | 'failed_sections' | 'auditor_name'>

export const siteAuditsV2 = {
  listSubmitted: () =>
    tbl().select(SEL).eq('status', 'submitted').order('submitted_at', { ascending: false }),
  listMyDrafts: (userId: string) =>
    tbl().select(SEL).eq('status', 'draft').eq('auditor_id', userId).order('updated_at', { ascending: false }),
  get: (id: string) => tbl().select(SEL).eq('id', id).maybeSingle(),
  start: (row: { account_id: string; location_id: string; auditor_id: string; auditor_name: string | null }) =>
    tbl().insert(row).select('id').single(),
  // Null data means the row is no longer a draft (submitted from another tab) or gone.
  saveDraft: (id: string, patch: Pick<T['Update'], 'answers' | 'location_id'>) =>
    tbl().update(patch).eq('id', id).eq('status', 'draft').select('id').maybeSingle(),
  submit: (id: string, payload: SubmitAudit) =>
    tbl().update({ ...payload, status: 'submitted' }).eq('id', id).eq('status', 'draft').select('id').maybeSingle(),
  remove: (id: string) => tbl().delete().eq('id', id).select('id'),
  // Called after a draft is discarded or an audit deleted, so its photos don't linger.
  removePhotos: (paths: string[]) =>
    paths.length ? supabase.storage.from('site-audit-photos').remove(paths) : Promise.resolve({ data: [], error: null }),
}
