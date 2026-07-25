import { useState } from 'react'
import { Download, FileText, Loader2 } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useCompany } from '@/lib/company'
import { downloadReportPdf } from '@/features/ask/reportPdf'
import type { ReportSpec } from '@/lib/queries/askOperator'

// The hand-off card for an AI-built report. Shows what the report contains and
// a button that renders and downloads the branded PDF on demand.
export function ReportCard({ spec }: { spec: ReportSpec }) {
  const { profile } = useAuth()
  const { name: accountName } = useCompany()
  const [busy, setBusy] = useState(false)

  const tableCount = spec.sections?.filter((s) => s.type === 'table').length ?? 0
  const summary = [
    `${spec.sections?.length ?? 0} section${spec.sections?.length === 1 ? '' : 's'}`,
    tableCount > 0 ? `${tableCount} table${tableCount === 1 ? '' : 's'}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  const download = async () => {
    setBusy(true)
    try {
      await downloadReportPdf(spec, {
        brandLogoUrl: profile?.brand_logo_url ?? null,
        accountName: accountName || undefined,
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex items-center gap-3 rounded-2xl border border-border bg-gradient-to-b from-card to-content p-3.5">
      <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent">
        <FileText className="size-5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[14px] font-semibold text-ink">{spec.title}</div>
        <div className="truncate text-[12px] text-ink-muted">
          {spec.subtitle ? `${spec.subtitle} · ` : ''}
          {summary}
        </div>
      </div>
      <button
        type="button"
        onClick={() => void download()}
        disabled={busy}
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-3.5 py-2 text-[13px] font-medium text-white transition hover:bg-accent-hover active:scale-95 disabled:opacity-60"
      >
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Download className="size-4" />}
        {busy ? 'Preparing…' : 'Download PDF'}
      </button>
    </div>
  )
}
