import { useCallback, useEffect, useState } from 'react'
import { Check, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { Button } from '@/components/ui/Button'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { timeAgo } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuth } from '@/lib/auth'
import { insights, type Insight } from '@/lib/queries/insights'

const SEVERITY_TONE = { info: 'accent', warning: 'warn', critical: 'danger' } as const

export default function InsightsPage() {
  const { profile } = useAuth()
  const [tab, setTab] = useState<'active' | 'history'>('active')
  const [items, setItems] = useState<Insight[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data } = tab === 'active' ? await insights.active() : await insights.history()
    setItems((data as Insight[] | null) ?? [])
    setLoading(false)
  }, [tab])

  useEffect(() => { void load() }, [load])

  const refresh = async () => {
    setRefreshing(true)
    setNotice(null)
    const { data, error } = await insights.refresh()
    setRefreshing(false)
    if (error) {
      // Supabase wraps non-2xx as FunctionsHttpError; surface the body message.
      const ctx = (error as unknown as { context?: Response }).context
      let msg = 'Could not refresh insights.'
      if (ctx) {
        try {
          const body = await ctx.json()
          if (body?.error === 'no_key') msg = 'AI Insights needs an Anthropic API key (see setup note below).'
          else if (body?.error === 'rate_limited') msg = 'Insights already refreshed within the last hour.'
          else if (body?.message) msg = body.message
        } catch { /* ignore */ }
      }
      setNotice(msg)
      return
    }
    const count = (data as { generated?: number } | null)?.generated ?? 0
    setNotice(count > 0 ? `Generated ${count} new insight${count === 1 ? '' : 's'}.` : 'No new insights — everything looks steady.')
    void load()
  }

  const acknowledge = async (id: string) => {
    if (!profile) return
    await insights.acknowledge(id, profile.id)
    setItems((arr) => arr.filter((i) => i.id !== id))
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="AI Insights"
        subtitle="Your data tells a story. Operator reads it for you."
        actions={
          <Button onClick={refresh} disabled={refreshing}>
            <RefreshCw className={cn('size-4', refreshing && 'animate-spin')} />
            {refreshing ? 'Analyzing…' : 'Refresh insights'}
          </Button>
        }
      />

      <nav className="flex gap-1 border-b border-border">
        {(['active', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-sm font-medium capitalize transition',
              tab === t ? 'border-accent text-ink' : 'border-transparent text-ink-muted hover:text-ink',
            )}
          >
            {t === 'active' ? 'Active' : 'History'}
          </button>
        ))}
      </nav>

      {notice && (
        <div className="rounded-md bg-accent-soft px-3 py-2 text-sm text-accent">{notice}</div>
      )}

      {loading ? (
        <p className="text-sm text-ink-muted">Loading…</p>
      ) : items.length === 0 ? (
        <EmptyState
          icon={Sparkles}
          title={tab === 'active' ? 'No insights yet' : 'No history yet'}
          description={
            tab === 'active'
              ? 'Click "Refresh insights" to analyze your last 30 days of operations.'
              : 'Acknowledged insights will appear here.'
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((ins) => (
            <div key={ins.id} className="rounded-md border border-border bg-card p-4">
              <div className="mb-2 flex items-center gap-2">
                <Badge tone={SEVERITY_TONE[ins.severity as keyof typeof SEVERITY_TONE]}>
                  {ins.severity}
                </Badge>
                <Badge tone="neutral">{ins.category}</Badge>
                <span className="ml-auto text-xs text-ink-muted">{timeAgo(ins.generated_at)}</span>
              </div>
              <p className="text-sm text-ink">{ins.insight_text}</p>
              {tab === 'active' && (
                <div className="mt-3 flex justify-end">
                  <Button variant="ghost" size="sm" onClick={() => acknowledge(ins.id)}>
                    <Check className="size-4" /> Acknowledge
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {notice?.includes('Anthropic API key') && (
        <div className="flex items-start gap-2 rounded-md border border-border bg-card p-4 text-sm text-ink-muted">
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warn" />
          <div>
            <p className="font-medium text-ink">Enable AI Insights</p>
            <p className="mt-1">
              Set your key as an Edge Function secret, then deploy:
            </p>
            <pre className="mt-2 overflow-x-auto rounded bg-content p-2 font-mono text-xs text-ink">
{`supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase functions deploy generate-insights`}
            </pre>
          </div>
        </div>
      )}
    </div>
  )
}
