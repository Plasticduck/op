import { useAuth } from '@/lib/auth'

const MW_ACCOUNT = '54f3e299-1f61-4ed2-9921-3d02160b72e6'

// The wash's brand logo URL for PDF exports (top-right corner), or null for
// accounts without one. Mighty Wash only for now, since the logo is theirs.
export function useBrandLogoUrl(): string | null {
  const { profile } = useAuth()
  return profile?.account_id === MW_ACCOUNT ? '/mw-logo.png' : null
}
