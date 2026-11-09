# Academy

The Academy is the training program inside **People > Training**, which Mighty Wash calls **Mighty Wash Academy**. It used to be a separate hosted page (`public/training/mighty-wash-academy.html`) shown in a frame. Now it's part of Operator: its content lives in the database, progress saves to each person, and leaders see their team's progress.

## Tracks

The Academy is split into tracks, and each track is a tab on the Training page.

| Track | Steps | What it is |
| --- | --- | --- |
| **Site Support** | Levels 1 to 7 (L1 to L7) | The Road Map to Success: every role from Quality Control to Regional Manager. These are the original Academy levels. |
| **Maintenance** | Tiers 1 to 3 (T1 to T3) | Maintenance certification, written from the "Maintenance Education" document (Manager Basic Knowledge). T1: know the material. T2: do the site-level work. T3: teach it. |

**Prerequisites:** a level can require other levels, from any track. It can't be signed off until those are complete. Mighty Wash:

- **General Manager (L6) requires T1 Maintenance**, so nobody is certified as a General Manager until they hold T1.
- T2 requires T1, and T3 requires T2.

"Complete" means every lesson, the scenarios, a passed assessment, every hands-on skill and the sign-off. The database enforces this when someone signs (`academy_sign`). If a required level is reopened later, the level that needed it shows as waiting again.

**Hands-on skills:** a level can list practical skills that a quiz can't test, like changing a hose or resetting a VFD. A leader watches the person do each one and checks it off. Nobody checks off their own. T2 has 9 and T3 has 5. A leader training someone on their device checks skills off on the level's Hands-on skills page. For anyone else, such as an RM checking off a GM, it's done from the person's record under Team progress.

## What people see

- **A track's tab** (Site Support first): the track's intro, the person's progress in it, their current role (Site Support only) and site, and its levels or tiers. A level that needs another shows "Requires T1 Maintenance", with a lock until it's done.
- **A level:** lessons grouped into courses, then scenario practice, the assessment, hands-on skills (when it has them) and a sign-off. A side list on desktop (a drop-down on phones) shows what's done and what's required first.
- **A lesson:** the lesson text, a "why this matters" box after the opening paragraph, and a knowledge check. All right completes the lesson. One lesson (the GM self-check) is a checklist with a focus item instead. A lesson with no questions has a Mark as read button.
- **Scenario practice:** answering every scenario completes it, and the explanations show either way.
- **Assessment:** the level's pass mark (80% for every Mighty Wash level). A failed attempt shows which answers were wrong but not the right ones, so a retake still tests what was learned. The right answers show once it's passed. Every attempt is kept.
- **Sign-off:** the person types their name as a signature, picks the site, and names their trainer or leader. The formal GM acknowledgment names the Regional Manager instead. The sign-off keeps the wording it was signed under. A leader then verifies it.

## Leaders

Leaders are Admins and managers, including Regional Managers and Executives, but not the shared office screen.

- **Team progress** tab: everyone at their sites who has started, with a column per level grouped by track (L1 to L7, T1 to T3), sign-offs waiting to be verified, a site filter, search and a CSV export. One check is certified, two checks is certified and verified, and a lock is signed but waiting on a required level. Admins see every site.
- **A person's record:** each level's lessons, scenario result, every assessment attempt, hands-on skills, and the sign-off, with Verify, Undo verify and Reopen. Leaders check off hands-on skills here too.
- **Train a team member:** most team members have no Operator login. A leader picks someone at one of their sites, and the Academy records that person's progress on the leader's device until the leader taps Done training. A banner stays up the whole time. When the person signs off, the leader can verify it on the spot.
- Nobody verifies their own sign-off. A person can take back their own sign-off until it's verified. After that, only a leader can reopen it.

## Editing the content

**Training > Site Support (or any track) > Edit content.** The database lets any Admin edit, but the screens are limited to the emails in `ACADEMY_EDITOR_EMAILS` (`src/features/people/training/academy/context.ts`), Kevan only for now. Add an email there to open it up.

- **Program wording:** the name, headline, intro and the "why" notes.
- **Tracks:** add a track (it gets its own tab), and set its name, what its steps are called (Level, Tier), its short code (L, T), and its intro wording. Retire one to hide it.
- **Levels:** add, reorder, rename, mark draft, set the pass mark, the sign-off statement, the hands-on skills, and which levels are required first. Retire one to hide it.
- **Courses and lessons:** add, reorder, retire or restore. The lesson editor has a small writing box (headings, lists, bold, the intro "lead" style, callouts, tables) and an HTML view. Saved HTML is cleaned to the tags and classes lessons use (`academy/prose.ts`).
- **Questions:** each knowledge check, the scenarios and the assessment are edited as a list, with the right answer picked and an optional explanation. Saving replaces the list.

Retiring a lesson or level hides it without losing anyone's progress. Progress percentages count active lessons only.

## Progress from the old page

The old hosted page kept progress in the browser. The first time someone opens the Academy on that browser, the app sends that progress to `academy_import_local`. Lessons, scenarios, assessment scores, sign-offs and their chosen role come over, and anything already recorded is kept. Sign-offs typed with a site name are matched to the site when the name matches. This happens once per person per browser.

The old address `/training/mighty-wash-academy.html` redirects to `/app/training` (`vercel.json`).

## For developers

- **Database:** migrations `0222_academy.sql` (the Academy) and `0223_academy_tracks.sql` (tracks, prerequisites, hands-on skills).
  - **0223:** `academy_tracks` (every level has a `track_id`), `academy_prereqs`, `academy_levels.skills` and `academy_skill_checks`. `academy__complete(learner, level)` is the definition of complete. `academy_sign` checks prerequisites, `academy_check_skill` is leaders only (never your own), and `academy_team` also returns `skills_done`, `skills_total` and `complete`.
  - **Content tables:** `academy_programs` (one row per account), `academy_levels`, `academy_courses`, `academy_lessons` and `academy_questions`.
  - **Progress tables:** `academy_learners`, `academy_lesson_progress`, `academy_attempts` and `academy_signoffs`.
  - **Learners:** a learner is either a user (`user_id`) or a team member without a login (`employee_id`).
  - **Answer keys:** only editors can read `academy_questions`. Everyone else gets questions from `academy_level_questions()`, which leaves the answers out. `academy_check_quiz` and `academy_submit` grade on the server.
  - **Writes:** progress writes go through functions only: `academy_me`, `academy_trainee`, `academy_update_learner`, `academy_save_selfcheck`, `academy_sign`, `academy_unsign`, `academy_verify` and `academy_import_local`. `academy_team` is the leader summary.
  - **Who can see a record:** `academy__can_see` (your own, or a leader's people by `auth_has_location`). **Who can record progress:** `academy__can_act` (your own, or a leader training a team member at their site).
  - **Content edits** go straight to the tables under row security (Admins). Question sets go through `academy_save_questions`.
- **Content seeds:** both go through `academy__import` (service role only; it refuses a track that already has levels).
  - `supabase/seed/academy_mighty_wash.sql` loads Site Support from the old page and removes the old library item.
  - `supabase/seed/academy_maintenance.sql` loads the Maintenance track and makes L6 require T1.
- **Frontend:** `src/features/people/training/academy/` and `src/lib/queries/academy.ts`. `TrainingPage` routes `training/academy/*` to `AcademyRoutes`. `AcademyProvider` loads the program, the signed-in learner, any trainee, and their progress. Lesson styles are in `academy.css`, using the app's theme tokens.
- **Tests:** `supabase/tests/academy.sql` (51 checks) covers hidden answer keys, grading, hidden answers on a failed assessment, sign-off and verify rules, trainees, site scoping, the office screen, editing and the import. It needs the seed loaded, rolls back, and ends by raising `ALL PASS`. `supabase/tests/academy_maintenance.sql` (21 checks) covers tracks, GM needing T1, tiers needing the tier below, and hands-on skill rules. It needs both seeds.

## Not built

- Fire drill crew duties. The source document leaves the red shirt and blue shirt duties blank, so the drills cover the manager's duties only.

- Assigning a level with a due date. The Training tab's assignments are separate, and none exist on Mighty Wash today.
- Badges for finished levels.
- Reminders or texts about unfinished training or sign-offs waiting to be verified.
- A printable certificate.
- Version history for lesson text.
