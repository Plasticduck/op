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
- Pre-launch: visible to kevan@washlyfe.com only until Phase 1 slice F ships.

## Phase 1 slices

| Slice | Scope | Status |
|---|---|---|
| A | DESIGN-NOTES.md; migrations 0181-0187 (all Phase 1 tables, RLS, triggers, activity log, bootstrap seed, RPCs); RLS tests; asset list, detail (status / assignment / health badges, Overview + Timeline tabs), Quick Add, full form, clone, add N identical, duplicate warnings | done 2026-10-30. Custom field definitions and fieldset rendering moved to E (settings screen) |
| B | Tag pool (generate, import), QR + Code128, label PDFs (Avery 5160 / 5163 sheets, 2.25 x 1.25 in roll, Brother 62 mm, outdoor), calibration + live preview, print queue | done 2026-10-30. Stickers screen (print queue with sticker stock, blank tags, printer setup), Print sticker on assets and lists, sticker condition on the asset page; printing counts down Sticker Stock (0188) |
| C | Scanner component (shared), `/t/:short/:tag` resolver, manual entry, public report-a-problem page into Work Requests, persistent Scan button, iOS camera permission | done 2026-10-30. `components/scan/BarcodeScanner` (torch, autofocus, beep / buzz, continuous mode), module ScanSheet + floating Scan button, Report problem on assets, Work Requests link back to the device; iOS shell needs a new build to pick up the camera permission |
| D | Check-out / check-in (area, person, parent asset), status changes, retire flow, bulk actions | done 2026-10-30. Check out to a person (site roster, optional signature), area, another device or another site, with due-back date, note, condition photo; check in with the status it came back in; status change with a note; Retire (checks in first, retires the tag) and Move; list selection (tap or scan to select) with bulk Check out / Check in / Status / Move / Print / Remove. "Archive" is now "Remove" (for mistakes), distinct from Retire |
| E | Global search (trigram, Cmd-K), filters, column chooser, saved views + defaults, CSV export, CSV import wizard | next |
| F | Subscriptions + consumables screens, nightly reminders (SMS + email digest, dedupe ledger), org + site dashboard tiles, kiosk heartbeat + manual down; open to owners and managers | |

## Testing

`supabase/tests/it_inventory_rls.sql` (46 checks) impersonates real users of
the demo account and another account inside a rolled-back transaction:
cross-account and cross-site isolation for owner / manager / employee / anon,
immutable activity log, tag uniqueness and retirement, serial / MAC dedupe,
deployable-only check-out, add-N tags, scan resolution, pre-printed tags,
print bookkeeping and sticker stock, and the bulk operations (a broken item
fails alone in a batch, no double check-out, areas must be at the item's site,
check-in status + note, retire checks in and retires the tag, checked-out
items don't move, crew can't check out). Run it after any IT Inventory migration; it must end with
ALL PASS and leave no rows behind.

`node scripts/test-label-scans.mjs` lays out every seeded sticker size with the
real layout code (`src/lib/labels`), rasterizes it at 203 and 300 dpi, and
decodes it with zxing (the scanner's engine): the QR must read back as the
sticker URL and the Code 128 as the tag. Run it after any label change. On
2026-10-30 the full PDF path was also checked once in headless Chrome (pdf.js
render, zxing decode, calibration offsets within 0.25 mm, 50 stickers in
under 40 ms).

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
| later | reminders cron (F) |
