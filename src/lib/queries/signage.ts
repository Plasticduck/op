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
