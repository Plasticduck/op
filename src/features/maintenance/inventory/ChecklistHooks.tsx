import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui/Button'
import { Modal } from '@/components/ui/Modal'
import { useAuth } from '@/lib/auth'
import { mi } from '@/lib/queries/maintenanceInventory'
import { MI_EMAILS } from './access'
import { errText } from './format'
import { ErrorNote, SearchBox, useDebounced } from './ui'

// The pieces of Maintenance Inventory that show on the Checklists pages, only for people
// on its access list. Everyone else's checklists look the same as before.

function useCanUse() {
  const { profile } = useAuth()
  return MI_EMAILS.includes((profile?.email ?? '').toLowerCase())
}

// On a checklist run: open a work order with the asset's parts as suggestions, and record
// parts used on the asset. Checklists have no pass or fail of their own, only the AI photo
// check, so a person can open one from any step and a failed photo check makes it stand out.
export function ChecklistItemActions({ instanceId, itemId, hasAsset, failed }: { instanceId: string; itemId: string; hasAsset: boolean; failed: boolean }) {
  const can = useCanUse()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  if (!can) return null
  const run = async (work: () => Promise<string>) => {
    setBusy(true)
    setError(null)
    try {
      navigate(await work())
    } catch (e) {
      setError(errText(e))
      setBusy(false)
    }
  }
  const openWorkOrder = () => run(async () => {
    const r = await mi.workOrderFromChecklist(instanceId, itemId)
    return `/app/maintenance-inventory/work-orders/${r.work_order_id}`
  })
  const partsUsed = () => run(async () => {
    const asset = await mi.checklistAsset(instanceId, itemId)
    return asset ? `/app/maintenance-inventory?asset=${asset}&source=checklist` : '/app/maintenance-inventory?source=checklist'
  })
  return (
    <div className="ml-2 flex flex-wrap items-center gap-2 sm:ml-7">
      {failed
        ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => void openWorkOrder()}>Open a work order</Button>
        : <button type="button" disabled={busy} className="min-h-8 text-xs text-ink-muted hover:text-ink hover:underline" onClick={() => void openWorkOrder()}>Problem? Open a work order</button>}
      {hasAsset && <button type="button" disabled={busy} className="min-h-8 text-xs text-accent hover:underline" onClick={() => void partsUsed()}>Parts used</button>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </div>
  )
}

// On a checklist template: which asset this step inspects.
export function ChecklistItemAsset({ itemId, assetId, onChanged }: { itemId: string; assetId: string | null; onChanged: () => void }) {
  const can = useCanUse()
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<Array<{ id: string; name: string; site_name: string }>>([])
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open || !dq.trim()) return
    let alive = true
    void mi.searchAssets(dq).then((r) => { if (alive) setRows(r) }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [dq, open])
  if (!can) return null
  const pick = async (id: string | null) => {
    try {
      await mi.setChecklistItemAsset(itemId, id)
      setOpen(false)
      onChanged()
    } catch (e) {
      setError(errText(e))
    }
  }
  return (
    <>
      <button type="button" className="inline-flex shrink-0 items-center rounded-md border border-border px-2 py-1 text-xs text-ink-muted hover:text-ink" onClick={() => setOpen(true)}>
        {assetId ? 'Asset linked' : 'Link asset'}
      </button>
      {open && (
        <Modal open onClose={() => setOpen(false)} title="Which asset does this step inspect?" description="A problem on this step opens a work order with this asset's parts list. At other sites, their asset of the same type is used.">
          <div className="flex flex-col gap-2">
            <SearchBox value={q} onChange={setQ} placeholder="Find equipment" />
            {error && <ErrorNote>{error}</ErrorNote>}
            {dq.trim() && rows.map((r) => (
              <button key={r.id} type="button" onClick={() => void pick(r.id)} className="flex min-h-11 items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-left text-sm hover:bg-content">
                <span className="truncate text-ink">{r.name}</span>
                <span className="shrink-0 text-xs text-ink-subtle">{r.site_name}</span>
              </button>
            ))}
            {assetId && <Button variant="ghost" onClick={() => void pick(null)}>Remove the link</Button>}
          </div>
        </Modal>
      )}
    </>
  )
}
