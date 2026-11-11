import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Field } from '@/components/forms/Field'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Modal } from '@/components/ui/Modal'
import { Select } from '@/components/ui/Select'
import { miEquipment, type MiArea } from '@/lib/queries/miEquipment'
import { useMi } from '../context'
import { errText } from '../format'
import { ErrorNote } from '../ui'
import { CRIT, STATUS } from './format'

// Changes to several machines at once, from the list's selection or one machine's menu.
// Each reports what changed in a sentence for the list's banner.

export type BulkKind = 'status' | 'zone' | 'crit' | 'site' | 'retire'

type Props = { kind: BulkKind; ids: string[]; label: string; areas: MiArea[]; onClose: () => void; onDone: (message: string) => void }

export function BulkDialog({ kind, ids, label, areas, onClose, onDone }: Props) {
  const { refs } = useMi()
  const [value, setValue] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Zone names in use anywhere, so "Dryers" is picked the same way at every site.
  const zoneNames = useMemo(() => [...new Set(areas.map((a) => a.name))].sort((a, b) => a.localeCompare(b)), [areas])

  const run = async () => {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'retire') {
        const r = await miEquipment.retire(ids, note)
        onDone(`Retired ${r.retired} (components included). They're under Status: Retired if you need them back.`)
      } else {
        const r = await miEquipment.bulk(ids, kind, value)
        onDone(r.changed === 0 ? 'Nothing needed changing.' : `Changed ${r.changed}.`)
      }
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const titles: Record<BulkKind, string> = {
    status: `Change status of ${label}`,
    zone: `Set the zone for ${label}`,
    crit: `Set criticality for ${label}`,
    site: `Move ${label} to another site`,
    retire: `Retire ${label}?`,
  }
  const ready = kind === 'retire' || kind === 'zone' || kind === 'crit' || !!value

  return (
    <Modal open onClose={onClose} title={titles[kind]} size="sm"
      description={kind === 'site' ? 'Components go with their machine. Zones carry over where the new site has one with the same name.'
        : kind === 'retire' ? 'Retired equipment leaves the lists and the tunnel diagram, with its components. Its history stays, and you can restore it.'
          : undefined}>
      <div className="flex flex-col gap-3">
        {kind === 'status' && (
          <Field label="Status">
            {(id) => (
              <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Pick one</option>
                {(['online', 'offline_planned', 'offline_unplanned'] as const).map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
              </Select>
            )}
          </Field>
        )}
        {kind === 'zone' && (
          <Field label="Zone" hint="Pick one, type a new one, or leave it empty to clear the zone.">
            {(id) => (
              <>
                <Input id={id} list="mi-zone-names" value={value} onChange={(e) => setValue(e.target.value)} placeholder="Dryers" />
                <datalist id="mi-zone-names">{zoneNames.map((z) => <option key={z} value={z} />)}</datalist>
              </>
            )}
          </Field>
        )}
        {kind === 'crit' && (
          <Field label="Criticality">
            {(id) => (
              <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Not set</option>
                {(['A', 'B', 'C'] as const).map((c) => <option key={c} value={c}>{CRIT[c].label}</option>)}
              </Select>
            )}
          </Field>
        )}
        {kind === 'site' && (
          <Field label="New site">
            {(id) => (
              <Select id={id} value={value} onChange={(e) => setValue(e.target.value)}>
                <option value="">Pick a site</option>
                {refs.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            )}
          </Field>
        )}
        {kind === 'retire' && (
          <Field label="Why (optional)">{(id) => <Input id={id} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Replaced with a new unit" />}</Field>
        )}
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant={kind === 'retire' ? 'danger' : 'primary'} disabled={busy || !ready} onClick={() => void run()}>
            {busy && <Loader2 className="size-4 animate-spin" />}
            {kind === 'retire' ? 'Retire' : kind === 'site' ? 'Move' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
