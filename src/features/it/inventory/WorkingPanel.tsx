import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { format } from 'date-fns'
import { CircleCheck, CircleX, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { currency } from '@/lib/format'
import { itInventory, type ItAssetRow, type ItSubscription } from '@/lib/queries/itInventory'
import { Row, Section } from './DetailParts'
import { fmtDay, friendlyError, healthBadge, notWorking } from './format'
import { Footer, NoteField } from './ItemActions'
import { CYCLE_SHORT } from './subscriptions'

// Working order on the asset page: what people report. "Not working" (here,
// from a problem report, or the public sticker page) holds until someone
// marks it working again. IT Inventory tracks; it doesn't monitor devices.

type Report = { state: string; source: string; note: string | null; observed_at: string }

export function WorkingSection({ asset, accountId, onChanged }: {
  asset: ItAssetRow
  accountId: string
  onChanged: (message: string) => void
}) {
  const down = notWorking(asset.health_state)
  const badge = healthBadge(asset.health_state)
  const [dialog, setDialog] = useState<null | 'down' | 'up'>(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)

  // Who said it's not working, and why.
  useEffect(() => {
    if (!down) { setReport(null); return }
    let alive = true
    void itInventory.lastHealthReport(asset.id).then(({ data }) => { if (alive) setReport((data as Report | null) ?? null) })
    return () => { alive = false }
  }, [asset.id, down, asset.health_changed_at])

  const close = () => { setDialog(null); setNote(''); setError(null) }
  const mark = async (state: 'offline' | 'online') => {
    setBusy(true)
    const { error: err } = await itInventory.reportHealth(accountId, asset, state, note.trim())
    setBusy(false)
    if (err) { setError(friendlyError(err.message)); return }
    close()
    onChanged(state === 'offline' ? 'Marked not working. It shows that way until someone marks it working.' : 'Marked working.')
  }

  return (
    <>
      <Section title="Working order">
        <Row label="Right now">
          {down ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge tone={badge.tone}>{badge.label}</Badge>
              {report && (
                <span className="text-ink-muted">
                  {report.note ? `"${report.note}" · ` : ''}{format(new Date(report.observed_at), 'MMM d, h:mm a')}
                </span>
              )}
            </span>
          ) : <span className="text-ink-muted">No problem reported</span>}
        </Row>
        {!asset.deleted_at && (
          <div className="px-3 py-2.5">
            {down ? (
              <Button size="sm" variant="secondary" onClick={() => setDialog('up')}><CircleCheck className="size-3.5" /> Mark working</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => setDialog('down')}><CircleX className="size-3.5" /> Mark not working</Button>
            )}
          </div>
        )}
      </Section>

      {dialog && (
        <Modal open onClose={close} size="md"
          title={dialog === 'down' ? `Mark ${asset.asset_tag} not working?` : `Mark ${asset.asset_tag} working?`}
          description={dialog === 'down' ? 'It shows as not working until someone marks it working again. To get it fixed, use Report problem too.' : undefined}>
          <NoteField value={note} onChange={setNote} placeholder={dialog === 'down' ? "What's wrong with it" : 'What fixed it'} />
          {error && <p className="mt-3 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
          <Footer busy={busy} onClose={close}>
            <Button variant={dialog === 'down' ? 'danger' : 'primary'} onClick={() => void mark(dialog === 'down' ? 'offline' : 'online')} disabled={busy}>
              {busy && <Loader2 className="size-4 animate-spin" />} {dialog === 'down' ? 'Mark not working' : 'Mark working'}
            </Button>
          </Footer>
        </Modal>
      )}
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
