import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { format } from 'date-fns'
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Camera,
  Check,
  ChevronDown,
  Copy,
  CopyPlus,
  EllipsisVertical,
  Loader2,
  Pencil,
  Sticker,
  Trash2,
  X,
} from 'lucide-react'
import { QrCodeImage } from '@/components/data/QrCodeImage'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { currency } from '@/lib/format'
import { useLocations } from '@/lib/locations'
import { shrinkPhoto } from '@/lib/shrinkPhoto'
import { cn } from '@/lib/utils'
import { itInventory, type ItAssetRow } from '@/lib/queries/itInventory'
import { AssetForm, type AssetFormMode } from './AssetForm'
import { ItIcon } from './ItIcon'
import {
  assignmentBadge,
  daysUntil,
  fmtDay,
  friendlyError,
  healthBadge,
  statusTone,
  tagUrl,
  warrantyState,
} from './format'
import { Timeline } from './Timeline'
import { useItRefs } from './useItRefs'

// One asset. Answers, top to bottom: what is it, where is it, who has it, is it
// healthy, is it under warranty, and what happened to it (Timeline). Status,
// check-out and health are three separate badges so they never get confused.

type Tab = 'overview' | 'timeline'

export function AssetDetail({ id }: { id: string }) {
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const [params, setParams] = useSearchParams()
  const { profile } = useAuth()
  const { locations } = useLocations()
  const { refs, reload: reloadRefs } = useItRefs()
  const routeState = routerLocation.state as { back?: string; flash?: string } | null
  const backTo = '/app/it-inventory' + (routeState?.back ?? '')
  const [asset, setAsset] = useState<ItAssetRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [photoUrl, setPhotoUrl] = useState<string | null>(null)
  const [form, setForm] = useState<AssetFormMode | null>(null)
  const [menu, setMenu] = useState<null | 'more' | 'status'>(null)
  const [confirm, setConfirm] = useState<null | 'archive' | 'delete'>(null)
  const [busy, setBusy] = useState(false)
  const [flash, setFlash] = useState<string | null>(routeState?.flash ?? null)
  const [error, setError] = useState<string | null>(null)
  const photoInput = useRef<HTMLInputElement>(null)
  const tab: Tab = params.get('tab') === 'timeline' ? 'timeline' : 'overview'

  const load = useCallback(async () => {
    const { data, error: err } = await itInventory.getAsset(id)
    if (err) setError(err.message)
    setAsset((data as unknown as ItAssetRow | null) ?? null)
    setLoading(false)
  }, [id])
  useEffect(() => { void load() }, [load])

  useEffect(() => {
    if (!asset?.image_path) { setPhotoUrl(null); return }
    let alive = true
    void itInventory.photoUrl(asset.image_path).then((u) => { if (alive) setPhotoUrl(u) })
    return () => { alive = false }
  }, [asset?.image_path])

  const siteName = useMemo(() => new Map(locations.map((l) => [l.id, l.name])), [locations])

  const run = async (op: () => PromiseLike<{ error: { message: string } | null }>, done?: string) => {
    setBusy(true)
    setError(null)
    const { error: err } = await op()
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); return false }
    if (done) setFlash(done)
    void load()
    return true
  }

  if (loading || !refs) {
    return <div className="grid h-full place-items-center text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  }
  if (!asset) {
    return (
      <div className="grid h-full place-items-center px-4 text-center text-sm text-ink-muted">
        <div>
          <p>{error ?? "This item doesn't exist, or it's at a site you can't see."}</p>
          <Button variant="link" className="mt-2" onClick={() => navigate(backTo)}>Back to IT Inventory</Button>
        </div>
      </div>
    )
  }

  const settings = refs.settings
  const category = refs.category.get(asset.category_id)
  const status = refs.status.get(asset.status_label_id)
  const model = asset.model_id ? refs.model.get(asset.model_id) : undefined
  const manufacturer = model?.manufacturer_id ? refs.manufacturer.get(model.manufacturer_id) : undefined
  const assignment = assignmentBadge(asset)
  const health = healthBadge(asset.health_state)
  const warranty = warrantyState(asset.warranty_end_date)
  const archived = !!asset.deleted_at
  const canEdit = profile?.role === 'owner' || profile?.role === 'manager' || profile?.role === 'technician'
  const url = tagUrl(settings.short_code, asset.asset_tag)
  // inet / macaddr come back from PostgREST as text; the generated types say unknown.
  const ip = asset.ip_address as string | null
  const mac = asset.mac_address as string | null

  const addPhoto = async (file: File) => {
    if (!profile) return
    setBusy(true)
    const res = await itInventory.uploadAssetPhoto(profile.account_id, asset.id, asset.location_id, await shrinkPhoto(file))
    setBusy(false)
    if (res.error) setError(res.error)
    else void load()
  }

  const setTab = (t: Tab) => setParams((p) => {
    const next = new URLSearchParams(p)
    if (t === 'overview') next.delete('tab')
    else next.set('tab', t)
    return next
  }, { replace: true })

  return (
    <div className="flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-4xl lg:px-8 lg:py-4">
      <div className="flex min-h-0 flex-1 flex-col bg-card lg:rounded-md lg:border lg:border-border">
        {/* Header */}
        <div className="flex items-start gap-2 border-b border-border px-2 py-2.5 sm:px-3">
          <button type="button" onClick={() => navigate(backTo)} aria-label="Back to IT Inventory"
            className="grid size-9 shrink-0 place-items-center rounded-full text-ink-muted hover:bg-content">
            <ArrowLeft className="size-5" />
          </button>
          <button type="button" disabled={!canEdit || busy} onClick={() => photoInput.current?.click()}
            className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-md bg-accent/15 text-accent"
            aria-label={photoUrl ? 'Replace photo' : 'Add a photo'}>
            {photoUrl ? <img src={photoUrl} alt="" className="size-full object-cover" /> : <ItIcon name={category?.icon} className="size-6" />}
          </button>
          <input ref={photoInput} type="file" accept="image/*" capture="environment" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void addPhoto(f); e.target.value = '' }} />
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-ink-subtle">{asset.asset_tag}</span>
              {archived && <Badge tone="danger">Archived</Badge>}
            </div>
            <h1 className="truncate text-[17px] font-semibold text-ink">{asset.name}</h1>
            <div className="mt-1 flex flex-wrap gap-1">
              <Badge tone={statusTone(status)}>{status?.name ?? 'Status'}</Badge>
              <Badge tone={assignment.tone}>{assignment.label}</Badge>
              <Badge tone={health.tone}>{health.label}</Badge>
            </div>
          </div>
          <div className="hidden shrink-0 sm:block" title={url}><QrCodeImage value={url} size={64} /></div>
          {canEdit && !archived && (
            <Button variant="secondary" size="sm" onClick={() => setForm('edit')}><Pencil className="size-3.5" /> Edit</Button>
          )}
          {canEdit && (
            <div className="relative">
              <button type="button" onClick={() => setMenu(menu === 'more' ? null : 'more')} aria-label="More"
                className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content">
                <EllipsisVertical className="size-4" />
              </button>
              {menu === 'more' && (
                <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-border bg-card py-1 shadow-md">
                  {!archived && (
                    <MenuItem icon={CopyPlus} onClick={() => { setMenu(null); setForm('clone') }}>Clone</MenuItem>
                  )}
                  {archived ? (
                    <MenuItem icon={ArchiveRestore} onClick={() => { setMenu(null); void run(() => itInventory.restoreAsset(asset.id), 'Restored.') }}>Restore</MenuItem>
                  ) : (
                    <MenuItem icon={Archive} onClick={() => { setMenu(null); setConfirm('archive') }}>Archive</MenuItem>
                  )}
                  {profile?.role === 'owner' && (
                    <MenuItem icon={Trash2} danger onClick={() => { setMenu(null); setConfirm('delete') }}>Delete for good</MenuItem>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Primary actions */}
        {canEdit && !archived && (
          <div className="flex flex-wrap gap-2 border-b border-border px-3 py-2">
            <div className="relative">
              <Button variant="secondary" size="sm" disabled={busy} onClick={() => setMenu(menu === 'status' ? null : 'status')}>
                Change status <ChevronDown className="size-3.5" />
              </Button>
              {menu === 'status' && (
                <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-md border border-border bg-card py-1 shadow-md">
                  {refs.statuses.map((s) => (
                    <button key={s.id} type="button" disabled={s.id === asset.status_label_id}
                      onClick={() => {
                        setMenu(null)
                        void run(() => itInventory.updateAsset(asset.id, { status_label_id: s.id }), `Status is now ${s.name}.`)
                      }}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-ink hover:bg-content disabled:opacity-60">
                      <Badge tone={statusTone(s)}>{s.name}</Badge>
                      {s.id === asset.status_label_id && <Check className="ml-auto size-4 text-accent" />}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <Button variant="secondary" size="sm" onClick={() => setForm('clone')}><CopyPlus className="size-3.5" /> Clone</Button>
            <Button variant="secondary" size="sm" onClick={() => photoInput.current?.click()} disabled={busy}>
              <Camera className="size-3.5" /> Photo
            </Button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex border-b border-border bg-card">
          {(['overview', 'timeline'] as Tab[]).map((t) => (
            <button key={t} type="button" onClick={() => setTab(t)}
              className={cn(
                'flex-1 border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition',
                tab === t ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
              )}>
              {t}
            </button>
          ))}
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))] sm:px-4">
          {flash && (
            <div className="mb-4 flex items-start justify-between gap-3 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
              <span>{flash}</span>
              <button type="button" onClick={() => setFlash(null)} aria-label="Dismiss" className="shrink-0"><X className="size-4" /></button>
            </div>
          )}
          {error && <p className="mb-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

          {tab === 'overview' ? (
            <div className="flex flex-col gap-5">
              <Section title="Where">
                <Row label="Site">{siteName.get(asset.location_id) ?? 'Archived site'}</Row>
                <Row label="Area">{asset.area_id ? refs.area.get(asset.area_id)?.name : null}</Row>
                <Row label="Checked out to">{asset.assigned_label}</Row>
              </Section>

              <Section title="What it is">
                <Row label="Category">{category?.name}</Row>
                <Row label="Model">{model ? [model.name, model.model_number].filter(Boolean).join(' · ') : null}</Row>
                <Row label="Manufacturer">{manufacturer?.name}</Row>
                <Row label="Serial" copy={asset.serial} mono>{asset.serial}</Row>
                <Row label="MAC address" copy={mac} mono>{mac}</Row>
                <Row label="IP address" copy={ip} mono>{ip}</Row>
                <Row label="Hostname" copy={asset.hostname} mono>{asset.hostname}</Row>
              </Section>

              <Section title="Health">
                <Row label="Right now"><Badge tone={health.tone}>{health.label}</Badge></Row>
                <Row label="Last seen">{asset.last_seen_at ? format(new Date(asset.last_seen_at), 'MMM d, yyyy h:mm a') : null}</Row>
              </Section>

              <Section title="Purchase and warranty">
                <Row label="Purchased">{asset.purchase_date ? fmtDay(asset.purchase_date) : null}</Row>
                <Row label="Cost">{asset.purchase_cost != null ? currency(asset.purchase_cost) : null}</Row>
                <Row label="Bought from">{asset.supplier_id ? refs.supplier.get(asset.supplier_id)?.name : null}</Row>
                <Row label="Order number">{asset.order_number}</Row>
                <Row label="Warranty">
                  {asset.warranty_end_date && (
                    <span className="flex flex-wrap items-center gap-2">
                      <Badge tone={warranty.tone}>{warranty.label}</Badge>
                      <span className="text-ink-muted">
                        {fmtDay(asset.warranty_end_date)}{asset.warranty_end_manual ? '' : ' (from the model)'}
                      </span>
                    </span>
                  )}
                </Row>
                <Row label="End of life">{asset.eol_date ? fmtDay(asset.eol_date) : null}</Row>
              </Section>

              <Section title="Sticker">
                <Row label="Tag" mono copy={asset.asset_tag}>{asset.asset_tag}</Row>
                <Row label="Printed">
                  {asset.tag?.printed_count
                    ? `${asset.tag.printed_count} time${asset.tag.printed_count === 1 ? '' : 's'}${asset.tag.last_printed_at ? `, last ${format(new Date(asset.tag.last_printed_at), 'MMM d, yyyy')}` : ''}`
                    : <span className="inline-flex items-center gap-1.5 text-warn"><Sticker className="size-4" /> Not printed yet</span>}
                </Row>
                <Row label="Condition">
                  {asset.sticker_condition === 'unknown' ? null : (
                    <Badge tone={asset.sticker_condition === 'ok' ? 'ok' : 'warn'}>
                      {asset.sticker_condition === 'ok' ? 'Readable' : asset.sticker_condition === 'faded' ? 'Faded' : 'Missing'}
                    </Badge>
                  )}
                </Row>
                <div className="flex items-center gap-3 px-3 py-2.5 sm:hidden">
                  <QrCodeImage value={url} size={96} />
                  <p className="text-xs text-ink-muted">Scan with any phone camera to open this page.</p>
                </div>
              </Section>

              <Section title="Audit">
                <Row label="Next audit">
                  {asset.next_audit_date && (
                    <span className={cn(daysUntil(asset.next_audit_date) < 0 && 'font-medium text-danger')}>
                      {fmtDay(asset.next_audit_date)}{daysUntil(asset.next_audit_date) < 0 ? ' (overdue)' : ''}
                    </span>
                  )}
                </Row>
                <Row label="Last audit">{asset.last_audit_at ? format(new Date(asset.last_audit_at), 'MMM d, yyyy') : 'Never'}</Row>
              </Section>

              {asset.notes && (
                <Section title="Notes">
                  <p className="whitespace-pre-wrap px-3 py-2.5 text-sm text-ink">{asset.notes}</p>
                </Section>
              )}
            </div>
          ) : (
            <Timeline asset={asset} refs={refs} siteName={siteName} />
          )}
        </div>
      </div>

      {form && (
        <AssetForm
          mode={form}
          refs={refs}
          asset={asset}
          onClose={() => setForm(null)}
          onRefsChanged={() => void reloadRefs()}
          onSaved={(created) => {
            setForm(null)
            if (form === 'clone') {
              navigate(`/app/it-inventory/${created[0].id}`, {
                state: { back: routeState?.back, flash: `Cloned as ${created.map((c) => c.asset_tag).join(', ')}. Stickers are waiting in the print queue.` },
                replace: false,
              })
              return
            }
            setFlash('Saved.')
            void load()
          }}
        />
      )}

      <ConfirmDialog
        open={confirm === 'archive'}
        title={`Archive ${asset.asset_tag} ${asset.name}?`}
        description="It leaves the lists and its tag is retired for good. You can restore it later from Retired and archived."
        confirmLabel="Archive"
        destructive
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          void run(() => itInventory.archiveAsset(asset.id)).then((ok) => {
            setConfirm(null)
            if (ok) navigate(backTo, { state: { flash: `Archived ${asset.asset_tag}.` } })
          })
        }}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`Delete ${asset.asset_tag} for good?`}
        description="This removes the record. Its history stays in the activity log and the tag is never reused. Archive instead if you might need it."
        confirmLabel="Delete"
        destructive
        loading={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          void run(() => itInventory.deleteAsset(asset.id)).then((ok) => {
            setConfirm(null)
            if (ok) navigate(backTo, { state: { flash: `Deleted ${asset.asset_tag}.` } })
          })
        }}
      />
    </div>
  )
}

function MenuItem({ icon: Icon, children, onClick, danger }: { icon: typeof Copy; children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick}
      className={cn('flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-content', danger ? 'text-danger' : 'text-ink')}>
      <Icon className="size-4" /> {children}
    </button>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{title}</div>
      <div className="divide-y divide-border rounded-md border border-border">{children}</div>
    </section>
  )
}

function Row({ label, children, copy, mono }: { label: string; children: ReactNode; copy?: string | null; mono?: boolean }) {
  const empty = children === null || children === undefined || children === '' || children === false
  return (
    <div className="flex items-center gap-3 px-3 py-2.5 text-sm">
      <div className="w-32 shrink-0 text-ink-muted">{label}</div>
      <div className={cn('min-w-0 flex-1 break-words', mono && 'font-mono', empty ? 'text-ink-subtle' : 'text-ink')}>{empty ? '–' : children}</div>
      {copy && <CopyButton value={copy} />}
    </div>
  )
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" aria-label="Copy" title="Copy"
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        })
      }}
      className="grid size-8 shrink-0 place-items-center rounded-md text-ink-subtle hover:bg-content hover:text-ink">
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  )
}
