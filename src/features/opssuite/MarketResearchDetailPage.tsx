import { useCallback, useEffect, useRef, useState } from 'react'
import {
  ArrowLeft,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Sparkles,
  Tag,
  Trash2,
  X,
} from 'lucide-react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { Modal } from '@/components/ui/Modal'
import { Input } from '@/components/ui/Input'
import { Select } from '@/components/ui/Select'
import { Field } from '@/components/forms/Field'
import { AttachmentViewer } from '@/components/data/AttachmentViewer'
import { shortDate, dateTime, currency } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import {
  marketResearch,
  marketResearchDeals,
  marketResearchSuggestions,
  type MarketResearch,
  type MarketResearchDeal,
  type MarketResearchSuggestion,
} from '@/lib/queries/opsSuite'

type ResearchWithLocation = MarketResearch & { location: { name: string } | null }

type BadgeTone = 'neutral' | 'accent' | 'ok' | 'warn' | 'danger'

const SEVERITY_TONE: Record<string, BadgeTone> = {
  info: 'accent',
  warning: 'warn',
  critical: 'danger',
}

const OFFER_TYPES = [
  'Monthly membership',
  'Single wash',
  'Bundle',
  'Promo',
  'Other',
] as const

type PendingFile = { id: string; file: File }

function fileToDataUri(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = reject
    r.readAsDataURL(file)
  })
}

function parseContent(content: string | null): Record<string, unknown> | null {
  if (!content) return null
  try {
    const parsed = JSON.parse(content)
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
    return null
  } catch {
    return null
  }
}

function renderAnswerValue(v: unknown): string {
  if (v == null) return ''
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return v.map(renderAnswerValue).filter(Boolean).join(', ')
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>
    if ('value' in obj) return renderAnswerValue(obj.value)
    return JSON.stringify(obj)
  }
  return String(v)
}

export default function MarketResearchDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { profile } = useAuth()
  const [research, setResearch] = useState<ResearchWithLocation | null>(null)
  const [deals, setDeals] = useState<MarketResearchDeal[]>([])
  const [suggestions, setSuggestions] = useState<MarketResearchSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [analyzing, setAnalyzing] = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [editingDeal, setEditingDeal] = useState<MarketResearchDeal | null>(null)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    const [r, d, s] = await Promise.all([
      marketResearch.get(id),
      marketResearchDeals.forResearch(id),
      marketResearchSuggestions.forResearch(id),
    ])
    setResearch((r.data as ResearchWithLocation | null) ?? null)
    setDeals((d.data as MarketResearchDeal[]) ?? [])
    setSuggestions((s.data as MarketResearchSuggestion[]) ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const analyze = async () => {
    if (!id) return
    setAnalyzing(true)
    setAnalyzeError(null)
    const { data, error } = await supabase.functions.invoke('analyze-market-deals', {
      body: { market_research_id: id },
    })
    setAnalyzing(false)
    if (error) {
      setAnalyzeError(error.message ?? 'Analysis failed.')
      return
    }
    if ((data as { error?: string } | null)?.error === 'no_key') {
      setAnalyzeError('AI is not configured yet (ANTHROPIC_API_KEY is unset).')
      return
    }
    void load()
  }

  const acknowledge = async (suggestionId: string) => {
    if (!profile) return
    await marketResearchSuggestions.acknowledge(suggestionId, profile.id)
    const stamp = new Date().toISOString()
    setSuggestions((prev) =>
      prev.map((s) =>
        s.id === suggestionId
          ? { ...s, acknowledged_at: stamp, acknowledged_by: profile.id }
          : s,
      ),
    )
  }

  const removeDeal = async (deal: MarketResearchDeal) => {
    if (!confirm(`Delete "${deal.title}"?`)) return
    await marketResearchDeals.remove(deal.id)
    setDeals((prev) => prev.filter((d) => d.id !== deal.id))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-ink-muted">
        <Loader2 className="size-5 animate-spin" />
      </div>
    )
  }

  if (!research) {
    return (
      <EmptyState
        icon={ArrowLeft}
        title="Research not found"
        description="It may have been deleted."
        action={
          <Link to="/app/market-research">
            <Button>Back to market research</Button>
          </Link>
        }
      />
    )
  }

  const parsedContent = parseContent(research.content)
  const heading = research.competitor_name ?? research.title
  const showSeparateTitle = research.competitor_name && research.title && research.competitor_name !== research.title
  const subtitle = [research.research_type, research.location?.name].filter(Boolean).join(' . ')

  return (
    <div className="flex flex-col gap-6">
      <Link
        to="/app/market-research"
        className="inline-flex items-center gap-1.5 text-sm text-ink-muted hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Back to market research
      </Link>

      <PageHeader
        title={heading}
        subtitle={subtitle || undefined}
        actions={
          <Button variant="secondary" onClick={() => void analyze()} disabled={analyzing}>
            <Sparkles className={cn('size-4', analyzing && 'animate-spin')} />
            {analyzing ? 'Analyzing' : 'Analyze with AI'}
          </Button>
        }
      />

      {analyzeError && (
        <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{analyzeError}</p>
      )}

      <section className="flex flex-col gap-3 rounded-md border border-border bg-card p-4">
        {showSeparateTitle && (
          <h2 className="text-base font-semibold text-ink">{research.title}</h2>
        )}
        {research.location?.name && (
          <p className="text-sm text-ink-muted">Site: {research.location.name}</p>
        )}
        {research.source_url && (
          <a
            href={research.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
          >
            <ExternalLink className="size-3.5" /> {research.source_url}
          </a>
        )}
        {parsedContent ? (
          <details className="rounded-md border border-border bg-content/40 p-2">
            <summary className="cursor-pointer text-xs font-medium text-ink-muted hover:text-ink">
              Notes from form
            </summary>
            <dl className="mt-2 grid grid-cols-1 gap-1.5 text-sm sm:grid-cols-[max-content_1fr] sm:gap-x-3">
              {Object.entries(parsedContent).map(([key, value]) => {
                const rendered = renderAnswerValue(value)
                if (!rendered) return null
                return (
                  <div key={key} className="contents">
                    <dt className="text-xs font-medium uppercase tracking-wide text-ink-muted">{key}</dt>
                    <dd className="whitespace-pre-wrap text-ink">{rendered}</dd>
                  </div>
                )
              })}
            </dl>
          </details>
        ) : (
          research.content && (
            <p className="whitespace-pre-wrap text-sm text-ink">{research.content}</p>
          )
        )}
        <p className="text-xs text-ink-subtle">
          Submitted by {research.submitted_by_name ?? 'Unknown'} at {dateTime(research.created_at)}
        </p>
        <AttachmentViewer entityType="market_research" entityId={research.id} />
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">Deals</h2>
          {deals.length > 0 && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" /> Add deal
            </Button>
          )}
        </div>
        {deals.length === 0 ? (
          <EmptyState
            icon={Tag}
            title="No deals captured yet"
            description="Add the competitor's promotional offers so the AI can suggest specific counters."
            action={<Button onClick={() => setAdding(true)}>Add deal</Button>}
          />
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {deals.map((deal) => (
              <div key={deal.id} className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
                <div className="flex items-start justify-between gap-2">
                  <strong className="text-sm text-ink">{deal.title}</strong>
                  {deal.offer_type && <Badge tone="neutral">{deal.offer_type}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2 text-sm text-ink">
                  {deal.price != null && <span>{currency(deal.price)}</span>}
                  {deal.expires_at && (
                    <Badge tone="warn">expires {shortDate(deal.expires_at)}</Badge>
                  )}
                </div>
                {deal.details && (
                  <p className="whitespace-pre-wrap text-sm text-ink-muted">{deal.details}</p>
                )}
                {deal.source_url && (
                  <a
                    href={deal.source_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                  >
                    <ExternalLink className="size-3.5" /> Source
                  </a>
                )}
                <AttachmentViewer entityType="market_research_deal" entityId={deal.id} />
                <div className="mt-1 flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditingDeal(deal)}>
                    Edit
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => void removeDeal(deal)}>
                    <Trash2 className="size-3.5" /> Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-ink-muted">
          AI suggestions
        </h2>
        {suggestions.length === 0 ? (
          <p className="text-sm text-ink-muted">
            Click Analyze with AI to generate counter-strategies based on these deals and your wash's sales data.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {suggestions.map((s) => {
              const tone = SEVERITY_TONE[s.severity] ?? 'neutral'
              return (
                <div
                  key={s.id}
                  className={cn(
                    'rounded-md border border-border bg-card p-3',
                    s.acknowledged_at && 'opacity-60',
                  )}
                >
                  <div className="mb-1 flex items-center justify-between">
                    <Badge tone={tone}>{s.severity}</Badge>
                    {!s.acknowledged_at && (
                      <Button variant="ghost" size="sm" onClick={() => void acknowledge(s.id)}>
                        Mark seen
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-ink">{s.suggestion_text}</p>
                  <p className="mt-2 text-xs text-ink-subtle">
                    {dateTime(s.generated_at)}
                    {s.model ? ` . ${s.model}` : ''}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {adding && id && profile && (
        <AddDealModal
          accountId={profile.account_id}
          researchId={id}
          createdBy={profile.id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false)
            void load()
          }}
        />
      )}

      {editingDeal && (
        <EditDealModal
          deal={editingDeal}
          onClose={() => setEditingDeal(null)}
          onSaved={() => {
            setEditingDeal(null)
            void load()
          }}
        />
      )}
    </div>
  )
}

type DealFormState = {
  title: string
  offerType: string
  price: string
  expiresAt: string
  sourceUrl: string
  details: string
}

function emptyFormState(): DealFormState {
  return { title: '', offerType: '', price: '', expiresAt: '', sourceUrl: '', details: '' }
}

function fromDeal(deal: MarketResearchDeal): DealFormState {
  return {
    title: deal.title,
    offerType: deal.offer_type ?? '',
    price: deal.price != null ? String(deal.price) : '',
    expiresAt: deal.expires_at ?? '',
    sourceUrl: deal.source_url ?? '',
    details: deal.details ?? '',
  }
}

function DealFormFields({
  state,
  setState,
}: {
  state: DealFormState
  setState: (next: DealFormState) => void
}) {
  return (
    <>
      <Field label="Deal title" required>
        {(id) => (
          <Input
            id={id}
            value={state.title}
            onChange={(e) => setState({ ...state, title: e.target.value })}
            placeholder="Unlimited Shine"
          />
        )}
      </Field>
      <Field label="Offer type">
        {(id) => (
          <Select
            id={id}
            value={state.offerType}
            onChange={(e) => setState({ ...state, offerType: e.target.value })}
          >
            <option value="">— None —</option>
            {OFFER_TYPES.map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </Select>
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Price">
          {(id) => (
            <Input
              id={id}
              type="number"
              step="0.01"
              inputMode="decimal"
              value={state.price}
              onChange={(e) => setState({ ...state, price: e.target.value })}
              placeholder="29.99"
            />
          )}
        </Field>
        <Field label="Expires on">
          {(id) => (
            <Input
              id={id}
              type="date"
              value={state.expiresAt}
              onChange={(e) => setState({ ...state, expiresAt: e.target.value })}
            />
          )}
        </Field>
      </div>
      <Field label="Source URL">
        {(id) => (
          <Input
            id={id}
            type="url"
            value={state.sourceUrl}
            onChange={(e) => setState({ ...state, sourceUrl: e.target.value })}
            placeholder="https://"
          />
        )}
      </Field>
      <Field label="Details">
        {(id) => (
          <textarea
            id={id}
            value={state.details}
            onChange={(e) => setState({ ...state, details: e.target.value })}
            rows={3}
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-subtle focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="Anything else worth noting."
          />
        )}
      </Field>
    </>
  )
}

function AddDealModal({
  accountId,
  researchId,
  createdBy,
  onClose,
  onSaved,
}: {
  accountId: string
  researchId: string
  createdBy: string
  onClose: () => void
  onSaved: () => void
}) {
  const [state, setState] = useState<DealFormState>(emptyFormState)
  const [pending, setPending] = useState<PendingFile[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addFiles = (list: FileList | null) => {
    if (!list) return
    const next: PendingFile[] = []
    for (let i = 0; i < list.length; i++) {
      next.push({ id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2)}`, file: list[i]! })
    }
    setPending((prev) => [...prev, ...next])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const removePending = (id: string) => setPending((prev) => prev.filter((p) => p.id !== id))

  const save = async () => {
    const title = state.title.trim()
    if (!title) {
      setError('Enter a deal title.')
      return
    }
    setError(null)
    setBusy(true)
    const priceNum = state.price.trim() === '' ? null : Number(state.price)
    const { data, error: err } = await marketResearchDeals.create({
      account_id: accountId,
      market_research_id: researchId,
      title,
      offer_type: state.offerType || null,
      price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
      expires_at: state.expiresAt || null,
      source_url: state.sourceUrl.trim() || null,
      details: state.details.trim() || null,
      created_by: createdBy,
    })
    if (err || !data) {
      setBusy(false)
      setError(err?.message ?? 'Failed to save deal.')
      return
    }
    const dealId = data.id
    for (const pf of pending) {
      try {
        const uri = await fileToDataUri(pf.file)
        await supabase.from('ops_attachments').insert({
          account_id: accountId,
          entity_type: 'market_research_deal',
          entity_id: dealId,
          file_name: pf.file.name,
          file_type: pf.file.type || null,
          data_uri: uri,
          label: null,
        })
      } catch {
        // continue; one bad file shouldn't block the rest
      }
    }
    setBusy(false)
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Add deal" size="lg">
      <div className="flex flex-col gap-4">
        <DealFormFields state={state} setState={setState} />

        <Field label="Add photo or PDF">
          {() => (
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*,application/pdf"
                multiple
                onChange={(e) => addFiles(e.target.files)}
                className="text-sm text-ink-muted file:mr-3 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink hover:file:bg-content"
              />
              {pending.length > 0 && (
                <ul className="flex flex-col gap-1">
                  {pending.map((pf) => (
                    <li
                      key={pf.id}
                      className="flex items-center justify-between gap-2 rounded-md border border-border bg-content/40 px-2 py-1 text-sm"
                    >
                      <span className="truncate text-ink">{pf.file.name}</span>
                      <button
                        type="button"
                        onClick={() => removePending(pf.id)}
                        className="rounded-md p-1 text-ink-muted hover:bg-border/40 hover:text-ink"
                        aria-label={`Remove ${pf.file.name}`}
                      >
                        <X className="size-3.5" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Field>

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}
            {busy ? 'Saving' : 'Save deal'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}

function EditDealModal({
  deal,
  onClose,
  onSaved,
}: {
  deal: MarketResearchDeal
  onClose: () => void
  onSaved: () => void
}) {
  const [state, setState] = useState<DealFormState>(() => fromDeal(deal))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const save = async () => {
    const title = state.title.trim()
    if (!title) {
      setError('Enter a deal title.')
      return
    }
    setError(null)
    setBusy(true)
    const priceNum = state.price.trim() === '' ? null : Number(state.price)
    const { error: err } = await marketResearchDeals.update(deal.id, {
      title,
      offer_type: state.offerType || null,
      price: priceNum != null && !Number.isNaN(priceNum) ? priceNum : null,
      expires_at: state.expiresAt || null,
      source_url: state.sourceUrl.trim() || null,
      details: state.details.trim() || null,
    })
    setBusy(false)
    if (err) {
      setError(err.message)
      return
    }
    onSaved()
  }

  return (
    <Modal open onClose={onClose} title="Edit deal" size="lg">
      <div className="flex flex-col gap-4">
        <DealFormFields state={state} setState={setState} />

        {error && <p className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving' : 'Save changes'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
