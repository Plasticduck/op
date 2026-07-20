import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { pageAllowed, SECTION_CATALOG } from '@/lib/permissions'

// Whether the current user may see a page section. Sections layer the same way
// as pages (per-user override, then per-role, then default). Unknown keys and
// signed-out states default to visible.
export function useSectionAllowed(sectionKey: string): boolean {
  const { profile } = useAuth()
  const { settings } = useCompany()
  const sec = SECTION_CATALOG.find((s) => s.key === sectionKey)
  if (!profile || !sec) return true
  return pageAllowed(profile.role, sectionKey, sec.roles, {
    rolePerms: settings.pagePermissions,
    userId: profile.id,
    userPerms: settings.userPermissions,
    optInRoles: sec.optIn,
  })
}
