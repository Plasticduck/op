import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Secret Shoppers. Everything goes through the secret-shopper edge function:
// the tables are RLS-locked (migrations 0232, 0233) and a shopper is identified
// by their PIN alone (the /ss phone app has no Operator login). Photos and videos
// go straight to the private secret-shopper-media bucket on signed upload URLs
// the function hands out once the PIN checks out.

const FN = 'secret-shopper'
const BUCKET = 'secret-shopper-media'
export const SHOPPER_MEDIA_MAX_BYTES = 50 * 1024 * 1024 // the project's upload limit
export const SHOPPER_MAX_FILES = 20

export type ShopperSite = { id: string; name: string }
export type ShopperSession = { pin: string; shopper: { id: string; name: string }; sites: ShopperSite[] }

export type ShopperReport = {
  location_id: string
  visited_at: string // ISO
  wash_package: string
  team_members: string
  ratings: Record<string, { stars: number; comment: string }>
  comments: string
}

export type ManagedShopper = {
  id: string
  name: string
  phone: string | null
  email: string | null
  active: boolean
  self_signup: boolean // made their own PIN in the app
  last_sign_in_at: string | null
  created_at: string
  reports: number
}

export type SubmitResult = { visitId: string; emailed: boolean; message: string | null; failedUploads: number }

type Result<T> = { data: T; error: null } | { data: null; error: string }

async function call<T>(body: Record<string, unknown>, fallback: string): Promise<Result<T>> {
  const { data, error } = await supabase.functions.invoke(FN, { body })
  if (error || !data?.ok) return { data: null, error: await fnErrorMessage(error, data, fallback) }
  return { data: data as T, error: null }
}

// Phones sometimes hand over a video or HEIC photo with no type; go by the
// extension then. null = not a photo or video.
const EXT_TYPES: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  heic: 'image/heic', heif: 'image/heif',
  mp4: 'video/mp4', mov: 'video/quicktime', m4v: 'video/x-m4v', webm: 'video/webm', '3gp': 'video/3gpp',
}
export function mediaType(file: File): string | null {
  if (file.type.startsWith('image/') || file.type.startsWith('video/')) return file.type
  return EXT_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null
}

export const secretShoppers = {
  signIn: async (pin: string): Promise<Result<ShopperSession>> => {
    const r = await call<{ shopper: ShopperSession['shopper']; sites: ShopperSite[] }>({ action: 'sign_in', pin }, "Couldn't check that PIN.")
    if (r.error !== null) return r
    return { data: { pin, shopper: r.data.shopper, sites: r.data.sites }, error: null }
  },

  // A shopper makes their own account ("Create a PIN") and is signed straight in.
  signUp: async (s: { name: string; phone: string; pin: string }): Promise<Result<ShopperSession>> => {
    const r = await call<{ shopper: ShopperSession['shopper']; sites: ShopperSite[] }>(
      { action: 'sign_up', name: s.name.trim(), phone: s.phone.trim(), pin: s.pin },
      "Couldn't create your account.",
    )
    if (r.error !== null) return r
    return { data: { pin: s.pin, shopper: r.data.shopper, sites: r.data.sites }, error: null }
  },

  // Save the report, upload each photo/video, then mark it submitted and email
  // it. A file that fails to upload is left out rather than failing the report.
  submit: async (
    pin: string,
    report: ShopperReport,
    files: File[],
    onProgress: (label: string) => void,
  ): Promise<Result<SubmitResult>> => {
    onProgress('Saving your report…')
    const started = await call<{ visit_id: string; uploads: { path: string; token: string }[] }>(
      {
        action: 'start',
        pin,
        report,
        files: files.map((f) => ({ name: f.name, type: mediaType(f), size: f.size })),
      },
      "Couldn't save your report.",
    )
    if (started.error !== null) return started
    const { visit_id, uploads } = started.data

    let failedUploads = 0
    for (let i = 0; i < uploads.length; i++) {
      onProgress(`Uploading ${i + 1} of ${uploads.length}…`)
      const { error } = await supabase.storage
        .from(BUCKET)
        .uploadToSignedUrl(uploads[i].path, uploads[i].token, files[i], { contentType: mediaType(files[i]) ?? undefined })
      if (error) failedUploads++
    }

    onProgress('Sending…')
    const done = await secretShoppers.finish(pin, visit_id)
    if (done.error !== null) return done
    return { data: { ...done.data, failedUploads }, error: null }
  },

  // Also how a report whose email didn't go out gets sent again.
  finish: async (pin: string, visitId: string): Promise<Result<SubmitResult>> => {
    const r = await call<{ emailed: boolean; message?: string }>({ action: 'finish', pin, visit_id: visitId }, "Couldn't submit your report.")
    if (r.error !== null) return r
    return { data: { visitId, emailed: r.data.emailed, message: r.data.message ?? null, failedUploads: 0 }, error: null }
  },

  // Admins (SECRET_SHOPPER_EMAILS) only.
  listShoppers: async (): Promise<Result<ManagedShopper[]>> => {
    const r = await call<{ shoppers: ManagedShopper[] }>({ action: 'admin_list' }, "Couldn't load shoppers.")
    if (r.error !== null) return r
    return { data: r.data.shoppers, error: null }
  },
  saveShopper: (s: { id?: string; name: string; phone: string; email: string; pin: string; active?: boolean }) =>
    call<{ id: string }>({ action: 'admin_save', ...s }, "Couldn't save the shopper."),
}
