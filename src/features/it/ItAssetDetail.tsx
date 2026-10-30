import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { format, formatDistanceToNowStrict, parseISO } from 'date-fns'
import QRCode from 'qrcode'
import {
  AlertTriangle,
  ArrowLeft,
  BadgeCheck,
  Check,
  Copy,
  CopyPlus,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Printer,
  RefreshCw,
  StickyNote,
  Trash2,
  User,
  Wrench,
  type LucideIcon,
} from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Select'
import { QrCodeImage } from '@/components/data/QrCodeImage'
import { useAuth } from '@/lib/auth'
import { currency } from '@/lib/format'
import { SITE_URL } from '@/lib/siteUrl'
import { cn } from '@/lib/utils'
import { itInventory, type ItAssetEvent, type ItAssetRow } from '@/lib/queries/itInventory'
import { ItAssetModal } from './ItAssetModal'
import { assetTag, categoryOf, DUE_WINDOW_DAYS, daysUntil, IT_STATUSES, needsCheck, NO_SITE, statusOf } from './itInventorySchema'

// One IT Inventory record: its details, a printable QR label that opens this
// page when scanned, and its history (moves, status changes and in-person checks
// are logged by the database; notes and repairs are added here).

const fmtDay = (day: string) => format(parseISO(day), 'MMM d, yyyy')
const ago = (iso: string) => formatDistanceToNowStrict(new Date(iso), { addSuffix: true })

const EVENT_ICONS: Record<string, LucideIcon> = {
  created: Plus,
  moved: MapPin,
  status: RefreshCw,
  assigned: User,
  verified: BadgeCheck,
  note: StickyNote,
  repair: Wrench,
}

export default function ItAssetDetail({ id }: { id: string }) {
  const { profile } = useAuth()
  const navigate = useNavigate()
  const routerLocation = useLocation()
  const back = '/app/it-inventory' + ((routerLocation.state as { back?: string } | null)?.back ?? '')
  const [asset, setAsset] = useState<ItAssetRow | null>(null)
  const [events, setEvents] = useState<ItAssetEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [modal, setModal] = useState<null | 'edit' | 'copy'>(null)
  const [busy, setBusy] = useState<null | 'status' | 'verify' | 'delete'>(null)

  const load = useCallback(async () => {
    const [a, ev] = await Promise.all([itInventory.get(id), itInventory.events(id)])
    setError(a.error ? a.error.message : null)
    setAsset((a.data as unknown as ItAssetRow | null) ?? null)
    setEvents(ev.data ?? [])
    setLoading(false)
  }, [id])
  useEffect(() => { void load() }, [load])

  const run = async (what: 'status' | 'verify', op: () => PromiseLike<{ error: { message: string } | null }>) => {
    setBusy(what)
    const { error: err } = await op()
    setBusy(null)
    if (err) { setError(err.message); return }
    void load()
  }

  if (loading) {
    return <div className="grid place-items-center py-24 text-ink-muted"><Loader2 className="size-5 animate-spin" /></div>
  }
  if (!asset) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10 text-center">
        <p className="text-sm text-ink-muted">{error ?? "This item doesn't exist or isn't at a site you can see."}</p>
        <Link to={back} className="mt-3 inline-block text-sm text-accent hover:underline">Back to IT Inventory</Link>
      </div>
    )
  }

  const c = categoryOf(asset.category)
  const s = statusOf(asset.status)
  const service = c.kind === 'service'
  const stale = needsCheck(asset)
  const canDelete = profile?.role === 'owner' || asset.created_by === profile?.id

  const remove = async () => {
    if (!window.confirm(`Delete ${assetTag(asset.asset_number)} ${asset.name} and its history? This can't be undone.\n\nIf it's just gone, mark it Retired or Lost instead so the record stays.`)) return
    setBusy('delete')
    const { error: err } = await itInventory.remove(asset.id)
    setBusy(null)
    if (err) { setError(err.message); return }
    navigate(back)
  }

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link to={back} className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink">
        <ArrowLeft className="size-4" /> IT Inventory
      </Link>

      <header className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
            <c.icon className="size-6" />
          </span>
          <div className="min-w-0">
            <div className="font-mono text-xs text-ink-muted">{assetTag(asset.asset_number)}</div>
            <h1 className="truncate text-xl font-semibold text-ink">{asset.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-ink-muted">
              <Badge tone={s.tone}>{s.label}</Badge>
              <span>{c.label}</span>
              <span>·</span>
              <span>{asset.location?.name ?? NO_SITE}{asset.placement ? `, ${asset.placement}` : ''}</span>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {!service && (
            <Button variant="secondary" size="sm" disabled={!!busy}
              onClick={() => void run('verify', () => itInventory.markVerified(asset.id))}>
              {busy === 'verify' ? <Loader2 className="size-4 animate-spin" /> : <BadgeCheck className="size-4" />} Checked in person
            </Button>
          )}
          <Button variant="secondary" size="sm" onClick={() => setModal('edit')}><Pencil className="size-4" /> Edit</Button>
          <Button variant="secondary" size="sm" onClick={() => setModal('copy')}><CopyPlus className="size-4" /> Duplicate</Button>
          {canDelete && (
            <Button variant="secondary" size="sm" disabled={!!busy} onClick={() => void remove()} aria-label="Delete" className="text-danger">
              <Trash2 className="size-4" />
            </Button>
          )}
        </div>
      </header>

      {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      {stale && (
        <p className="mt-4 flex items-start gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {asset.last_verified_at
            ? `Nobody has checked this in person since ${format(new Date(asset.last_verified_at), 'MMM d, yyyy')}.`
            : 'Nobody has checked this in person yet.'}{' '}
          Tap Checked in person next time you're looking at it.
        </p>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card title="Overview">
            <Row label="Status">
              <Select value={asset.status} disabled={!!busy} className="h-9 max-w-[200px]"
                onChange={(e) => {
                  const status = e.target.value
                  void run('status', () => itInventory.update(asset.id, { status }))
                }}>
                {IT_STATUSES.map((st) => <option key={st.key} value={st.key}>{st.label}</option>)}
              </Select>
            </Row>
            <Row label="Site">{asset.location?.name ?? NO_SITE}</Row>
            <Row label={service ? 'Where it terminates' : 'Where at the site'}>{asset.placement}</Row>
            <Row label="Assigned to">{asset.assigned_to}</Row>
            {!service && (
              <Row label="Last checked">
                {asset.last_verified_at ? (
                  <span className={stale ? 'text-warn' : undefined}>
                    {format(new Date(asset.last_verified_at), 'MMM d, yyyy')} ({ago(asset.last_verified_at)})
                  </span>
                ) : <span className="text-warn">Never</span>}
              </Row>
            )}
          </Card>

          {service ? (
            <Card title="Service">
              <Row label="Provider">{asset.vendor}</Row>
              <Row label="Plan">{asset.model}</Row>
              <Row label="Account or circuit #" copy={asset.serial_number} mono>{asset.serial_number}</Row>
              {asset.category === 'internet' && <Row label="Static IP" copy={asset.ip_address} mono>{asset.ip_address}</Row>}
            </Card>
          ) : (
            <>
              <Card title="Hardware">
                <Row label="Manufacturer">{asset.manufacturer}</Row>
                <Row label="Model">{asset.model}</Row>
                <Row label="Serial number" copy={asset.serial_number} mono>{asset.serial_number}</Row>
              </Card>
              <Card title="Network & access">
                <Row label="Hostname" copy={asset.hostname} mono>{asset.hostname}</Row>
                <Row label="IP address" copy={asset.ip_address} mono>{asset.ip_address}</Row>
                <Row label="MAC address" copy={asset.mac_address} mono>{asset.mac_address}</Row>
                <Row label="Operating system">{asset.operating_system}</Row>
                <Row label="Remote access ID" copy={asset.remote_access_id} mono>{asset.remote_access_id}</Row>
              </Card>
            </>
          )}

          <Card title={service ? 'Cost & renewal' : 'Cost & coverage'}>
            {!service && <Row label="Bought from">{asset.vendor}</Row>}
            <Row label={service ? 'Start date' : 'Purchase date'}>
              {asset.purchase_date && (
                <>
                  {fmtDay(asset.purchase_date)}
                  <span className="text-ink-muted"> ({formatDistanceToNowStrict(parseISO(asset.purchase_date))} {service ? 'ago' : 'old'})</span>
                </>
              )}
            </Row>
            {!service && <Row label="Purchase cost">{asset.purchase_cost != null ? currency(asset.purchase_cost) : null}</Row>}
            {!service && <Row label="Warranty">{asset.warranty_expires && <DueDate day={asset.warranty_expires} kind="warranty" />}</Row>}
            <Row label="Monthly cost">
              {asset.monthly_cost != null && (
                <>
                  {currency(asset.monthly_cost)}
                  <span className="text-ink-muted"> ({currency(asset.monthly_cost * 12)} a year)</span>
                </>
              )}
            </Row>
            <Row label="Renews">{asset.renewal_date && <DueDate day={asset.renewal_date} kind="renewal" />}</Row>
          </Card>

          {asset.notes && (
            <Card title="Notes">
              <p className="whitespace-pre-wrap px-4 py-3 text-sm text-ink">{asset.notes}</p>
            </Card>
          )}
        </div>

        <div className="space-y-5">
          <LabelCard asset={asset} />
          <HistoryCard asset={asset} events={events} onAdded={() => void load()} />
        </div>
      </div>

      {modal && (
        <ItAssetModal
          asset={modal === 'edit' ? asset : null}
          copyFrom={modal === 'copy' ? asset : null}
          defaultSiteId={asset.location_id ?? ''}
          onClose={() => setModal(null)}
          onSaved={(savedId) => {
            setModal(null)
            if (savedId && savedId !== asset.id) navigate(`/app/it-inventory/${savedId}`, { state: routerLocation.state })
            else void load()
          }}
        />
      )}
    </div>
  )
}

// ---- Pieces -------------------------------------------------------------------

function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-border bg-card">
      <h2 className="border-b border-border px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-ink-subtle">{title}</h2>
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}

function Row({ label, children, copy, mono }: { label: string; children: ReactNode; copy?: string | null; mono?: boolean }) {
  const empty = children == null || children === '' || children === false
  return (
    <div className="flex items-center gap-3 px-4 py-2.5 text-sm">
      <div className="w-36 shrink-0 text-ink-muted">{label}</div>
      <div className={cn('min-w-0 flex-1 break-words', mono && 'font-mono', empty ? 'text-ink-subtle' : 'text-ink')}>
        {empty ? '–' : children}
      </div>
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
      className="grid size-7 shrink-0 place-items-center rounded-md text-ink-subtle hover:bg-content hover:text-ink">
      {done ? <Check className="size-3.5 text-ok" /> : <Copy className="size-3.5" />}
    </button>
  )
}

// A warranty end or renewal date with how far off it is. A lapsed renewal is
// urgent; an ended warranty is just history.
function DueDate({ day, kind }: { day: string; kind: 'warranty' | 'renewal' }) {
  const d = daysUntil(day)
  const rel = d === 0 ? 'today' : d > 0 ? `in ${d} day${d === 1 ? '' : 's'}` : `${-d} day${d === -1 ? '' : 's'} ago`
  const tone = d < 0
    ? kind === 'renewal' ? 'text-danger' : 'text-ink-muted'
    : d <= DUE_WINDOW_DAYS ? 'text-warn' : 'text-ink'
  const word = kind === 'warranty' ? (d < 0 ? 'Ended' : 'Ends') : d < 0 ? 'Was due' : 'Due'
  return <span className={tone}>{word} {fmtDay(day)} ({rel})</span>
}

function LabelCard({ asset }: { asset: ItAssetRow }) {
  const url = `${SITE_URL}/app/it-inventory/${asset.id}`
  const [printing, setPrinting] = useState(false)
  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">Asset label</h2>
      <div className="mt-3 flex items-center gap-4">
        <QrCodeImage value={url} size={112} />
        <div className="min-w-0">
          <div className="font-mono text-lg font-bold text-ink">{assetTag(asset.asset_number)}</div>
          <div className="truncate text-sm text-ink">{asset.name}</div>
          <div className="truncate text-xs text-ink-muted">{asset.location?.name ?? NO_SITE}</div>
        </div>
      </div>
      <Button variant="secondary" size="sm" className="mt-3 w-full" disabled={printing}
        onClick={() => {
          setPrinting(true)
          void printLabel(asset, url).finally(() => setPrinting(false))
        }}>
        <Printer className="size-4" /> Print label
      </Button>
      <p className="mt-2 text-xs text-ink-muted">
        Sized for 2.25 x 1.25 in labels (DYMO 30334). Stick it on the device; scanning it with a phone camera opens this page.
      </p>
    </section>
  )
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch)

// Prints a single label from a hidden iframe so the app page itself never
// changes. The QR is regenerated at print size rather than copied off screen.
async function printLabel(asset: ItAssetRow, url: string): Promise<void> {
  const qr = await QRCode.toString(url, { type: 'svg', errorCorrectionLevel: 'M', margin: 0 })
  const tag = assetTag(asset.asset_number)
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${tag}</title><style>
    @page { size: 2.25in 1.25in; margin: 0.08in; }
    html, body { margin: 0; }
    body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #000; }
    .label { display: flex; align-items: center; gap: 0.1in; width: 2.09in; height: 1.09in; overflow: hidden; }
    .qr { flex: none; width: 1in; height: 1in; }
    .qr svg { display: block; width: 100%; height: 100%; }
    .text { min-width: 0; }
    .tag { font: 700 13pt ui-monospace, Menlo, Consolas, monospace; }
    .name { margin-top: 2pt; font-size: 8pt; font-weight: 600; line-height: 1.15; max-height: 2.3em; overflow: hidden; }
    .site { margin-top: 2pt; font-size: 7pt; color: #333; }
  </style></head><body><div class="label"><div class="qr">${qr}</div><div class="text">
    <div class="tag">${tag}</div>
    <div class="name">${escapeHtml(asset.name)}</div>
    <div class="site">${escapeHtml(asset.location?.name ?? NO_SITE)}</div>
  </div></div></body></html>`

  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden'
  await new Promise<void>((resolve) => {
    frame.onload = () => resolve()
    frame.srcdoc = html
    document.body.appendChild(frame)
  })
  frame.contentWindow?.focus()
  frame.contentWindow?.print()
  setTimeout(() => frame.remove(), 1000)
}

function HistoryCard({ asset, events, onAdded }: { asset: ItAssetRow; events: ItAssetEvent[]; onAdded: () => void }) {
  const { profile } = useAuth()
  const [kind, setKind] = useState<'note' | 'repair'>('note')
  const [text, setText] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async () => {
    if (!profile || !text.trim()) return
    setSaving(true)
    setError(null)
    const { error: err } = await itInventory.addEvent({
      account_id: asset.account_id,
      asset_id: asset.id,
      kind,
      summary: text.trim(),
      actor_id: profile.id,
      actor_name: profile.name || null,
    })
    setSaving(false)
    if (err) { setError(err.message); return }
    setText('')
    onAdded()
  }

  return (
    <section className="rounded-xl border border-border bg-card p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-subtle">History</h2>
      <div className="mt-3 space-y-2">
        <div className="inline-flex rounded-lg border border-border bg-content p-0.5 text-xs">
          {(['note', 'repair'] as const).map((k) => (
            <button key={k} type="button" onClick={() => setKind(k)}
              className={cn('rounded-md px-2.5 py-1 font-medium', kind === k ? 'bg-card text-ink shadow-sm' : 'text-ink-muted')}>
              {k === 'note' ? 'Note' : 'Repair'}
            </button>
          ))}
        </div>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2}
          placeholder={kind === 'repair' ? 'What was fixed or replaced?' : 'Add a note'}
          className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent" />
        {error && <p className="text-xs text-danger">{error}</p>}
        <Button size="sm" onClick={() => void add()} disabled={saving || !text.trim()}>
          {saving && <Loader2 className="size-4 animate-spin" />} Add {kind}
        </Button>
      </div>

      <ol className="mt-4 space-y-3">
        {events.map((e) => {
          const Icon = EVENT_ICONS[e.kind] ?? StickyNote
          return (
            <li key={e.id} className="flex gap-2.5">
              <span className={cn(
                'mt-0.5 grid size-6 shrink-0 place-items-center rounded-full',
                e.kind === 'repair' ? 'bg-warn-soft text-warn' : e.kind === 'verified' ? 'bg-ok-soft text-ok' : 'bg-content text-ink-muted',
              )}>
                <Icon className="size-3.5" />
              </span>
              <div className="min-w-0 text-sm">
                <div className="whitespace-pre-wrap break-words text-ink">
                  {e.kind === 'repair' && <span className="font-medium">Repair: </span>}
                  {e.summary}
                </div>
                <div className="text-xs text-ink-muted" title={format(new Date(e.created_at), 'MMM d, yyyy h:mm a')}>
                  {e.actor_name ?? 'Someone'} · {ago(e.created_at)}
                </div>
              </div>
            </li>
          )
        })}
        {events.length === 0 && <li className="text-sm text-ink-muted">No history yet.</li>}
      </ol>
    </section>
  )
}
