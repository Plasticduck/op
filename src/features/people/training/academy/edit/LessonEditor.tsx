import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Plus, X } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { academy, type AcademyLesson, type EditQuestion, type OutlineLevel } from '@/lib/queries/academy'
import { EDIT_BASE, lessonPath, useAcademy } from '../context'
import { sanitizeHtml } from '../prose'
import { BackLink, Card, Pill } from '../ui'
import { Area, Field, Text, inputCls } from './fields'
import { QuestionsEditor } from './QuestionsEditor'
import { RichText } from './RichText'
import { errText } from '../helpers'

export default function LessonEditor() {
  const { levelKey, lessonKey } = useParams()
  const { level: find } = useAcademy()
  const level = find(levelKey)
  const meta = level?.courses.flatMap((c) => c.lessons).find((l) => l.key === lessonKey)
  const [lesson, setLesson] = useState<AcademyLesson | null>(null)
  const [error, setError] = useState<string | null>(null)
  const id = meta?.id
  const load = useCallback(() => {
    if (!id) return
    academy.lesson(id).then(setLesson).catch((e) => setError(errText(e)))
  }, [id])
  useEffect(() => { load() }, [load])

  if (!level || !meta) return <div className="flex flex-col gap-3"><BackLink to={EDIT_BASE}>Edit the Academy</BackLink><p className="text-sm text-ink-muted">Lesson not found.</p></div>
  if (error) return <p className="text-sm text-danger">{error}</p>
  if (!lesson) return <p className="text-sm text-ink-muted">Loading…</p>
  return <Editor key={lesson.id + lesson.updated_at} level={level} lesson={lesson} onSaved={load} />
}

function Editor({ level, lesson, onSaved }: { level: OutlineLevel; lesson: AcademyLesson; onSaved: () => void }) {
  const { reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const [f, setF] = useState({
    title: lesson.title, minutes: String(lesson.minutes), why: lesson.why ?? '', kind: lesson.kind as 'quiz' | 'selfcheck',
    course_id: lesson.course_id, checks: lesson.checks.length ? lesson.checks : [''],
  })
  const [body, setBody] = useState(lesson.body)
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [questions, setQuestions] = useState<EditQuestion[] | null>(null)

  const loadQuestions = useCallback(() => {
    academy.editQuestions(level.id).then((qs) => setQuestions(qs.filter((q) => q.lesson_id === lesson.id))).catch((e) => toast(errText(e)))
  }, [level.id, lesson.id, toast])
  useEffect(() => { loadQuestions() }, [loadQuestions])

  // Warn before leaving with unsaved text.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => { setF((x) => ({ ...x, [k]: v })); setDirty(true) }
  const save = async () => {
    setBusy(true)
    try {
      const minutes = Math.round(Number(f.minutes))
      if (!f.title.trim()) throw new Error('Give the lesson a title')
      if (!(minutes >= 1 && minutes <= 240)) throw new Error('Minutes is a number from 1 to 240')
      const checks = f.checks.map((c) => c.trim()).filter(Boolean)
      if (f.kind === 'selfcheck' && checks.length === 0) throw new Error('A self-check needs at least one statement')
      await academy.saveLesson(lesson.id, {
        title: f.title.trim(), minutes, why: f.why.trim() || null, kind: f.kind, course_id: f.course_id,
        checks: f.kind === 'selfcheck' ? checks : [], body: sanitizeHtml(body), updated_by: profile?.id ?? null,
      })
      setDirty(false)
      await reloadOutline()
      toast('Lesson saved')
      onSaved()
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink to={`${EDIT_BASE}/${level.key}`}>Level {level.num}: {level.short_title}</BackLink>
        <Link to={lessonPath(level.key, lesson.key)} className="text-sm text-accent hover:underline">View lesson</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-ink">{lesson.title}</h2>
        {!lesson.active && <Pill>retired</Pill>}
      </div>

      <Card className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_120px]">
          <Field label="Title"><Text value={f.title} onChange={set('title')} /></Field>
          <Field label="Minutes"><input type="number" min={1} max={240} value={f.minutes} onChange={(e) => set('minutes')(e.target.value)} className={inputCls} /></Field>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Course">
            <select value={f.course_id} onChange={(e) => set('course_id')(e.target.value)} className={inputCls}>
              {level.courses.map((c) => <option key={c.id} value={c.id}>{c.title}{c.active ? '' : ' (retired)'}</option>)}
            </select>
          </Field>
          <Field label="Ends with">
            <select value={f.kind} onChange={(e) => set('kind')(e.target.value as 'quiz' | 'selfcheck')} className={inputCls}>
              <option value="quiz">A knowledge check (all right completes it)</option>
              <option value="selfcheck">A self-check (tick what's true, pick a focus)</option>
            </select>
          </Field>
        </div>
        <Field label="Why this matters" hint="Shown in a box after the lesson's opening paragraph.">
          <Area value={f.why} onChange={set('why')} rows={3} />
        </Field>
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-muted">Lesson</span>
          <RichText value={body} onChange={(v) => { setBody(v); setDirty(true) }} />
        </div>
        {f.kind === 'selfcheck' && (
          <div>
            <span className="mb-1 block text-xs font-medium text-ink-muted">Self-check statements</span>
            <div className="flex flex-col gap-1.5">
              {f.checks.map((c, i) => (
                <div key={i} className="flex items-center gap-2">
                  <input value={c} onChange={(e) => set('checks')(f.checks.map((x, j) => (j === i ? e.target.value : x)))} className={inputCls} />
                  <button type="button" aria-label="Remove" onClick={() => set('checks')(f.checks.filter((_, j) => j !== i))} className="rounded p-1 text-ink-muted hover:bg-content"><X className="size-4" /></button>
                </div>
              ))}
            </div>
            <button type="button" onClick={() => set('checks')([...f.checks, ''])} className="mt-1.5 text-xs text-accent hover:underline">+ Add a statement</button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save lesson'}</Button>
          {dirty && <span className="text-xs text-warn">Unsaved changes</span>}
        </div>
      </Card>

      {f.kind === 'quiz' && (
        <Card className="flex flex-col gap-3">
          <h3 className="font-semibold text-ink">Knowledge check</h3>
          {questions == null ? <p className="text-sm text-ink-muted">Loading…</p> : (
            <QuestionsEditor
              key={questions.map((q) => q.id + q.updated_at).join()}
              levelId={level.id} lessonId={lesson.id} kind="quiz" initial={questions}
              onSaved={() => { loadQuestions(); void reloadOutline() }} toast={toast}
            />
          )}
          {questions?.length === 0 && (
            <p className="flex items-center gap-1 text-xs text-ink-muted"><Plus className="size-3" /> Without questions, this lesson can't be completed.</p>
          )}
        </Card>
      )}
    </div>
  )
}
