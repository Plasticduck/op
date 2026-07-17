import { useAuth } from '@/lib/auth'

// Per-account brand logo shown at the top of the dashboards. Renders nothing
// unless the account has a brand_logo_url set (Mighty Wash today).
export function AccountBrandLogo() {
  const { profile } = useAuth()
  if (!profile?.brand_logo_url) return null
  return (
    <img
      src={profile.brand_logo_url}
      alt="Company logo"
      className="h-12 w-auto max-w-[45vw] object-contain sm:h-16"
    />
  )
}
