import { Fragment, useEffect, useRef, useState } from 'react'
import { ArrowUp, Database, Sparkles, TriangleAlert } from 'lucide-react'
import { PageHeader } from '@/components/layout/PageHeader'
import { askOperator, type AskStep, type AskTurn } from '@/lib/queries/askOperator'
import { washWord, type WashPhase } from '@/features/ask/washWords'
import { cn } from '@/lib/utils'

type Msg = {
  role: 'user' | 'assistant'
  content: string
  steps?: AskStep[]
  // Anything the assistant said on its way to an answer, before it ran a tool.
  notes?: string[]
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
  // Live state for the answer currently streaming in.
  const [draft, setDraft] = useState('')
  const [notes, setNotes] = useState<string[]>([])
  const [phase, setPhase] = useState<WashPhase>('thinking')
  const [detail, setDetail] = useState('')
  const [tick, setTick] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, draft, busy])

  // Rotate the car wash verb while it works.
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setTick((n) => n + 1), 1400)
    return () => clearInterval(t)
  }, [busy])

  const send = async (text: string) => {
    const question = text.trim()
    if (!question || busy) return
    setInput('')
    const history: AskTurn[] = messages
      .filter((m) => !m.error)
      .map((m) => ({ role: m.role, content: m.content }))
    setMessages((m) => [...m, { role: 'user', content: question }])
    setBusy(true)
    setDraft('')
    setNotes([])
    setPhase('thinking')
    setDetail('')

    // Events land faster than React state settles, so accumulate in plain
    // locals and mirror them into state for rendering.
    let answer = ''
    const collectedNotes: string[] = []
    let collectedSteps: AskStep[] = []
    let settled = false

    const finish = (content: string, error = false) => {
      settled = true
      setMessages((m) => [
        ...m,
        {
          role: 'assistant',
          content,
          steps: collectedSteps.length ? collectedSteps : undefined,
          notes: !error && collectedNotes.length ? collectedNotes : undefined,
          error,
        },
      ])
    }

    try {
      await askOperator.askStream(question, history, (ev) => {
        switch (ev.t) {
          case 'phase':
            setPhase(ev.phase === 'tool' ? 'tool' : 'thinking')
            setDetail(ev.detail ?? '')
            break
          case 'delta':
            answer += ev.text
            setDraft(answer)
            setPhase('writing')
            setDetail('Writing the answer')
            break
          case 'preamble': {
            // That text was narration, not the answer. Keep it as a note.
            const note = answer.trim()
            if (note) {
              collectedNotes.push(note)
              setNotes([...collectedNotes])
            }
            answer = ''
            setDraft('')
            break
          }
          case 'step':
            collectedSteps.push(ev.step)
            break
          case 'done':
            if (ev.steps) collectedSteps = ev.steps
            finish((ev.answer ?? answer).trim() || 'I could not find an answer.')
            break
          case 'error':
            finish(ev.message ?? 'Something went wrong answering that.', true)
            break
        }
      })
      // Stream ended without a terminal event (server restart, dropped
      // connection). Keep whatever text arrived rather than losing it.
      if (!settled) finish(answer.trim() || 'The answer was cut off. Try asking again.')
    } catch (e) {
      finish(e instanceof Error ? e.message : 'Something went wrong answering that.', true)
    } finally {
      setBusy(false)
      setDraft('')
      setNotes([])
      setDetail('')
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-4 py-4 lg:px-8">
      <PageHeader
        title="Operator AI"
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

        {busy && (notes.length > 0 || draft) && (
          <div className="flex justify-start">
            <div className="max-w-[92%] rounded-2xl rounded-bl-sm border border-border bg-card px-4 py-3 text-sm text-ink">
              <Notes notes={notes} />
              {draft && <AnswerText text={draft} />}
            </div>
          </div>
        )}

        {busy && (
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="size-4 shrink-0 animate-pulse text-accent" />
            <span className="font-medium text-ink">{washWord(phase, tick)}</span>
            {detail && <span className="truncate text-ink-muted">· {detail}</span>}
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
        {msg.notes && <Notes notes={msg.notes} />}
        <AnswerText text={msg.content} />
        {msg.steps && msg.steps.length > 0 && <QueryDetails steps={msg.steps} />}
      </div>
    </div>
  )
}

// What the assistant said on the way to the answer, kept above it so the work
// it did is visible without cluttering the answer itself.
function Notes({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null
  return (
    <ul className="mb-2 space-y-1 border-l-2 border-border pl-3 text-xs text-ink-subtle">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
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
              {s.sql ? (
                <pre className="overflow-x-auto whitespace-pre-wrap break-words font-mono text-[11px] text-ink-muted">
                  {s.sql}
                </pre>
              ) : (
                <p className="font-mono text-[11px] text-ink-muted">
                  {s.tool === 'get_site_performance'
                    ? 'Pulled live site performance data'
                    : (s.tool ?? 'tool')}
                </p>
              )}
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
