import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type SignageRequest = T['signage_requests']['Row']

// One entry in the shared artwork library (any past order's artwork).
export type ArtworkItem = {
  artwork_path: string
  artwork_name: string | null
  sign_category: string | null
  sign_type: string | null
  created_at: string
}

// Top-level product categories (the signage catalog tiles + order form).
export const SIGN_CATEGORIES = [
  'A-Frame Signs',
  'Aluminum Signs',
  'Safety Signs',
  'Wind Signs',
  'Business Card',
  'Courtesy Cards',
  'Note Pads',
  'Other Items',
] as const

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
  // A site's orders, plus any ALL SITES orders (location_id null).
  list: (loc: string) =>
    supabase
      .from('signage_requests')
      .select('*, requested_by(name)')
      .or(`location_id.eq.${loc},location_id.is.null`)
      .order('created_at', { ascending: false }),
  create: (row: T['signage_requests']['Insert']) =>
    supabase.from('signage_requests').insert(row).select().single(),
  update: (id: string, patch: T['signage_requests']['Update']) =>
    supabase.from('signage_requests').update(patch).eq('id', id),

  // The whole artwork library: standalone uploads (signage_artwork) merged with
  // artwork attached to past orders, newest first. Deduped by path in the UI.
  libraryList: async (): Promise<ArtworkItem[]> => {
    const [std, orders] = await Promise.all([
      supabase.from('signage_artwork').select('path, name, sign_category, created_at'),
      supabase
        .from('signage_requests')
        .select('artwork_path, artwork_name, sign_category, sign_type, created_at')
        .not('artwork_path', 'is', null),
    ])
    const a: ArtworkItem[] = ((std.data as { path: string; name: string | null; sign_category: string | null; created_at: string }[] | null) ?? []).map(
      (s) => ({ artwork_path: s.path, artwork_name: s.name, sign_category: s.sign_category, sign_type: null, created_at: s.created_at }),
    )
    const b: ArtworkItem[] = (orders.data as ArtworkItem[] | null) ?? []
    return [...a, ...b].sort((x, y) => (y.created_at > x.created_at ? 1 : -1))
  },

  // Upload a PDF straight to the library, no order needed. Optionally tag it with a
  // product category so it shows up in that catalog tile's gallery.
  addArtwork: async (accountId: string, file: File, category?: string | null) => {
    const path = `${accountId}/${crypto.randomUUID()}.pdf`
    const { error: upErr } = await supabase.storage
      .from('signage-artwork')
      .upload(path, file, { contentType: 'application/pdf', upsert: false })
    if (upErr) return { error: upErr }
    const { error } = await supabase
      .from('signage_artwork')
      .insert({ account_id: accountId, path, name: file.name, sign_category: category ?? null })
    return { error }
  },

  // Best-effort: email the request (with the artwork PDF) to info@washlyfe.com.
  emailRequest: (requestId: string) =>
    supabase.functions.invoke('signage-request-email', { body: { request_id: requestId } }),

  // Remove an artwork from the library (file + rows + order refs). Server-side
  // this is locked to a single admin; everyone else gets 403.
  removeArtwork: (path: string) =>
    supabase.functions.invoke('signage-artwork-remove', { body: { path } }),

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
  // Batch signed URLs for library thumbnails, returned as a path -> url map.
  artworkUrls: async (paths: string[], expiresIn = 3600): Promise<Record<string, string>> => {
    if (!paths.length) return {}
    const { data } = await supabase.storage.from('signage-artwork').createSignedUrls(paths, expiresIn)
    const map: Record<string, string> = {}
    for (const d of data ?? []) if (d.path && d.signedUrl) map[d.path] = d.signedUrl
    return map
  },
}
