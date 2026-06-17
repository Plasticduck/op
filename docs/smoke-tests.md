# TunnelSync — Manual Smoke Tests

Demo logins (password `tunnelsync-demo` for all):
- `owner@demo.tunnelsync.app` — all locations, full access
- `manager@demo.tunnelsync.app` — Highway 40 only
- `employee@demo.tunnelsync.app` — Highway 40, linked to the "Marcus" employee

Run `npm run dev` and work through these.

## Auth & shell
- [ ] `/` shows the marketing landing; `/demo` drops straight into the app (no signup).
- [ ] Sign in as owner → dashboard shows live counts for the active location.
- [ ] Location switcher (top bar) toggles Highway 40 ↔ Downtown.
- [ ] Sign in as employee → sidebar hides Reports, Insights, Equipment, HR pages.

## Settings (owner)
- [ ] Settings → Team → Invite → copy link → open incognito → set password → lands scoped to assigned location.
- [ ] Settings → Locations → add a location → it appears in the switcher; archive it → it leaves.

## Ops
- [ ] Equipment → add → open detail (uptime %, linked WOs/downtime).
- [ ] Parts → add a part; drop it below reorder → low-stock banner + a notification to managers.
- [ ] Work Orders → create → attach an inventory part → cost updates → close → part stock decrements; closed_at set.
- [ ] Downtime → log → equipment shows "down" → mark resolved → duration computed.
- [ ] Checklists → create with items → open detail → tap items → Mark complete → appears in history + "done today".
- [ ] Closeouts → submit today → locked → unlock with reason (History button shows the audit row).
- [ ] Documents → upload → View (signed URL) → archive.
- [ ] Contacts / Supplies → CRUD + status pipeline.

## People
- [ ] Employees → add → profile → Set PIN.
- [ ] Schedule → add shifts in the grid → labor cost updates → publish.
- [ ] Time Clock → Open kiosk → tap employee → enter PIN → clocks in; again → clocks out.
- [ ] Timesheets → edit an entry with a reason → History button shows the audit row → CSV export downloads.
- [ ] Reviews / Counseling / Injuries / Uniforms → create records; employee role cannot see counseling/injuries.

## Reports
- [ ] /app/reports → open any report → change date range + location filter → CSV export → Print (chrome hidden).

## Key-gated (after secrets are set)
- [ ] AI Insights → Refresh → ≥1 card per category (needs `ANTHROPIC_API_KEY`).
- [ ] Billing → choose a plan → Stripe checkout (needs `STRIPE_*`); webhook flips `billing_status` to active.

## Automated checks
- `npm run build` — type-check + production build.
- `npm run lint` — eslint.
