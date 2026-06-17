import { useState } from 'react'
import { Download, FileSpreadsheet, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { Field } from '@/components/forms/Field'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'
import { subDays, format } from 'date-fns'

type Dataset = 'work-orders' | 'assets' | 'parts' | 'vendors' | 'time-tracking'
const DATASETS: Array<{ key: Dataset; label: string }> = [
  { key: 'work-orders', label: 'Work Orders' },
  { key: 'assets', label: 'Assets' },
  { key: 'parts', label: 'Parts' },
  { key: 'vendors', label: 'Vendors' },
  { key: 'time-tracking', label: 'Time & Cost Tracking' },
]

export function ExportDataTab() {
  const [ds, setDs] = useState<Dataset>('work-orders')
  const [from, setFrom] = useState(format(subDays(new Date(), 30), 'yyyy-MM-dd'))
  const [to, setTo] = useState(format(new Date(), 'yyyy-MM-dd'))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastDownload, setLastDownload] = useState<{ rows: number; file: string } | null>(null)

  // Optional WO-only filters from the screenshot
  const [includePlanned, setIncludePlanned] = useState(true)
  const [includeDue, setIncludeDue] = useState(true)
  const [includeCompleted, setIncludeCompleted] = useState(true)

  const exportNow = async () => {
    setBusy(true)
    setError(null)
    setLastDownload(null)
    try {
      const { rows, headers, file } = await fetchDataset(ds, { from, to, includePlanned, includeDue, includeCompleted })
      downloadCsv(file, headers, rows)
      setLastDownload({ rows: rows.length, file })
    } catch (e) {
      setError((e as Error).message ?? 'Export failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      {/* Dataset picker */}
      <aside className="lg:w-64 lg:shrink-0">
        <div className="overflow-hidden rounded-md border border-border bg-card">
          {DATASETS.map((d) => (
            <button
              key={d.key}
              type="button"
              onClick={() => setDs(d.key)}
              className={cn(
                'flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-left text-sm last:border-0',
                ds === d.key ? 'bg-accent-soft font-semibold text-accent' : 'text-ink hover:bg-content',
              )}
            >
              <FileSpreadsheet className="size-4" /> {d.label}
            </button>
          ))}
        </div>
      </aside>

      {/* Export form */}
      <section className="flex-1 rounded-md border border-border bg-card p-4">
        <h2 className="mb-4 text-lg font-semibold text-ink">
          Export {DATASETS.find((d) => d.key === ds)?.label}
        </h2>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="From">{(id) => <Input id={id} type="date" value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
          <Field label="To">{(id) => <Input id={id} type="date" value={to} onChange={(e) => setTo(e.target.value)} />}</Field>
        </div>

        <div className="mt-4">
          <div className="mb-2 text-sm font-medium text-ink">Export Format</div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="radio" checked readOnly /> CSV (Excel)
          </label>
        </div>

        {ds === 'work-orders' && (
          <div className="mt-4 flex flex-col gap-1.5">
            <div className="mb-1 text-sm font-medium text-ink">Work Orders to include in this date range</div>
            <Check label="Planned or Created" checked={includePlanned} onChange={setIncludePlanned} />
            <Check label="Due" checked={includeDue} onChange={setIncludeDue} />
            <Check label="Completed" checked={includeCompleted} onChange={setIncludeCompleted} />
          </div>
        )}

        {error && <p className="mt-4 rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
        {lastDownload && (
          <p className="mt-4 rounded-md bg-ok-soft px-3 py-2 text-sm text-ok">
            Exported {lastDownload.rows} row{lastDownload.rows === 1 ? '' : 's'} to {lastDownload.file}
          </p>
        )}

        <div className="mt-6 flex justify-end">
          <Button onClick={() => void exportNow()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
            Download CSV
          </Button>
        </div>
      </section>
    </div>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-ink">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-accent" /> {label}
    </label>
  )
}

// ---- Dataset queries ----------------------------------------------------

type ExportOpts = {
  from: string
  to: string
  includePlanned: boolean
  includeDue: boolean
  includeCompleted: boolean
}

async function fetchDataset(ds: Dataset, opts: ExportOpts): Promise<{ headers: string[]; rows: string[][]; file: string }> {
  const stamp = format(new Date(), 'yyyy-MM-dd')
  const fromIso = new Date(opts.from).toISOString()
  const toIso = new Date(opts.to + 'T23:59:59').toISOString()

  if (ds === 'work-orders') {
    const { data } = await supabase
      .from('work_orders')
      .select(`
        number, title, status, priority, work_type, recurrence,
        created_at, due_at, completed_at,
        location:locations(name),
        equipment:equipment(name)
      `)
      .gte('created_at', fromIso).lte('created_at', toIso)
      .order('number')
    const rows = (data ?? []).map((w) => {
      const wo = w as Record<string, unknown>
      const loc = wo.location as { name: string } | null
      const eq = wo.equipment as { name: string } | null
      return [
        '#' + String(wo.number),
        String(wo.title ?? ''),
        String(wo.status ?? ''),
        String(wo.priority ?? ''),
        String(wo.work_type ?? ''),
        String(wo.recurrence ?? ''),
        wo.created_at ? format(new Date(wo.created_at as string), 'yyyy-MM-dd HH:mm') : '',
        wo.due_at ? format(new Date(wo.due_at as string), 'yyyy-MM-dd') : '',
        wo.completed_at ? format(new Date(wo.completed_at as string), 'yyyy-MM-dd HH:mm') : '',
        loc?.name ?? '',
        eq?.name ?? '',
      ]
    })
    return {
      headers: ['Number', 'Title', 'Status', 'Priority', 'Work Type', 'Recurrence', 'Created', 'Due', 'Completed', 'Location', 'Asset'],
      rows,
      file: `work-orders-${stamp}.csv`,
    }
  }

  if (ds === 'assets') {
    const { data } = await supabase
      .from('equipment')
      .select('asset_number, name, type, status, criticality, qr_code, manufacturer, model, serial_number, location:locations(name)')
      .order('asset_number')
    const rows = (data ?? []).map((a) => {
      const x = a as Record<string, unknown>
      const loc = x.location as { name: string } | null
      return [
        '#' + String(x.asset_number),
        String(x.name ?? ''),
        String(x.type ?? ''),
        String(x.status ?? ''),
        String(x.criticality ?? ''),
        String(x.qr_code ?? ''),
        String(x.manufacturer ?? ''),
        String(x.model ?? ''),
        String(x.serial_number ?? ''),
        loc?.name ?? '',
      ]
    })
    return {
      headers: ['Number', 'Name', 'Type', 'Status', 'Criticality', 'QR Code', 'Manufacturer', 'Model', 'Serial Number', 'Location'],
      rows,
      file: `assets-${stamp}.csv`,
    }
  }

  if (ds === 'parts') {
    const { data } = await supabase
      .from('parts')
      .select('part_number, name, sku, uom, unit_cost, lead_time_days, ordering_part_number, qr_code, vendor:vendors(name), stock:parts_inventory(quantity_on_hand, minimum_in_stock)')
      .order('part_number')
    const rows = (data ?? []).map((p) => {
      const x = p as Record<string, unknown>
      const stock = x.stock as Array<{ quantity_on_hand: number; minimum_in_stock: number }> | null
      const total = stock?.reduce((a, s) => a + Number(s.quantity_on_hand), 0) ?? 0
      const min = stock?.reduce((a, s) => a + Number(s.minimum_in_stock), 0) ?? 0
      const vendor = x.vendor as { name: string } | null
      return [
        '#' + String(x.part_number),
        String(x.name ?? ''),
        String(x.sku ?? ''),
        String(x.uom ?? ''),
        x.unit_cost != null ? String(x.unit_cost) : '',
        x.lead_time_days != null ? String(x.lead_time_days) : '',
        String(x.ordering_part_number ?? ''),
        String(x.qr_code ?? ''),
        vendor?.name ?? '',
        String(total),
        String(min),
      ]
    })
    return {
      headers: ['Number', 'Name', 'SKU', 'UOM', 'Unit Cost', 'Lead Time (Days)', 'Ordering Part Number', 'QR Code', 'Vendor', 'Total Stock', 'Total Minimum'],
      rows,
      file: `parts-${stamp}.csv`,
    }
  }

  if (ds === 'vendors') {
    const { data } = await supabase.from('vendors').select('name, kind, email, phone, address, website').order('name')
    const rows = (data ?? []).map((v) => {
      const x = v as Record<string, unknown>
      return [
        String(x.name ?? ''),
        String(x.kind ?? ''),
        String(x.email ?? ''),
        String(x.phone ?? ''),
        String(x.address ?? ''),
        String(x.website ?? ''),
      ]
    })
    return {
      headers: ['Name', 'Kind', 'Email', 'Phone', 'Address', 'Website'],
      rows,
      file: `vendors-${stamp}.csv`,
    }
  }

  // time-tracking
  const { data } = await supabase
    .from('work_order_time_entries')
    .select('user_name, minutes, hourly_rate, notes, created_at, work_order:work_orders(number, title)')
    .gte('created_at', fromIso).lte('created_at', toIso)
    .order('created_at', { ascending: false })
  const rows = (data ?? []).map((t) => {
    const x = t as Record<string, unknown>
    const wo = x.work_order as { number: number; title: string } | null
    return [
      wo ? '#' + wo.number : '',
      wo?.title ?? '',
      String(x.user_name ?? ''),
      String(x.minutes ?? ''),
      x.hourly_rate != null ? String(x.hourly_rate) : '',
      String(x.notes ?? ''),
      x.created_at ? format(new Date(x.created_at as string), 'yyyy-MM-dd HH:mm') : '',
    ]
  })
  return {
    headers: ['WO Number', 'WO Title', 'Worked By', 'Minutes', 'Hourly Rate', 'Notes', 'Logged At'],
    rows,
    file: `time-tracking-${stamp}.csv`,
  }
}

function downloadCsv(filename: string, headers: string[], rows: string[][]) {
  const escape = (s: string) => {
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) {
      return '"' + s.replace(/"/g, '""') + '"'
    }
    return s
  }
  const csv = [
    headers.map(escape).join(','),
    ...rows.map((r) => r.map(escape).join(',')),
  ].join('\n')
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
