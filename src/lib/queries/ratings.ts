import { supabase } from '@/lib/supabase'

// Live Google star ratings per site. The google-place-rating edge function
// returns cached values and refreshes them from the Places API at most about
// once a day. It fails soft: if the function is missing its API key or is not
// reachable, we return an empty list so the dashboard just omits the rating.
export type SiteRating = {
  location_id: string
  rating: number | null
  count: number | null
  synced_at: string | null
}

export const ratings = {
  fetch: async (locationIds?: string[]): Promise<SiteRating[]> => {
    const { data, error } = await supabase.functions.invoke('google-place-rating', {
      body: { location_ids: locationIds ?? null },
    })
    if (error) return []
    return (data as { ratings?: SiteRating[] } | null)?.ratings ?? []
  },
}
