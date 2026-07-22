import { supabase } from '@/lib/supabase'

// Read-only Google Calendar overlay, all behind edge functions (the client
// never sees tokens).
export type GoogleEvent = {
  id: string
  title: string
  start: string
  end: string | null
  allDay: boolean
}

export type GoogleEventsResult = {
  connected: boolean
  email?: string
  events?: GoogleEvent[]
  error?: string
  detail?: string
  detailMsg?: string
  grantedScopes?: string
}

export const googleCalendar = {
  // Returns { url } — the Google consent URL to redirect the browser to.
  connectUrl: () => supabase.functions.invoke('google-oauth-start', { body: {} }),
  events: (timeMin: string, timeMax: string) =>
    supabase.functions.invoke('google-calendar-events', { body: { timeMin, timeMax } }),
  disconnect: () => supabase.functions.invoke('google-calendar-disconnect', { body: {} }),
}
