import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { CircleCheck, CircleX, Loader2, MonitorSmartphone, Unplug } from 'lucide-react'
import { ConfirmDialog } from '@/components/feedback/ConfirmDialog'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { currency } from '@/lib/format'
import { describeDevice, getDeviceLink, onDeviceLinkChange, setDeviceLink } from '@/lib/itHeartbeat'
import { itInventory, type ItAssetRow, type ItSubscription } from '@/lib/queries/itInventory'
import { Row, Section } from './DetailParts'
import { fmtDay, friendlyError, healthBadge } from './format'
import { Footer, NoteField } from './ItemActions'
import { CYCLE_SHORT } from './subscriptions'

// Health on the asset page. Phase 1 has two signals: devices that run Operator
// (crew tablets, kiosk browsers) report in while it's open, and people say
// when something isn't working. A person's "not working" holds until someone
// marks it working again, even if the device keeps reporting in.

type Report = { state: string; source: string; note: string | null; observed_at: string }

export function HealthSection({ asset, accountId, canEdit, onChanged }: {
  asset: ItAssetRow
  accountId: string
  canEdit: boolean
  onChanged: (message: string) => void
}) {
  const health = healthBadge(asset.health_state)
  const [link, setLink] = useState(getDeviceLink)
  useEffect(() => onDeviceLinkChange(() => setLink(getDeviceLink())), [])
  const here = link?.assetId === asset.id
  const heartbeat = asset.monitoring_enabled && asset.monitor_method === 'heartbeat'
  const [dialog, setDialog] = useState<null | 'link' | 'unlink' | 'down' | 'up'>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const archived = !!asset.deleted_at

  // Why it's offline: the last report (a person's note, or "Stopped reporting in").
  useEffect(() => {
    if (asset.health_state !== 'offline') { setReport(null); return }
    let alive = true
    void itInventory.lastHealthReport(asset.id).then(({ data }) => { if (alive) setReport((data as Report | null) ?? null) })
    return () => { alive = false }
  }, [asset.id, asset.health_state, asset.health_changed_at])

  const close = () => { setDialog(null); setNote(''); setError(null) }

  const linkHere = async () => {
    setBusy(true)
    setError(null)
    // This device stood for another item: free that one first.
    if (link && link.assetId !== asset.id) await itInventory.unlinkDevice(link.assetId)
    const { data, error: err } = await itInventory.linkDevice(asset.id, describeDevice())
    if (err || !data) { setBusy(false); setError(friendlyError(err?.message ?? "Couldn't link this device.")); return }
    await itInventory.heartbeat(data)
    setDeviceLink({ key: data, assetId: asset.id, tag: asset.asset_tag, name: asset.name })
    setBusy(false)
    close()
    onChanged(`This device now reports in as ${asset.asset_tag}. Leave Operator open on it.`)
  }

  const unlink = async () => {
    setBusy(true)
    const { error: err } = await itInventory.unlinkDevice(asset.id)
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); return }
    if (here) setDeviceLink(null)
    close()
    onChanged('Stopped monitoring. No device reports in for it now.')
  }

  const mark = async (state: 'offline' | 'online') => {
    setBusy(true)
    const { error: err } = await itInventory.reportHealth(accountId, asset, state, note.trim())
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); return }
    close()
    onChanged(state === 'offline' ? 'Marked not working. It shows as offline until someone marks it working.' : 'Marked working.')
  }

  return (
    <>
      <Section title="Health">
        <Row label="Right now">
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={health.tone}>{health.label}</Badge>
            {report?.note && (
              <span className="text-ink-muted">
                "{report.note}" · {format(new Date(report.observed_at), 'MMM d, h:mm a')}
              </span>
            )}
          </span>
        </Row>
        <Row label="Monitoring">
          {heartbeat
            ? here ? 'This device reports in while Operator is open on it' : 'A linked device reports in every minute while Operator is open'
            : <span className="text-ink-muted">Not monitored</span>}
        </Row>
        <Row label="Last seen">
          {asset.last_seen_at
            ? <span title={format(new Date(asset.last_seen_at), 'MMM d, yyyy h:mm a')}>{formatDistanceToNowStrict(new Date(asset.last_seen_at), { addSuffix: true })}</span>
            : null}
        </Row>
        {!archived && (
          <div className="flex flex-wrap gap-2 px-3 py-2.5">
            {asset.health_state === 'offline' ? (
              <Button size="sm" variant="secondary" onClick={() => setDialog('up')}><CircleCheck className="size-3.5" /> Mark working</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setDialog('down')}><CircleX className="size-3.5" /> Mark not working</Button>
            )}
            {canEdit && !here && (
              <Button size="sm" variant="secondary" onClick={() => setDialog('link')}>
                <MonitorSmartphone className="size-3.5" /> {heartbeat ? 'Link this device instead' : 'Link this device'}
              </Button>
            )}
            {canEdit && heartbeat && (
              <Button size="sm" variant="ghost" onClick={() => setDialog('unlink')}>
                <Unplug className="size-3.5" /> {here ? 'Unlink this device' : 'Stop monitoring'}
              </Button>
            )}
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={dialog === 'link'}
        title={`Is this device ${asset.asset_tag} ${asset.name}?`}
        description={[
          'Do this on the tablet or kiosk itself. While Operator is open on it, signed in or not, it reports in every minute, and it shows as offline if it stops for more than a few minutes.',
          heartbeat ? 'Another device reports in for this item now; this one takes over.' : '',
          link && link.assetId !== asset.id ? `This device reports in as ${link.tag} ${link.name} now. Linking it here stops that.` : '',
        ].filter(Boolean).join(' ')}
        confirmLabel="Link this device"
        loading={busy}
        onCancel={close}
        onConfirm={() => void linkHere()}
      />
      <ConfirmDialog
        open={dialog === 'unlink'}
        title={here ? 'Unlink this device?' : `Stop monitoring ${asset.asset_tag}?`}
        description="It stops reporting in and its health goes back to unknown. You can link it again any time."
        confirmLabel={here ? 'Unlink' : 'Stop monitoring'}
        loading={busy}
        onCancel={close}
        onConfirm={() => void unlink()}
      />
      {(dialog === 'down' || dialog === 'up') && (
        <Modal open onClose={close} size="md"
          title={dialog === 'down' ? `Mark ${asset.asset_tag} not working?` : `Mark ${asset.asset_tag} working?`}
          description={dialog === 'down'
            ? 'It shows as offline until someone marks it working again. To get it fixed, use Report problem too.'
            : heartbeat ? 'If it has stopped reporting in, it goes back to offline within a few minutes.' : undefined}>
          <NoteField value={note} onChange={setNote} placeholder={dialog === 'down' ? "What's wrong with it" : 'What fixed it'} />
          {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Footer busy={busy} onClose={close}>
            <Button variant={dialog === 'down' ? 'danger' : 'primary'} onClick={() => void mark(dialog === 'down' ? 'offline' : 'online')} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} {dialog === 'down' ? 'Mark not working' : 'Mark working'}
            </Button>
          </Footer>
        </Modal>
      )}
      {error && !dialog && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
    </>
  )
}

// The subscriptions that cover this item (the LPR service for an LPR camera).
export function CoveredBy({ assetId }: { assetId: string }) {
  const [subs, setSubs] = useState<Pick<ItSubscription, 'id' | 'name' | 'cost' | 'billing_cycle' | 'renewal_date'>[]>([])
  useEffect(() => {
    let alive = true
    void itInventory.subscriptionsForAsset(assetId).then(({ data }) => {
      if (!alive) return
      const rows = (data ?? []).map((r) => r.subscription).filter((s): s is NonNullable<typeof s> => !!s && !s.deleted_at)
      setSubs(rows)
    })
    return () => { alive = false }
  }, [assetId])
  if (!subs.length) return null
  return (
    <Section title="Covered by">
      {subs.map((s) => (
        <Row key={s.id} label={s.cost != null ? `${currency(s.cost)}${CYCLE_SHORT[s.billing_cycle] ?? ''}` : 'Subscription'}>
          <Link to={`/app/it-inventory/subscriptions?id=${s.id}`} className="text-accent hover:underline">{s.name}</Link>
          {s.renewal_date && <span className="block text-xs text-ink-muted">Renews {fmtDay(s.renewal_date)}</span>}
        </Row>
      ))}
    </Section>
  )
}
