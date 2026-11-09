# Academy

The Academy is the training program inside **People > Training**, which Mighty Wash calls **Mighty Wash Academy**. It used to be a separate hosted page (`public/training/mighty-wash-academy.html`) shown in a frame. Now it's part of Operator: its content lives in the database, progress saves to each person, and leaders see their team's progress.

## What people see

- **Road Map** (the first tab): the program's intro, the person's progress, their current role and site, and the ladder of levels.
- **A level:** lessons grouped into courses, then scenario practice, a level assessment and a sign-off. A side list on desktop (a drop-down on phones) shows what's done.
- **A lesson:** the lesson text, a "why this matters" box after the opening paragraph, and a knowledge check. All right completes the lesson. One lesson (the GM self-check) is a checklist with a focus item instead. A lesson with no questions has a Mark as read button.
- **Scenario practice:** answering every scenario completes it, and the explanations show either way.
- **Assessment:** the level's pass mark (80% for every Mighty Wash level). A failed attempt shows which answers were wrong but not the right ones, so a retake still tests what was learned. The right answers show once it's passed. Every attempt is kept.
- **Sign-off:** the person types their name as a signature, picks the site, and names their trainer or leader. The formal GM acknowledgment names the Regional Manager instead. The sign-off keeps the wording it was signed under. A leader then verifies it.

## Leaders

Leaders are Admins and managers, including Regional Managers and Executives, but not the shared office screen.

- **Team progress** tab: everyone at their sites who has started, with a cell per level, sign-offs waiting to be verified, a site filter, search and a CSV export. Admins see every site.
- **A person's record:** each level's lessons, scenario result, every assessment attempt, and the sign-off, with Verify, Undo verify and Reopen.
- **Train a team member:** most team members have no Operator login. A leader picks someone at one of their sites, and the Academy records that person's progress on the leader's device until the leader taps Done training. A banner stays up the whole time. When the person signs off, the leader can verify it on the spot.
- Nobody verifies their own sign-off. A person can take back their own sign-off until it's verified. After that, only a leader can reopen it.

## Editing the content

**Training > Road Map > Edit content.** The database lets any Admin edit, but the screens are limited to the emails in `ACADEMY_EDITOR_EMAILS` (`src/features/people/training/academy/context.ts`), Kevan only for now. Add an email there to open it up.

- **Program wording:** the name, headline, intro and the "why" notes.
- **Levels:** add, reorder, rename, mark draft, set the pass mark and the sign-off statement, or retire one.
- **Courses and lessons:** add, reorder, retire or restore. The lesson editor has a small writing box (headings, lists, bold, the intro "lead" style, callouts, tables) and an HTML view. Saved HTML is cleaned to the tags and classes lessons use (`academy/prose.ts`).
- **Questions:** each knowledge check, the scenarios and the assessment are edited as a list, with the right answer picked and an optional explanation. Saving replaces the list.

Retiring a lesson or level hides it without losing anyone's progress. Progress percentages count active lessons only.

## Progress from the old page

The old hosted page kept progress in the browser. The first time someone opens the Academy on that browser, the app sends that progress to `academy_import_local`. Lessons, scenarios, assessment scores, sign-offs and their chosen role come over, and anything already recorded is kept. Sign-offs typed with a site name are matched to the site when the name matches. This happens once per person per browser.

The old address `/training/mighty-wash-academy.html` redirects to `/app/training` (`vercel.json`).

## For developers

- **Database:** migration `0222_academy.sql`.
  - **Content tables:** `academy_programs` (one row per account), `academy_levels`, `academy_courses`, `academy_lessons` and `academy_questions`.
  - **Progress tables:** `academy_learners`, `academy_lesson_progress`, `academy_attempts` and `academy_signoffs`.
  - **Learners:** a learner is either a user (`user_id`) or a team member without a login (`employee_id`).
  - **Answer keys:** only editors can read `academy_questions`. Everyone else gets questions from `academy_level_questions()`, which leaves the answers out. `academy_check_quiz` and `academy_submit` grade on the server.
  - **Writes:** progress writes go through functions only: `academy_me`, `academy_trainee`, `academy_update_learner`, `academy_save_selfcheck`, `academy_sign`, `academy_unsign`, `academy_verify` and `academy_import_local`. `academy_team` is the leader summary.
  - **Who can see a record:** `academy__can_see` (your own, or a leader's people by `auth_has_location`). **Who can record progress:** `academy__can_act` (your own, or a leader training a team member at their site).
  - **Content edits** go straight to the tables under row security (Admins). Question sets go through `academy_save_questions`.
- **Content seed:** `supabase/seed/academy_mighty_wash.sql` loads the program from the old page through `academy__import` (service role only; it refuses an account that already has content) and removes the old library item. It was generated from the hosted page's data.
- **Frontend:** `src/features/people/training/academy/` and `src/lib/queries/academy.ts`. `TrainingPage` routes `training/academy/*` to `AcademyRoutes`. `AcademyProvider` loads the program, the signed-in learner, any trainee, and their progress. Lesson styles are in `academy.css`, using the app's theme tokens.
- **Tests:** `supabase/tests/academy.sql` (51 checks) covers hidden answer keys, grading, hidden answers on a failed assessment, sign-off and verify rules, trainees, site scoping, the office screen, editing and the import. It needs the seed loaded, rolls back, and ends by raising `ALL PASS`.

## Not built

- Assigning a level with a due date. The Training tab's assignments are separate, and none exist on Mighty Wash today.
- Badges for finished levels.
- Reminders or texts about unfinished training or sign-offs waiting to be verified.
- A printable certificate.
- Version history for lesson text.
