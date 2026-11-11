import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// The public side of a Maintenance Inventory machine sticker: what the machine is, and
// reporting a problem with it, for people who can't open the module (or aren't signed
// in). Kept apart from the module's queries so the public page stays small.

export type PublicMachine = { tag: string; name: string; type: string | null; site: string | null; zone: string | null }

async function result<R>(data: unknown, error: unknown): Promise<{ data: R | null; message: string | null }> {
  if (!error) return { data: data as R, message: null }
  const msg = await fnErrorMessage(error as Parameters<typeof fnErrorMessage>[0], data as { message?: string } | null, 'Something went wrong. Try again.')
  return { data: null, message: msg }
}

export const miPublic = {
  info: async (short: string, tag: string) => {
    const { data, error } = await supabase.functions.invoke('mi-scan-public', { body: { action: 'info', short, tag } })
    return result<{ ok: true; company: string | null; asset: PublicMachine }>(data, error)
  },
  report: async (row: { short: string; tag: string; description: string; name?: string; contact?: string; down?: boolean }) => {
    const { data, error } = await supabase.functions.invoke('mi-scan-public', { body: { action: 'report', ...row } })
    return result<{ ok: true; number: number }>(data, error)
  },
}
