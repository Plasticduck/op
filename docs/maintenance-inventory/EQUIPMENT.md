# Maintenance Inventory: equipment

Maintenance Inventory's machines, run the way IT Inventory runs devices. Built
2026-11-11 (migration 0227). Tunnel diagrams are in [TUNNEL.md](TUNNEL.md).

## Where things are

| What | Where |
|---|---|
| Shell, section bar | `src/features/maintenance/inventory/MaintenanceInventoryPage.tsx`, `SectionNav.tsx` |
| Overview | `OverviewPage.tsx` (Home's to-dos, then equipment by site, zone, and what's down) |
| List | `equipment/EquipmentList.tsx`, `filters.ts`, `columns.tsx` |
| Machine page | `equipment/EquipmentDetail.tsx`; body shared with the tunnel panel in `EquipmentBody.tsx` |
| Add, edit, clone | `equipment/EquipmentForm.tsx` |
| Bulk changes | `equipment/BulkActions.tsx` (status, zone, criticality, site, retire) |
| Use counter | `equipment/UsageCard.tsx` |
| History | `equipment/Timeline.tsx` |
| Queries | `src/lib/queries/miEquipment.ts` |
| Tests | `supabase/tests/mi_equipment.sql` |

Routes: `/app/maintenance-inventory/equipment` and `/equipment/:id`. The old
`/assets` and `/assets/:id` redirect there.

## Decisions

- **One table.** Machines are the existing `equipment` table, also edited by the
  older Assets page (`/app/assets`). Both stay in step: saving criticality A/B/C
  also writes the legacy `criticality` column.
- **Machines and components.** `parent_asset_id` makes a component. The list opens
  on machines only; components are a filter away and listed on their machine.
- **`type` is load-bearing.** MaintainX named every machine `#02 - Top Brush 1`
  with type `Top Brush 1`, the same at every site. Tunnel templates link by type,
  and schedules copied between sites match by it. The form warns before changing it.
- **Zones** are `mi_areas`, per site, picked by name. "Dryers" is made at a site
  the first time it's used there.
- **History** (`mi_equipment_events`) is written by a trigger on `equipment`, so
  edits from any page are recorded. Accounts without `mi_settings` are skipped.
- **Retire, don't delete.** A machine with log entries, parts used, schedules, a
  sticker or work orders can't be deleted (trigger `mi__equipment_delete_guard`).
  This also stops a parent's delete from cascading through its components.
  Retiring takes the components with it; restoring brings them back.

## Use counter

Cars washed at the machine's site (`site_daily_metrics`: DRB less test cars, plus
FlexWash, by day), counted from the later of:

- the install date, or
- the last live "Replaced" log entry (`mi_log_entries.resets_usage`).

That day is included. Voiding the "Replaced" entry puts the old start back, since
the start is worked out each time. Without a start date the card shows the last
30 days and 12 months instead. Sites with no daily counts (MW19, MW20, MW32,
MW33, MW35, Spotless as of 2026-11-11) say so.

`equipment.usage_basis` is `all_cars` (default), `none` (doesn't run per car), or
`packages`, which is reserved: `usage_packages` will name the wash packages that
run a machine (tire shine) once package counts are stored by day. Until then
`packages` counts every car.

## Stickers (0229)

Machine stickers are `MF-A-#####` in `mi_tags`, on IT Inventory's label templates,
logo and short code, so one scanner reads both. A tag is `unused` (a blank printed
ahead of time), `applied` or `retired`; a retired tag keeps who it was on in
`former_entity_id`, and a code is never reused (trigger `mi__tags_guard`).

- **Stickers** tool (`/stickers`): the print queue (machines with no sticker, one
  never printed, or one marked faded, missing or damaged; components don't get
  stickers) and blank batches (`mi_generate_blank_tags`).
- Scanning a blank asks which machine it's going on (`mi_claim_tag`); a machine
  that already has one is asked to replace it, which retires the old one. Scanning
  a retired sticker says what it was on.
- The machine page's Sticker section marks its condition and puts a new one on.

## Audits (0230)

**Audits** tool (`/audits`, `/audits/:id`): walk a site and scan each machine's
sticker or tick it off. One open audit per site; others join it. Scans report
found, found in a different zone, at another site, an unknown sticker, a blank
(put it on a machine there and then), or a retired one. Finishing (all checked, or
the rest counted missing) marks found machines audited, moves them to the zone
they were found in, records sticker condition, and writes the history.
Tests: `supabase/tests/mi_audits.sql`.

## Import (0231)

`/import` (directors and admins; the Import button on the list). One row per
machine or component; matches by sticker, asset number, MaintainX id, then site
and name. `parent` can be a row higher up. Preview runs and rolls back; importing
is all or nothing. Tests: `supabase/tests/mi_import.sql`.

## Public problem report

A machine sticker's QR (`/t/<short>/MF-A-...`) takes anyone who can't open the
module to a report page (`public/MiPublicReport.tsx`). Edge function
`mi-scan-public` (public) shows only name, type, site and zone and files an
untriaged **Maintenance** ticket in Work Orders NEW (department `maintenance`,
`equipment_id` set; high priority if "not running at all"), with a
`problem_reported` line on the machine's history. Five a machine an hour. It then
calls `classify-work-order` with the service key for the AI title. Bin, tool and
location stickers ask non-members to sign in.

## Permissions

Module ranks (`mi_members`): site tech 1, site manager 2, regional 3, corporate
maintenance director 4, admin 5. Reading is rank 1 at your sites. Adding,
editing, bulk changes and retiring are rank 2. Moving machines between sites is
rank 4. Logging a replacement is rank 1 (it's a log entry).
