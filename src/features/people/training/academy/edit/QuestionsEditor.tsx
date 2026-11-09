import { useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { academy, type EditQuestion, type QuestionKind } from '@/lib/queries/academy'
import { cn } from '@/lib/utils'
import { Area, Field, Text, inputCls } from './fields'
import { errText } from '../helpers'

type Item = { id?: string; title: string; prompt: string; options: string[]; answer: number; why: string }

const toItem = (q: EditQuestion): Item => ({ id: q.id, title: q.title ?? '', prompt: q.prompt, options: [...q.options], answer: q.answer, why: q.why ?? '' })
const blank = (): Item => ({ title: '', prompt: '', options: ['', '', '', ''], answer: 0, why: '' })

// Edit one set of questions: a lesson's knowledge check, or a level's scenarios or
// assessment. Saving replaces the whole set.
export function QuestionsEditor({
  levelId, lessonId, kind, initial, onSaved, toast,
}: {
  levelId: string
  lessonId: string | null
  kind: QuestionKind
  initial: EditQuestion[]
  onSaved: () => void
  toast: (t: string) => void
}) {
  const [items, setItems] = useState<Item[]>(() => initial.map(toItem))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scenario = kind === 'scenario'

  const change = (i: number, patch: Partial<Item>) => {
    setItems((list) => list.map((it, j) => (j === i ? { ...it, ...patch } : it)))
    setDirty(true)
  }
  const move = (i: number, d: -1 | 1) => {
    setItems((list) => {
      const n = list.slice()
      const j = i + d
      if (j < 0 || j >= n.length) return list
      ;[n[i], n[j]] = [n[j], n[i]]
      return n
    })
    setDirty(true)
  }
  const save = async () => {
    setBusy(true)
    setError(null)
    try {
      await academy.saveQuestions(levelId, lessonId, kind, items.map((it) => ({
        id: it.id, title: scenario ? it.title : null, prompt: it.prompt, options: it.options, answer: it.answer, why: it.why,
      })))
      setDirty(false)
      toast('Questions saved')
      onSaved()
    } catch (e) {
      setError(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 && <p className="text-sm text-ink-muted">No questions yet.</p>}
      {items.map((it, i) => (
        <div key={it.id ?? `new-${i}`} className="rounded-lg border border-border bg-content p-3">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{scenario ? 'Scenario' : 'Question'} {i + 1}</span>
            <span className="flex items-center gap-1">
              <IconBtn label="Move up" onClick={() => move(i, -1)} disabled={i === 0}><ArrowUp className="size-4" /></IconBtn>
              <IconBtn label="Move down" onClick={() => move(i, 1)} disabled={i === items.length - 1}><ArrowDown className="size-4" /></IconBtn>
              <IconBtn label="Remove" onClick={() => { setItems((l) => l.filter((_, j) => j !== i)); setDirty(true) }}><Trash2 className="size-4" /></IconBtn>
            </span>
          </div>
          <div className="flex flex-col gap-2">
            {scenario && <Field label="Name"><Text value={it.title} onChange={(v) => change(i, { title: v })} placeholder="e.g. The returning fault" /></Field>}
            <Field label={scenario ? 'The situation' : 'Question'}>
              <Area value={it.prompt} onChange={(v) => change(i, { prompt: v })} rows={scenario ? 3 : 2} />
            </Field>
            <div>
              <span className="mb-1 block text-xs font-medium text-ink-muted">Choices (pick the right one)</span>
              <div className="flex flex-col gap-1.5">
                {it.options.map((o, j) => (
                  <div key={j} className="flex items-center gap-2">
                    <input
                      type="radio"
                      name={`ans-${kind}-${lessonId ?? levelId}-${i}`}
                      checked={it.answer === j}
                      onChange={() => change(i, { answer: j })}
                      aria-label={`Choice ${j + 1} is right`}
                      className="size-4 shrink-0"
                    />
                    <input
                      value={o}
                      onChange={(e) => change(i, { options: it.options.map((x, k) => (k === j ? e.target.value : x)) })}
                      className={cn(inputCls, it.answer === j && 'border-ok')}
                      placeholder={`Choice ${j + 1}`}
                    />
                    <IconBtn
                      label="Remove choice"
                      disabled={it.options.length <= 2}
                      onClick={() => change(i, {
                        options: it.options.filter((_, k) => k !== j),
                        answer: it.answer === j ? 0 : it.answer > j ? it.answer - 1 : it.answer,
                      })}
                    >
                      <X className="size-4" />
                    </IconBtn>
                  </div>
                ))}
              </div>
              {it.options.length < 8 && (
                <button type="button" onClick={() => change(i, { options: [...it.options, ''] })} className="mt-1.5 text-xs text-accent hover:underline">
                  + Add a choice
                </button>
              )}
            </div>
            <Field label="Why (shown after answering)">
              <Area value={it.why} onChange={(v) => change(i, { why: v })} rows={2} />
            </Field>
          </div>
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={() => { setItems((l) => [...l, blank()]); setDirty(true) }}>
          <Plus className="size-4" /> Add {scenario ? 'a scenario' : 'a question'}
        </Button>
        <Button size="sm" onClick={() => void save()} disabled={busy || !dirty}>{busy ? 'Saving…' : 'Save questions'}</Button>
        {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
        {error && <span className="text-sm text-danger">{error}</span>}
      </div>
    </div>
  )
}

function IconBtn({ label, onClick, disabled, children }: { label: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-ink-muted hover:bg-card hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  )
}
