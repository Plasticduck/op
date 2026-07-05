import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'
import type { RegionDef } from '@/lib/regions'

// `company_settings` is a jsonb column added in migration 0044. Until
// database.types.ts is regenerated (npm run db:types) it isn't in the typed
// account row, so reads cast the row and writes cast the patch. Reads of an
// account without the column yet degrade gracefully to empty settings.
type AccountUpdate = Database['public']['Tables']['accounts']['Update']

export type CorporateInfo = {
  legal_name?: string
  address?: string
  phone?: string
  email?: string
  website?: string
}

// A reusable shift preset the user can drag onto the schedule. Times are "HH:MM".
// `lunch` marks an unpaid break that does not count toward scheduled hours.
export type ShiftTemplate = {
  id: string
  start: string
  end: string
  label?: string
  lunch?: boolean
}

export type CompanySettings = {
  corporate?: CorporateInfo
  regions?: RegionDef[]
  // First day of the work week for scheduling: 0 = Sunday … 6 = Saturday.
  scheduleWeekStart?: number
  // Custom shift presets shown in the schedule builder's shift palette.
  shiftTemplates?: ShiftTemplate[]
}

export type SitePlan = 'single' | 'multi'

type AccountRow = {
  name?: string
  company_settings?: CompanySettings | null
  site_plan?: SitePlan | null
}

export async function getCompany(
  accountId: string,
): Promise<{ name: string; settings: CompanySettings; sitePlan: SitePlan }> {
  const { data } = await supabase.from('accounts').select('*').eq('id', accountId).single()
  const row = data as AccountRow | null
  return {
    name: row?.name ?? '',
    settings: (row?.company_settings ?? {}) as CompanySettings,
    sitePlan: row?.site_plan ?? 'multi',
  }
}

export async function setSitePlan(accountId: string, sitePlan: SitePlan) {
  return supabase
    .from('accounts')
    .update({ site_plan: sitePlan } as unknown as AccountUpdate)
    .eq('id', accountId)
}

export async function updateCompany(
  accountId: string,
  patch: { name?: string; settings?: CompanySettings },
) {
  const update: Record<string, unknown> = {}
  if (patch.name !== undefined) update.name = patch.name
  if (patch.settings !== undefined) update.company_settings = patch.settings
  return supabase
    .from('accounts')
    .update(update as unknown as AccountUpdate)
    .eq('id', accountId)
}
