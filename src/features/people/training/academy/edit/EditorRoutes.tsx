import { lazy, useState } from 'react'
import { Link, Route, Routes, useNavigate } from 'react-router-dom'
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { Button } from '@/components/ui/Button'
import { useAuth } from '@/lib/auth'
import { academy, type AcademyProgram, type AcademyTrack, type OutlineLevel } from '@/lib/queries/academy'
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

// Level keys are used in links next to these, and track keys are Training tab names.
const RESERVED_LEVEL = new Set(['edit', 'people'])
const RESERVED_TRACK = new Set(['team', 'training', 'onboarding', 'certs', 'badges', 'roadmap'])

function EditorHome() {
  const { outline, reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  if (!outline) return null

  const addTrack = async () => {
    if (!title.trim() || !profile) return
    setBusy(true)
    try {
      let key = title.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'track'
      const taken = new Set(outline.allTracks.map((t) => t.key))
      while (taken.has(key) || RESERVED_TRACK.has(key)) key = `${key}-${Math.random().toString(36).slice(2, 5)}`
      const letter = title.trim()[0].toUpperCase().replace(/[^A-Z]/, 'X')
      await academy.addTrack({
        account_id: profile.account_id, key, title: title.trim(), unit_label: 'Level', code_prefix: letter,
        sort: Math.max(0, ...outline.allTracks.map((t) => t.sort)) + 1, updated_by: profile.id,
      })
      await reloadOutline()
      setTitle('')
      toast('Track added. Add its first level below it.')
    } catch (e) {
      toast(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5">
      <BackLink to="/app/training">Academy</BackLink>
      <div>
        <h2 className="text-xl font-semibold text-ink">Edit the Academy</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Changes show to everyone as soon as they're saved. Retiring a lesson, level or track hides it without losing anyone's progress.
        </p>
      </div>

      <ProgramForm key={outline.program?.updated_at ?? 'new'} program={outline.program} />

      {outline.allTracks.map((t) => (
        <TrackCard key={t.id + t.updated_at} track={t} levels={outline.allLevels.filter((l) => l.track_id === t.id)} />
      ))}

      <Card className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Field label="New track (a tab of its own, like Maintenance)" className="flex-1"><Text value={title} onChange={setTitle} placeholder="e.g. Lube Shop" /></Field>
        <Button variant="secondary" onClick={() => void addTrack()} disabled={busy || !title.trim()}><Plus className="size-4" /> Add track</Button>
      </Card>
    </div>
  )
}

// A track: its wording, and its levels in order.
function TrackCard({ track, levels }: { track: AcademyTrack; levels: OutlineLevel[] }) {
  const { outline, reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const navigate = useNavigate()
  const [f, setF] = useState({
    title: track.title, unit_label: track.unit_label, code_prefix: track.code_prefix, eyebrow: track.eyebrow ?? '',
    headline: track.headline ?? '', intro: track.intro ?? '', why: track.why ?? '',
  })
  const [newTitle, setNewTitle] = useState('')
  const [newShort, setNewShort] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k: keyof typeof f) => (v: string) => setF((x) => ({ ...x, [k]: v }))

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
  const saveWording = () => run(async () => {
    const code = f.code_prefix.trim().toUpperCase()
    if (!f.title.trim() || !f.unit_label.trim()) throw new Error('Give the track a name and a word for its steps (Level, Tier)')
    if (!/^[A-Z]{1,3}$/.test(code)) throw new Error('The short code is 1 to 3 capital letters, like L or T')
    const n = (v: string) => (v.trim() ? v.trim() : null)
    await academy.saveTrack(track.id, {
      title: f.title.trim(), unit_label: f.unit_label.trim(), code_prefix: code, eyebrow: n(f.eyebrow), headline: n(f.headline),
      intro: n(f.intro), why: n(f.why), updated_by: profile?.id ?? null,
    })
  }, 'Track saved')
  const swap = (i: number, d: -1 | 1) => {
    const a = levels[i]
    const b = levels[i + d]
    if (!a || !b) return
    void run(async () => {
      await academy.saveLevel(a.id, { num: b.num })
      await academy.saveLevel(b.id, { num: a.num === b.num ? a.num + d : a.num })
    })
  }
  const addLevel = () => {
    if (!newTitle.trim() || !profile || !outline) return
    void run(async () => {
      const num = Math.max(0, ...levels.map((l) => l.num)) + 1
      const taken = new Set(outline.allLevels.map((l) => l.key))
      let key = `${track.code_prefix.toLowerCase()}${num}`
      while (taken.has(key) || RESERVED_LEVEL.has(key)) key = `${track.code_prefix.toLowerCase()}${num}-${Math.random().toString(36).slice(2, 6)}`
      const lv = await academy.addLevel({
        account_id: profile.account_id, track_id: track.id, key, num, title: newTitle.trim(), short_title: (newShort || newTitle).trim(),
        ack_statement: `I have completed the ${newTitle.trim()} training and can perform its standards.`, updated_by: profile.id,
      })
      await academy.addCourse({ account_id: profile.account_id, level_id: lv.id, title: newTitle.trim(), sort: 1 })
      setNewTitle('')
      setNewShort('')
      navigate(`${EDIT_BASE}/${lv.key}`)
    })
  }

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-semibold text-ink">{track.title}</h3>
        <span className="text-xs text-ink-muted">{track.unit_label}s, shown as {track.code_prefix}1, {track.code_prefix}2…</span>
        {!track.active && <Pill>retired</Pill>}
      </div>
      <details>
        <summary className="cursor-pointer text-sm text-accent">Track wording</summary>
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <Field label="Name (the tab)"><Text value={f.title} onChange={set('title')} /></Field>
          <Field label="Its steps are called"><Text value={f.unit_label} onChange={set('unit_label')} placeholder="Level or Tier" /></Field>
          <Field label="Short code"><Text value={f.code_prefix} onChange={set('code_prefix')} placeholder="L or T" /></Field>
          <Field label="Small heading" className="sm:col-span-3"><Text value={f.eyebrow} onChange={set('eyebrow')} /></Field>
          <Field label="Headline" className="sm:col-span-3"><Text value={f.headline} onChange={set('headline')} /></Field>
          <Field label="Intro" className="sm:col-span-3"><Area value={f.intro} onChange={set('intro')} /></Field>
          <Field label="Why it matters" className="sm:col-span-3"><Area value={f.why} onChange={set('why')} /></Field>
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" onClick={() => void saveWording()} disabled={busy}>Save track</Button>
          <Button size="sm" variant="secondary" disabled={busy}
            onClick={() => void run(() => academy.saveTrack(track.id, { active: !track.active }), track.active ? 'Track retired' : 'Track restored')}>
            {track.active ? 'Retire track' : 'Restore track'}
          </Button>
        </div>
      </details>
      <ul className="divide-y divide-border rounded-lg border border-border">
        {levels.map((l, i) => (
          <li key={l.id} className="flex flex-wrap items-center gap-3 px-3 py-2.5">
            <span className="flex size-9 items-center justify-center rounded-full bg-content text-xs font-bold text-ink-muted ring-1 ring-border">{l.code}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <Link to={`${EDIT_BASE}/${l.key}`} className="font-medium text-ink hover:text-accent">{l.title}</Link>
                {l.draft && <Pill tone="warn">draft</Pill>}
                {!l.active && <Pill>retired</Pill>}
              </div>
              <p className="text-xs text-ink-muted">
                {l.lessons.length} lessons · {l.scenarioCount} scenarios · {l.assessmentCount} assessment questions
                {l.skills.length ? ` · ${l.skills.length} hands-on skills` : ''}
                {l.requires.length ? ` · requires ${l.requires.map((id) => outline?.allLevels.find((x) => x.id === id)?.code ?? '?').join(', ')}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" title="Move up" aria-label="Move up" disabled={busy || i === 0} onClick={() => swap(i, -1)} className="rounded p-1 text-ink-muted hover:bg-content disabled:opacity-30"><ArrowUp className="size-4" /></button>
              <button type="button" title="Move down" aria-label="Move down" disabled={busy || i === levels.length - 1} onClick={() => swap(i, 1)} className="rounded p-1 text-ink-muted hover:bg-content disabled:opacity-30"><ArrowDown className="size-4" /></button>
              <Link to={`${EDIT_BASE}/${l.key}`} className="ml-1 rounded-md border border-border px-2.5 py-1 text-sm text-ink hover:bg-content">Edit</Link>
            </div>
          </li>
        ))}
        {levels.length === 0 && <li className="px-3 py-2.5 text-sm text-ink-muted">No {track.unit_label.toLowerCase()}s yet.</li>}
      </ul>
      <div className="flex flex-col gap-2 rounded-lg border border-dashed border-border p-3 sm:flex-row sm:items-end">
        <Field label={`New ${track.unit_label.toLowerCase()}`} className="flex-1"><Text value={newTitle} onChange={setNewTitle} placeholder="Title" /></Field>
        <Field label="Short name" className="sm:w-48"><Text value={newShort} onChange={setNewShort} placeholder="Optional" /></Field>
        <Button onClick={addLevel} disabled={busy || !newTitle.trim()}><Plus className="size-4" /> Add {track.unit_label.toLowerCase()}</Button>
      </div>
    </Card>
  )
}

function ProgramForm({ program }: { program: AcademyProgram | null }) {
  const { reloadOutline, toast } = useAcademy()
  const { profile } = useAuth()
  const [f, setF] = useState({
    title: program?.title ?? 'Academy',
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
        account_id: profile.account_id, title: f.title.trim() || 'Academy', why_scenarios: n(f.why_scenarios),
        why_assessment: n(f.why_assessment), why_signoff: n(f.why_signoff), draft_note: n(f.draft_note),
        updated_at: new Date().toISOString(), updated_by: profile.id,
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
        <summary className="cursor-pointer font-semibold text-ink">Program wording (used by every track)</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Name" className="sm:col-span-2"><Text value={f.title} onChange={set('title')} /></Field>
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
