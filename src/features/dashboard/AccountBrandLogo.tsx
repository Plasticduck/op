import { useAuth } from '@/lib/auth'

// Per-account brand logo shown at the top of the dashboards. Renders nothing
// unless the account has a brand_logo_url set (Mighty Wash today).
export function AccountBrandLogo() {
  const { profile } = useAuth()
  if (!profile?.brand_logo_url) return null
  return (
    <div className="flex justify-center sm:justify-start">
      <img
        src={profile.brand_logo_url}
        alt="Company logo"
        className="h-16 w-auto max-w-full object-contain sm:h-20"
      />
    </div>
  )
}
