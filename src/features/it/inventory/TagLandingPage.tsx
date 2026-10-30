import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CircleCheck, Loader2, TriangleAlert, Wrench } from 'lucide-react'
import { NAV_GROUPS, navEmailOk } from '@/components/layout/Sidebar'
import { Button } from '@/components/ui/Button'
import { Logo } from '@/components/ui/Logo'
import { useAuth, type Profile } from '@/lib/auth'
import { permRoleInList } from '@/lib/permissions'
import { permRole } from '@/lib/rbac'
import { itInventory, type PublicAsset } from '@/lib/queries/itInventory'
import { ProblemForm } from './ReportProblem'
import { TAG_RE } from './scan'

// /t/<account>/<tag>: where a sticker's QR goes when scanned with any phone
// camera. Someone signed in who can use IT Inventory lands on the asset (or on
// Add, for a blank sticker). Everyone else gets a small Report a problem page
// that shows only the device's name, category and site.

// Same gate as the IT Inventory nav item (roles + pre-launch email list).
function canOpenInventory(p: Profile): boolean {
  const item = NAV_GROUPS.flatMap((g) => g.items).find((i) => i.to === '/app/it-inventory')
  if (!item) return false
  const role = permRole(p.role, p.role_category)
  return permRoleInList(role, item.roles) && navEmailOk(item, p.email, role)
}

export default function TagLandingPage() {
  const { short = '', tag = '' } = useParams()
  const navigate = useNavigate()
  const { profile, loading } = useAuth()
  const [mode, setMode] = useState<'checking' | 'report' | 'unknown' | 'other'>('checking')

  useEffect(() => {
    if (loading) return
    if (!profile || !canOpenInventory(profile)) { setMode('report'); return }
    let alive = true
    void itInventory.resolveTag(short, tag).then((res) => {
      if (!alive) return
      if (res?.result === 'asset') navigate(`/app/it-inventory/${res.asset_id}`, { replace: true })
      else if (res?.result === 'unused') navigate(`/app/it-inventory?add=1&tag=${encodeURIComponent(res.tag ?? tag)}`, { replace: true })
      else if (res?.result === 'other_account') setMode('other')
      else if (res?.result === 'unknown') setMode('unknown')
      else setMode('report') // at a site they can't see: they can still report it
    })
    return () => { alive = false }
  }, [loading, profile, short, tag, navigate])

  return (
    <div className="min-h-dvh bg-content px-4 py-10">
      <div className="mx-auto w-full max-w-lg">
        <div className="mb-6 flex justify-center"><Logo brand="washlyfe" /></div>
        {mode === 'checking' ? (
          <div className="grid place-items-center py-10 text-ink-muted"><Loader2 className="size-6 animate-spin" /></div>
        ) : mode === 'report' ? (
          <PublicReport short={short} tag={tag} signedIn={!!profile} />
        ) : (
          <div className="rounded-lg border border-border bg-card p-6 text-center">
            <TriangleAlert className="mx-auto mb-3 size-10 text-warn" />
            {mode === 'other' ? (
              <>
                <h1 className="text-lg font-semibold text-ink">Not one of your stickers</h1>
                <p className="mt-1 text-sm text-ink-muted">This sticker belongs to another company, so it isn't in your inventory.</p>
              </>
            ) : (
              <>
                <h1 className="text-lg font-semibold text-ink">We couldn't find this sticker</h1>
                <p className="mt-1 text-sm text-ink-muted">{tag.toUpperCase()} isn't in your inventory yet.</p>
                {TAG_RE.test(tag.toUpperCase()) && (
                  <Button className="mt-4" onClick={() => navigate(`/app/it-inventory?add=1&tag=${encodeURIComponent(tag.toUpperCase())}`)}>
                    Add it with this tag
                  </Button>
                )}
              </>
            )}
            <p className="mt-4 text-sm"><Link to="/app/it-inventory" className="text-accent hover:underline">Go to IT Inventory</Link></p>
          </div>
        )}
      </div>
    </div>
  )
}

function PublicReport({ short, tag, signedIn }: { short: string; tag: string; signedIn: boolean }) {
  const [info, setInfo] = useState<{ company: string | null; asset: PublicAsset } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let alive = true
    void itInventory.scanInfo(short, tag).then(({ data, message }) => {
      if (!alive) return
      if (data) setInfo(data)
      else setError(message)
    })
    return () => { alive = false }
  }, [short, tag])

  if (error) {
    return <div className="rounded-lg border border-border bg-card p-6 text-center text-sm text-ink-muted">{error}</div>
  }
  if (!info) return <div className="grid place-items-center py-10 text-ink-muted"><Loader2 className="size-6 animate-spin" /></div>
  if (done) {
    return (
      <div className="rounded-lg border border-border bg-card p-8 text-center">
        <CircleCheck className="mx-auto mb-3 size-12 text-ok" />
        <h1 className="text-lg font-semibold text-ink">Thanks, it's reported</h1>
        <p className="mt-1 text-sm text-ink-muted">The {info.company ?? ''} team has it and will take a look.</p>
        <Button className="mt-5" variant="secondary" onClick={() => setDone(false)}>Report something else</Button>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-full bg-accent-soft text-accent"><Wrench className="size-5" /></span>
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-ink">Report a problem</h1>
          <p className="text-xs text-ink-muted">Let {info.company ?? 'the team'} know something's wrong with this device.</p>
        </div>
      </div>
      <div className="mb-4 rounded-md border border-border bg-content px-3 py-2.5">
        <div className="font-medium text-ink">{info.asset.name}</div>
        <div className="text-sm text-ink-muted">{[info.asset.category, info.asset.site].filter(Boolean).join(' · ')}</div>
        <div className="mt-0.5 font-mono text-xs text-ink-subtle">{info.asset.tag}</div>
      </div>
      <ProblemForm short={short} tag={tag} signedIn={signedIn} onDone={() => setDone(true)} />
    </div>
  )
}
