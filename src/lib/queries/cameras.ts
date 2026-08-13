// Spot AI camera feeds. All access goes through the spot-cameras edge function,
// which holds the API key server-side and scopes sites to the caller.
import { supabase } from '@/lib/supabase'

export type SpotCamera = {
  id: number
  name: string
  status: string // 'online' | 'offline' | ...
  has_speakers: boolean
}
export type SpotSite = {
  site: string // "Mighty Wash #20"
  store: number | null
  cameras: SpotCamera[]
}

export const cameras = {
  // Cameras grouped by site, already scoped to the caller's permissions.
  list: async (): Promise<SpotSite[]> => {
    const { data, error } = await supabase.functions.invoke('spot-cameras', { body: { action: 'list' } })
    if (error) throw error
    return ((data as { sites?: SpotSite[] })?.sites) ?? []
  },

  // Short-lived iframe-embeddable live URL for one camera.
  embed: async (cameraId: number): Promise<string> => {
    const { data, error } = await supabase.functions.invoke('spot-cameras', {
      body: { action: 'embed', camera_id: cameraId },
    })
    if (error) throw error
    return (data as { url: string }).url
  },

  // Batch embed URLs for the wall view (longer-lived tokens).
  embedMany: async (cameraIds: number[]): Promise<{ id: number; url: string }[]> => {
    if (cameraIds.length === 0) return []
    const { data, error } = await supabase.functions.invoke('spot-cameras', {
      body: { action: 'embed_many', camera_ids: cameraIds },
    })
    if (error) throw error
    return (data as { urls?: { id: number; url: string }[] })?.urls ?? []
  },
}
