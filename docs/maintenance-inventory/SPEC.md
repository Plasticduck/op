You are building the "Maintenance & Facilities Inventory" module inside Wash Lyfe Operator, an internal operations SaaS used by Mighty Wash (30+ car wash sites in Texas and New Mexico, including six in Lubbock, plus a quick lube, Mighty Express Auto Center in Hobbs, NM).

STACK AND CONTEXT
- Frontend: React + Vite (existing Operator app, mobile-first PWA). Backend: Supabase (Postgres, Auth, Storage, Edge Functions, RLS). Payments: Stripe Connect (not used by this module).
- Existing Operator modules you MUST integrate with rather than duplicate: site checklists with AI photo verification, crew gamification, daily ops verdicts, SMS alerts, and an IT inventory module that uses a sticker/barcode/QR tagging system.
- BEFORE WRITING CODE: inspect the existing repo. Document (1) the sites/users/roles tables, (2) the IT inventory tag table, label format, label printing and scan component, (3) the checklist data model, (4) the SMS alert service. Reuse them. Write a short INTEGRATION_NOTES.md summarizing what you found and any assumptions.

PURPOSE
Give a small maintenance team and 30+ site managers one mobile-first system to: know what parts, tools and equipment exist at every site, truck and warehouse; consume parts against equipment and work orders with one scan; check tools in and out with clear custody; keep critical tunnel spares on hand; reorder before stockouts; move stock between sites before buying; and report cost per site, per asset and per car washed.

USERS AND ROLES
- site_tech: scan, consume parts, check tools out and in, count, receive at own site(s), create work orders, propose new parts.
- site_manager: everything site_tech can do, plus approve count variances and transfers for own site, edit min/max for own site, create draft POs up to a configurable limit.
- regional_manager: everything site_manager can do for all sites in assigned region(s); approve transfers between sites in the region; approve POs up to a limit.
- corporate_maintenance_director: all sites; manage the global part catalog, vendors, categories, kits and PM templates; approve any PO; view all dashboards.
- admin: everything, plus role management, imports and settings.
Enforce all of this with Supabase RLS plus role checks inside RPC functions. Never rely on the UI alone.

MVP MODULES
1. Parts & Consumables: one global catalog record per part (internal SKU, name, description, category, manufacturer, manufacturer part number, UOM, pack qty, critical flag, ABC class, photo, spec JSON, documents). Stock is held per location with min, max, reorder point, bin and moving-average cost. Each part can have many vendors, each with its own vendor part number, price, lead time and preferred flag. Duplicate detection on create: warn on fuzzy name match (pg_trgm) and block exact match on manufacturer + mfr part number or on barcode.
2. Tools & Check-out: serialized tools with a custodian that is always set (a user, a truck location or a site crib). Scan to check out (due date optional) and scan to return (condition: good, needs repair, damaged, missing parts). Two-sided transfer: the receiver must accept. Track status: available, checked_out, in_repair, lost, retired.
3. Equipment/Asset Registry: hierarchy site > area (e.g., Tunnel Entrance, Wash Zone, Dryer Zone, Equipment Room, Vacuum Island, Pay Station Lane, Lube Bay) > equipment > component. Fields: make, model, serial, install date, warranty expiry, vendor, criticality A/B/C, status, QR tag. BOM: parts linked to the asset with quantity per. Show service history and parts cost.
4. Work Orders & PM tie-in: if Operator already has work orders or checklist tasks, extend them; otherwise create a minimal work_orders table. Planned parts reserve stock. Issuing parts writes ledger rows linked to the work order and asset. A failed checklist item (e.g., "conveyor rollers spin freely: FAIL") can create a work order with suggested parts from the asset BOM. Phase 2: meter-based PM using daily wash counts per site/tunnel.
5. Purchasing & Vendors: a reorder suggestion list (available + on order <= reorder point). Suggested qty = max minus (available + on order), rounded up to the vendor pack size. "Create POs by vendor" groups suggestions into one draft PO per preferred vendor. Flow: draft > submitted > approved > sent (PDF + email) > partially received > received > closed. Receive by scanning into a location/bin; support partial receipts; update moving-average cost on receipt.
6. Multi-site Stock & Transfers: location types are stockroom, cabinet, truck and regional_warehouse. Transfer flow: request > approve > ship (ledger transfer_out, state in_transit) > receive (ledger transfer_in). Before suggesting a PO line, show other sites holding stock above max for that part.
7. Counts & Audits: cycle counts by location, category, ABC class or critical-only. Blind count option. Variance review with reason codes (damaged, used without WO, mis-binned, receiving error, theft/loss, unknown). Approved variances post count_adjust ledger rows. Tool audits by truck or crib.
8. Scanning & Labels: reuse Operator's existing tag system. Tag code namespaces: parts bins MF-B-, tools MF-T-, assets MF-A-, locations/trucks MF-L- (adjust to match the existing IT format). Camera scanning in the PWA (use the existing Operator scan component if one exists; otherwise BarcodeDetector API with a ZXing fallback) supporting QR, Code128 and manufacturer UPC/EAN. Scan-to-act: scanning a bin offers Consume / Count / Receive / Transfer; scanning a tool offers Check out / Return / Transfer / Report issue; scanning an asset offers its history, BOM, open WOs and Consume part on this asset. Print label sheets (PDF) for new parts bins, tools, assets and locations.
9. Reporting & Alerts: see KPIs below. Alerts go through Operator's SMS service: critical part below min (SMS to site manager + regional); critical part at zero (SMS to the corporate maintenance director as well); tool overdue (SMS to custodian, then manager after 24h); count variance over a $ threshold. Non-critical low-stock alerts roll up into a daily digest.
10. Roles & Permissions: as above, plus configurable PO approval limits per role.

DATA MODEL (create via SQL migrations in supabase/migrations)
Tables: regions; sites (reuse); user_site_roles (reuse or extend); stock_locations; bins; part_categories; parts; part_vendors; vendors; stock_levels (unique part_id+location_id; available = on_hand - reserved as a generated column); inventory_transactions (append-only ledger: type in receive, issue, return, transfer_out, transfer_in, adjust, count_adjust, reserve, unreserve; signed qty; qty_before; qty_after; unit_cost; work_order_id; asset_id; po_line_id; transfer_id; count_id; reason_code; performed_by; source in mobile, web, checklist, import; client_txn_id unique for idempotency; created_at); assets (self-referencing parent_id); asset_parts; meters; meter_readings; pm_schedules; work_orders (or existing); work_order_parts (qty_planned, qty_issued, qty_returned, unit_cost); kits; kit_items; tools; tool_checkouts; purchase_orders; po_lines; receipts; receipt_lines; transfers; transfer_lines; cycle_counts; cycle_count_lines; tags (reuse IT tags or polymorphic entity_type/entity_id); attachments; inventory_alerts; audit_log.
Rules:
- All stock-changing actions go through Postgres RPC functions (SECURITY DEFINER, with explicit role checks): receive_po_line, issue_part, return_part, reserve_parts, start_transfer, receive_transfer, post_count, adjust_stock, checkout_tool, return_tool, accept_tool_transfer. Each function locks the stock_levels row (SELECT ... FOR UPDATE), validates, writes the ledger row and updates stock_levels in one transaction.
- Block direct writes to stock_levels and inventory_transactions from the authenticated role.
- Negative on_hand is disallowed by default. A per-site setting allows "issue now, reconcile later" with a forced count task.
- Use numeric(12,3) for quantities and numeric(12,4) for costs. Money totals in cents or numeric(12,2).
- Indexes: parts(sku) unique; parts(manufacturer, mfr_part_number) unique where not null; gin trigram on parts.name; stock_levels(location_id); inventory_transactions(part_id, created_at), (work_order_id), (asset_id).
RLS:
- Create auth_site_ids() returning the site ids visible to the user (direct site roles, plus region roles expanded to sites, plus all sites for corporate/admin).
- Site-scoped tables: using (site_id = any(auth_site_ids())). Location-scoped tables join to stock_locations.site_id.
- Global catalog tables (parts, part_categories, vendors, part_vendors, kits): select for all authenticated users; insert/update only for corporate_maintenance_director and admin. Techs insert into a part_requests table instead.
- Transfers: visible to both source and destination sites; ship requires source-site role, receive requires destination-site role.
- Write pgTAP or SQL tests proving a Lubbock site tech cannot read Hobbs stock and cannot write the ledger directly.

CORE USER FLOWS (each must work one-handed on a phone in under ~3 taps after the scan)
1. Receive parts: open PO or scan the packing slip PO number > scan part barcode or bin > enter qty (default = remaining qty) > confirm. Partial receipt is allowed. Photo of the packing slip is optional. Average cost updates.
2. Consume parts against a work order or asset: from an open WO or checklist item tap "Add parts", or scan the asset tag and then the bin tag > qty stepper (default 1) > confirm. The ledger row links the WO and asset. If the scanned bin is at another site, warn. If stock is insufficient, offer "request transfer" or "create WO note: part needed".
3. Check out and return a tool: scan tool > custodian defaults to me (or pick a truck/tech) > optional due date > confirm. Return: scan > condition > confirm. Transfer to another tech: the sender initiates, the receiver gets a push/SMS and accepts by scanning.
4. Transfer stock between sites: requester picks part + qty + source location (UI shows stock by site) > approver (regional for inter-site) approves > shipper scans out (in_transit) > receiver scans in. Discrepancies create a variance record.
5. Cycle count: manager creates a count (scope + blind flag) or the system schedules one weekly (critical parts weekly, A monthly, B quarterly, C semiannually; configurable) > tech scans each bin and enters the count > the system computes variance > manager approves with a reason > ledger count_adjust rows.
6. Reorder alert to PO: a nightly Edge Function (plus a trigger on each issue) evaluates the reorder point. Critical parts send SMS immediately. The Reorder screen lists suggestions grouped by preferred vendor, with "check other sites first" showing overstock elsewhere > "Create draft POs" > approve per limits > send PDF/email to vendor > status tracked to receipt.

MOBILE-FIRST UI REQUIREMENTS
- Home screen for techs: big Scan button, My Tools, My Open WOs, Low Stock at My Site.
- Every inventory action is available on mobile (no web-only inventory edits).
- Large tap targets, qty steppers, a camera scanner that opens in under 1 second, haptic/audio confirmation on scan.
- Offline queue: actions are stored in IndexedDB with client_txn_id and replayed when back online; the server dedupes on client_txn_id. Show pending sync state.
- Search parts by name, SKU, mfr part number, vendor part number or category, with photo thumbnails.
- Desktop views for managers: catalog management, reorder board, PO management, transfers, dashboards, CSV import/export.

REPORTING DASHBOARDS AND KPIs
- Inventory value by site/location/category (on_hand x avg_unit_cost).
- Stockouts (count, and days critical parts sat at zero) and critical-spares compliance (% of required critical spares on hand per tunnel).
- Fill rate: % of WO part requests satisfied from site stock without transfer or emergency buy.
- Inventory turns: trailing-12-month issue cost / average inventory value.
- Dead/stale stock: no movement in N days (default 180, configurable per part).
- Carrying cost estimate: average inventory value x a configurable annual carrying rate.
- Parts cost per asset, per site, and per car washed (join to Operator daily wash counts).
- Count accuracy: % of counted lines within tolerance; net and gross variance $.
- Tools: overdue returns, tools lost or damaged in the period ($), and utilization.
- Equipment: MTTR and MTBF per asset category from work orders with downtime; top 10 assets by parts spend.
- Emergency purchases: POs flagged urgent, and their premium vs. normal price.

INTEGRATION HOOKS
- Checklists: checklist templates can reference an asset; failed items can open a WO with BOM-suggested parts; checklist steps can include a "parts used" control that calls issue_part.
- AI photo verification: optional "photo of installed part" step on high-value consumption.
- SMS alerts: use the existing Operator SMS service and templates; respect quiet hours except for critical stockouts.
- Daily ops verdict: add an inventory signal (critical spares missing = yellow; tunnel-down part at zero = red).
- Gamification: optional points for completing cycle counts on time and for zero-variance counts.
- Future: export POs, receipts and consumption by GL account/site to CSV for accounting (QuickBooks-style); a webhook outbox table (inventory_events) for later ERP/AP integration; vendor email-to-PO.
- Import: CSV import for parts (columns: sku, name, description, category, manufacturer, mfr_part_number, uom, is_critical, location, bin, on_hand, min_qty, max_qty, unit_cost, vendor, vendor_part_number, lead_time_days, barcode). Use one row per part per location, with a preview showing create/update/error per row before commit.

SEED DATA
Sites: create sample sites "Lubbock 1" (express tunnel) and "Hobbs Lube" (quick lube), one regional warehouse, and two trucks.
Asset categories (tunnel): Conveyor (chain, rollers, drive sprocket, take-up drum, tension cylinder, call-up fork, return door, rotary encoder, gear reducer/hydraulic motor), Hydraulic power pack, Correlator/entrance controls, Tunnel controller and PLC, Prep guns/pressure washers, Presoak and chemical arches, Chemical injectors/dilution station, Foam generators/applicators, Wrap-around brushes, Top brushes, Mitters, Tire/wheel brushes and blasters, Tire shine applicator, High-pressure pump station, Rinse/spot-free RO system, Water reclaim, Dryers/blowers, Air compressor and dryer, Vacuum producers and arches, Pay stations/kiosks, Gates, LPR cameras, RFID readers, Lighting/signage, HVAC, Water heater/boiler.
Asset categories (quick lube): Oil pumps (3:1 to 10:1) and bulk tanks, Hose reels and control valves/preset meters, Grease pump and reels, Used oil and coolant receivers/evacuation, Lifts/pits, Air compressor, Fluid dispensing stations, Shop tools, POS terminals.
Part categories: Janitorial & Vending, Signage & Facility, Lighting, Prep, Spray Nozzles & Swivels, Tunnel Parts, Hydraulic Parts, Electronics, Brushes/Cloth/Foam, Pumps, Pressure Flow Parts, Fittings, Hose & Tubing, Foam Generators, Chemical Injector Parts, Water Treatment, Chemicals, Vacuum Hose, Equipment, Lube Equipment Parts, Filters.
Critical spares kit "Tunnel Down Kit" (per tunnel, all critical): conveyor chain 10 ft (1), conveyor roller assembly (2), double-action air cylinder (2), drive sprocket (1), spring fork return (1), call-up fork (1), 1 in flange bearing (2), take-up drum (1), conveyor tension cylinder (1), return door (1), rotary encoder (1), gear reducer or hydraulic motor (1), critical level switch (1), proximity/photo eye (2), solenoid valve (2), hydraulic hose assembly (2), high-pressure nozzle assortment (1 set), swivel (2), brush motor (1), dryer motor contactor/overload (1).
Common consumables (min/max per site): spray tips, O-rings/seal kits for HP pumps, pump oil, grease, RO prefilters, brush cloth/foam elements, vacuum hose and cuffs, LED lamps, fuses, zip ties, pipe fittings, RFID tags, receipt paper.
Quick lube "Lube Bay Down Kit": oil pump repair kit (1), control valve/meter repair kit (1), hose reel spring/swivel kit (1), drain receiver hose (1), grease gun coupler (2), air regulator/filter element (1), lift safety lock parts per lift manual (1 set).
Tools (sample): cordless impact driver, torque wrench, chain breaker, pressure gauge kit, multimeter, grease gun, pipe wrench set, ladder, pressure washer.
Vendors (sample, no real pricing): Sonny's, MacNeil/NCS, Kleen-Rite, Motor City Wash Works, AVW, Vaughan, Car Wash Superstore, Graco/Lincoln distributor, local industrial supply.

ACCEPTANCE CRITERIA
1. A site tech at Lubbock 1 can scan a bin QR, consume 2 rollers against an open WO for the Conveyor asset in 3 taps or fewer after the scan. on_hand drops by 2, a ledger row exists with WO and asset IDs, and WO parts cost reflects the avg cost.
2. Dropping a critical part below min sends exactly one SMS to the site manager and regional manager within 2 minutes; dropping it to zero also notifies the corporate maintenance director. No duplicate SMS for repeated issues within 24h.
3. Reorder board groups suggestions by preferred vendor and computes qty = max - (available + on order) rounded to pack size. "Create draft POs" makes one PO per vendor.
4. Partial receipt of 5 of 10 sets the PO to partially received, adds 5 to stock and updates avg cost correctly; receiving the remaining 5 closes the PO line.
5. Transfer from the warehouse to Hobbs Lube shows in_transit stock that is in neither location's on_hand; receipt moves it into Hobbs.
6. A blind cycle count hides expected qty. Variances above the $ threshold require manager approval and a reason code before posting.
7. Tool checkout sets custodian and status; overdue tools trigger SMS; transfer requires receiver acceptance; the tool history shows a complete custody chain.
8. RLS tests pass: a site tech cannot read other regions' stock or write the ledger directly; a regional manager sees only their region; the corporate director sees all.
9. The same action submitted twice offline (same client_txn_id) posts once.
10. Duplicate part creation is blocked on exact mfr + mfr part number or barcode and warned on similar names.
11. Labels print as a PDF sheet using the same tag format and scanner as the IT inventory module, and scanning any MF- tag opens the right action menu.
12. Dashboards show inventory value by site, stockouts, turns, dead stock, parts cost per car washed, overdue tools and count accuracy, with seed data producing non-empty charts.
13. CSV import of 500 parts with per-location rows previews row-level create/update/error results and commits atomically.
14. Lighthouse mobile performance >= 85 on the scan and consume screens; the scanner opens in under 1 second on a mid-range Android phone.

DELIVERABLES
SQL migrations + RLS policies + RPC functions + tests; React routes/components under /maintenance (Scan, Parts, Tools, Assets, Work Orders integration, Reorder, POs, Transfers, Counts, Reports, Settings); Edge Functions for nightly reorder evaluation, alert dispatch and PO email/PDF; seed script; INTEGRATION_NOTES.md; README with role setup and label printing instructions.
Build in this order: schema + RLS + RPCs > scanning + consume + receive > tools > transfers + counts > reorder + POs > dashboards > imports.
