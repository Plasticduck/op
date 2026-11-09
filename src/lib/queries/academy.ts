import { supabase } from '@/lib/supabase'
import type { Database } from '@/lib/database.types'

// Academy (docs/academy/README.md): levels of courses and lessons, with knowledge
// checks, scenario practice, an assessment and a sign-off per level. Learners never
// read answer keys: questions come from academy_level_questions (no answers) and the
// check functions grade on the server.

type T = Database['public']['Tables']

export type AcademyProgram = T['academy_programs']['Row']
export type AcademyLevel = T['academy_levels']['Row']
export type AcademyCourse = T['academy_courses']['Row']
export type AcademyLesson = T['academy_lessons']['Row']
export type AcademyLessonMeta = Omit<AcademyLesson, 'body'>
export type EditQuestion = T['academy_questions']['Row']
export type Learner = T['academy_learners']['Row']
export type LessonProgress = T['academy_lesson_progress']['Row']
export type Attempt = T['academy_attempts']['Row']
export type Signoff = T['academy_signoffs']['Row']

export type QuestionKind = 'quiz' | 'scenario' | 'assessment'
export type PublicQuestion = {
  id: string
  lesson_id: string | null
  kind: QuestionKind
  sort: number
  title: string | null
  prompt: string
  options: string[]
}
export type Me = { learner: Learner | null; leader: boolean; editor: boolean }
export type QuestionResult = { correct: boolean; answer: number | null; why: string | null }
export type GradeResult = {
  correct: number
  total: number
  score: number
  results: Record<string, QuestionResult>
  done?: boolean
  passed?: boolean
  pass_pct?: number
  revealed?: boolean
}
export type TeamLevel = {
  lessons_done: number
  lessons_total: number
  has_scenarios: boolean
  has_assessment: boolean
  scenarios: boolean
  best: number | null
  attempts: number
  passed: boolean
  signoff_id: string | null
  signed_on: string | null
  verified: boolean
}
export type TeamRow = {
  learner_id: string
  name: string
  is_user: boolean
  location_id: string | null
  level_key: string | null
  last_active_at: string | null
  levels: Record<string, TeamLevel>
}

export type OutlineCourse = AcademyCourse & { lessons: AcademyLessonMeta[] }
export type OutlineLevel = AcademyLevel & {
  courses: OutlineCourse[]
  // Active lessons in order, across the level's active courses.
  lessons: AcademyLessonMeta[]
  scenarioCount: number
  assessmentCount: number
}
export type Outline = {
  program: AcademyProgram | null
  levels: OutlineLevel[] // active levels in ladder order
  allLevels: OutlineLevel[] // including archived ones (for editors)
  quizCount: Map<string, number> // lesson id -> questions
}

export type Progress = {
  learnerId: string
  lessons: Map<string, LessonProgress>
  scenarios: Map<string, Attempt[]> // level id -> attempts, newest first
  assessments: Map<string, Attempt[]>
  signoffs: Map<string, Signoff>
}

type RpcFn = (name: string, args?: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message: string } | null }>
async function rpc<R>(name: string, args?: Record<string, unknown>): Promise<R> {
  const { data, error } = await (supabase.rpc as unknown as RpcFn).call(supabase, name, args)
  if (error) throw new Error(error.message)
  return data as R
}
// For calls that always return data when they succeed (lists, single rows).
function must<R>(res: { data: R; error: { message: string } | null }): NonNullable<R> {
  if (res.error) throw new Error(res.error.message)
  return res.data as NonNullable<R>
}

const LESSON_META =
  'id, account_id, level_id, course_id, key, title, minutes, why, kind, checks, sort, active, created_at, updated_at, updated_by'

export const academy = {
  async outline(): Promise<Outline> {
    const [prog, levels, courses, lessons, counts] = await Promise.all([
      supabase.from('academy_programs').select('*').maybeSingle(),
      supabase.from('academy_levels').select('*').order('num').order('title'),
      supabase.from('academy_courses').select('*').order('sort'),
      supabase.from('academy_lessons').select(LESSON_META).order('sort'),
      rpc<{ level_id: string; lesson_id: string | null; kind: QuestionKind; n: number }[]>('academy_question_counts'),
    ])
    if (prog.error) throw new Error(prog.error.message)
    const program = prog.data
    const lv = must(levels)
    const cs = must(courses)
    const ls = must(lessons) as AcademyLessonMeta[]
    const quizCount = new Map<string, number>()
    const scen = new Map<string, number>()
    const assess = new Map<string, number>()
    for (const c of counts ?? []) {
      if (c.kind === 'quiz' && c.lesson_id) quizCount.set(c.lesson_id, c.n)
      else if (c.kind === 'scenario') scen.set(c.level_id, c.n)
      else if (c.kind === 'assessment') assess.set(c.level_id, c.n)
    }
    const allLevels: OutlineLevel[] = lv.map((l) => {
      const courseList: OutlineCourse[] = cs
        .filter((c) => c.level_id === l.id)
        .map((c) => ({ ...c, lessons: ls.filter((s) => s.course_id === c.id) }))
      return {
        ...l,
        courses: courseList,
        lessons: courseList.filter((c) => c.active).flatMap((c) => c.lessons.filter((s) => s.active)),
        scenarioCount: scen.get(l.id) ?? 0,
        assessmentCount: assess.get(l.id) ?? 0,
      }
    })
    return { program, levels: allLevels.filter((l) => l.active), allLevels, quizCount }
  },

  lesson: async (id: string) => must(await supabase.from('academy_lessons').select('*').eq('id', id).single()),
  me: () => rpc<Me>('academy_me'),
  trainee: (employeeId: string) => rpc<Learner>('academy_trainee', { p_employee: employeeId }),
  async learner(id: string): Promise<Learner | null> {
    const r = await supabase.from('academy_learners').select('*').eq('id', id).maybeSingle()
    if (r.error) throw new Error(r.error.message)
    return r.data
  },
  updateLearner: (learner: string, levelKey: string | null, location: string | null) =>
    rpc<void>('academy_update_learner', { p_learner: learner, p_level_key: levelKey, p_location: location }),

  async progress(learnerId: string): Promise<Progress> {
    const [l, a, s] = await Promise.all([
      supabase.from('academy_lesson_progress').select('*').eq('learner_id', learnerId),
      supabase.from('academy_attempts').select('*').eq('learner_id', learnerId).order('created_at', { ascending: false }),
      supabase.from('academy_signoffs').select('*').eq('learner_id', learnerId),
    ])
    const p: Progress = { learnerId, lessons: new Map(), scenarios: new Map(), assessments: new Map(), signoffs: new Map() }
    for (const r of must(l)) p.lessons.set(r.lesson_id, r)
    for (const r of must(a)) {
      const m = r.kind === 'scenarios' ? p.scenarios : p.assessments
      m.set(r.level_id, [...(m.get(r.level_id) ?? []), r])
    }
    for (const r of must(s)) p.signoffs.set(r.level_id, r)
    return p
  },

  questions: (levelId: string) => rpc<PublicQuestion[]>('academy_level_questions', { p_level: levelId }),
  checkQuiz: (lessonId: string, answers: Record<string, number>, learner: string | null) =>
    rpc<GradeResult>('academy_check_quiz', { p_lesson: lessonId, p_answers: answers, p_learner: learner }),
  submit: (levelId: string, kind: 'scenarios' | 'assessment', answers: Record<string, number>, learner: string | null) =>
    rpc<GradeResult>('academy_submit', { p_level: levelId, p_kind: kind, p_answers: answers, p_learner: learner }),
  saveSelfcheck: (lessonId: string, checks: boolean[], focus: number | null, finish: boolean, learner: string) =>
    rpc<void>('academy_save_selfcheck', { p_lesson: lessonId, p_checks: checks, p_focus: focus, p_finish: finish, p_learner: learner }),
  sign: (a: { learner: string; level: string; name: string; location: string; signedOn: string; leaderName: string; verify: boolean }) =>
    rpc<string>('academy_sign', {
      p_learner: a.learner, p_level: a.level, p_name: a.name, p_location: a.location,
      p_signed_on: a.signedOn, p_leader_name: a.leaderName, p_verify: a.verify,
    }),
  unsign: (signoffId: string) => rpc<void>('academy_unsign', { p_signoff: signoffId }),
  verify: (signoffId: string, on: boolean) => rpc<void>('academy_verify', { p_signoff: signoffId, p_on: on }),
  team: (location: string | null) => rpc<TeamRow[]>('academy_team', { p_location: location }),
  importLocal: (state: unknown) => rpc<{ imported: number }>('academy_import_local', { p_state: state }),

  // ---- editing (Admins) ----
  editQuestions: async (levelId: string) =>
    must(await supabase.from('academy_questions').select('*').eq('level_id', levelId).order('sort')),
  saveQuestions: (levelId: string, lessonId: string | null, kind: QuestionKind, items: unknown[]) =>
    rpc<number>('academy_save_questions', { p_level: levelId, p_lesson: lessonId, p_kind: kind, p_items: items }),
  saveProgram: async (row: T['academy_programs']['Insert']) =>
    must(await supabase.from('academy_programs').upsert(row).select('*').single()),
  saveLevel: async (id: string, patch: T['academy_levels']['Update']) =>
    must(await supabase.from('academy_levels').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()),
  addLevel: async (row: T['academy_levels']['Insert']) =>
    must(await supabase.from('academy_levels').insert(row).select('*').single()),
  saveCourse: async (id: string, patch: T['academy_courses']['Update']) =>
    must(await supabase.from('academy_courses').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select('*').single()),
  addCourse: async (row: T['academy_courses']['Insert']) =>
    must(await supabase.from('academy_courses').insert(row).select('*').single()),
  saveLesson: async (id: string, patch: T['academy_lessons']['Update']) =>
    must(await supabase.from('academy_lessons').update(patch).eq('id', id).select('*').single()),
  addLesson: async (row: T['academy_lessons']['Insert']) =>
    must(await supabase.from('academy_lessons').insert(row).select('*').single()),
}

// ---- Progress math (shared by the learner screens) ----

export type LevelStatus = {
  done: number
  total: number
  scenarios: boolean
  passed: boolean
  best: number | null
  signed: boolean
  verified: boolean
  units: number
  got: number
  pct: number
  complete: boolean
}

export function levelStatus(level: OutlineLevel, p: Progress | null): LevelStatus {
  const done = p ? level.lessons.filter((l) => p.lessons.get(l.id)?.done_at).length : 0
  const scen = level.scenarioCount > 0
  const assess = level.assessmentCount > 0
  const scenarios = !!p?.scenarios.get(level.id)?.length
  const tries = p?.assessments.get(level.id) ?? []
  const passed = tries.some((a) => a.passed)
  const best = tries.length ? Math.max(...tries.map((a) => a.score)) : null
  const sign = p?.signoffs.get(level.id)
  const units = level.lessons.length + (scen ? 1 : 0) + (assess ? 1 : 0) + 1
  const got = done + (scen && scenarios ? 1 : 0) + (assess && passed ? 1 : 0) + (sign ? 1 : 0)
  return {
    done, total: level.lessons.length, scenarios, passed, best, signed: !!sign, verified: !!sign?.verified_at,
    units, got, pct: Math.round((got / units) * 100), complete: got === units,
  }
}

export function teamLevelUnits(t: TeamLevel | undefined): { got: number; units: number } {
  if (!t) return { got: 0, units: 0 }
  const units = t.lessons_total + (t.has_scenarios ? 1 : 0) + (t.has_assessment ? 1 : 0) + 1
  const got = t.lessons_done + (t.has_scenarios && t.scenarios ? 1 : 0) + (t.has_assessment && t.passed ? 1 : 0) + (t.signoff_id ? 1 : 0)
  return { got, units }
}

export function teamLevelPct(t: TeamLevel | undefined): number {
  const { got, units } = teamLevelUnits(t)
  return units ? Math.round((got / units) * 100) : 0
}

export function overallPct(levels: OutlineLevel[], p: Progress | null) {
  let got = 0
  let units = 0
  let complete = 0
  for (const l of levels) {
    const s = levelStatus(l, p)
    got += s.got
    units += s.units
    if (s.complete) complete += 1
  }
  return { pct: units ? Math.round((got / units) * 100) : 0, complete }
}
