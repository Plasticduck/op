import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { LineChart, Plus } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { EmptyState } from '@/components/ui/EmptyState'
import { shortDate } from '@/lib/format'
import { useAuth } from '@/lib/auth'
import { useLocations } from '@/lib/locations'
import { marketResearch, customForms, type MarketResearch } from '@/lib/queries/opsSuite'
import { exportExcel, exportPdf, type ExportColumn } from '@/lib/opsExport'
import { OpsToolbar } from './OpsToolbar'
import { useOpsTable } from './useOpsTable'
import MarketResearchForm from './MarketResearchForm'
import {
  DEFAULT_MARKET_RESEARCH_SCHEMA,
  type MarketResearchSchema,
  type MarketResearchAnswers,
} from './marketResearchSchema'

type Row = MarketResearch & { location: { name: string } | null }

const EXPORT_COLUMNS: ExportColumn<Row>[] = [
  { header: 'Title', value: (r) => r.title },
  { header: 'Type', value: (r) => r.research_type },
  { header: 'Competitor', value: (r) => r.competitor_name },
  { header: 'Site', value: (r) => r.location?.name },
  { header: 'Source URL', value: (r) => r.source_url },
  { header: 'Submitted by', value: (r) => r.submitted_by_name },
  { header: 'Date', value: (r) => shortDate(r.created_at) },
]

export default function MarketResearchPage() {
  const { profile } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [schema, setSchema] = useState<MarketResearchSchema>(DEFAULT_MARKET_RESEARCH_SCHEMA)

  const load = () =>
    marketResearch.list().then(({ data }) => {
      setRows((data as unknown as Row[]) ?? [])
      setLoading(false)
    })
  useEffect(() => { void load() }, [])
  useEffect(() => {
    void customForms.get('market_research').then(({ data }) => {
      if (data?.schema) setSchema(data.schema as MarketResearchSchema)
    })
  }, [])
  const table = useOpsTable(rows, (r) => r.created_at)

  const canCustomize = profile?.role === 'owner' || profile?.role === 'manager'

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Market Research"
        subtitle="Competitor, pricing, and market intelligence by site."
        actions={<Button onClick={() => setAdding(true)}><Plus className="size-4" /> Add entry</Button>}
      />

      <div className="rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm text-ink"><span className="font-medium text-accent">New:</span> Open any research entry to attach the competitor's deals and have AI suggest counter-strategies using your sales + performance data.</div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-accent/30 bg-accent-soft px-3 py-2 text-sm">
        <p className="text-ink"><span className="font-medium text-accent">Tip:</span> You can customize this form for your wash's needs.</p>
        {canCustomize && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => alert('Custom builder for Market Research coming soon. The default form is in place.')}
          >
            Customize
          </Button>
        )}
      </div>

      <OpsToolbar
        range={table.range} onRange={table.setRange} sort={table.sort} onSort={table.setSort} count={table.rows.length}
        onExportPdf={() => exportPdf('Market Research', EXPORT_COLUMNS, table.rows)}
        onExportExcel={() => exportExcel('market-research', EXPORT_COLUMNS, table.rows)}
      />

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : table.rows.length === 0 ? (
        <EmptyState icon={LineChart} title="No research" description="Add a competitor research entry. After saving, attach the deals they're running and let AI suggest specific counters." action={<Button onClick={() => setAdding(true)}>Add competitor research</Button>} />
      ) : (
        <div className="overflow-x-auto rounded-md border border-border bg-card">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-content text-left text-xs uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-3 py-2.5 font-medium">Title</th>
                <th className="px-3 py-2.5 font-medium">Type</th>
                <th className="px-3 py-2.5 font-medium">Competitor</th>
                <th className="px-3 py-2.5 font-medium">Site</th>
                <th className="px-3 py-2.5 font-medium">Submitted by</th>
                <th className="px-3 py-2.5 font-medium">Date</th>
                <th className="px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {table.rows.map((r) => (
                <tr key={r.id} className="border-t border-border hover:bg-content">
                  <td className="px-3 py-2.5 font-medium text-ink">{r.title}</td>
                  <td className="px-3 py-2.5">{r.research_type ? <Badge tone="neutral">{r.research_type}</Badge> : '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.competitor_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.location?.name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{r.submitted_by_name ?? '—'}</td>
                  <td className="px-3 py-2.5 text-ink-muted">{shortDate(r.created_at)}</td>
                  <td className="px-3 py-2.5 text-right"><Link to={'/app/market-research/' + r.id} className="text-accent hover:underline text-sm">Open</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding && (
        <AddResearch
          accountId={profile?.account_id ?? ''}
          submitterId={profile?.id ?? null}
          submitterName={profile?.name ?? null}
          schema={schema}
          onClose={() => setAdding(false)}
          onSaved={() => { setAdding(false); void load() }}
        />
      )}
    </div>
  )
}

function AddResearch({ accountId, submitterId, submitterName, schema, onClose, onSaved }: {
  accountId: string
  submitterId: string | null
  submitterName: string | null
  schema: MarketResearchSchema
  onClose: () => void
  onSaved: () => void
}) {
  const { locations } = useLocations()
  const [locationId, setLocationId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (answers: MarketResearchAnswers) => {
    setError(null)
    const brand = ((answers['competitor_brand_name'] as Record<string, unknown> | undefined)?.value as string | undefined)?.trim() ?? ''
    if (!brand) {
      setError('Enter the competitor brand name')
      return
    }

    setBusy(true)
    const { error: err } = await marketResearch.create({
      account_id: accountId,
      location_id: locationId || null,
      title: `${brand} visit`,
      research_type: 'Competitor',
      competitor_name: brand,
      source_url: null,
      content: JSON.stringify(answers),
      submitted_by: submitterId,
      submitted_by_name: submitterName,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Add market research" size="lg">
      <div className="flex flex-col gap-4">
        <Field label="Site">
          {(id) => (
            <Select id={id} value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">— None —</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </Select>
          )}
        </Field>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <MarketResearchForm schema={schema} onSubmit={save} submitting={busy} />

        <div className="flex justify-end">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
        </div>
      </div>
    </Modal>
  )
}
