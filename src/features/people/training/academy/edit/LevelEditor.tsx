import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { academy, type EditQuestion, type OutlineCourse, type OutlineLevel } from '@/lib/queries/academy'
import { EDIT_BASE, levelPath, useAcademy } from '../context'
import { BackLink, Card, Pill } from '../ui'
import { Area, Field, Text, Toggle, inputCls } from './fields'
import { QuestionsEditor } from './QuestionsEditor'
import { errText, randomKey } from '../helpers'

export default function LevelEditor() {
  const { levelKey } = useParams()
  const { level: find } = useAcademy()
  const level = find(levelKey)
  if (!level) return <div className="flex flex-col gap-3"><BackLink to={EDIT_BASE}>Edit the Academy</BackLink><p className="text-sm text-ink-muted">Level not found.</p></div>
  return <Editor key={level.id + level.updated_at} level={level} />
}

function Editor({ level }: { level: OutlineLevel }) {
  const { reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const [f, setF] = useState({
    title: level.title, short_title: level.short_title, role_text: level.role_text ?? '', blurb: level.blurb ?? '', why: level.why ?? '',
    draft: level.draft, pass_pct: String(level.pass_pct), ack_formal: level.ack_formal, ack_title: level.ack_title ?? '', ack_statement: level.ack_statement,
  })
  const [busy, setBusy] = useState(false)
  const [questions, setQuestions] = useState<EditQuestion[] | null>(null)
  const [newCourse, setNewCourse] = useState('')

  const loadQuestions = useCallback(() => {
    academy.editQuestions(level.id).then(setQuestions).catch((e) => toast(errText(e)))
  }, [level.id, toast])
  useEffect(() => { loadQuestions() }, [loadQuestions])

  const save = async (patch?: Partial<{ active: boolean }>) => {
    setBusy(true)
    try {
      const pass = Math.round(Number(f.pass_pct))
      if (!f.title.trim() || !f.short_title.trim()) throw new Error('Give the level a name and a short name')
      if (!(pass >= 1 && pass <= 100)) throw new Error('Pass mark is a percent from 1 to 100')
      await academy.saveLevel(level.id, {
        title: f.title.trim(), short_title: f.short_title.trim(), role_text: f.role_text.trim() || null, blurb: f.blurb.trim() || null,
        why: f.why.trim() || null, draft: f.draft, pass_pct: pass, ack_formal: f.ack_formal, ack_title: f.ack_title.trim() || null,
        ack_statement: f.ack_statement.trim(), updated_by: profile?.id ?? null, ...patch,
      })
      await reloadOutline()
      toast(patch?.active === false ? 'Level retired' : patch?.active ? 'Level restored' : 'Level saved')
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const addCourse = async () => {
    if (!newCourse.trim() || !profile) return
    setBusy(true)
    try {
      await academy.addCourse({ account_id: profile.account_id, level_id: level.id, title: newCourse.trim(), sort: level.courses.length + 1 })
      setNewCourse('')
      await reloadOutline()
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const set = <K extends keyof typeof f>(k: K) => (v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }))
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <BackLink to={EDIT_BASE}>Edit the Academy</BackLink>
        <Link to={levelPath(level.key)} className="text-sm text-accent hover:underline">View level</Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-xl font-semibold text-ink">Level {level.num}: {level.title}</h2>
        {!level.active && <Pill>retired</Pill>}
      </div>

      <Card className="flex flex-col gap-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Text value={f.title} onChange={set('title')} /></Field>
          <Field label="Short name" hint="Used in the ladder and buttons"><Text value={f.short_title} onChange={set('short_title')} /></Field>
          <Field label="The role" className="sm:col-span-2"><Area value={f.role_text} onChange={set('role_text')} rows={2} /></Field>
          <Field label="Summary" className="sm:col-span-2"><Area value={f.blurb} onChange={set('blurb')} rows={2} /></Field>
          <Field label="Why this level matters" className="sm:col-span-2"><Area value={f.why} onChange={set('why')} rows={3} /></Field>
          <Field label="Assessment pass mark (%)"><input type="number" min={1} max={100} value={f.pass_pct} onChange={(e) => set('pass_pct')(e.target.value)} className={inputCls} /></Field>
          <div className="flex items-end pb-2"><Toggle checked={f.draft} onChange={set('draft')} label="Draft (pending leadership review)" /></div>
        </div>
        <div className="rounded-lg border border-border p-3">
          <div className="mb-2 font-medium text-ink">Sign-off</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2"><Toggle checked={f.ack_formal} onChange={set('ack_formal')} label="Formal acknowledgment (verified by a Regional Manager)" /></div>
            {f.ack_formal && <Field label="Acknowledgment title" className="sm:col-span-2"><Text value={f.ack_title} onChange={set('ack_title')} placeholder="e.g. General Manager Standards" /></Field>}
            <Field label="What they agree to" className="sm:col-span-2" hint="Each signed sign-off keeps the wording it was signed under.">
              <Area value={f.ack_statement} onChange={set('ack_statement')} rows={4} />
            </Field>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save level'}</Button>
          {level.active
            ? <Button variant="secondary" disabled={busy} onClick={() => void save({ active: false })}>Retire level</Button>
            : <Button variant="secondary" disabled={busy} onClick={() => void save({ active: true })}>Restore level</Button>}
        </div>
      </Card>

      <div className="flex flex-col gap-3">
        <h3 className="font-semibold text-ink">Courses and lessons</h3>
        {level.courses.map((c) => <CourseCard key={c.id + c.updated_at} course={c} level={level} />)}
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-end">
          <Field label="New course" className="flex-1"><Text value={newCourse} onChange={setNewCourse} placeholder="e.g. Level 1 Maintenance Qualification" /></Field>
          <Button variant="secondary" onClick={() => void addCourse()} disabled={busy || !newCourse.trim()}><Plus className="size-4" /> Add course</Button>
        </div>
      </div>

      <Card className="flex flex-col gap-3">
        <h3 className="font-semibold text-ink">Scenario practice</h3>
        {questions == null ? <p className="text-sm text-ink-muted">Loading…</p> : (
          <QuestionsEditor
            key={`s-${questions.length}-${questions.filter((q) => q.kind === 'scenario').map((q) => q.updated_at).join()}`}
            levelId={level.id} lessonId={null} kind="scenario"
            initial={questions.filter((q) => q.kind === 'scenario')}
            onSaved={() => { loadQuestions(); void reloadOutline() }} toast={toast}
          />
        )}
      </Card>
      <Card className="flex flex-col gap-3">
        <h3 className="font-semibold text-ink">Level assessment</h3>
        <p className="-mt-2 text-xs text-ink-muted">Learners see which answers they missed, and the right answers only once they pass.</p>
        {questions == null ? <p className="text-sm text-ink-muted">Loading…</p> : (
          <QuestionsEditor
            key={`a-${questions.length}-${questions.filter((q) => q.kind === 'assessment').map((q) => q.updated_at).join()}`}
            levelId={level.id} lessonId={null} kind="assessment"
            initial={questions.filter((q) => q.kind === 'assessment')}
            onSaved={() => { loadQuestions(); void reloadOutline() }} toast={toast}
          />
        )}
      </Card>
    </div>
  )
}

function CourseCard({ course, level }: { course: OutlineCourse; level: OutlineLevel }) {
  const { reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [f, setF] = useState({ title: course.title, blurb: course.blurb ?? '', note: course.note ?? '', draft: course.draft })
  const [busy, setBusy] = useState(false)
  const [newLesson, setNewLesson] = useState('')
  const dirty = f.title !== course.title || f.blurb !== (course.blurb ?? '') || f.note !== (course.note ?? '') || f.draft !== course.draft

  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true)
    try {
      await fn()
      await reloadOutline()
      if (done) toast(done)
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const lessons = course.lessons
  const swap = (i: number, d: -1 | 1) => {
    const a = lessons[i]
    const b = lessons[i + d]
    if (!a || !b) return
    void run(async () => {
      await academy.saveLesson(a.id, { sort: b.sort })
      await academy.saveLesson(b.id, { sort: a.sort === b.sort ? a.sort + d : a.sort })
    })
  }
  const addLesson = () => {
    if (!newLesson.trim() || !profile) return
    void run(async () => {
      const l = await academy.addLesson({
        account_id: profile.account_id, level_id: level.id, course_id: course.id, key: randomKey('x'), title: newLesson.trim(),
        sort: Math.max(0, ...lessons.map((x) => x.sort)) + 1, body: '<p class="lead">What this lesson covers.</p>', updated_by: profile.id,
      })
      setNewLesson('')
      navigate(`${EDIT_BASE}/${level.key}/${l.key}`)
    })
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-ink">{course.title}</span>
        {course.draft && <Pill tone="warn">draft</Pill>}
        {!course.active && <Pill>retired</Pill>}
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-accent">Course details</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Text value={f.title} onChange={(v) => setF({ ...f, title: v })} /></Field>
          <Field label="Issued by / note"><Text value={f.note} onChange={(v) => setF({ ...f, note: v })} /></Field>
          <Field label="Summary" className="sm:col-span-2"><Area value={f.blurb} onChange={(v) => setF({ ...f, blurb: v })} rows={2} /></Field>
          <Toggle checked={f.draft} onChange={(v) => setF({ ...f, draft: v })} label="Draft course" />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy || !dirty || !f.title.trim()} onClick={() => void run(() => academy.saveCourse(course.id, {
            title: f.title.trim(), blurb: f.blurb.trim() || null, note: f.note.trim() || null, draft: f.draft,
          }), 'Course saved')}>Save course</Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void run(() => academy.saveCourse(course.id, { active: !course.active }), course.active ? 'Course retired' : 'Course restored')}>
            {course.active ? 'Retire course' : 'Restore course'}
          </Button>
        </div>
      </details>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {lessons.map((l, i) => (
          <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
            <span className="w-6 text-sm text-ink-subtle">{i + 1}.</span>
            <span className="min-w-0 flex-1">
              <Link to={`${EDIT_BASE}/${level.key}/${l.key}`} className="text-sm font-medium text-ink hover:text-accent">{l.title}</Link>
              <span className="ml-2 text-xs text-ink-muted">{l.minutes} min{l.kind === 'selfcheck' ? ' · self-check' : ''}</span>
              {!l.active && <span className="ml-2"><Pill>retired</Pill></span>}
            </span>
            <span className="flex items-center gap-1">
              <button type="button" aria-label="Move up" title="Move up" disabled={busy || i === 0} onClick={() => swap(i, -1)} className="rounded p-1 text-ink-muted hover:bg-content disabled:opacity-30"><ArrowUp className="size-4" /></button>
              <button type="button" aria-label="Move down" title="Move down" disabled={busy || i === lessons.length - 1} onClick={() => swap(i, 1)} className="rounded p-1 text-ink-muted hover:bg-content disabled:opacity-30"><ArrowDown className="size-4" /></button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void run(() => academy.saveLesson(l.id, { active: !l.active }), l.active ? 'Lesson retired' : 'Lesson restored')}
                className="ml-1 rounded-md border border-border px-2 py-0.5 text-xs text-ink hover:bg-content"
              >
                {l.active ? 'Retire' : 'Restore'}
              </button>
            </span>
          </li>
        ))}
        {lessons.length === 0 && <li className="px-3 py-2 text-sm text-ink-muted">No lessons yet.</li>}
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="New lesson" className="flex-1"><Text value={newLesson} onChange={setNewLesson} placeholder="Lesson title" /></Field>
        <Button variant="secondary" onClick={addLesson} disabled={busy || !newLesson.trim()}><Plus className="size-4" /> Add lesson</Button>
      </div>
    </Card>
  )
}
