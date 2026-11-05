import { useEffect, useState } from 'react'
import { ScanLine, X } from 'lucide-react'
import { BarcodeScanner } from '@/components/scan/BarcodeScanner'
import { Button } from '@/components/ui/Button'
import { mi, type AssetRow, type PartListRow } from '@/lib/queries/maintenanceInventory'
import { primeScanSound } from '@/lib/scan/feedback'
import { errText } from '../inventory/format'
import { ErrorNote, SearchBox, useDebounced } from '../inventory/ui'
import type { AssetRef } from './context'

// Pick a machine at a site: type to search, or scan its MF-A sticker.
export function AssetPicker({ siteId, value, onChange, optional = true }: { siteId: string; value: AssetRef | null; onChange: (a: AssetRef | null) => void; optional?: boolean }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<AssetRow[]>([])
  const [scanning, setScanning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!dq.trim() || !siteId) return
    let alive = true
    void mi.assets(siteId, dq).then((r) => { if (alive) setRows(r.slice(0, 25)) }).catch((e) => { if (alive) setError(errText(e)) })
    return () => { alive = false }
  }, [dq, siteId])

  const scanned = async (raw: string) => {
    setScanning(false)
    try {
      const r = await mi.resolveScan(raw)
      if (r.kind !== 'asset') { setError(r.kind === 'other_site' ? r.message : 'That isn\'t a machine sticker.'); return }
      const d = await mi.assetDetail(r.id)
      if (d.hidden) { setError(d.message ?? 'That machine is at a site you can\'t see.'); return }
      if (siteId && d.asset.location_id !== siteId) { setError(`That's ${d.asset.name} at ${d.asset.site_name}, not this site.`); return }
      setError(null)
      onChange({ id: d.asset.id, name: d.asset.name, site_id: d.asset.location_id })
    } catch (e) {
      setError(errText(e))
    }
  }

  if (value) {
    return (
      <div className="flex min-h-11 items-center justify-between gap-2 rounded-lg border border-border bg-content px-3 py-2">
        <span className="min-w-0 truncate text-sm font-medium text-ink">{value.name}</span>
        {optional && <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}><X className="size-4" /> Change</Button>}
      </div>
    )
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-2">
        <SearchBox value={q} onChange={(v) => { setQ(v); if (!v.trim()) setRows([]) }} placeholder="Search this site's machines" className="min-w-0 flex-1" />
        <Button type="button" variant="secondary" onClick={() => { primeScanSound(); setScanning((s) => !s) }} aria-label="Scan a machine sticker"><ScanLine className="size-4" /> Scan</Button>
      </div>
      {scanning && <BarcodeScanner onDetect={scanned} className="h-56 rounded-lg" />}
      {error && <ErrorNote>{error}</ErrorNote>}
      {dq.trim() && rows.length === 0 && <p className="text-xs text-ink-muted">No machines match.</p>}
      {rows.length > 0 && (
        <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {rows.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { onChange({ id: r.id, name: r.name, site_id: siteId }); setQ(''); setRows([]) }}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-content">
                <span className="min-w-0 truncate text-ink">{r.name}</span>
                {r.area_name && <span className="shrink-0 text-xs text-ink-subtle">{r.area_name}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// Find a catalog part by name, SKU or part number.
export function PartSearch({ onPick, placeholder = 'Add a part: search by name or SKU', exclude = [] }: { onPick: (p: { id: string; name: string; uom: string | null }) => void; placeholder?: string; exclude?: string[] }) {
  const [q, setQ] = useState('')
  const dq = useDebounced(q)
  const [rows, setRows] = useState<PartListRow[]>([])
  useEffect(() => {
    if (!dq.trim()) return
    let alive = true
    void mi.parts({ q: dq, limit: 12 }).then((r) => { if (alive) setRows(r.rows) }).catch(() => {})
    return () => { alive = false }
  }, [dq])
  const shown = dq.trim() ? rows.filter((r) => !exclude.includes(r.id)) : []
  return (
    <div className="flex flex-col gap-1.5">
      <SearchBox value={q} onChange={(v) => { setQ(v); if (!v.trim()) setRows([]) }} placeholder={placeholder} />
      {shown.length > 0 && (
        <ul className="flex max-h-56 flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
          {shown.map((r) => (
            <li key={r.id}>
              <button type="button" onClick={() => { onPick({ id: r.id, name: r.name, uom: r.uom }); setQ(''); setRows([]) }}
                className="flex min-h-11 w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-content">
                <span className="min-w-0 truncate text-ink">{r.name}</span>
                <span className="shrink-0 text-xs text-ink-subtle">{r.sku ?? ''}{r.is_sample ? ' · sample' : ''}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function Textarea({ id, value, onChange, rows = 3, placeholder }: { id?: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string }) {
  return (
    <textarea id={id} value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder}
      className="w-full rounded-lg border border-border bg-content px-3 py-2 text-sm text-ink placeholder:text-ink-subtle" />
  )
}
