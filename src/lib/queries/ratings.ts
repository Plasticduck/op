import { supabase } from '@/lib/supabase'

// Google star ratings per site, sourced from GatherUp (the account's review
// tool). The gatherup-rating edge function returns cached values and refreshes
// them at most about once a day, and also caches recent reviews for the feed. It
// fails soft: if the function is missing its keys or is unreachable, we return an
// empty list so the dashboard just omits the rating.
export type SiteRating = {
  location_id: string
  rating: number | null
  count: number | null
  synced_at: string | null
}

export type SiteReview = {
  review_id: number
  author: string | null
  rating: number | null
  content: string | null
  review_time: string | null
}

export const ratings = {
  fetch: async (locationIds?: string[]): Promise<SiteRating[]> => {
    const { data, error } = await supabase.functions.invoke('gatherup-rating', {
      body: { location_ids: locationIds ?? null },
    })
    if (error) return []
    return (data as { ratings?: SiteRating[] } | null)?.ratings ?? []
  },

  // Recent cached Google reviews for one site, newest first, for the feed.
  reviews: async (locationId: string, limit = 10): Promise<SiteReview[]> => {
    const { data, error } = await supabase
      .from('gatherup_reviews')
      .select('review_id, author, rating, content, review_time')
      .eq('location_id', locationId)
      .order('review_time', { ascending: false })
      .limit(limit)
    if (error) return []
    return (data as SiteReview[] | null) ?? []
  },
}
