# IT Inventory module: product spec

Source: product brief from Kevan, 2026-10-30. Kept verbatim (lightly formatted) so
every build session works from the same document. Codebase mapping decisions
(org = `accounts`, site = `locations`, role mapping, deviations) live in
[PLAN.md](./PLAN.md); where the two disagree, PLAN.md records the decision.

## Role and product context

You are a senior full-stack engineer working inside the existing Wash Lyfe Operator codebase. Design and build a new IT Inventory module as a native feature of Operator, not a separate app. Before writing code, read the existing schema, RLS policies, auth and org/site/user model, checklist engine, photo upload and AI photo verification pipeline, SMS alert service, and the shared UI component library and theme. Reuse all of it. Propose a short implementation plan and migration list first, then build phase by phase.

Wash Lyfe Operator is a multi-site operations SaaS for car wash operators, lube centers and auto centers. The typical customer is a six-site car wash chain with no dedicated IT staff. Site managers and owners, not technicians, will use this module. Existing features: site checklists with AI photo verification, crew gamification, QR-code tipping, a daily ops verdict per site, and SMS alerts.

Tech stack: React + Vite frontend, Supabase (Postgres, Auth, Storage, Edge Functions, RLS).

The IT footprint to track per site: POS terminals, pay stations and auto cashiers, tunnel and wash controllers (PLCs), tablets and handhelds, security cameras and NVRs, license plate recognition (LPR) cameras and servers, routers, firewalls, switches, Wi-Fi access points, ISP modems and cellular backup modems, receipt and label printers, digital signage and menu board players, and UPS units. Also track recurring subscriptions (ISP circuits, POS software, LPR service, camera cloud, signage SaaS, cellular plans) and consumables (receipt paper, label stock, asset sticker stock).

Every physical asset in this module gets a physical sticker carrying a QR code and a 1D barcode. The sticker system is a core part of the design, not an add-on. See the tagging section below.

## Design principles

These come from what users of Snipe-IT, Lansweeper and NinjaOne praise and complain about.

1. Time to value under 15 minutes for a new org: seeded categories, manufacturers, status labels and car wash templates so the first asset can be added and its sticker printed immediately.
2. Minimal required fields. To create an asset require only site, category, and name or model. Everything else is optional and progressively disclosed. Do not show 30 empty fields (a common Snipe-IT complaint).
3. Mobile first. Managers will scan stickers with a phone camera standing at the pay station. Every core workflow (scan, view, check out, audit, add photo, report a problem) must work one-handed on a phone. A weak mobile experience is a top complaint for both Snipe-IT and NinjaOne.
4. Scan is the primary entry point. Assume most interactions begin with a scanned sticker, not a typed search. Design every asset screen so that arriving by scan is the fastest path.
5. Fast asset detail page: one page that answers what is it, where is it, who has it, is it healthy, is it under warranty, and what happened to it. Target under 1 second to interactive on cached data.
6. One search box. A single global search across asset tag, name, serial, model, IP, MAC and notes. Do not ship two competing search fields (a Snipe-IT complaint).
7. Unambiguous status. Separate lifecycle status (status label), assignment (checked out to X) and health (online or offline). Show all three as distinct badges. Never show Ready to Deploy on an item that is currently checked out (a known Snipe-IT confusion).
8. No duplicates. Deduplicate on asset tag, serial number and MAC address within an org, and warn before creating a likely duplicate (a Lansweeper complaint: records duplicate when IPs change). IP address is an attribute, never an identity.
9. Reports that are quick and simple: every list is filterable, sortable, column-configurable, exportable to CSV, and savable as a view. Avoid deep report builders (Lansweeper and NinjaOne users complain reports are clicky or limited).
10. No asset count limits. Never block adding an asset or a site because of a count.
11. Same product, same feel. The module must look and behave like the rest of Operator. See the next section.

## Visual design and theme consistency

The IT Inventory module must be indistinguishable in look, feel and voice from the rest of Operator. A user moving from the checklist screen to the inventory screen should not notice a change in design.

Before building any UI:

1. Inventory the existing design system. Locate the theme tokens (colors, typography scale, spacing scale, radii, shadows, breakpoints), the shared component library (buttons, inputs, selects, badges, cards, tables, modals, drawers, tabs, toasts, empty states, skeleton loaders), the layout shell (navigation, page headers, site switcher), and the icon set. Document what you find in a short DESIGN-NOTES.md in the module folder and reference it throughout the build.
2. Use only existing tokens and components. Do not introduce new colors, fonts, spacing values, icon libraries, or component variants. If the module needs something the library does not have (for example a scanner viewfinder overlay or a label preview), build it from existing primitives and tokens and add it to the shared library, not to the module alone.
3. Match existing patterns one for one. Lists look like Operator's other lists. Detail pages use the same header, tab and action-bar structure as existing detail pages (for example a site or a checklist run). Forms use the same field layout, validation styling and save behavior. Status badges use the same badge component and color semantics already used for checklist results and ops verdicts (for example the same green, amber and red meanings).
4. Follow the existing navigation model. Add IT Inventory where other site-level modules live in the nav, with the same site-scoping behavior. The org dashboard tile and the site Today strip must use the same card and tile components as the existing dashboards.
5. Keep the product voice. Labels, empty states, error messages, confirmations and SMS copy follow the existing Operator personality framework and tone (plain, direct, confident, written for a site manager, never for a sysadmin). Reuse existing copy patterns for confirmations and destructive actions.
6. Respect existing responsive and accessibility behavior: same breakpoints, same touch target sizes, same focus states, same dark mode handling if Operator has one.
7. Print and label output should carry Operator branding where there is room (a small wordmark or the customer's logo if Operator already supports customer logos) but must never sacrifice scan reliability for decoration.

Acceptance check: a designer reviewing side by side screenshots of an existing Operator page and a new inventory page should find no token, component or layout differences other than content.

## Sticker, barcode and QR code tagging system

Every physical asset gets a durable sticker carrying a QR code, a 1D barcode and a human-readable asset tag. The sticker is the primary identity of the device in the field. Build the system so that a manager with a roll of stickers and a phone can tag an entire site in one visit.

### Asset tag format

1. Tags auto-generate per org with a configurable prefix and zero padding, for example WL-000123. Allow a per-site prefix option (for example LBK3-0042). Allow manual override. Enforce uniqueness per org.
2. Support pre-printed tag pools: an org can import or generate a batch of unused tags (for example 500 tags for a sticker vendor order) that exist in it_asset_tags with status unused until they are applied to an asset. Applying a pre-printed sticker then only requires scanning it and filling the Quick Add form.
3. Never reuse a retired tag. Keep the tag reserved to the retired asset forever.

### What is encoded

1. QR code: a short URL, for example https://app.washlyfe.../t/{org_short}/{asset_tag}. Scanning with any stock phone camera opens the asset page for a logged-in user, or a minimal Report a problem with this device page for a logged-out user. The public page exposes only the asset name, category, site and a problem form; no serial, IP, cost or owner data.
2. 1D barcode: Code128 encoding the bare asset tag, for use with USB and Bluetooth barcode scanners at a desk and for fast lookup through the global search box.
3. Human-readable text: asset tag in large type, short asset name, site name, and an optional support phone line. Optional small Operator wordmark or customer logo.

### Label generation and printing

1. Generate print-ready PDFs for (a) sheet labels using Avery-style templates (for example 5160, 5163, 8160 equivalents) and (b) single-label rolls for common thermal printers in 2.25 x 1.25 inch and 62 mm Brother QL, Dymo LabelWriter and Zebra sizes.
2. Provide a calibration test print and X/Y offset and scale adjustments saved per org and per template, because misaligned labels are a known Snipe-IT complaint. Show a live on-screen preview that matches the printed output.
3. Support bulk printing from any filtered list or selection, with sort order matching the physical walk through a site (by area, then by tag). Also support printing a sheet of blank pre-printed tags from a tag pool.
4. Offer a hardened outdoor variant layout for tunnel equipment, vacuum stations and pay lanes, sized for weatherproof polyester or vinyl stock, with high-contrast QR and a quiet zone that still scans when partly dirty or faded. Document recommended sticker materials in the admin guide.
5. Log every print as label_printed in the activity log, including template, quantity and who printed.

### In-app scanning

1. Build a scanner component using a web barcode library that reads QR and Code128 from the phone camera, with a flashlight toggle, autofocus hint, haptic and sound feedback on a successful read, and a continuous scan mode for audits and bulk check-out.
2. Scan resolution rules: a tag that matches an asset opens it; a tag from the unused pool opens Quick Add with the tag prefilled; an unknown tag offers to create an asset with that tag or to report it; a tag from another org is rejected with a plain message.
3. Fallback: a manual tag entry field with the same resolution rules, for damaged stickers.
4. Scanning must work on iOS Safari and Android Chrome without installing an app, inside the existing Operator web app shell.

### Sticker lifecycle

1. Track sticker condition during audits (readable, faded, missing) and queue a reprint list per site.
2. When a replacement sticker is printed for an existing asset, keep the same tag; do not mint a new one.
3. Support secondary stickers for an asset (for example one on the device and one on the equipment room shelf) using the same tag.

## Data model (Supabase Postgres)

### General rules

1. Every table has id uuid primary key default gen_random_uuid(), org_id uuid not null referencing the existing orgs table, created_at, updated_at and created_by. Site-scoped tables also have site_id referencing the existing sites table.
2. Soft delete via deleted_at on user-facing entities.
3. Enable RLS on every table. Org members can read rows in their org. Site-scoped rows are readable only by users with access to that site, reusing the existing site membership model. Writes are limited by role: owner and admin can do everything; site manager can write for their sites; crew can read plus scan, audit and report a problem. Write pgTAP or SQL tests proving cross-org and cross-site isolation.
4. Use Postgres enums or check constraints where noted. Prefix all tables with it_.

### Tables

1. **it_manufacturers**: name, website, support_phone, support_url, warranty_lookup_url. Seed common manufacturers and let orgs add their own.
2. **it_categories**: name, kind (asset, accessory, consumable, component, subscription), icon, default_fieldset_id, requires_ip boolean, default_monitoring boolean, label_template_id (default sticker layout for the category, for example outdoor for pay stations). Seed car wash categories: POS Terminal, Pay Station, Tunnel Controller, Tablet, Handheld Scanner, Security Camera, NVR, LPR Camera, LPR Server, Router/Firewall, Switch, Wi-Fi Access Point, ISP Modem, Cellular Backup Modem, Receipt Printer, Label Printer, Signage Player, Display, UPS, Other.
3. **it_asset_models**: manufacturer_id, category_id, name, model_number, image_path, eol_months, default_warranty_months, depreciation_id (nullable), fieldset_id (nullable), notes. Assets inherit defaults from their model, following Snipe-IT.
4. **it_status_labels**: name, type (deployable, pending, undeployable, archived), color, is_default, sort_order. Seed: In Service (deployable), Spare / In Stock (deployable), Being Set Up (pending), Out for Repair (undeployable), Broken (undeployable), Lost / Stolen (undeployable), Retired (archived). Archived assets are hidden from default lists.
5. **it_site_areas**: site_id, name (for example Tunnel, Equipment Room, Pay Lane 1, Pay Lane 2, Office, Vacuum Area, Lube Bay). Seed defaults per site and let managers edit them.
6. **it_suppliers**: name, contact_name, phone, email, account_number, notes.
7. **it_asset_tags**: org_id, tag (unique per org), status (unused, applied, retired), source (generated, imported, pre_printed), batch_id, asset_id (nullable), printed_count int, last_printed_at. This is the tag pool that makes pre-printed sticker rolls work.
8. **it_assets**: site_id, area_id (nullable), asset_tag (unique per org, references it_asset_tags.tag), name, model_id, category_id (denormalized for fast filtering), serial, status_label_id, assigned_type (site, area, user, asset, null), assigned_id, parent_asset_id (for example camera to NVR), purchase_date, purchase_cost numeric, supplier_id, order_number, warranty_end_date, eol_date, ip_address inet, mac_address macaddr, hostname, monitoring_enabled boolean, monitor_method (none, heartbeat, ping, tcp, http), monitor_target text, monitor_interval_seconds int default 120, last_seen_at, health_state (unknown, online, degraded, offline), health_changed_at, next_audit_date, last_audit_at, sticker_condition (ok, faded, missing, unknown), sticker_last_verified_at, custom_values jsonb, notes, image_path, deleted_at. Indexes: (org_id, site_id), (org_id, asset_tag), serial, mac_address, trigram index on name, serial and notes, (org_id, warranty_end_date), (org_id, next_audit_date).
9. **it_custom_fields**: name, key, field_type (text, number, date, boolean, select, url, ip, secret), options jsonb, help_text, is_required boolean, show_in_list boolean, editable_during_audit boolean. Secret fields (for example admin passwords) are encrypted at rest via Supabase Vault, visible only to owner and admin, with every reveal logged.
10. **it_fieldsets** and **it_fieldset_fields** (fieldset_id, field_id, sort_order): groups of custom fields attached to models or categories.
11. **it_assignments**: asset_id, assigned_type, assigned_id, checked_out_at, checked_out_by, expected_return_at, checked_in_at, checked_in_by, note, signature_path (nullable), photo_path (nullable). This is the check-out history.
12. **it_maintenances**: asset_id, maintenance_type_id, title, supplier_id, is_warranty boolean, cost numeric, start_date, completion_date, downtime_minutes, notes, created_by. **it_maintenance_types**: name, color. Seed: Repair, Preventive Maintenance, Upgrade, Replacement, Vendor Service Call, Firmware Update.
13. **it_subscriptions**: site_id nullable (null means org-wide), name, supplier_id, category_id, account_number, seats int nullable, cost numeric, billing_cycle (monthly, quarterly, annual, other), start_date, renewal_date, auto_renew boolean, cancel_notice_days int, owner_user_id, notes. **it_subscription_assets** join table.
14. **it_consumables**: site_id, category_id, name, model_number, qty_on_hand int, min_qty int, reorder_url, supplier_id. **it_consumable_events**: consumable_id, delta int, reason (restock, used, adjustment), user_id, note. Seed a Sticker Stock consumable per site so label stock is tracked like receipt paper.
15. **it_accessories** (phase 2): site_id, category_id, name, qty_total, min_qty; it_accessory_assignments to users or assets.
16. **it_label_templates**: org_id nullable (null means system template), name, kind (sheet, roll), page_spec jsonb (page size, columns, rows, label size, margins, gutters), layout jsonb (which elements appear and where: qr, barcode, tag, name, site, phone, logo), offset_x_mm, offset_y_mm, scale, is_outdoor boolean, is_default boolean. **it_label_print_jobs**: template_id, asset_ids uuid[], tag_ids uuid[], printed_by, printed_at, pdf_path.
17. **it_attachments**: entity_type, entity_id, storage_path, mime_type, kind (photo, receipt, manual, warranty, config_backup, other), caption, uploaded_by. Use the existing Supabase Storage bucket conventions and signed URLs.
18. **it_audit_runs**: site_id, checklist_run_id (link to the existing checklist engine), scheduled_for, started_at, completed_at, completed_by, status (scheduled, in_progress, completed, overdue). **it_audit_items**: audit_run_id, asset_id, result (found, missing, wrong_location, damaged, not_checked), sticker_condition, scanned_at, photo_path, ai_verification_result jsonb, note.
19. **it_activity_log**: append-only. entity_type, entity_id, action (created, updated, checked_out, checked_in, status_changed, audited, maintenance_logged, health_changed, imported, deleted, secret_revealed, label_printed, tag_applied, tag_retired), actor_user_id or actor_system, before jsonb, after jsonb, created_at. Write rows from Postgres triggers so the history cannot be bypassed. Revoke UPDATE and DELETE on this table from all app roles.
20. **it_health_events**: asset_id, observed_at, state, latency_ms, source (heartbeat, probe, manual). Prune after 90 days; keep state transitions forever in it_activity_log.
21. **it_site_probes** (phase 2): site_id, name, token_hash, last_checkin_at, version, ip_address. **it_discovered_devices** (phase 3): site_id, probe_id, mac_address, ip_address, hostname, vendor_from_oui, fingerprint jsonb, first_seen_at, last_seen_at, guessed_category_id, status (unclaimed, claimed, ignored), claimed_asset_id.
22. **it_saved_views**: user_id, org_id, entity, name, filters jsonb, columns jsonb, sort jsonb, is_shared boolean.
23. **it_reminder_rules**: org_id, kind (warranty, subscription_renewal, audit_due, eol, low_stock, offline, sticker_reprint), days_before int[], channels (sms, email, in_app), recipients. Defaults: warranty and renewals at 60, 30 and 7 days; audits at 7 days; offline after the health threshold.
24. **it_depreciations** (phase 3): name, months, min_value. Linear method only to start.

## Core workflows

### A. Adding assets

1. Scan to add (primary mobile path): scan an unused pre-printed sticker, the Quick Add form opens with the tag prefilled; pick site and area (defaulting to the user's current site), pick category or model with type-ahead, optional photo. Save in under 30 seconds.
2. Quick Add without a sticker: same form; the tag auto-generates and the app offers to print a sticker now or add it to the site's print queue.
3. Full form with model defaults prefilled and custom fields from the fieldset.
4. Clone asset for adding the second and third identical pay station.
5. Bulk add: Add N identical units generates sequential tags and queues N stickers.
6. Photo-first add (phase 2): photograph the device's model and serial sticker; an edge function uses the existing AI vision pipeline to extract manufacturer, model and serial into the form for confirmation. Never auto-save AI guesses without user confirmation.
7. CSV import wizard: upload, auto-map columns by header similarity, let the user fix the mapping, preview the first 20 rows with validation errors, dry run, then commit. Create missing manufacturers, models, categories and areas on the fly when the user approves. Match existing assets by asset tag or serial to update instead of duplicating. Keep an import record in the activity log with a downloadable error report. Provide template CSVs per entity. After import, offer to print stickers for every imported asset that has none.

### B. Tagging and labels

See the sticker, barcode and QR code section above. Every add path ends with a sticker either printed or queued. The site print queue is a first-class screen: a list of assets at the site without a verified sticker, printable in one job.

### C. Check-out and check-in

1. Check out an asset to a site area, a person, or a parent asset, with optional expected return date, note, photo and signature. Only assets whose status label type is deployable can be checked out; block undeployable, pending and archived types with a clear message.
2. Scan-driven check-out: scan the sticker, choose the target, done. For a person, allow scanning their crew badge or picking from the site roster.
3. Check-in returns the asset to the site's stock, prompts for a new status label (for example Broken or Spare / In Stock) and an optional condition photo.
4. Bulk check-out and check-in from a selection or from continuous scan mode (for example hand out four tablets to the morning crew).

### D. Lifecycle statuses

Status changes are explicit actions with an optional note; each one is logged. Show status, assignment and health as three separate badges.

### E. Physical audits by site (reuse the checklist and photo verification infrastructure)

1. Org-level audit interval (default 6 months) and warning threshold (default 7 days), overridable per category (for example LPR cameras every 3 months). After an audit, next_audit_date = audit date + interval.
2. An audit run for a site generates a checklist in the existing checklist engine: one item per expected asset at that site, grouped by area, ordered to match a natural walk through the site.
3. On a phone the auditor walks the site in continuous scan mode. Each scan marks the asset found, records sticker condition, and offers to update its area if it differs. Unscanned items remain to be resolved as missing, damaged or other. Scanning an asset registered to a different site flags wrong location with a one-tap move.
4. Optional photo per item, verified by the existing AI photo verification (for example confirm the photo shows a pay station with a visible sticker).
5. Custom fields marked editable_during_audit (for example firmware version, condition) can be updated inline.
6. Completing an audit writes audit rows, updates last_audit_at and next_audit_date, adds faded or missing stickers to the site print queue, and feeds a pass or fail signal into the daily ops verdict if audits are overdue or items are missing.

### F. History and audit trail

Every asset page has a Timeline tab that reads from it_activity_log: who did what, when, before and after values, with links to related assignments, maintenances, audits, health changes, label prints and attachments. Filter by event type.

### G. Warranty, EOL and renewal tracking with reminders

1. warranty_end_date is computed from purchase_date plus the model's default_warranty_months unless set manually. Show warranty badges: Active, Expiring within 60 days, Expired.
2. Subscriptions show renewal date, cost, cancel-notice deadline (renewal_date minus cancel_notice_days) and auto-renew flag.
3. A nightly scheduled edge function evaluates it_reminder_rules and sends SMS and email through the existing alert service, de-duplicated per asset, rule and threshold, with a digest mode (one SMS per manager per day summarizing everything due). Low-stock consumables, including sticker stock, trigger the same way.

### H. Search, filter and saved views

1. Global search (Cmd/Ctrl+K on desktop, a search bar on mobile) across tag, name, serial, model, manufacturer, IP, MAC and notes using Postgres trigram plus full-text. Exact asset tag or serial matches, including a Code128 scan from a USB scanner, jump straight to the asset.
2. List filters: site, area, category, model, manufacturer, status label, status type, assigned to, health state, warranty state, audit due or overdue, sticker condition, purchase date range, custom field values.
3. Column chooser, sort, pagination with virtualization for 5,000+ rows, CSV export of the current view, and saved views (personal or shared). Ship default saved views: Offline now, Warranty expiring in 60 days, Audit overdue, Out for repair, Checked out to people, Needs sticker.
4. Bulk actions on any selection: change status, move site or area, check out or in, print stickers, schedule audit, edit shared fields, export, archive.

### I. Dashboards

1. Org dashboard: counts by site and category, health summary by site, items needing attention (offline, out for repair, warranty expiring, renewals due, audits overdue, low stock, stickers to print), monthly subscription spend by site, repair spend last 90 days.
2. Site dashboard: the same for one site, plus an area-by-area equipment view (grouped cards, not a floor plan), and a Today strip that shows on the existing site ops screen.
3. Every dashboard tile links to the matching filtered list. All tiles use the existing dashboard card components.

### J. Health layer (simplified and agentless per device, inspired by NinjaOne and Lansweeper)

Supabase Edge Functions run in the cloud and cannot reach private LAN IPs at a site, so:

1. Phase 1 (no hardware): heartbeat health. Devices that already talk to Operator (crew tablets, kiosk browsers) send a heartbeat via an authenticated endpoint; last_seen_at updates. Optionally check public endpoints via HTTP or TCP from an edge function on a schedule. A manual Mark as down from a crew problem report also counts.
2. Phase 2: a site probe, one per site rather than an agent per device, following NinjaOne's NMS Delegate and Lansweeper's on-premise sensor pattern. Deliver as a small Docker container or single binary for a Raspberry Pi or any always-on PC. It authenticates with a per-probe token, pulls the list of monitored assets for its site (IP, method, interval), runs ping, TCP port or HTTP checks, and posts batched results to an edge function every interval. The probe checks in every 60 seconds.
3. Offline rule (copy NinjaOne's logic): threshold = 2 x the shortest active monitor interval for that asset. If no successful result arrives within the threshold, mark offline. For ping-only assets, require two consecutive missed intervals. If the site probe itself stops checking in, mark the probe offline, raise a single Site N monitoring is offline alert, and set its assets to unknown, not offline.
4. Alerts: on a transition to offline lasting longer than the per-category alert delay (default 5 minutes for pay stations, POS and routers; 15 minutes for cameras; none for printers), send an SMS to the site manager via the existing alert service; send a recovery SMS when it comes back. Throttle to one alert per asset per hour and a per-site digest during multi-device outages. Critical categories offline during operating hours feed into the daily ops verdict.
5. Do NOT build patch management, remote desktop, script execution, software deployment, software install inventory, or vulnerability scanning.

### K. Discovery (phase 3, simplified Lansweeper idea)

1. The site probe performs a periodic ARP and ping sweep of its configured subnets plus passive mDNS and SSDP listening, with optional SNMP v2c sysDescr reads using a community string the user provides. It reports MAC, IP, hostname, OUI vendor and fingerprint data.
2. Results land in an Unclaimed devices inbox per site with a best-guess category. Users can Claim (create or link an asset, matching on MAC, and queue a sticker), Ignore, or mark as Guest or Customer device. New unknown devices can trigger an optional alert.
3. Show unknown devices honestly as Unknown rather than guessing confidently.

### L. Integrations and API (phase 3)

REST access via Supabase PostgREST with RLS, outbound webhooks for asset.created, asset.status_changed, asset.offline and audit.completed, and a Report a problem link into Operator's existing issue and checklist follow-up flow.

## UX requirements and complaints to avoid

### UX requirements

1. Asset detail page layout, built from Operator's existing detail page pattern: header with photo, name, tag and a mini QR, three badges (status, assignment, health), primary actions (Check out or in, Change status, Log maintenance, Print sticker, Report problem). Tabs: Overview (key fields, warranty, model info, custom fields), Timeline, Maintenance, Attachments, Health (last 7 days of state changes), Related (parent and children, subscriptions).
2. A persistent Scan button in the module's mobile navigation, reachable in one tap from any screen.
3. Sensible defaults everywhere: seeded categories, models for common car wash and IT gear captured as the user goes, default status In Service, default site from the user's current site context, default sticker template from the category.
4. Performance budget: a list of 2,000 assets filters in under 300 ms client side or under 800 ms server side; QR scan to asset page under 2 seconds on 4G; sticker PDF for 50 labels generated in under 5 seconds.
5. Empty states, loading skeletons, toasts and confirmations use the existing Operator components and copy style.

### Complaints to avoid (from reviews of the three products)

1. Dated, cluttered UI, clicky or thin reports, and hidden configuration screens (Lansweeper, NinjaOne, Snipe-IT).
2. Hard setup (Lansweeper, self-hosted Snipe-IT) and manual entry for everything (Snipe-IT).
3. Misaligned labels and weak or third-party mobile apps (Snipe-IT, NinjaOne). The calibration tool, on-screen preview and in-browser scanner exist to prevent this.
4. Duplicate records when IPs change (Lansweeper) and confusing status meanings (Snipe-IT Deployed).
5. Alert noise. Counter with thresholds, consecutive-miss rules, probe-down suppression and digests.
6. A module that looks bolted on. Counter with the theme consistency rules above.

## Phased delivery, acceptance criteria and deliverables

### Phase 1 (MVP)

1. Design system inventory and DESIGN-NOTES.md; confirm every planned screen maps to existing components.
2. Migrations for tables 1 through 14, 16, 17, 19, 22 and 23 with RLS and tests; seed data including label templates and a Sticker Stock consumable per site.
3. Asset CRUD, scan to add, Quick Add, clone, bulk add, model defaults, custom fields and fieldsets.
4. Tag pool, auto-generated and pre-printed tags, QR and Code128 generation, sticker PDF generation (sheet plus one thermal roll size plus the outdoor variant), calibration and offsets, print queue, in-browser camera scanning, public report-a-problem scan page.
5. Check-out and check-in to site area, user or parent asset; status labels; retire flow.
6. Activity log via triggers; Timeline tab.
7. CSV import wizard for assets, models and subscriptions, with post-import sticker printing.
8. Global search, filters, saved views, bulk actions, CSV export.
9. Warranty and subscription renewal reminders via SMS and email digest.
10. Org and site dashboards using existing dashboard components.
11. Heartbeat health for devices that already talk to Operator; manual down reports.

### Acceptance criteria for Phase 1

1. A new org can add its first asset and print its sticker within 2 minutes of opening the module, with only site, category and name or model required.
2. Scanning a printed sticker with a stock iPhone or Android camera opens the correct asset within 2 seconds for a logged-in user, and opens only the problem report form for a logged-out user.
3. Scanning an unused pre-printed sticker opens Quick Add with the tag prefilled; scanning a tag from another org is rejected.
4. Sticker PDFs align to the chosen template within 1 mm after calibration on at least one Avery sheet layout and one thermal roll printer; the on-screen preview matches the printed output.
5. A user in Org A cannot read or write any Org B inventory row, and a site manager cannot read assets at sites they do not manage, proven by automated RLS tests.
6. Importing a 500-row CSV with mapped columns completes in under 60 seconds, reports row-level errors, and creates zero duplicates when re-run with the same file.
7. Every create, update, check-out, check-in, status change, label print and delete produces an immutable activity log row with before and after values; app roles cannot update or delete log rows.
8. Assets with a warranty or renewal within 60, 30 and 7 days generate exactly one reminder per threshold per recipient, delivered by SMS and email digest.
9. An asset with a non-deployable status cannot be checked out, and the UI explains why.
10. Lists of 2,000 assets filter and sort within the performance budget; all lists export to CSV.
11. A side by side design review finds no token, component or layout differences between a new inventory screen and an existing Operator screen.

### Phase 2

1. Physical audits integrated with the checklist engine and AI photo verification, audit schedules, sticker condition capture, reprint queue, and overdue signals in the daily ops verdict.
2. Maintenance records and types, repair cost rollups.
3. Consumables with low-stock alerts; accessories.
4. Site probe v1 (ping, TCP and HTTP checks), offline rules, offline and recovery SMS, probe-down suppression, Health tab.
5. Photo-to-form extraction of model and serial.
6. Additional label sizes and customer logo on stickers.

### Acceptance criteria for Phase 2

1. A manager can complete a 40-asset site audit on a phone in continuous scan mode, with missing and wrong-location items resolved before completion; next_audit_date updates correctly; faded stickers appear in the reprint queue.
2. A monitored asset with a 120-second ping interval is marked offline only after two consecutive missed intervals, and an SMS is sent only after the category alert delay.
3. If the site probe stops checking in, exactly one probe-offline alert is sent and its assets show unknown, not offline.
4. Logging a maintenance record with status Out for Repair and completing it returns the asset to its prior status and records downtime.

### Phase 3

1. Discovery via the site probe and the Unclaimed devices inbox.
2. Linear depreciation and book value reporting.
3. Components (parts installed in assets).
4. Public API documentation, webhooks, and optional vendor integrations (POS or camera cloud status APIs).

Acceptance criterion for Phase 3: a new device plugged into a monitored subnet appears in the Unclaimed inbox within two sweep intervals, and claiming it links by MAC without creating a duplicate and queues a sticker.

### Deliverables

SQL migrations with RLS policies and tests, seed scripts, edge functions (reminders, health evaluator, probe ingest, label PDF, import), React routes and components built on the existing design system, DESIGN-NOTES.md, the site probe as a small open-source container with a README, a sticker and printer guide (recommended materials, printers and calibration steps), and a short admin guide written for a non-technical car wash manager.
