import { useEffect, useState } from 'react'
import { Bot, Info } from 'lucide-react'
import { dateTime } from '@/lib/format'
import { fpa, type FpaVersion } from '@/lib/queries/fpa'

// Where the numbers come from, the model's own definitions, and who can read
// the model through Operator AI.
export function About({ version }: { version: FpaVersion }) {
  const [readers, setReaders] = useState<string[] | null>(null)
  useEffect(() => {
    let alive = true
    fpa.readers().then((r) => { if (alive) setReaders(r) }).catch(() => { if (alive) setReaders([]) })
    return () => { alive = false }
  }, [])
  const counts = version.row_counts ?? {}
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <div className="rounded-md border border-border bg-card p-4 text-sm">
        <h2 className="flex items-center gap-1.5 font-semibold text-ink"><Info className="size-4" /> About this model</h2>
        <p className="mt-1 text-ink-muted">
          {version.info.subtitle ?? version.label}. Loaded from <span className="text-ink">{version.file_name ?? version.label}</span>
          {version.loaded_by_name ? ` by ${version.loaded_by_name}` : ''} on {dateTime(version.activated_at ?? version.loaded_at)}.
          The figures are the workbook’s own results ({(counts.metrics ?? 0).toLocaleString()} engine values, {(counts.pl_lines ?? 0).toLocaleString()} QuickBooks lines), not live QuickBooks.
        </p>
        {!!version.info.definitions?.length && (
          <dl className="mt-3 space-y-1.5">
            {version.info.definitions.map((d) => (
              <div key={d.label}>
                <dt className="font-medium text-ink">{d.label}</dt>
                <dd className="text-ink-muted">{d.text}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <div className="flex flex-col gap-4">
        <div className="rounded-md border border-border bg-card p-4 text-sm">
          <h2 className="flex items-center gap-1.5 font-semibold text-ink"><Bot className="size-4" /> Operator AI access</h2>
          <p className="mt-1 text-ink-muted">This page is yours only. Operator AI answers questions from the model for these logins and nobody else:</p>
          <ul className="mt-2 flex flex-wrap gap-1.5">
            {(readers ?? []).map((r) => <li key={r} className="rounded-md bg-content px-2 py-0.5 text-xs text-ink">{r}</li>)}
          </ul>
        </div>
        {!!version.info.data_notes?.length && (
          <div className="rounded-md border border-border bg-card p-4 text-sm">
            <h2 className="font-semibold text-ink">Data notes from the workbook</h2>
            <dl className="mt-2 space-y-1.5">
              {version.info.data_notes.map((d) => (
                <div key={d.label}>
                  <dt className="font-medium text-ink">{d.label}</dt>
                  <dd className="text-ink-muted">{d.text}</dd>
                </div>
              ))}
            </dl>
          </div>
        )}
      </div>
    </section>
  )
}
