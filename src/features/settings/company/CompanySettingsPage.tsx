import { useEffect, useState } from 'react'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { MultiLocationSelect } from '@/components/forms/MultiLocationSelect'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { useLocations } from '@/lib/locations'
import { resolveRegions, type RegionDef } from '@/lib/regions'
import { updateCompany, type CorporateInfo } from '@/lib/queries/companySettings'

export function CompanySettingsPage() {
  const { profile } = useAuth()
  const { locations } = useLocations()
  const { name: companyName, settings, loading, reload } = useCompany()

  const [name, setName] = useState('')
  const [corporate, setCorporate] = useState<CorporateInfo>({})
  const [regions, setRegions] = useState<RegionDef[]>([])
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Seed the form from this account's saved company settings. Regions are
  // per-account, so an account with none starts empty.
  useEffect(() => {
    if (loading) return
    setName(companyName)
    setCorporate(settings.corporate ?? {})
    setRegions(resolveRegions(settings.regions))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

  const setCorp = (key: keyof CorporateInfo, value: string) =>
    setCorporate((prev) => ({ ...prev, [key]: value }))

  const setRegion = (i: number, patch: Partial<RegionDef>) =>
    setRegions((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)))

  const save = async () => {
    if (!profile) return
    setError(null)
    setSaved(false)
    setBusy(true)
    const cleanRegions = regions
      .map((r) => ({ name: r.name.trim(), siteIds: r.siteIds }))
      .filter((r) => r.name.length > 0)
    const { error: err } = await updateCompany(profile.account_id, {
      name: name.trim() || companyName,
      settings: { corporate, regions: cleanRegions },
    })
    setBusy(false)
    if (err) return setError(err.message)
    await reload()
    setSaved(true)
  }

  if (loading) return <p className="text-sm text-ink-muted">Loading…</p>

  const siteOptions = locations.map((l) => ({ id: l.id, name: l.name }))

  return (
    <div className="flex flex-col gap-8">
      {/* Corporate info */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-ink">Corporate info</h2>
          <p className="text-xs text-ink-muted">Company details used across the app.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Company name">
            {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} />}
          </Field>
          <Field label="Legal name">
            {(id) => (
              <Input
                id={id}
                value={corporate.legal_name ?? ''}
                onChange={(e) => setCorp('legal_name', e.target.value)}
              />
            )}
          </Field>
          <Field label="Address" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={corporate.address ?? ''}
                onChange={(e) => setCorp('address', e.target.value)}
                placeholder="Street, city, state, ZIP"
              />
            )}
          </Field>
          <Field label="Phone">
            {(id) => (
              <Input
                id={id}
                value={corporate.phone ?? ''}
                onChange={(e) => setCorp('phone', e.target.value)}
              />
            )}
          </Field>
          <Field label="Email">
            {(id) => (
              <Input
                id={id}
                type="email"
                value={corporate.email ?? ''}
                onChange={(e) => setCorp('email', e.target.value)}
              />
            )}
          </Field>
          <Field label="Website" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={corporate.website ?? ''}
                onChange={(e) => setCorp('website', e.target.value)}
                placeholder="https://"
              />
            )}
          </Field>
        </div>
      </section>

      {/* Region settings */}
      <section className="flex flex-col gap-4 border-t border-border pt-8">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-ink">Region settings</h2>
            <p className="text-xs text-ink-muted">
              Group sites into regions. Used by the multi-site dashboard and violations.
            </p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRegions((prev) => [...prev, { name: '', siteIds: [] }])}
          >
            <Plus className="size-4" /> Add region
          </Button>
        </div>

        {regions.length === 0 ? (
          <p className="text-sm text-ink-muted">No regions yet. Add one to group your sites.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {regions.map((r, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-4">
                <div className="mb-3 flex items-center gap-2">
                  <Input
                    value={r.name}
                    onChange={(e) => setRegion(i, { name: e.target.value })}
                    placeholder="Region name"
                    className="font-medium"
                    aria-label="Region name"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setRegions((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label="Remove region"
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
                <MultiLocationSelect
                  options={siteOptions}
                  value={r.siteIds}
                  onChange={(next) => setRegion(i, { siteIds: next })}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {error && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="flex items-center gap-3 border-t border-border pt-6">
        <Button onClick={save} disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" /> Saving…
            </>
          ) : (
            'Save changes'
          )}
        </Button>
        {saved && <span className="text-sm text-ok">Saved.</span>}
      </div>
    </div>
  )
}
