import { supabase } from '@/lib/supabase'

// Active-member lookup by license plate. The member-lookup edge function pings both
// FlexWash (resolve-vehicle) and DRB/SiteWatch and returns each system's verdict.
// Credentials live server-side; the function is MW owner/manager gated.

export type MemberSource = {
  found: boolean
  active: boolean
  paused?: boolean
  label: string // "Active member" | "Frozen" | "Inactive" | "Not a member" | …
  status?: string | null
  plan?: string | null
  priceCents?: number | null
  memberSince?: string | null
  name?: string | null
  lastBillingDate?: string | null
  customerId?: string | null
  error?: string
  diagnostics?: Record<string, unknown>
}

export type MemberLookupResult = {
  ok: boolean
  plate: string
  normalizedPlate: string
  anyActive: boolean
  flexwash: MemberSource
  drb: MemberSource
  error?: string
  message?: string
}

export const memberLookup = (plate: string, state?: string) =>
  supabase.functions.invoke<MemberLookupResult>('member-lookup', { body: { plate, state } })
