import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

type T = Database['public']['Tables']
export type SocialPost = T['social_posts']['Row']

export const socialPosts = {
  forRange: (fromDate: string, toDate: string) =>
    supabase
      .from('social_posts')
      .select('*')
      .gte('post_date', fromDate)
      .lte('post_date', toDate)
      .order('post_date'),
  create: (row: T['social_posts']['Insert']) =>
    supabase.from('social_posts').insert(row).select().single(),
  update: (id: string, patch: T['social_posts']['Update']) =>
    supabase.from('social_posts').update(patch).eq('id', id).select().single(),
  remove: (id: string) => supabase.from('social_posts').delete().eq('id', id),
}
