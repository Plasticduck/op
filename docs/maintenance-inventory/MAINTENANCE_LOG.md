# Maintenance Log

Every job done on the equipment, the schedules that say what's due next, and the parts those schedules will need. It lives at **Maintenance > Maintenance Log** (`/app/maintenance-log`) and is built on Maintenance Inventory's data.

## Who can use it

It has the same two gates as Maintenance Inventory (see [README.md](README.md)):

- **The page:** `MI_EMAILS` in `src/features/maintenance/inventory/access.ts`. Today that's Kevan and Joshua Jowers.
- **The data:** a role under Maintenance Inventory > Settings > People and roles.

| Role | Can do |
| --- | --- |
| Site tech | Log work, mark scheduled tasks done, open a work order for a task, edit their own entries for 7 days, void their own for 24 hours |
| Site manager and up | The above, plus set up, change, pause and remove schedules, skip a task, edit or void any entry at their sites, see Reports |

## The screens

- **Log:** one timeline for the sites a person can see. It merges three sources:
  - entries logged here
  - finished maintenance work orders that no entry already covers
  - parts taken off the shelf outside a work order or entry

  It can filter by site, date range, kind and search, page back in time, and export to CSV. Opening it with `?asset=<id>` shows one machine's whole history.
- **Due:** the to-do list, split into overdue, due now and coming up. Each task can be marked done (its parts come pre-filled from stock at the site), handed to a work order, or skipped by a manager.
- **Schedules:** every schedule, with its own page showing how it runs, the parts each time, and its history. Managers can edit, pause or remove one.
- **Parts forecast:** what the schedules will use in the next 30, 60 or 90 days against what each site has free and on order. A manager can turn the shortages into draft POs.
- **Reports** (managers and up): scheduled jobs done, on-time rate, overdue now, repairs, time spent, downtime, parts and outside costs, a table by site with cost per 1,000 cars, the machines that keep breaking, the costliest machines, and a month-by-month count.

Maintenance Inventory links in from three places:

- **A machine's page:** a Maintenance card with its schedules and Log work, History and Schedule buttons.
- **A part's page:** the schedules that use the part, plus Add a schedule.
- **Scanning a machine's sticker:** a Log maintenance on this button.

## Logging work

One form covers a repair, a quick inspection, a note, or a scheduled task:

- **Basics:** site, machine (search, or scan its MF sticker), kind of work, what was done, and how it went (done, needs follow-up, failed).
- **Parts used:** each one comes off the shelf through `mi_issue_part`, the same as Consume, so stock, average cost and low-stock alerts behave the same everywhere.
- **Photos:** shrunk on the phone before upload.
- **More details:** time spent, machine downtime, vendor and outside cost, and the machine's status afterwards.
- **Follow-up:** a failed or follow-up result can open a follow-up work order.

With no signal, the entry waits on the phone and syncs once when it's back, like stock actions do. Photos need signal: an entry saved offline goes in without them.

Entries can be edited (words and numbers, not parts) and voided. A voided entry stays in the history, crossed out. If it finished a scheduled task, the schedule goes back to how it stood before. Voiding doesn't put parts back on the shelf: use Return on the part's page for that.

## How schedules work

- **What it covers:** a schedule belongs to one site and, optionally, one machine. Setting one up for several sites makes a copy per site. If it names a machine, each other site gets its own machine of the same type, the way checklist templates work. A site with no such machine gets a whole-site schedule, and the form says how many.
- **How often:** by the calendar (every N days, weeks or months), by cars washed at the site, or both, whichever comes first.
- **Car counts:** these come from `site_daily_metrics`, the same count as the dashboards (DRB less test cars, plus FlexWash). The site's number comes from its name (MW01 is site 1), the same match the inventory reports use. A site with no counts shows "No car counts for this site yet".
- **When it's due:**

  | Status | By the calendar | By cars |
  | --- | --- | --- |
  | Coming up | Within the warning window (7 days unless changed) | 90% of the count, or the site's recent volume says it'll get there inside the window |
  | Due | On the due date | At the count |
  | Overdue | After the due date | 10% past the count |

  With both set, the more urgent of the two wins.
- **Next due:** it moves forward from the day the job is done, not from the old due date. A skip moves it on the same way.
- **Work orders:** any task can be handed to a work order with its parts listed as suggestions. Suggestions are planned at zero, so nothing is set aside until someone picks the location, the same as checklist work orders. A schedule can also open its own work order each night once it's coming up. Closing that work order anywhere in Operator logs the job and moves the schedule on, and so does marking the task done here.
- **Reminders:** the nightly job (`mi-nightly`, 3:30am Central) raises one reminder per schedule per cycle when it's due, and one more if it goes overdue. Reminders go out in the same nightly text as low stock: to whoever the schedule is assigned to, otherwise to the site's managers, then the region, then the director and admins. **Texts are off until an admin turns them on** in Maintenance Inventory > Settings, so for now nothing is sent and reminders are marked off.

## Sample data

Seven demo schedules and five past entries sit on real machines at MW01 and MW19 (`supabase/seed/maintenance_log_sample.sql`). They cover overdue, due, coming up and on track, plus one car-count schedule. They don't open work orders, so nothing shows up on the shared Work Orders pages.

Maintenance Inventory > Settings > Sample data removes them along with the rest of the demo. That includes their entries, any work orders they opened, open follow-ups from demo entries, and their reminders. A job someone logs while trying it out is flagged as sample too when it uses demo stock. A job with no demo parts is kept, and can be voided.

## Not built

- A PDF of one machine's history. The Log's CSV export, filtered to the machine, covers it for now.
- Hour meters or other meters. Cars washed is the only usage count.
- Fixed-calendar schedules (always the 1st of the month whatever happens). Next due always counts from when the job was done.
- The existing **Preventive Maintenance** page (`pm_plans`, unused on Mighty Wash) and the **Downtime** page aren't connected. Downtime minutes are kept on log entries instead.

## For developers

- **Database:** migration `0221_mi_maintenance_log.sql`.
  - **Tables:** `mi_schedules` and `mi_schedule_parts`; `mi_log_entries` and `mi_log_entry_parts`, whose lines point at the ledger row that took each part. Work orders gained `mi_schedule_id`.
  - **Writes** go through functions only: `mi_log_add` (idempotent on its client id, and every part goes through `mi_issue_part`), `mi_log_update`, `mi_log_void`, `mi_save_schedule`, `mi_archive_schedule` and `mi_schedule_work_order`.
  - **Where a schedule stands** is computed, never stored: `mi__schedule_state`.
  - **Triggers:** `work_orders_mi_schedule_done` logs a schedule's work order when it closes.
  - **Nightly:** `mi__nightly` calls `mi__schedules_nightly`.
- **Alerts:** `mi_alerts` has a new kind, `maintenance_due`, sent as a digest. The `mi-alerts` function words the nightly text for parts and tasks separately.
- **Frontend:** the screens are in `src/features/maintenance/log/` and the queries in `src/lib/queries/maintenanceLog.ts`. Logging goes through the inventory's offline queue (`act('mi_log_add', ...)`), and `SyncBar` is shared.
- **Tests:** `supabase/tests/maintenance_log.sql` covers roles, due states by date and by cars, idempotent replay, skip and void, work orders both ways, reminders, the forecast, the report, and sample removal. Like the inventory test, it rolls back and ends by raising `ALL PASS`.
