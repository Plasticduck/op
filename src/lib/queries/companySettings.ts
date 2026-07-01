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

export type CompanySettings = {
  corporate?: CorporateInfo
  regions?: RegionDef[]
}

type AccountRow = { name?: string; company_settings?: CompanySettings | null }

export async function getCompany(
  accountId: string,
): Promise<{ name: string; settings: CompanySettings }> {
  const { data } = await supabase.from('accounts').select('*').eq('id', accountId).single()
  const row = data as AccountRow | null
  return { name: row?.name ?? '', settings: (row?.company_settings ?? {}) as CompanySettings }
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
