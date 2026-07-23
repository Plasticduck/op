import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Boxes, Car, Database, Gauge, TriangleAlert, Wrench } from 'lucide-react'
import { askOperator, type AskStep, type AskTurn } from '@/lib/queries/askOperator'
import { washWord, type WashPhase } from '@/features/ask/washWords'
import { ActivityTrail, type Activity } from '@/features/ask/ActivityTrail'
import { AnswerBody } from '@/features/ask/AnswerBody'
import { StarMark } from '@/features/ask/StarMark'
import { useTypewriter } from '@/features/ask/useTypewriter'
import { cn } from '@/lib/utils'

type Msg = {
  role: 'user' | 'assistant'
  content: string
  activities?: Activity[]
  steps?: AskStep[]
  error?: boolean
}

const SUGGESTIONS = [
  { icon: Car, q: 'Which site washed the most cars last month?' },
  { icon: Wrench, q: 'How many work orders are open, by site?' },
  { icon: Gauge, q: 'Which equipment is overdue for service?' },
  { icon: Boxes, q: 'What are my lowest-stock inventory items?' },
]

export default function AskOperatorPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  // Live state for the answer currently arriving.
  const [draft, setDraft] = useState('')
  const [activities, setActivities] = useState<Activity[]>([])
  const [phase, setPhase] = useState<WashPhase>('thinking')
  const [detail, setDetail] = useState('')
  const [tick, setTick] = useState(0)
  // Held back until the reveal catches up, so the answer never snaps to full
  // length the moment the stream closes.
  const [pending, setPending] = useState<Msg | null>(null)

  const typed = useTypewriter(draft)
  const scrollRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, typed, activities, busy])

  // Rotate the car wash verb while it works.
  useEffect(() => {
    if (!busy) return
    const t = setInterval(() => setTick((n) => n + 1), 1600)
    return () => clearInterval(t)
  }, [busy])

  // Commit the finished answer once every word has been revealed.
  useEffect(() => {
    if (!pending || typed.length < draft.length) return
    setMessages((m) => [...m, pending])
    setPending(null)
    setDraft('')
    setActivities([])
    setDetail('')
    setBusy(false)
  }, [pending, typed, draft])

  // Keep the composer sized to its contents.
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [input])

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
    setActivities([])
    setPhase('thinking')
    setDetail('')

    // Events land faster than React state settles, so accumulate in plain
    // locals and mirror them into state for rendering.
    let answer = ''
    let acts: Activity[] = []
    let actId = 0
    let collectedSteps: AskStep[] = []
    let settled = false

    const startAct = (label: string) => {
      acts = [
        ...acts.map((a) => (a.state === 'active' ? { ...a, state: 'done' as const } : a)),
        { id: actId++, label, state: 'active' as const },
      ]
      setActivities(acts)
    }
    const closeActs = (patch?: Partial<Activity>) => {
      acts = acts.map((a) => (a.state === 'active' ? { ...a, state: 'done' as const, ...patch } : a))
      setActivities(acts)
    }

    const finish = (content: string, error = false) => {
      settled = true
      closeActs()
      setPending({
        role: 'assistant',
        content,
        activities: acts.length ? acts : undefined,
        steps: collectedSteps.length ? collectedSteps : undefined,
        error,
      })
    }

    try {
      await askOperator.askStream(question, history, (ev) => {
        switch (ev.t) {
          case 'phase':
            if (ev.phase === 'tool') {
              setPhase('tool')
              setDetail(ev.detail ?? '')
              startAct(ev.detail ?? 'Working through your data')
            } else {
              setPhase('thinking')
              setDetail('')
              startAct(acts.length === 0 ? 'Working out what to look up' : 'Reading what came back')
            }
            break
          case 'delta':
            answer += ev.text
            setDraft(answer)
            setPhase('writing')
            setDetail('')
            break
          case 'preamble': {
            // That text was narration on the way to a tool, not the answer.
            // It belongs in the activity trail, not the answer body.
            const note = answer.trim()
            if (note) {
              closeActs()
              acts = [...acts, { id: actId++, label: note, state: 'done' as const }]
              setActivities(acts)
            }
            answer = ''
            setDraft('')
            break
          }
          case 'step':
            collectedSteps.push(ev.step)
            closeActs({ rows: ev.step.rowCount, error: ev.step.error })
            break
          case 'done': {
            if (ev.steps) collectedSteps = ev.steps
            // Prefer the text we already revealed: the server's assembled
            // answer is trimmed, and a shorter target would rewind the reveal.
            const full = answer.length ? answer : (ev.answer ?? '')
            setDraft(full)
            finish(full.trim() || 'I could not find an answer.')
            break
          }
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
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void send(input)
  }

  const empty = messages.length === 0 && !busy

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-3xl flex-col px-4 pb-4 lg:px-8">
      <header className="flex items-center gap-2.5 py-4">
        <StarMark className="size-5 text-accent" />
        <h1 className="text-lg font-semibold tracking-tight text-ink">Operator AI</h1>
      </header>

      <div ref={scrollRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6">
        {empty ? (
          <div className="flex flex-1 flex-col items-center justify-center px-2 py-8 text-center">
            <StarMark active className="size-11 text-accent" />
            <h2 className="mt-5 text-2xl font-semibold tracking-tight text-ink">
              What can I tell you?
            </h2>
            <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-muted">
              I read your live Operator data. Ask in plain English, and answers stay scoped to the
              sites you can see.
            </p>
            <div className="mt-7 grid w-full max-w-xl grid-cols-1 gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s.q}
                  type="button"
                  onClick={() => void send(s.q)}
                  className="group flex items-start gap-3 rounded-2xl border border-border bg-card p-3.5 text-left transition duration-200 hover:-translate-y-0.5 hover:border-accent/50 hover:shadow-lg hover:shadow-accent/5"
                >
                  <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent transition duration-200 group-hover:scale-110">
                    <s.icon className="size-4" />
                  </span>
                  <span className="pt-0.5 text-[13.5px] leading-snug text-ink">{s.q}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-7">
            {messages.map((m, i) => (
              <Turn key={i} msg={m} />
            ))}

            {busy && (
              <div className="ai-rise flex gap-3">
                <StarMark active className="mt-0.5 size-6 shrink-0 text-accent" />
                <div className="min-w-0 flex-1 space-y-3">
                  <ActivityTrail items={activities} />
                  {typed && <AnswerBody text={typed} caret />}
                  <p className="flex items-center gap-1.5 text-[13px]">
                    <span className="ai-shimmer font-medium">{washWord(phase, tick)}</span>
                    {detail && <span className="text-ink-subtle">· {detail}</span>}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={onSubmit} className="mt-auto">
        <div className="flex items-end gap-2 rounded-[28px] border border-border bg-card py-2 pl-5 pr-2 shadow-sm transition duration-200 focus-within:border-accent/60 focus-within:shadow-md">
          {/* border-0 + focus:ring-0 + px-0 undo @tailwindcss/forms, which runs
              in base strategy and otherwise draws a square 1px box with
              border-radius 0 inside this pill. */}
          <textarea
            ref={inputRef}
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
            className="max-h-40 min-h-11 flex-1 resize-none border-0 bg-transparent px-0 py-2.5 text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-subtle focus:ring-0"
          />
          <button
            type="submit"
            disabled={busy || !input.trim()}
            className="mb-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition duration-200 hover:bg-accent-hover active:scale-95 disabled:opacity-40"
            aria-label={busy ? 'Working' : 'Send'}
          >
            {busy ? <StarMark active className="size-5" /> : <ArrowUp className="size-5" />}
          </button>
        </div>
        <p className="mt-2 px-1 text-center text-[11px] text-ink-subtle">
          Answers are AI-generated from your data and can occasionally be off. Double-check anything
          you act on.
        </p>
      </form>
    </div>
  )
}

function Turn({ msg }: { msg: Msg }) {
  if (msg.role === 'user') {
    return (
      <div className="ai-rise flex justify-end">
        <div className="max-w-[85%] rounded-3xl rounded-br-lg bg-accent px-4 py-2.5 text-[15px] leading-relaxed text-white">
          {msg.content}
        </div>
      </div>
    )
  }

  return (
    <div className="ai-rise flex gap-3">
      <StarMark className={cn('mt-0.5 size-6 shrink-0', msg.error ? 'text-danger' : 'text-accent')} />
      <div className="min-w-0 flex-1 space-y-3">
        {msg.activities && msg.activities.length > 0 && <ActivityTrail items={msg.activities} />}
        {msg.error ? (
          <div className="rounded-2xl border border-danger/25 bg-danger-soft px-4 py-3 text-[14px] text-danger">
            <div className="mb-1 flex items-center gap-1.5 font-medium">
              <TriangleAlert className="size-4" /> Something went wrong
            </div>
            {msg.content}
          </div>
        ) : (
          <AnswerBody text={msg.content} />
        )}
        {msg.steps && msg.steps.length > 0 && <QueryDetails steps={msg.steps} />}
      </div>
    </div>
  )
}

function QueryDetails({ steps }: { steps: AskStep[] }) {
  const [open, setOpen] = useState(false)
  const withSql = steps.filter((s) => s.sql)
  if (withSql.length === 0) return null

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-2.5 py-1 text-[11px] text-ink-subtle transition hover:border-accent/40 hover:text-ink-muted"
      >
        <Database className="size-3" />
        {open ? 'Hide' : 'Show'} {withSql.length} quer{withSql.length === 1 ? 'y' : 'ies'}
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {withSql.map((s, i) => (
            <div key={i} className="overflow-hidden rounded-xl border border-border bg-content">
              <pre className="overflow-x-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-ink-muted">
                {s.sql}
              </pre>
              <p className="border-t border-border px-3 py-1.5 text-[11px] text-ink-subtle">
                {s.error ? `error: ${s.error}` : `${s.rowCount ?? 0} row(s)`}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
