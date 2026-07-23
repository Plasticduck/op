import { Fragment, useEffect, useRef, useState } from 'react'
import { ArrowUp, Database, Sparkles, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { askOperator, type AskResult, type AskStep, type AskTurn } from '@/lib/queries/askOperator'
import { cn } from '@/lib/utils'

type Msg = {
  role: 'user' | 'assistant'
  content: string
  steps?: AskStep[]
  error?: boolean
}

const SUGGESTIONS = [
  'Which site washed the most cars last month?',
  'How many work orders are open, by site?',
  'Which equipment is overdue for service?',
  'What are my lowest-stock inventory items?',
  'Show open site violations by severity.',
]

export default function AskOperatorPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, busy])

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    setInput('')
    const history: AskTurn[] = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }))
    setMessages((m) => [...m, { role: 'user', content: question }])
    setBusy(true)
    const { data, error } = await askOperator.ask(question, history)
    setBusy(false)

    if (error) {
      const ctx = (error as unknown as { context?: Response }).context
      let msg = 'Something went wrong answering that.'
      if (ctx) {
        try {
          const body = await ctx.json()
          if (body?.error === 'no_key') msg = 'The assistant needs an Anthropic API key configured.'
          else if (body?.message) msg = body.message
        } catch {
          // keep default
        }
      }
      setMessages((m) => [...m, { role: 'assistant', content: msg, error: true }])
      return
    }
    const r = data as AskResult | null
    setMessages((m) => [
      ...m,
      {
        role: 'assistant',
        content: r?.answer ?? 'I could not find an answer.',
        steps: r?.steps,
      },
    ])
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-4 py-4 lg:px-8">
      <PageHeader
        title="Ask Operator"
        subtitle="Ask questions about your data in plain English. Answers stay scoped to what you can access."
      />

      <div ref={scrollRef} className="mt-4 flex-1 space-y-4 overflow-y-auto pb-4">
        {messages.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-ink">
              <Sparkles className="size-5 text-accent" />
              <span className="font-semibold">What can I tell you?</span>
            </div>
            <p className="mt-1 text-sm text-ink-muted">
              I read your live Operator data to answer questions. Try one of these:
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => void send(s)}
                  className="rounded-full border border-border bg-content px-3 py-1.5 text-left text-sm text-ink-muted transition hover:border-accent hover:text-accent"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => <MessageBubble key={i} msg={m} />)
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm text-ink-muted">
            <Sparkles className="size-4 animate-pulse text-accent" />
            Looking through your data…
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-auto">
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card p-2 focus-within:border-accent">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                void send(input)
              }
            }}
            rows={1}
            placeholder="Ask about cars washed, work orders, inventory, staff…"
            className="max-h-40 flex-1 resize-none bg-transparent px-2 py-1.5 text-sm text-ink outline-none placeholder:text-ink-subtle"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-white transition hover:bg-accent-hover disabled:opacity-40"
            aria-label="Send"
          >
            <ArrowUp className="size-5" />
          </button>
        </div>
        <p className="mt-1.5 px-1 text-[11px] text-ink-subtle">
          Answers are AI-generated from your data and can occasionally be off. Double-check anything
          you act on.
        </p>
      </form>
    </div>
  )
}

function MessageBubble({ msg }: { msg: Msg }) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-accent px-4 py-2 text-sm text-white">
          {msg.content}
        </div>
      </div>
    )
  }
  return (
    <div className="flex justify-start">
      <div
        className={cn(
          'max-w-[92%] rounded-2xl rounded-bl-sm border px-4 py-3 text-sm',
          msg.error
            ? 'border-danger-soft bg-danger-soft text-danger'
            : 'border-border bg-card text-ink',
        )}
      >
        {msg.error && (
          <div className="mb-1 flex items-center gap-1.5 font-medium">
            <TriangleAlert className="size-4" /> Error
          </div>
        )}
        <AnswerText text={msg.content} />
        {msg.steps && msg.steps.length > 0 && <QueryDetails steps={msg.steps} />}
      </div>
    </div>
  )
}

function QueryDetails({ steps }: { steps: AskStep[] }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-3 border-t border-border pt-2">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1.5 text-xs text-ink-subtle hover:text-ink-muted"
      >
        <Database className="size-3.5" />
        {open ? 'Hide' : 'Show'} the {steps.length} quer{steps.length === 1 ? 'y' : 'ies'} I ran
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {steps.map((s, i) => (
            <div key={i} className="rounded-md border border-border bg-content p-2">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-muted">
                {s.sql}
              </pre>
              <p className="mt-1 text-[11px] text-ink-subtle">
                {s.error ? `error: ${s.error}` : `${s.rowCount ?? 0} row(s)`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// Minimal renderer for the model's markdown: paragraphs, bullet/numbered lists,
// pipe tables, and **bold**. Enough to read cleanly without a markdown dependency.
function AnswerText({ text }: { text: string }) {
  const lines = text.replace(/\r/g, '').split('\n')
  const blocks: React.ReactNode[] = []
  let i = 0
  let key = 0

  const isTableRow = (l: string) => /^\s*\|.*\|\s*$/.test(l)
  const isDivider = (l: string) => /^\s*\|?[\s:|-]+\|?\s*$/.test(l) && l.includes('-')

  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    // Table
    if (isTableRow(line) && i + 1 < lines.length && isDivider(lines[i + 1])) {
      const header = splitRow(line)
      const rows: string[][] = []
      i += 2
      while (i < lines.length && isTableRow(lines[i])) {
        rows.push(splitRow(lines[i]))
        i++
      }
      blocks.push(
        <div key={key++} className="my-2 overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr>
                {header.map((h, hi) => (
                  <th
                    key={hi}
                    className="border border-border bg-content px-2 py-1 text-left font-semibold text-ink"
                  >
                    {inline(h)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri}>
                  {r.map((c, ci) => (
                    <td key={ci} className="border border-border px-2 py-1 text-ink-muted">
                      {inline(c)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      )
      continue
    }
    // List (bullet or numbered)
    if (/^\s*([-*]|\d+\.)\s+/.test(line)) {
      const items: string[] = []
      const ordered = /^\s*\d+\.\s+/.test(line)
      while (i < lines.length && /^\s*([-*]|\d+\.)\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*([-*]|\d+\.)\s+/, ''))
        i++
      }
      const ListTag = ordered ? 'ol' : 'ul'
      blocks.push(
        <ListTag
          key={key++}
          className={cn('my-1.5 space-y-1 pl-5', ordered ? 'list-decimal' : 'list-disc')}
        >
          {items.map((it, ii) => (
            <li key={ii}>{inline(it)}</li>
          ))}
        </ListTag>,
      )
      continue
    }
    // Paragraph
    blocks.push(
      <p key={key++} className="my-1.5 leading-relaxed first:mt-0">
        {inline(line)}
      </p>,
    )
    i++
  }

  return <div className="text-sm">{blocks}</div>
}

function splitRow(l: string): string[] {
  return l
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim())
}

// Render **bold** segments; leave the rest as text.
function inline(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    /^\*\*[^*]+\*\*$/.test(p) ? (
      <strong key={i} className="font-semibold text-ink">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{p}</Fragment>
    ),
  )
}
