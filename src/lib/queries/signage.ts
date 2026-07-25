import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type SignageRequest = T['signage_requests']['Row']

// Top-level categories on the order form.
export const SIGN_CATEGORIES = ['General Site Signage', 'Banner', 'Flags', 'Magnets'] as const

// Rigid substrates (used for General Site Signage's type list).
const RIGID_SUBSTRATES = [
  '1/4" Clear Acrylic',
  '1/4" White Acrylic',
  '3/16" Clear Acrylic',
  '3/16" White Acrylic',
  'Aluminum',
  'Bubble X',
  'Bulldog Board Material - 3mm C2S',
  'Coroplast - 10mm',
  'Coroplast - 4mm',
  'Foam Core',
  'Foam PVC - 3mm',
  'Foam PVC - 6mm',
  'Gatorplast - 1/2" White',
  'Gatorplast - 3/16" White',
  'Max Metal - 3mm',
  'Max Metal - 6mm',
  'Multishield',
  'Polycarbonate',
  'Styrene',
]
const BANNER_MATERIALS = ['13 oz. Vinyl', '15 oz. Vinyl', '18 oz. Vinyl', 'Mesh']
const FLAGS = [
  'Angled Feather Flags',
  'Convex Feather Flags',
  'Econo Feather Flags',
  'Pole Flags',
  'Teardrop Flags',
  'Wholesale Rectangular Feather Flags',
]
const MAGNETS = ['Custom Vehicle Magnets', 'Small Magnets']

// The second dropdown's options depend on the chosen category.
export function signTypeOptions(category: string): string[] {
  switch (category) {
    case 'Banner':
      return BANNER_MATERIALS
    case 'Flags':
      return FLAGS
    case 'Magnets':
      return MAGNETS
    case 'General Site Signage':
      return RIGID_SUBSTRATES
    default:
      return []
  }
}

// Banner's type list is really a material choice; label it so.
export function signTypeLabel(category: string): string {
  return category === 'Banner' ? 'Material' : 'Sign type'
}

// Per-flag preset sizes + whether the customer chooses single/double sided.
// `sided: false` means single-sided only (no choice).
export type FlagSpec = { sizes: string[]; sided: boolean }
const FLAG_SPECS: Record<string, FlagSpec> = {
  'Angled Feather Flags': { sizes: ['9 ft', '10.5 ft', '14 ft', '18 ft'], sided: true },
  'Convex Feather Flags': { sizes: ['9 ft', '10.5 ft', '14 ft', '18 ft'], sided: true },
  'Econo Feather Flags': { sizes: ['16 ft'], sided: false },
  'Pole Flags': { sizes: ['24" x 18"', '36" x 24"', '60" x 36"', '72" x 48"', '96" x 60"'], sided: true },
  'Teardrop Flags': { sizes: ['7 ft', '9 ft', '11.2 ft', '13.5 ft'], sided: true },
  'Wholesale Rectangular Feather Flags': { sizes: ['8.5 ft', '11.8 ft', '15 ft'], sided: true },
}

export function flagSpec(signType: string): FlagSpec | undefined {
  return FLAG_SPECS[signType]
}

export const signage = {
  list: (loc: string) =>
    supabase
      .from('signage_requests')
      .select('*, requested_by(name)')
      .eq('location_id', loc)
      .order('created_at', { ascending: false }),
  create: (row: T['signage_requests']['Insert']) =>
    supabase.from('signage_requests').insert(row).select().single(),
  update: (id: string, patch: T['signage_requests']['Update']) =>
    supabase.from('signage_requests').update(patch).eq('id', id),

  // Artwork: PDF only, stored under the account folder in a private bucket.
  uploadArtwork: async (accountId: string, file: File) => {
    const path = `${accountId}/${crypto.randomUUID()}.pdf`
    const { error } = await supabase.storage
      .from('signage-artwork')
      .upload(path, file, { contentType: 'application/pdf', upsert: false })
    return { error, path: error ? null : path }
  },
  artworkUrl: async (path: string, expiresIn = 3600) => {
    const { data, error } = await supabase.storage
      .from('signage-artwork')
      .createSignedUrl(path, expiresIn)
    return { error, url: data?.signedUrl ?? null }
  },
}
