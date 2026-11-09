import { lazy, useState } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { academy, type AcademyProgram } from '@/lib/queries/academy'
import { EDIT_BASE, useAcademy } from '../context'
import { BackLink, Card, Pill } from '../ui'
import { Area, Field, Text } from './fields'
import { errText } from '../helpers'

const LevelEditor = lazy(() => import('./LevelEditor'))
const LessonEditor = lazy(() => import('./LessonEditor'))



// /app/training/academy/edit/... (Admins on the editor list)
export default function EditorRoutes() {
  return (
    <Routes>
      <Route index element={<EditorHome />} />
      <Route path=":levelKey" element={<LevelEditor />} />
      <Route path=":levelKey/:lessonKey" element={<LessonEditor />} />
    </Routes>
  )
}

const RESERVED = new Set(['edit', 'people'])

function EditorHome() {
  const { outline, reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [short, setShort] = useState('')
  const [busy, setBusy] = useState(false)
  if (!outline) return null
  const levels = outline.allLevels

  const swap = async (i: number, d: -1 | 1) => {
    const a = levels[i]
    const b = levels[i + d]
    if (!a || !b) return
    setBusy(true)
    try {
      await academy.saveLevel(a.id, { num: b.num })
      await academy.saveLevel(b.id, { num: a.num })
      await reloadOutline()
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  const add = async () => {
    if (!title.trim() || !profile) return
    setBusy(true)
    try {
      const num = Math.max(0, ...levels.map((l) => l.num)) + 1
      const taken = new Set(levels.map((l) => l.key))
      let key = `l${num}`
      while (taken.has(key) || RESERVED.has(key)) key = `l${num}-${Math.random().toString(36).slice(2, 6)}`
      const lv = await academy.addLevel({
        account_id: profile.account_id, key, num, title: title.trim(), short_title: (short || title).trim(),
        ack_statement: `I have completed the ${title.trim()} training and can perform its standards.`,
        updated_by: profile.id,
      })
      await academy.addCourse({ account_id: profile.account_id, level_id: lv.id, title: title.trim(), sort: 1 })
      await reloadOutline()
      setTitle('')
      setShort('')
      navigate(`${EDIT_BASE}/${lv.key}`)
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <BackLink to="/app/training">Road Map</BackLink>
      <div>
        <h2 className="text-xl font-semibold text-ink">Edit the Academy</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Changes show to everyone as soon as they're saved. Retiring a lesson or level hides it without losing anyone's progress.
        </p>
      </div>

      <ProgramForm key={outline.program?.updated_at ?? 'new'} program={outline.program} />

      <Card className="flex flex-col gap-3">
        <h3 className="font-semibold text-ink">Levels</h3>
        <ul className="divide-y divide-border rounded-lg border border-border">
          {levels.map((l, i) => (
            <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
              <span className="flex size-8 items-center justify-center rounded-full bg-content text-sm font-bold text-ink-muted ring-1 ring-border">{l.num}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`${EDIT_BASE}/${l.key}`} className="font-medium text-ink hover:text-accent">{l.title}</Link>
                  {l.draft && <Pill tone="warn">draft</Pill>}
                  {!l.active && <Pill>retired</Pill>}
                </div>
                <p className="text-xs text-ink-muted">
                  {l.lessons.length} lessons · {l.scenarioCount} scenarios · {l.assessmentCount} assessment questions
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button type="button" title="Move up" aria-label="Move up" disabled={busy || i === 0} onClick={() => void swap(i, -1)} className="rounded p-1 text-ink-muted hover:bg-content disabled:opacity-30"><ArrowUp className="size-4" /></button>
                <button type="button" title="Move down" aria-label="Move down" disabled={busy || i === levels.length - 1} onClick={() => void swap(i, 1)} className="rounded p-1 text-ink-muted hover:bg-content disabled:opacity-30"><ArrowDown className="size-4" /></button>
                <Link to={`${EDIT_BASE}/${l.key}`} className="ml-1 rounded-md border border-border px-2.5 py-1 text-sm text-ink hover:bg-content">Edit</Link>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-end">
          <Field label="New level" className="flex-1"><Text value={title} onChange={setTitle} placeholder="e.g. Lube Technician" /></Field>
          <Field label="Short name" className="sm:w-48"><Text value={short} onChange={setShort} placeholder="Optional" /></Field>
          <Button onClick={() => void add()} disabled={busy || !title.trim()}><Plus className="size-4" /> Add level</Button>
        </div>
      </Card>
    </div>
  )
}

function ProgramForm({ program }: { program: AcademyProgram | null }) {
  const { reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const [f, setF] = useState({
    title: program?.title ?? 'Academy',
    eyebrow: program?.eyebrow ?? '',
    headline: program?.headline ?? '',
    intro: program?.intro ?? '',
    why_program: program?.why_program ?? '',
    why_scenarios: program?.why_scenarios ?? '',
    why_assessment: program?.why_assessment ?? '',
    why_signoff: program?.why_signoff ?? '',
    draft_note: program?.draft_note ?? '',
  })
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))
  const save = async () => {
    if (!profile) return
    setBusy(true)
    try {
      const n = (v: string) => (v.trim() ? v.trim() : null)
      await academy.saveProgram({
        account_id: profile.account_id, title: f.title.trim() || 'Academy', eyebrow: n(f.eyebrow), headline: n(f.headline), intro: n(f.intro),
        why_program: n(f.why_program), why_scenarios: n(f.why_scenarios), why_assessment: n(f.why_assessment), why_signoff: n(f.why_signoff),
        draft_note: n(f.draft_note), updated_at: new Date().toISOString(), updated_by: profile.id,
      })
      await reloadOutline()
      toast('Program saved')
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Card>
      <details>
        <summary className="cursor-pointer font-semibold text-ink">Program wording</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Name"><Text value={f.title} onChange={set('title')} /></Field>
          <Field label="Small heading on the Road Map"><Text value={f.eyebrow} onChange={set('eyebrow')} /></Field>
          <Field label="Headline" className="sm:col-span-2"><Text value={f.headline} onChange={set('headline')} /></Field>
          <Field label="Intro" className="sm:col-span-2"><Area value={f.intro} onChange={set('intro')} /></Field>
          <Field label="Why this program exists" className="sm:col-span-2"><Area value={f.why_program} onChange={set('why_program')} /></Field>
          <Field label="Why: scenario practice"><Area value={f.why_scenarios} onChange={set('why_scenarios')} rows={4} /></Field>
          <Field label="Why: the assessment"><Area value={f.why_assessment} onChange={set('why_assessment')} rows={4} /></Field>
          <Field label="Why: the sign-off"><Area value={f.why_signoff} onChange={set('why_signoff')} rows={4} /></Field>
          <Field label="Note on draft levels"><Area value={f.draft_note} onChange={set('draft_note')} rows={4} /></Field>
        </div>
        <div className="mt-3"><Button size="sm" onClick={() => void save()} disabled={busy}>{busy ? 'Saving…' : 'Save wording'}</Button></div>
      </details>
    </Card>
  )
}

