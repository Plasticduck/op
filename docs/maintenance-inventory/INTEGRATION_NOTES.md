# Maintenance Inventory: integration notes

What the build found in Operator, what it reuses, and where it departs from the prompt in [SPEC.md](SPEC.md).

## What already existed

### Sites, users and roles

- Sites are `locations`. There is no separate `sites` table.
- People are `users` (`role`, `role_category`, `location_ids`). `auth_site_ids()` returns the sites a person can see. Owners get all of them.
- Regions are not a table. They live in `accounts.company_settings.regions[]` as `{name, siteIds}`, and this module reads them there.
- Operator's roles don't match the five roles in the prompt, so the module adds `mi_members`: one row per person with a role (`site_tech` to `admin`, ranks 1 to 5), `site_ids` and `region_names`. No row means no access, whatever the person's Operator role is.
- Two gates sit in front of the module: `MI_EMAILS` in `src/features/maintenance/inventory/access.ts` controls the route and the sidebar link, and `mi_members` controls the data.

### IT Inventory tags, labels and scanning

- Tag table: `it_asset_tags`, numbered from `it_tag_counters`. The module has its own `mi_tags` (`MF-B-`, `MF-T-`, `MF-A-`, `MF-L-` plus 5 digits) and shares the counter table, so numbers come from the same place.
- Sticker QR format: `/t/<account short_code>/<tag>`. MF stickers use the same format. `TagLandingPage` sends any `MF-` tag on to `/app/maintenance-inventory?tag=`.
- Label printing: `buildLabelsPdf` in `src/lib/labels/`, with sizes and printer offsets in `it_label_templates` and the logo in `it_settings`. `mi_label_setup()` reads them, so IT stickers and maintenance stickers share one setup.
- Scanner: `src/components/scan/BarcodeScanner.tsx` and `src/lib/scan/detector.ts`. It gained a `retail` prop that adds UPC and EAN. IT scanning is unchanged.

### Parts, vendors, assets and work orders

Mighty Wash already had this data, imported from MaintainX, so the module extends it instead of creating `regions`, `sites`, `assets`, `vendors` or `work_orders` tables.

| Prompt's table | Used here |
| --- | --- |
| `parts`, `vendors` | Existing tables, with new columns (304 real parts, 41 vendors) |
| `assets` | Existing `equipment` (2,149 rows), with new columns |
| `asset_boms` | Existing `part_assets`, with `qty_per` added |
| `work_orders`, `work_order_parts` | Existing tables. New `catalog_part_id` because the old `part_id` points at the empty `parts_inventory` table. `quantity` stays equal to net issued, so existing work order screens still show parts and cost |
| Everything else | New tables prefixed `mi_` |

### Checklists

- `checklists` (template) has `checklist_items`, and each site and day gets a `checklist_instances` row.
- Photo checks live in the submissions tables. Their AI verdict is `pass`, `discrepancy`, `unclear`, `error` or `pending`.
- **Items have no pass or fail of their own.** Only photo items ever "fail". So the Open a work order control is on every item (for people on the access list), and it becomes a button when the photo check says `discrepancy`.
- New: `checklist_items.asset_id`. Linking is on the template screen. A template runs at many sites, so when the linked asset belongs to another site, the run uses that site's asset of the same `type`.

### Text alerts

- `send-sms` wraps Twilio, and the Twilio secrets are already set. `mi-alerts` makes the same Twilio call directly, because going through another function hits the per-run call budget and the service-key problem noted in the project memory.
- Only people with a phone number and SMS opt-in get texts (`mi__alert_recipients`, `sms_ok`).

### Gamification

`badges` and `employee_badges` exist, but no points system does. Points for accurate counts were not built.

## Assumptions and departures from the prompt

- **Path:** the prompt's `/maintenance` is `/app/maintenance-inventory`, because `/app/maintenance` routes already exist.
- **Function names:** every RPC is prefixed `mi_` (`mi_issue_part`, not `issue_part`).
- **No fake sites:** sample stock sits on real sites MW01 (Lubbock) and MW19 (Hobbs), in locations flagged `is_sample`.
- **No sample work orders:** so a couple of reports (top assets, fill rate) are empty until real ones exist.
- **Vendors:** only existing vendors are used. AVW, Vaughan and Graco were not added.
- **Legacy Parts page:** it reads stock from the old, empty `parts_inventory`, so it won't show this module's quantities. Sample parts are filtered out of it and out of Export Data.
- **Duplicate SKUs:** 3 pairs in the real data are flagged `sku_legacy_dup` rather than merged. A person should look at them.
- **Daily ops verdict:** no daily rollup exists to feed. `mi_site_signals()` gives the green, yellow or red stock signal on Reports instead.
- **Ledger events:** the prompt's `inventory_events` stream is `mi_alerts` plus the ledgers themselves. No ERP outbox was built.
- **PM:** existing `pm_plans` covers schedules. Meter-based PM is Phase 2 in the prompt and was not built.

## Maintenance Log (added later)

See [MAINTENANCE_LOG.md](MAINTENANCE_LOG.md). What it reuses and where it departs:

- **Work orders:** finished ones show in the log as they are, and a schedule's work orders are ordinary `work_orders` rows with `mi_schedule_id` set, so every work order screen can open and close them.
- **Parts used:** go through `mi_issue_part`, so the stock ledger stays the one record of what left the shelf. `mi_log_entry_parts` only points at those ledger rows.
- **Car counts:** come from `site_daily_metrics`, the same source and site-number match as the inventory reports.
- **`equipment.last_serviced_at`:** set when work is logged on a machine.
- **Not `pm_plans`:** the existing Preventive Maintenance table has no car-count trigger and no parts. Its nightly job opens a work order for every plan, and it's visible to every technician while this module is limited to two people. It has no rows on Mighty Wash, and it's left as it was.
- **Not `downtime_events`:** downtime minutes stay on the log entry. The Downtime page isn't fed.

## Not built

- Gamification points
- Meter-based PM
- ERP outbox
- Vendor email to PO
- AI check of an install photo
