# IT Inventory: build plan and decisions

Spec: [SPEC.md](./SPEC.md). Design notes: [DESIGN-NOTES.md](../../src/features/it/inventory/DESIGN-NOTES.md).
This file records how the spec maps onto the Operator codebase and what is
done. Where SPEC.md and this file disagree, this file is the decision.

## Mapping to the codebase

| Spec | Operator |
|---|---|
| org, `org_id`, orgs table | `accounts`, `account_id`, `auth_account_id()` |
| site, `site_id`, site membership | `locations`, `location_id`, `auth_has_location()` (owners and technicians see every site; managers and employees see `users.location_ids`) |
| owner / admin | `owner` (shown as "Admin") |
| site manager | `manager` (and its role categories) |
| crew | `employee` |
| (not in spec) | `technician`: writes for every site, like an owner without account settings |
| daily ops verdict | does not exist. Closest is the dashboard site scorecard (`src/lib/scorecard.ts`); audit and offline signals feed that |
| crew badge | does not exist. Check-out to a person picks from the site roster (`employees`) |
| Report a problem flow | Work Requests (`work_requests`, public portal pattern). Problem reports become work requests linked to the IT asset |
| SMS / email alerts | `send-sms` edge function (Twilio) and Resend (`RESEND_API_KEY`) |
| customer logo | `accounts.brand_logo_url` (already used on PDFs via `lib/pdfLogo.ts`) |

Access helpers (migration 0181): `it_can_read(loc)`, `it_can_write(loc)`,
`it_is_admin()`, `it_is_staff()`. A null site means account-wide (readable by
everyone in the account, writable by owners only).

Other decisions:
- Status label `color` stores a tone key (`ok`, `accent`, `neutral`, `warn`,
  `danger`), never a hex value, so badges use the existing Badge tones.
- Category `icon` stores a key from a curated lucide map in the module, so only
  the icons we use are bundled.
- `assigned_type = 'user'` points at `employees.id` (the site roster), since
  most crew have no login. `assigned_label` is denormalized for lists.
- Tags are identity: set at creation (generated, pre-printed pool, or typed),
  never changed, never reused. Retiring or deleting an asset retires its tag.
- Serial and MAC are unique per account among live assets (DB enforced), and the
  UI warns before save. IP is an attribute only.
- Account settings (tag prefix, padding, per-site prefixes, short code for QR
  links, audit interval, support phone) live in `it_settings`.
- Label templates are seeded per account so calibration offsets are per
  account and per template, as the spec asks.
- Default saved views ship in code; user views are rows in `it_saved_views`.
- Barcode scanning uses the browser's BarcodeDetector where it supports QR and
  Code 128 (Android Chrome), otherwise `zxing-wasm` directly
  (`src/lib/scan/detector.ts`), lazy-loaded only by the scanner, wasm served
  from our origin. (The `barcode-detector` ponyfill was tried first and
  dropped: v3.2.2 bundles zxing 3.1.3 glue, so pairing it with a self-hosted
  wasm of another version broke at runtime. Using zxing-wasm directly keeps
  glue and wasm in one package, and it is the same engine the scan tests
  decode with.) Code 128 is drawn by a small in-repo encoder, QR by the
  existing `qrcode` package, label PDFs by jsPDF in the browser.
- Sticker QR links: `https://operator.washlyfe.com/t/<it_settings.short_code>/<tag>`
  (`TagLandingPage`). Signed-in users with module access land on the asset;
  everyone else gets the public Report a problem page (`it-scan-public` edge
  function, service role, shows only name / category / site, 5 reports per
  asset per hour). Reports become Work Requests (`work_requests.it_asset_id`)
  and `problem_reported` Timeline rows.
- `vercel.json` Permissions-Policy allows `camera=(self)` (it was `camera=()`,
  which blocks the camera in Chrome).
- RLS tests are SQL scripts run inside a rolled-back transaction
  (`supabase/tests/it_inventory_rls.sql`); there is no pgTAP/Docker setup.
- The iOS shell needs `NSCameraUsageDescription` for in-app scanning; stock
  camera scans of the QR URL work without it.
- Pre-launch: visible to kevan@washlyfe.com only (route `RequireEmails` plus
  the Sidebar item's `emails`) until Kevan says to open it. Opening it also
  shows the IT tiles on the main dashboard (they follow the nav item).
- Reminders (`it-reminders` edge function, 8 AM Central via pg_cron at 13:00
  and 14:00 UTC with an hour guard) send nothing for an account until an admin
  turns them on in Settings (`it_settings.reminders_enabled`, default off). The
  seeded rules keep the spec's thresholds. Thresholds are crossings, not exact
  days: an item first seen 5 days out gets only the 7-day reminder, and a
  missed morning catches up the next day. Each reminder is claimed in
  `it_reminder_sends` (unique key) before it's sent, and un-claimed if the send
  fails. Digest (default): one text and one email per person per day.
  Recipients: Admins and technicians for every site, managers for their own
  sites, plus people named on the rule and a subscription's owner. Texts only
  go to people with a mobile number who opted in to texts.
- A subscription that renews by itself with a notice period is due on its
  cancel-by date (renewal minus notice); otherwise on its renewal date.
  "Mark renewed" moves the renewal date one billing cycle.
- Supplies: `counted_at` is the last time a person counted or restocked. A
  supply nobody has counted (the seeded Sticker Stock rows start at 0) says
  "Not counted" and never counts as low. `low_since` is set by trigger when a
  counted supply drops to its minimum (min 0 = no reminder) and cleared when
  it's back above; reminders use it as the due date (once per dip).
- IT Inventory tracks; it does not monitor (Kevan, 2026-10-30: Mighty Wash
  already gets downtime alerts elsewhere). The spec's heartbeats, site probe,
  ping / TCP / HTTP checks, offline and recovery texts, and Phase 3 network
  discovery are out of scope. 0192 shipped device heartbeats; 0194 removed
  them. "Health" is what people report: "Not working" (asset page, a problem
  report, or the public sticker page) until someone marks it working, which
  clears it to no known problem. `it_health_events` keeps those reports; the
  asset's Timeline shows "Marked not working" / "Marked working" with the note.
  The header badge only appears when something is reported not working.

## Phase 1 slices

| Slice | Scope | Status |
|---|---|---|
| A | DESIGN-NOTES.md; migrations 0181-0187 (all Phase 1 tables, RLS, triggers, activity log, bootstrap seed, RPCs); RLS tests; asset list, detail (status / assignment / health badges, Overview + Timeline tabs), Quick Add, full form, clone, add N identical, duplicate warnings | done 2026-10-30. Custom field definitions and fieldset rendering moved to E (settings screen) |
| B | Tag pool (generate, import), QR + Code128, label PDFs (Avery 5160 / 5163 sheets, 2.25 x 1.25 in roll, Brother 62 mm, outdoor), calibration + live preview, print queue | done 2026-10-30. Stickers screen (print queue with sticker stock, blank tags, printer setup), Print sticker on assets and lists, sticker condition on the asset page; printing counts down Sticker Stock (0188) |
| C | Scanner component (shared), `/t/:short/:tag` resolver, manual entry, public report-a-problem page into Work Requests, persistent Scan button, iOS camera permission | done 2026-10-30. `components/scan/BarcodeScanner` (torch, autofocus, beep / buzz, continuous mode), module ScanSheet + floating Scan button, Report problem on assets, Work Requests link back to the device; iOS shell needs a new build to pick up the camera permission |
| D | Check-out / check-in (area, person, parent asset), status changes, retire flow, bulk actions | done 2026-10-30. Check out to a person (site roster, optional signature), area, another device or another site, with due-back date, note, condition photo; check in with the status it came back in; status change with a note; Retire (checks in first, retires the tag) and Move; list selection (tap or scan to select) with bulk Check out / Check in / Status / Move / Print / Remove. "Archive" is now "Remove" (for mistakes), distinct from Retire |
| E | Global search (trigram, Cmd-K), filters, column chooser, saved views + defaults, CSV export, CSV import wizard | done 2026-10-30. `it_search` in Cmd-K (exact tag / serial first); list filters (area, model, manufacturer, checked out, health, warranty, audit, sticker, purchase dates, custom fields), column chooser, header sort, 200-row pages, CSV export, built-in + saved (personal / shared) views; import wizard for equipment, models and subscriptions (auto-matched columns, dry run, per-row errors and downloadable report, create-missing options, sticker printing for new items); Settings (tag prefix / digits / sticker phone) and custom fields per category, including Vault secrets |
| F | Subscriptions + consumables screens, nightly reminders (SMS + email digest, dedupe ledger), org + site dashboard tiles, kiosk heartbeat + manual down; open to owners and managers | done 2026-10-30, except opening it up (waiting on Kevan). Heartbeats were built and then removed (0194: tracker, not monitor). Module tabs (Overview, Equipment, Subscriptions, Supplies); Overview for all sites (needs-attention tiles, by site, by category, monthly subscription spend, repairs in 90 days) and one site (area by area); Subscriptions (cost, monthly and yearly totals, cancel-by, mark renewed, devices covered, CSV export); Supplies (count, restock, use, history, low); Reminders settings (on/off, kinds, days, text/email, who, preview, send me a test); `it-reminders` edge function; IT tiles on the main dashboard (All sites and the site view); mark working / not working, "Covered by" on the asset page |

## Phase 2

The spec's Phase 2, minus the site probe and offline alerts (tracker, not
monitor; see above).

| Slice | Scope | Status |
|---|---|---|
| G | Physical audits, inside IT Inventory (Kevan: not in the checklist list) | done 2026-10-30. Audits tab: each site with how much is overdue or due, start / continue, past audits. The walk: continuous scanning by area in walk order, "you're in" area (an item found elsewhere moves there at the end), sticker readable / faded / missing, tap an item for missing / damaged, note, photo and fields marked "editable during audit"; another site's sticker offers "Move it here" to people who manage both; unknown stickers are noted. Finishing needs every item resolved ("mark the rest missing"), then sets last / next audit dates per category interval, sticker condition (faded or missing goes to the print queue), area and fields, with an "audited" Timeline row per item. The report offers Mark lost, Change status, Print stickers and Add it. Settings > Audits: interval, warning days, per-kind overrides. Not done: AI photo checks on audit photos, and the overdue signal on the dashboard scorecard (it would change site grades) |
| H | Repairs: maintenance records and types, back to the prior status when done, downtime, cost rollups | done 2026-10-30. "Log repair" on the asset page and a Repairs tab (open jobs with Mark done and Edit, finished jobs, total spent and downtime). Logging can take the item out of service (Out for Repair now, its earlier status back when the job is marked done, downtime counted); past jobs can be logged as done with hours out. Repairs and service page (from the Overview tile and the Equipment menu): open now, spent in 90 days and this year, downtime, filters, CSV export, cost by site and by kind of gear over 12 months. Timeline shows logged / done / edited / removed jobs |
| I | Accessories (count-based, checked out to people or devices) | done 2026-10-30. On the Supplies tab behind a Supplies / Accessories switch (supplies get used up; accessories come back). Total, out and left per site, low at the minimum, check out a number to a person on the roster or a device at the site (with due back and a note), who has them (overdue in red), check in, returned history, add / edit / remove. "Accessories with it" on a device's page. Five accessory kinds seeded (Charger or Cable, Case or Mount, Keyboard or Mouse, Headset or Radio, Other Accessory) |
| J | Photo to form (make, model, serial from a label photo) | next |
| K | Company logo on stickers, more label sizes | |

Audits are their own tables (`it_audit_runs`, `it_audit_items`), not checklist
runs; `checklist_run_id` stays for the spec's data model but is unused. Crew
can audit (spec: read, scan, audit, report), so `it_start_audit`,
`it_audit_scan` and `it_complete_audit` check `it_can_read`, and equipment
only changes inside `it_complete_audit`. Items are updated directly (RLS
plus a guard trigger that allows only result, sticker, area, fields, photo and
note while the audit is open). One open audit per site; a second person who
starts it joins the same one. Audit photos go to `<account>/audit/` in the
`it-inventory` bucket, which any account member may upload to.

Repairs: `it_log_repair` and `it_finish_repair` (security invoker, so RLS
decides; managers and admins only) keep the status the item had on the job
(`prior_status_id`) and when it went out (`out_of_service_at`). A second job
while it's already out copies the first job's earlier status, and the item
comes back only when the last open job is done, and only if it's still out
of service (someone retiring it in the meantime wins). Downtime runs to now,
or to the end of the day it was done if that date is in the past (Central).
Spend counts finished jobs on the day they were done; estimates on open jobs
don't count.

Accessories (`it_accessories`, `it_accessory_assignments`, view
`it_accessory_stock` for out / left): rules are in triggers. A check-out locks
the accessory row, so two people can't take the last one; it can't exceed
what's left, must go to someone on the account's roster or a device at the
same site, and keeps the accessory's name for the history. The total can't
drop below what's out, and an accessory can't change site while any are out.
Check-outs are closed by checking in (no deletes). A check-out to a device
carries `asset_id`, so it shows on that device's Timeline. Accessories aren't
in the low-stock reminders (supplies are).

## Testing

`supabase/tests/it_inventory_rls.sql` (132 checks) impersonates real users of
the demo account and another account inside a rolled-back transaction:
cross-account and cross-site isolation for owner / manager / employee / anon,
immutable activity log, tag uniqueness and retirement, serial / MAC dedupe,
deployable-only check-out, add-N tags, scan resolution, pre-printed tags,
print bookkeeping and sticker stock, and the bulk operations (a broken item
fails alone in a batch, no double check-out, areas must be at the item's site,
check-in status + note, retire checks in and retires the tag, checked-out
items don't move, crew can't check out), CSV import (dry run saves nothing and
uses no tag numbers, new models need permission, bad rows fail alone, existing
tags update, re-importing the same file makes no duplicates, managers can't
import into or pull from other sites, only admins add every-site
subscriptions), search, Vault secrets (owner-only, reveals logged, values
never in the log), and slice F: overview numbers scoped like the lists (a
manager sees only their site, anon nothing), supplies (uncounted is never low,
counting / using / restocking move it in and out of low, stock moves aren't
logged as edits), working order (crew can report something not working,
the note reaches the Timeline, the overview counts it, marking it working
clears it, people can't record anything but manual reports), audits (the
list is every active item at the site, one open audit per site, managers
can't audit other sites, a scan marks found and a repeat says so, another
site's sticker shows only that site's name to someone who can't see it,
unknown stickers are noted, it won't finish with unchecked items, rows can't
be re-pointed, finishing sets dates / sticker / area / only audit-editable
fields and writes Timeline rows for found and missing items, a finished audit
can't be changed, other companies see nothing), repairs (out of service sets
Out for Repair and keeps the old status, a second open job keeps the original,
finishing one of two doesn't bring it back early, finishing records date /
cost / downtime and restores the status, no finishing twice, a past job
changes nothing, Timeline rows, no repairs at other sites or by crew, no
finishing before starting), accessories (categories seeded, a person's
name and the site filled in, an unknown check-out type refused, the stock view
counts out and left, a device check-out points at the device and reaches its
Timeline, no checking out more than are left, no lowering the total below
what's out, checking in records who and frees them, closed check-outs can't
change, no adding at another site, no lending to a device at another site,
crew can't check out, other companies see nothing), and reminder
candidates (warranty, cancel-by date, low stock; nothing from other accounts;
not readable by app roles).

Import performance: 500 equipment rows commit in about 1.7 s and re-run in
about 1.6 s (spec: under 60 s; the request limit is 8 s, and the wizard sends
200 rows per call). Run it after any IT Inventory migration; it must end with
ALL PASS and leave no rows behind.

`node scripts/test-label-scans.mjs` lays out every seeded sticker size with the
real layout code (`src/lib/labels`), rasterizes it at 203 and 300 dpi, and
decodes it with zxing (the scanner's engine): the QR must read back as the
sticker URL and the Code 128 as the tag. Run it after any label change. On
2026-10-30 the full PDF path was also checked once in headless Chrome (pdf.js
render, zxing decode, calibration offsets within 0.25 mm, 50 stickers in
under 40 ms).

Reminders were checked on 2026-10-30 against temporary demo data (called from
the database with the cron's key, so nothing was sent): the preview picked the
manager for their site's items only, the Admin for those plus the every-site
subscription, no crew, and the right thresholds (30 days out -> the 30-day
reminder, 5 days -> 7, cancel-by 10 days -> 30). Claiming the same reminder
twice through PostgREST returned it once, then nothing. The slice F screens
were checked in headless Chrome at phone and desktop width, light and dark,
with data captured from the demo account (64 checks: tiles and their links,
totals, sorting, the forms and the calls they make, no sideways scroll).

Scanning was checked end to end on 2026-10-30 in headless Chrome with a fake
camera playing a printed sticker: `BarcodeScanner` read it through the
zxing-wasm path in about a second from a cold page load; the public `/t` page
showed only name, category and site (not the serial), filed a report, and
turned away an unknown sticker. The `it-scan-public` function was also checked
directly: other companies' codes and missing tags both answer "not found",
empty reports are refused, the sixth report in an hour is refused, and
unknown-sticker reports need a signed-in caller.

Sticker rules that keep scans reliable (in `layout.ts`): QR 4-module quiet
zone (ECC M; Q on outdoor), Code 128 10-module quiet zones, bars never under
0.19 mm (the barcode is dropped rather than printed unreadable), tags never
truncated (shrunk to fit), QR rows overlap slightly so printers leave no seams.

## Migrations

| File | Contents |
|---|---|
| 0181_it_core | pg_trgm, access helpers, `it_settings`, tag counters, label templates, manufacturers, categories, custom fields + fieldsets, models, status labels, site areas, suppliers |
| 0182_it_assets | tag pool, assets (+ trigram and lookup indexes), tag generation, asset triggers, assignments, maintenance types + records, health events, secret values (Vault) |
| 0183_it_subscriptions_consumables | subscriptions + asset links, consumables + stock events |
| 0184_it_labels_attachments | print jobs, attachments, `it-inventory` storage bucket |
| 0185_it_activity_log | append-only log written by triggers on every entity; app roles cannot change it |
| 0186_it_views_reminders | saved views, reminder rules, reminder send ledger |
| 0187_it_bootstrap | per-account seed (`it_bootstrap()`), tag resolve, duplicate check, tag pool RPCs |
| 0188_it_sticker_stock_on_print | printing stickers counts down each site's Sticker Stock |
| 0189_it_problem_reports | `work_requests.it_asset_id`; `problem_reported` activity action |
| 0190_it_checkout_status | bulk RPCs `it_check_out` / `it_check_in` / `it_set_status` / `it_move` (security invoker, per-item results); notes on log rows via `it.note`; attachment photos on the asset Timeline; check-out areas must be at the item's site |
| 0191_it_search_import | `it_search` (invoker, trigram); `it_import_assets` / `it_import_models` / `it_import_subscriptions` (definer with explicit per-site checks: invoker RLS made 500 rows take 44 s, now 1.7 s); `it_find_site`, `it_num`, `it_log_import` |
| 0192_it_overview_health | `it_overview` (dashboard numbers, invoker); `it_settings.reminders_enabled`; supplies `counted_at` / `low_since`; health events change the asset's badge; `it_device_links` + `it_link_device` / `it_unlink_device` / `it_heartbeat`; `it_health_sweep` (cron every 2 min) and a daily 90-day prune; `it_reminder_candidates` (service role only) |
| 0193_it_reminders_cron | `it-reminders` at 8 AM Central |
| 0195_it_audits | `it_audit_runs` / `it_audit_items` with RLS and a guard trigger; `it_start_audit`, `it_audit_scan`, `it_complete_audit`, `it_cancel_audit`; audit photo uploads for anyone in the account |
| 0196_it_repairs | `it_maintenances.prior_status_id` / `out_of_service_at`; `it_log_repair`, `it_finish_repair` |
| 0197_it_accessories | `it_accessories`, `it_accessory_assignments`, `it_accessory_stock` view, guard triggers; accessory categories (existing accounts here, new ones via `it_bootstrap`) |
| 0194_it_tracker_not_monitor | removes the device heartbeats (functions, table, sweep cron); `it_overview` counts "not working" reports and each site's overdue audits |
