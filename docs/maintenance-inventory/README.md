# Maintenance Inventory

Parts, tools, stock counts, transfers, purchase orders and reorder suggestions across all sites, built to be used from a phone. It lives at **Maintenance > Maintenance Inventory** (`/app/maintenance-inventory`).

- [SPEC.md](SPEC.md): the original prompt
- [INTEGRATION_NOTES.md](INTEGRATION_NOTES.md): what it reuses in Operator, and where it departs from the prompt
- [MAINTENANCE_LOG.md](MAINTENANCE_LOG.md): the Maintenance Log page, schedules and parts forecast built on this data
- [EQUIPMENT.md](EQUIPMENT.md): machines, laid out like IT Inventory: list, history, use counter, stickers, audits, import, public problem reports
- [TUNNEL.md](TUNNEL.md): top-down tunnel diagrams linked to real machines, templates and the editor

## Giving someone access

A person needs both of these:

1. **Their email in `MI_EMAILS`** in `src/features/maintenance/inventory/access.ts`. This shows the page. It takes a code change, and it's there on purpose while the module is pre-launch.
2. **A role under Settings > People and roles**. This controls what they can see and do. An admin sets it in the app.

| Role | Sees | Can do |
| --- | --- | --- |
| Site tech | Their sites | Scan, use parts, check tools in and out, count, receive, open work orders, propose new parts |
| Site manager | Their sites | The above, plus approve count differences and transfers, set min and max, draft POs up to the limit |
| Regional manager | Their regions | The above across the region, plus approve POs up to the limit |
| Corporate maintenance director | All sites | The above, plus manage the catalog, vendors, categories and kits, and approve any PO |
| Admin | All sites | Everything, including settings and roles |

Spend limits and the count-difference limit are under Settings. Today Kevan and Joshua Jowers are both admins. Joshua has no phone number on file, so Joshua won't get texts.

## Printing labels

1. Open what you want to label:
   - **Bins and locations:** Settings > Locations and bins > Labels
   - **Tools:** Tools > Labels
   - **Machines:** Equipment > Stickers
2. Pick a sticker size and print the PDF at 100% (no "fit to page").

Each sticker carries a QR code and a barcode for its `MF-` tag. A phone's own camera can read the QR code and, once signed in, opens straight on that item. Scan inside the app works too.

Sticker sizes, the logo and printer calibration are shared with IT Inventory, and are set up at **IT > IT Inventory > Stickers**. Print a calibration sheet there first if the labels come out off-center.

## Before going live

1. **Remove the sample data:** Settings > Sample data. It deletes only rows flagged as sample, including the Maintenance Log's demo schedules and entries. The real parts stay.
2. **Load real stock:** Settings > Import. The CSV preview writes nothing, and one bad row stops the whole file.
3. **Turn on texts:** Settings > Text alerts > Turn on. It's off until then. Use "Who would get what" first to see the list.
4. **Add people** (see above).

## Automatic jobs

| Job | When | What it does |
| --- | --- | --- |
| `mi-nightly` | 09:30 UTC (3:30am Central in winter, 4:30am in summer) | Checks stock against reorder points, flags overdue tools, opens scheduled counts and raises alerts |
| `mi-alerts-dispatch` | Every minute, only while alerts are waiting | Sends urgent alerts, respecting quiet hours |

PO emails go out through `mi-po-send` only when someone taps Send to vendor.

## For developers

- **Database:** migrations `0212` to `0221` (`0221` is the Maintenance Log). Tables are prefixed `mi_`. `mi__` functions are internal and can't be called by signed-in users.
- **Stock changes** go through one function, `mi__post`. The ledgers are append-only, enforced by a trigger.
- **Frontend:** `src/features/maintenance/inventory/`. Queries are in `src/lib/queries/maintenanceInventory.ts`.
- **Offline:** `offline.ts` queues actions in IndexedDB with a client id, so a replay can't post twice.
- **Tests:** `supabase/tests/maintenance_inventory.sql` runs the acceptance criteria and role rules in a transaction that always rolls back. It ends by raising `ALL PASS`, which shows as an error on purpose.
- **Sample data:** `supabase/seed/maintenance_inventory_sample.sql`. Remove it with `mi_remove_sample_data()`.
