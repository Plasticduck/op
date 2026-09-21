import { supabase } from '@/lib/supabase'

// Total official cars washed (from site_performance_days) for a set of MW site
// numbers over a date range. Server-side aggregate, so wide ranges don't hit the
// PostgREST row cap. Best-effort: returns 0 on error.
export async function carsWashedTotal(siteNumbers: number[], start: string, end: string): Promise<number> {
  if (!siteNumbers.length || !start || !end) return 0
  const { data, error } = await supabase.rpc('interior_cars_washed', {
    p_site_numbers: siteNumbers,
    p_start: start,
    p_end: end,
  })
  if (error) return 0
  return Number(data) || 0
}
