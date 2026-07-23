import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ClipboardCopy,
  Image as ImageIcon,
  Loader2,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import { QrCodeImage } from '@/components/data/QrCodeImage'
import { Wos } from '@/components/ui/Wos'
import { format } from 'date-fns'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import {
  assets,
  STATUS_LABEL,
  STATUS_TONE,
  CRITICALITY_LABEL,
  CRITICALITY_TONE,
  type AssetStatus,
  type AssetCriticality,
} from '@/lib/queries/assets'
import { EditAssetModal } from './NewAssetModal'

type Detail = {
  id: string
  account_id: string
  location_id: string
  asset_number: number
  name: string
  type: string | null
  description: string | null
  status: AssetStatus
  criticality: AssetCriticality
  qr_code: string | null
  manufacturer: string | null
  model: string | null
  serial_number: string | null
  parent_asset_id: string | null
  purchase_date: string | null
  warranty_expiry: string | null
  last_serviced_at: string | null
  service_interval_days: number | null
  created_at: string
  updated_at: string
  location: { id: string; name: string } | null
  parent: { id: string; name: string; asset_number: number } | null
  sub_assets: Array<{ id: string; name: string; asset_number: number; status: AssetStatus; criticality: AssetCriticality }>
  photos: Array<{ id: string; storage_path: string; caption: string | null; created_at: string }>
}

type WO = {
  id: string
  number: number
  title: string
  status: string
  priority: string
  completed_at: string | null
  created_at: string
  assignees: Array<{ user_name: string }>
}

type Tab = 'insights' | 'details' | 'history'

export function AssetDetail({
  assetId, onBack, onChanged,
}: {
  assetId: string
  onBack: () => void
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const { profile } = useAuth()
  const [d, setD] = useState<Detail | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('details')
  const [editing, setEditing] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [history, setHistory] = useState<WO[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = await assets.byId(assetId)
    setD(data as unknown as Detail)
    setLoading(false)
  }, [assetId])

  useEffect(() => { void load() }, [load])

  // Pull WO history once when entering History or Insights.
  useEffect(() => {
    if (tab !== 'history' && tab !== 'insights') return
    setHistoryLoading(true)
    void assets.workOrderHistory(assetId).then(({ data }) => {
      setHistory((data as unknown as WO[]) ?? [])
      setHistoryLoading(false)
    })
  }, [assetId, tab])

  useEffect(() => {
    const ch = supabase
      .channel('asset-' + assetId)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'equipment', filter: `id=eq.${assetId}` }, () => { void load() })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'asset_photos', filter: `asset_id=eq.${assetId}` }, () => { void load() })
      .subscribe()
    return () => { void supabase.removeChannel(ch) }
  }, [assetId, load])

  const removeAsset = async () => {
    if (!d) return
    if (!window.confirm(`Delete asset "${d.name}"? This also removes any sub-assets.`)) return
    await assets.remove(d.id)
    onChanged()
    onBack()
  }

  if (loading || !d) {
    return (
      <div className="grid h-full place-items-center text-sm text-ink-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-2 py-2.5 sm:px-3">
        <button
          type="button"
          onClick={onBack}
          className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content lg:hidden"
          aria-label="Back"
        >
          <ArrowLeft className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="text-[11px] text-ink-subtle">#{String(d.asset_number).padStart(2, '0')}</span>
            <Badge tone={STATUS_TONE[d.status]}>{STATUS_LABEL[d.status]}</Badge>
            {d.criticality !== 'none' && (
              <Badge tone={CRITICALITY_TONE[d.criticality]}>{CRITICALITY_LABEL[d.criticality]}</Badge>
            )}
          </div>
          <h1 className="truncate text-[17px] font-semibold text-ink">{d.name}</h1>
        </div>
        <Button variant="secondary" onClick={() => setEditing(true)} size="sm"><Pencil className="size-3.5" /> Edit</Button>
        <div className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            className="grid size-9 place-items-center rounded-full text-ink-muted hover:bg-content"
            aria-label="More"
          ><MoreVertical className="size-4" /></button>
          {menuOpen && (
            <div className="absolute right-0 top-full z-20 mt-1 w-52 rounded-md border border-border bg-card py-1 shadow-md">
              <button
                onClick={() => { setMenuOpen(false); void createWorkOrderForAsset(d, navigate) }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-ink hover:bg-content"
              >
                <Plus className="size-4" /> Use in New Work Order
              </button>
              <button
                onClick={() => { setMenuOpen(false); void removeAsset() }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-danger hover:bg-content"
              >
                <Trash2 className="size-4" /> Delete asset
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card">
        {(['insights', 'details', 'history'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'flex-1 border-b-2 px-4 py-2.5 text-sm font-medium capitalize transition',
              tab === t ? 'border-accent text-accent' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Body */}
      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-4">
        {tab === 'insights' && (
          <InsightsTab asset={d} history={history} historyLoading={historyLoading} />
        )}
        {tab === 'details' && (
          <DetailsTab asset={d} accountId={profile?.account_id ?? ''} onChanged={load} navigate={navigate} />
        )}
        {tab === 'history' && (
          <HistoryTab history={history} loading={historyLoading} navigate={navigate} />
        )}
      </div>

      {editing && (
        <EditAssetModal
          asset={d}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); void load(); onChanged() }}
        />
      )}
    </div>
  )
}

// ---- Insights tab --------------------------------------------------------

function InsightsTab({ asset, history, historyLoading }: { asset: Detail; history: WO[]; historyLoading: boolean }) {
  const openWO = history.filter((h) => h.status !== 'done' && h.status !== 'skipped')
  const completedWO = history.filter((h) => h.status === 'done')
  const last30 = completedWO.filter((h) => h.completed_at && new Date(h.completed_at).getTime() > Date.now() - 30 * 86400000)
  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Status</div>
        <div className="rounded-md border border-border p-3">
          <div className="flex items-center gap-2 text-sm">
            <span className={cn('size-2.5 rounded-full', STATUS_TONE[asset.status] === 'ok' ? 'bg-ok' : STATUS_TONE[asset.status] === 'warn' ? 'bg-warn' : STATUS_TONE[asset.status] === 'danger' ? 'bg-danger' : 'bg-ink-subtle')} />
            <span className="font-medium text-ink">{STATUS_LABEL[asset.status]}</span>
          </div>
          <p className="mt-1 text-[11px] text-ink-subtle">Last updated {format(new Date(asset.updated_at), 'MM/dd/yyyy, h:mm a')}</p>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label={<>Open <Wos /></>} value={openWO.length} tone={openWO.length > 0 ? 'warn' : 'ok'} />
        <StatTile label="Completed (30d)" value={last30.length} />
        <StatTile label="Sub-Assets" value={asset.sub_assets.length} />
        <StatTile label="Criticality" value={CRITICALITY_LABEL[asset.criticality]} tone={CRITICALITY_TONE[asset.criticality]} />
      </div>

      <section>
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Recent Work Orders</div>
        {historyLoading ? (
          <p className="text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Loading...</p>
        ) : history.length === 0 ? (
          <p className="rounded-md border border-border bg-content/40 p-3 text-sm text-ink-muted">No work orders on this asset yet.</p>
        ) : (
          <div className="overflow-hidden rounded-md border border-border">
            {history.slice(0, 5).map((w) => <WORow key={w.id} wo={w} />)}
          </div>
        )}
      </section>
    </div>
  )
}

function StatTile({ label, value, tone }: { label: React.ReactNode; value: React.ReactNode; tone?: 'ok' | 'warn' | 'danger' | 'neutral' }) {
  const cls =
    tone === 'warn' ? 'text-warn' :
    tone === 'danger' ? 'text-danger' :
    tone === 'ok' ? 'text-ok' : 'text-ink'
  return (
    <div className="rounded-md border border-border bg-content/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className={cn('mt-0.5 text-2xl font-semibold tabular', cls)}>{value}</div>
    </div>
  )
}

// ---- Details tab ---------------------------------------------------------

function DetailsTab({
  asset, accountId, onChanged, navigate,
}: {
  asset: Detail
  accountId: string
  onChanged: () => void
  navigate: ReturnType<typeof useNavigate>
}) {
  const [copyOk, setCopyOk] = useState(false)
  const copyQr = async () => {
    if (!asset.qr_code) return
    await navigator.clipboard.writeText(asset.qr_code)
    setCopyOk(true)
    setTimeout(() => setCopyOk(false), 1500)
  }

  return (
    <div className="flex flex-col gap-4">
      {(!asset.manufacturer || !asset.model) && (
        <div className="rounded-md border border-accent/30 bg-accent-soft/40 p-3 text-sm">
          <div className="font-semibold text-ink">Add a Manufacturer and Model</div>
          <p className="mt-0.5 text-ink-muted">Help us recommend manuals, procedures, parts, and more for this Asset.</p>
        </div>
      )}

      {/* Asset Type + QR */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Asset Type</div>
          <div className="mt-1 text-sm text-ink">{asset.type ?? '—'}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">QR Code / Barcode</div>
          <div className="mt-1 flex items-center gap-2">
            <span className="font-mono text-sm text-ink">{asset.qr_code}</span>
            <button
              type="button"
              onClick={() => void copyQr()}
              className="rounded p-1 text-ink-subtle hover:text-accent"
              aria-label="Copy QR code"
            ><ClipboardCopy className="size-3.5" /></button>
            {copyOk && <span className="text-[11px] text-ok">Copied</span>}
          </div>
          <div className="mt-2">
            <QrCodeImage value={`https://operator.washlyfe.com/app/assets/${asset.id}`} size={132} />
          </div>
          <p className="mt-1 text-[10px] text-ink-subtle">Print + tape on the asset. Scans open it in the app.</p>
        </div>
      </section>

      {/* Location + Parent */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FieldBlock label="Location" value={asset.location?.name ?? '—'} />
        <FieldBlock label="Parent Asset"
          value={asset.parent ? (
            <button onClick={() => navigate(`/app/assets/${asset.parent!.id}`)} className="text-accent hover:underline">
              #{asset.parent.asset_number} . {asset.parent.name}
            </button>
          ) : '—'}
        />
      </section>

      {/* Mfr / Model / Serial */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FieldBlock label="Manufacturer" value={asset.manufacturer ?? '—'} />
        <FieldBlock label="Model" value={asset.model ?? '—'} />
        <FieldBlock label="Serial Number" value={asset.serial_number ?? '—'} />
      </section>

      {/* Service info */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <FieldBlock label="Purchase Date" value={asset.purchase_date ? format(new Date(asset.purchase_date), 'MM/dd/yyyy') : '—'} />
        <FieldBlock label="Warranty Expires" value={asset.warranty_expiry ? format(new Date(asset.warranty_expiry), 'MM/dd/yyyy') : '—'} />
        <FieldBlock label="Last Serviced" value={asset.last_serviced_at ? format(new Date(asset.last_serviced_at), 'MM/dd/yyyy') : '—'} />
      </section>

      {asset.description && (
        <section>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Description</div>
          <p className="whitespace-pre-wrap text-sm text-ink">{asset.description}</p>
        </section>
      )}

      {/* Sub-assets */}
      {asset.sub_assets.length > 0 && (
        <section>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">
            Sub-Assets ({asset.sub_assets.length})
          </div>
          <div className="overflow-hidden rounded-md border border-border">
            {asset.sub_assets.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => navigate(`/app/assets/${s.id}`)}
                className="flex w-full items-center justify-between gap-2 border-b border-border px-3 py-2 text-sm last:border-0 hover:bg-content"
              >
                <div className="flex items-center gap-2">
                  <span className="grid size-6 place-items-center rounded bg-accent/15 text-[10px] font-semibold text-accent">#{s.asset_number}</span>
                  <span className="text-ink">{s.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  {s.criticality !== 'none' && <Badge tone={CRITICALITY_TONE[s.criticality]}>{s.criticality}</Badge>}
                  <Badge tone={STATUS_TONE[s.status]}>{STATUS_LABEL[s.status]}</Badge>
                </div>
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Photos */}
      <PhotosSection asset={asset} accountId={accountId} onChanged={onChanged} />

      <div className="flex justify-center pt-2">
        <button
          type="button"
          onClick={() => void createWorkOrderForAsset(asset, navigate)}
          className="inline-flex items-center gap-1.5 rounded-full border border-accent px-4 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
        >
          <Plus className="size-3.5" /> Use in New Work Order
        </button>
      </div>
    </div>
  )
}

function FieldBlock({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">{label}</div>
      <div className="mt-0.5 text-sm text-ink">{value}</div>
    </div>
  )
}

// ---- History tab ---------------------------------------------------------

function HistoryTab({ history, loading, navigate }: {
  history: WO[]; loading: boolean; navigate: ReturnType<typeof useNavigate>
}) {
  if (loading) {
    return <p className="text-sm text-ink-muted"><Loader2 className="inline size-4 animate-spin" /> Loading work order history...</p>
  }
  if (history.length === 0) {
    return <p className="rounded-md border border-border bg-content/40 p-3 text-sm text-ink-muted">No work orders on this asset yet.</p>
  }
  return (
    <div className="overflow-hidden rounded-md border border-border">
      {history.map((w) => <WORow key={w.id} wo={w} onClick={() => navigate(`/app/work-orders/${w.id}`)} />)}
    </div>
  )
}

function WORow({ wo, onClick }: { wo: WO; onClick?: () => void }) {
  const inner = (
    <>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-medium text-ink">{wo.title}</span>
          <span className="text-[10px] text-ink-subtle">#{wo.number}</span>
        </div>
        {wo.completed_at ? (
          <p className="text-[11px] text-ok">Completed {format(new Date(wo.completed_at), 'MM/dd/yyyy')}</p>
        ) : (
          <p className="text-[11px] text-ink-subtle">Created {format(new Date(wo.created_at), 'MM/dd/yyyy')}</p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2 text-[11px]">
        {wo.priority !== 'none' && (
          <Badge tone={wo.priority === 'high' ? 'danger' : wo.priority === 'medium' ? 'warn' : 'ok'}>{wo.priority}</Badge>
        )}
        <Badge tone={wo.status === 'done' ? 'ok' : wo.status === 'on_hold' ? 'warn' : 'accent'}>{wo.status.replace('_', ' ')}</Badge>
      </div>
    </>
  )
  if (onClick) {
    return <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-content">{inner}</button>
  }
  return <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 last:border-0">{inner}</div>
}

// ---- Photos -------------------------------------------------------------

const PHOTO_URL_CACHE = new Map<string, { url: string; exp: number }>()

function PhotosSection({ asset, accountId, onChanged }: {
  asset: Detail; accountId: string; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)

  const onPick = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setBusy(true)
    for (let i = 0; i < files.length; i++) {
      const f = files.item(i)
      if (!f) continue
      if (!f.type.startsWith('image/')) continue
      await assets.uploadPhoto(accountId, asset.id, f)
    }
    setBusy(false)
    onChanged()
  }

  const photos = asset.photos ?? []

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-subtle">Photos ({photos.length})</div>
        <label className="inline-flex cursor-pointer items-center gap-1 text-xs font-medium text-accent hover:text-accent-hover">
          {busy ? <Loader2 className="size-3 animate-spin" /> : <Plus className="size-3" />}
          Add
          <input type="file" accept="image/*" multiple className="hidden" onChange={(e) => void onPick(e.target.files)} />
        </label>
      </div>
      {photos.length === 0 ? (
        <p className="rounded-md border border-dashed border-border bg-content/30 px-3 py-4 text-center text-sm text-ink-muted">
          No photos. Add the nameplate, install location, or any reference shot.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p) => <PhotoThumb key={p.id} photo={p} onChanged={onChanged} />)}
        </div>
      )}
    </section>
  )
}

function PhotoThumb({ photo, onChanged }: {
  photo: { id: string; storage_path: string; caption: string | null }; onChanged: () => void
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    const cached = PHOTO_URL_CACHE.get(photo.storage_path)
    if (cached && cached.exp > Date.now()) { setUrl(cached.url); return }
    let alive = true
    void (async () => {
      const { url: signed } = await assets.photoSignedUrl(photo.storage_path, 3600)
      if (!alive || !signed) return
      PHOTO_URL_CACHE.set(photo.storage_path, { url: signed, exp: Date.now() + 50 * 60 * 1000 })
      setUrl(signed)
    })()
    return () => { alive = false }
  }, [photo.storage_path])

  return (
    <div className="group relative aspect-square overflow-hidden rounded-md bg-content">
      {url ? (
        <a href={url} target="_blank" rel="noreferrer"><img src={url} alt={photo.caption ?? ''} className="size-full object-cover" /></a>
      ) : (
        <div className="grid size-full place-items-center"><ImageIcon className="size-4 text-ink-subtle" /></div>
      )}
      <button
        type="button"
        onClick={async () => { if (window.confirm('Delete this photo?')) { await assets.removePhoto(photo.id, photo.storage_path); onChanged() } }}
        className="absolute right-1 top-1 hidden rounded-full bg-card p-0.5 text-ink-muted hover:text-danger group-hover:block"
        aria-label="Delete"
      ><X className="size-3" /></button>
    </div>
  )
}

// ---- Side actions --------------------------------------------------------

// Navigate to the WO list with a pre-filled hint. The new-WO modal isn't
// open-with-defaults yet; for now we drop the user on the WO page and let
// them open the modal with this asset name pre-suggested in description.
async function createWorkOrderForAsset(asset: Detail, navigate: ReturnType<typeof useNavigate>) {
  sessionStorage.setItem(
    'newWO.prefill',
    JSON.stringify({ equipment_id: asset.id, equipment_name: asset.name }),
  )
  navigate('/app/work-orders')
}
