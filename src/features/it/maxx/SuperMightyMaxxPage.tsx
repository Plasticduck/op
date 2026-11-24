import { useAuth } from '@/lib/auth'
import { MaxxGame } from './MaxxGame'

// The route /app/super-mighty-maxx. Full-bleed (see AppShell.FULL_BLEED_PATTERNS): the
// game fills the page, and on phones leaves the bottom bar's strip free.
export default function SuperMightyMaxxPage() {
  const { profile } = useAuth()
  if (!profile) return null
  return (
    <div className="h-full min-h-0 bg-shell pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
      <MaxxGame userId={profile.id} />
    </div>
  )
}
