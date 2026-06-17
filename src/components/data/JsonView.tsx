// Renders arbitrary migrated JSONB (audit sections, evaluation answers) as a
// readable nested key/value tree — no raw braces in the UI.
function humanize(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

export function JsonView({ value }: { value: unknown }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-ink-subtle">—</span>
  }
  if (typeof value === 'boolean') return <span className="text-ink">{value ? 'Yes' : 'No'}</span>
  if (typeof value === 'number' || typeof value === 'string') {
    return <span className="whitespace-pre-wrap text-ink">{String(value)}</span>
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-ink-subtle">—</span>
    // Array of scalars → comma list; array of objects → stacked.
    if (value.every((v) => typeof v !== 'object' || v === null)) {
      return <span className="text-ink">{value.map((v) => String(v)).join(', ')}</span>
    }
    return (
      <div className="flex flex-col gap-2">
        {value.map((v, i) => (
          <div key={i} className="rounded border border-border p-2">
            <JsonView value={v} />
          </div>
        ))}
      </div>
    )
  }
  // object
  const entries = Object.entries(value as Record<string, unknown>)
  if (entries.length === 0) return <span className="text-ink-subtle">—</span>
  return (
    <dl className="flex flex-col gap-1.5">
      {entries.map(([k, v]) => (
        <div key={k} className="grid grid-cols-[minmax(8rem,12rem)_1fr] gap-2 text-sm">
          <dt className="text-ink-muted">{humanize(k)}</dt>
          <dd>
            <JsonView value={v} />
          </dd>
        </div>
      ))}
    </dl>
  )
}
