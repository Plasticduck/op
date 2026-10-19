import { supabase } from '@/lib/supabase'
import { fnErrorMessage } from '@/lib/fnError'

// Public SMS opt-in via an emailed personal link (/text-alerts/:token). Backed by
// the sms-optin edge function; the token is the only credential, so this works
// for staff who have never logged in.

export type OptInState = { first_name: string | null; phone_masked: string | null; opted_in: boolean }

async function call(body: Record<string, unknown>): Promise<OptInState> {
  const { data, error } = await supabase.functions.invoke('sms-optin', { body })
  if (error) throw new Error(await fnErrorMessage(error, data, 'Something went wrong. Please try again.'))
  return data as OptInState
}

export const smsOptIn = {
  info: (token: string) => call({ action: 'info', token }),
  save: (token: string, phone: string) => call({ action: 'save', token, phone, consent: true }),
  optOut: (token: string) => call({ action: 'optout', token }),
}
