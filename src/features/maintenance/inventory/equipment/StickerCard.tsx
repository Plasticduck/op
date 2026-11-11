import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Row, Section } from '@/features/it/inventory/DetailParts'
import { parseScan } from '@/features/it/inventory/scan'
import { miEquipment, type EquipmentDetail, type TagCondition } from '@/lib/queries/miEquipment'
import { cn } from '@/lib/utils'
import { useMi } from '../context'
import { day, errText } from '../format'
import { TAG_CONDITION } from './format'

// A machine's sticker: its code, when it was printed, whether it can still be read, and
// putting a new one on (a blank from the roll) when it can't.

export function StickerCard({ d, reload }: { d: EquipmentDetail; reload: () => void }) {
  const { notify } = useMi()
  const a = d.asset
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const condition = a.tag_condition

  const mark = async (c: TagCondition) => {
    if (!a.tag) return
    try {
      await miEquipment.setTagCondition([a.tag], c)
      notify(c === 'ok' ? 'Sticker checked.' : `Marked ${TAG_CONDITION[c].label.toLowerCase()}. It's in the print queue.`)
      reload()
    } catch (e) {
      notify(errText(e), 'danger')
    }
  }
  const claim = async (replace: boolean) => {
    const tag = parseScan(code)?.tag ?? code.trim().toUpperCase()
    if (!tag) return
    setBusy(true)
    try {
      const r = await miEquipment.claimTag(tag, a.id, replace)
      notify(r.replaced ? `${r.code} is on now; ${r.replaced} is retired.` : `${r.code} is on this machine now.`)
      setCode('')
      setConfirm(null)
      reload()
    } catch (e) {
      const m = errText(e)
      if (/Replace it\?$/.test(m)) setConfirm(m)
      else notify(m, 'danger')
    } finally {
      setBusy(false)
    }
  }

  if (a.parent_asset_id && !a.tag) return null
  return (
    <Section title="Sticker">
      <Row label="Tag" mono>{a.tag ?? <span className="font-sans text-ink-subtle">None yet. Print one, or put a blank on below.</span>}</Row>
      {a.tag && <Row label="Printed">{a.tag_printed_count ? `${a.tag_printed_count} time${a.tag_printed_count === 1 ? '' : 's'}, last ${day(a.tag_last_printed_at)}` : 'Not yet'}</Row>}
      {a.tag && (
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2.5">
          <span className="mr-1 w-32 shrink-0 text-sm text-ink-muted">Can you read it?</span>
          {(Object.keys(TAG_CONDITION) as TagCondition[]).map((c) => (
            <button key={c} type="button" onClick={() => void mark(c)}
              className={cn('rounded-full border px-2.5 py-1 text-xs font-medium transition',
                condition === c ? (TAG_CONDITION[c].tone === 'ok' ? 'border-ok bg-ok-soft text-ok' : TAG_CONDITION[c].tone === 'warn' ? 'border-warn bg-warn-soft text-warn' : 'border-danger bg-danger-soft text-danger')
                  : 'border-border text-ink-muted hover:text-ink')}>
              {TAG_CONDITION[c].label}
            </button>
          ))}
        </div>
      )}
      {a.status !== 'retired' && (
        <form className="flex flex-wrap items-center gap-2 px-3 py-2.5" onSubmit={(e) => { e.preventDefault(); void claim(false) }}>
          <span className="w-32 shrink-0 text-sm text-ink-muted">{a.tag ? 'New sticker' : 'Blank sticker'}</span>
          <Input value={code} onChange={(e) => { setCode(e.target.value); setConfirm(null) }} placeholder="MF-A-00123" autoCapitalize="characters" className="h-9 max-w-[180px] font-mono" />
          <Button type="submit" size="sm" variant="secondary" disabled={busy || !code.trim()}>{busy && <Loader2 className="size-3.5 animate-spin" />} Put it on</Button>
          {confirm && (
            <div className="flex w-full flex-wrap items-center gap-2 rounded-md bg-warn-soft px-3 py-2 text-sm text-warn">
              <span className="flex-1">{confirm} The old one will be retired and can't be used again.</span>
              <Button type="button" size="sm" onClick={() => void claim(true)}>Replace it</Button>
            </div>
          )}
        </form>
      )}
    </Section>
  )
}
