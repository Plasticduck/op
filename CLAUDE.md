# CLAUDE.md — guide for AI agents working in this repo

This file is read automatically by Claude Code and other agents. Read it before
making changes. `AGENTS.md` points here; keep both in sync if you split them.

## What this is

**Operator** (internal codename TunnelSync; the live product is branded
"Operator", the company is WashLyfe) is a B2B SaaS for car-wash operators:
maintenance + people + finance + reporting, modeled closely on MaintainX for the
work-order/asset/parts side. Single React SPA on Supabase, deployed to Vercel
at **operator.washlyfe.com**, with a thin native iOS WebView shell.

Multi-tenant: every row is scoped to an `account` (one car-wash company) and
usually a `location` (one physical site). Mighty Wash is the main live tenant,
and many newer pages (Site Performance, MSA, FlexWash, Lube Shop, payroll,
fleet) are built on Mighty Wash's own systems.

Four base roles: `owner` (labeled "Admin" in the UI), `manager`, `employee`,
`technician`. A manager can also carry a `role_category` (`regional_manager`,
`executive`, `finance`) that changes what they see in the app but not what RLS
allows. See **Access control** below.

## Stack

- **Frontend:** React 19 + Vite + TypeScript, Tailwind v4, React Router v7
  (data router), TanStack Table, React Hook Form + Zod, date-fns, lucide-react,
  `qrcode`, Leaflet (maps), jsPDF + jspdf-autotable (PDF exports), `xlsx`,
  `pdfjs-dist`.
- **Backend:** Supabase — Postgres with **row-level security on every table**,
  Auth, Storage (private buckets + signed URLs), Edge Functions (Deno).
- **AI:** Claude via edge functions: `ask-operator` (Operator AI), `generate-insights`,
  `suggest-schedule`, `suggest-social-post`, `analyze-market-deals`,
  `verify-checklist-photo`, `extract-drb-gsr`, `invoice-inbound`,
  `fetch-competitor-data`, `classify-work-order`. Model id lives in each
  function; default `claude-sonnet-4-6` (`ask-operator` also honors an
  `ANTHROPIC_MODEL` secret; `classify-work-order` uses `claude-opus-5-5`).
- **Payments:** Stripe — subscription billing (embedded pricing table on the
  Billing page, Checkout from the BillingGate lock screen, Customer Portal,
  webhook, per-site quantity for Multi-Site) and **Stripe Connect** for per-site
  cashless tips (direct charges, money settles in each site's own bank).
- **Integrations (via edge functions):** DRB SiteWatch, FlexWash partner API,
  MaintainX, iSolved payroll, Issuetrak, Spot AI cameras, Verizon Connect
  Reveal, Twilio SMS, Google Places + Calendar, GatherUp, Census +
  OpenStreetMap. Each degrades to `no_key` when its secret is missing.
- **Native:** `WashLyfe Operator/` is a SwiftUI + WKWebView iOS shell that loads
  the live site and bridges Web Push / local notifications.

## Commands

```bash
npm install
npm run dev          # Vite dev server, http://localhost:5173
npm run build        # tsc -b && vite build  — ALWAYS run before declaring done
npx tsc -b           # typecheck only
npx eslint src --quiet   # lint
```

There is no test runner and no CI. **Verify changes with `npx tsc -b`, `npx
eslint src --quiet`, and `npm run build`** — all three must pass. Manual smoke
flows live in `docs/smoke-tests.md`.

## Repo map

```
src/
  routes/index.tsx          Router. lazy lz() (stale-chunk reload guard), s() = Suspense,
                            mgr() = owner|manager, tech() = +technician, emp() = +employee.
  routes/guards.tsx         RequireAuth, RequireRole, RequirePermRole, RequireEmails,
                            RequireEmailsOrRoles, RequireSitePerformance, RequireGmBonus, ...
  components/
    layout/                 AppShell, Sidebar (nav catalog), BottomNav, TopBar,
                            CommandPalette (Cmd-K), BillingGate
    ui/                     Button, Input, Select, Modal, Badge, Logo, ...
    data/                   DataTable, StatCardRow, Charts (inline-SVG), MonthGrid, QrCodeImage
    forms/  feedback/
  features/
    auth/                   login / signup / forgot / accept-invite (AuthLayout)
    ask/                    Operator AI: plain-English questions over account data
    dashboard/              role-switched dashboard (owner/manager vs employee)
    marketing/              public landing / pricing / demo / legal (WashLyfe brand)
    ops/                    MaintainX-style: work-orders (+ Work Orders NEW), assets, parts,
                            categories, vendors, teams, procedures, PM, work requests +
                            public request portal, checklists, closeouts, downtime,
                            documents, contacts, supplies, labor dashboard
    opssuite/               Largest area. Site Performance, MSA, FlexWash sales/chargebacks,
                            interior, Lube Shop, house accounts, member lookup, site reviews/
                            audits, violations, signage, invoices, inventory, market research/
                            explorer, bonuses, commissions, goal tracker, fleet map, site visits,
                            per diem, mileage, event pay, capital requests
    people/                 employees, schedule (drag+drop) + public schedule portal,
                            timeclock (kiosk + geofence/face), timesheets, reviews, training,
                            counseling, injuries, uniforms, time-off, calendar, breaks
    hr/                     iSolved labor pages: Labor Data, On the Clock, Salaried Labor
    it/                     Issuetrak, IT Field Checklist
    maintenance/            Chemicals, Maintenance Orders
    facilities/             Service Board
    cameras/                Spot AI camera feeds
    messages/               Slack-style chat: site rooms + DMs + groups, @mentions,
                            reactions, pins, threads, files
    tips/                   cashless tipping (public TipPage, TipsAdminPage, TipsNewPage pool)
    social/  insights/  reports/  settings/
  lib/
    supabase.ts             client singleton (ANON key only)
    auth.tsx                useAuth() -> { profile: {id, account_id, role, role_category, location_ids,...} }
    rbac.ts                 Role / RoleCategory / PermRole types + helpers
    permissions.ts          pageAllowed(), SECTION_CATALOG (see Access control)
    locations.tsx           LocationProvider + useLocations() (active-site switcher)
    company.tsx / notifications.tsx / billingGate.ts   shell providers + app-lock state
    queries/*.ts            ONE typed module per domain — all DB access goes through these
    reports/*.ts            jsPDF exports (site audit/review/violation, OSHA, chemicals, ...)
    database.types.ts       GENERATED from Postgres — never hand-edit
    scorecard.ts            site letter-grade computation (dashboard)
    punch.ts / push.ts / nativeBridge.ts / tipPoster.ts / fnError.ts / weather.ts ...
supabase/
  migrations/NNNN_name.sql  sequential, append-only. Currently up to 0197.
  tests/*.sql               SQL tests run in a rolled-back transaction (e.g. it_inventory_rls.sql)
  functions/<name>/index.ts Deno edge functions (~80)
  config.toml               per-function verify_jwt overrides
WashLyfe Operator/          native iOS Xcode project (SwiftUI + WKWebView)
docs/smoke-tests.md
```

## Architecture conventions (load-bearing — follow these)

**Data access** goes through `src/lib/queries/<domain>.ts`, never inline
`supabase.from(...)` in components. Each module exports typed wrappers and the
row types. After any schema change, **regenerate `database.types.ts`** (see
below) — query modules and components rely on it.

**Side-by-side list+detail pages** (work-orders, assets, parts, messages,
categories, vendors) share one pattern:
- Two routes: `/app/x` and `/app/x/:id`. The `:id` param drives the detail pane.
- Outer wrapper: `flex h-full min-h-0 flex-col lg:mx-auto lg:w-full lg:max-w-7xl lg:px-8 lg:py-4`.
- Grid: `lg:grid-cols-[400px_1fr]`. On mobile only one pane shows
  (`showListOnMobile = !routeId`; list is `hidden lg:flex` when a detail is open).
- These routes are registered in **`AppShell.FULL_BLEED_PATTERNS`** so the shell
  removes its padding and lets the page own its scroll. If you add such a page
  (or any page that owns its own scroll, like a full-screen map or Operator AI),
  add its pattern there too, or scrolling/overflow will break.
- `BottomNav` (mobile) hides itself on `/app/(messages|work-orders|assets|parts)/:id`
  detail routes so the screen is full-height.

**Realtime:** list + detail panes subscribe to `postgres_changes` and reload on
change. Keep channel names unique per entity (`'work-order-' + id`).

**Styling:** Tailwind v4, tokens defined in `src/index.css`. Use the semantic
classes, not raw hex: surfaces `bg-shell` (dark nav) / `bg-content` / `bg-card`,
text `text-ink` / `text-ink-muted` / `text-ink-subtle` / `text-ink-invert`,
`border-border`, and status families `accent` / `ok` / `warn` / `danger` each
with a `-soft` background variant. Brand blue is `#2563eb` (`accent`).

**Branding:** `Logo` defaults to `brand="operator"` (app + auth pages). The
public marketing pages pass `brand="washlyfe"`. Don't change which brand shows
where without being asked.

## Access control

Three layers, from coarse to authoritative:

1. **Router guards** (`routes/guards.tsx`, plus `mgr()` / `tech()` / `emp()`
   in `routes/index.tsx`) gate on base role, `PermRole`, or account flags.
2. **`pageAllowed()`** in `src/lib/permissions.ts` decides which pages a user
   sees. It is enforced in Sidebar, CommandPalette, BottomNav, and the AppShell
   route gate. Resolution is per-user, then per-role, then default; it can only
   restrict within a role's pages. Items with `optIn` are hidden unless enabled.
   Overrides live in `company_settings.pagePermissions` / `userPermissions` and
   are edited on the Team settings page. Section-level gating uses
   `SECTION_CATALOG` + `useSectionAllowed`.
3. **Postgres RLS** is the real floor. It only knows the base `Role`, never
   `role_category`, so a regional manager is a manager at the database level.

**Pre-launch pages** are limited to named people by email: `RequireEmails` /
`RequireEmailsOrRoles` on the route **and** an `emails:` list on the Sidebar
item. To open a page up, change both, or it will show in the nav but bounce,
or work by URL but stay hidden.

## Database & migrations

- Migrations are **sequential, append-only** SQL: `supabase/migrations/NNNN_name.sql`.
  Never edit a migration that's already been applied; add a new one. Use the
  next number after the highest existing file. A few numbers (0022, 0050, 0093,
  0157-0162) have two files from parallel work; don't add more duplicates.
- Apply with the Supabase CLI: `npx supabase db push` (needs the project linked
  + `.env.server`). This project was historically applied via the Supabase
  Management API; either way, end state is the same.
- **After applying, regenerate types:**
  ```bash
  npx supabase gen types typescript --project-id <PROJECT_REF> > src/lib/database.types.ts
  ```
- **RLS is mandatory.** Every new table must `enable row level security` and add
  policies. Reuse the SQL helper functions used throughout:
  - `auth_account_id()` — caller's account
  - `auth_role()` / `auth_is_manager_plus()`
  - `auth_has_location(loc uuid)` — caller can see this site
  - `auth_employee_id()` / `auth_location_ids()`
  Typical pattern: `select using (account_id = auth_account_id() and
  auth_has_location(location_id))`, writes additionally gated on
  `auth_is_manager_plus()`. Service-role edge functions bypass RLS by design.

## Edge functions (Deno)

`supabase/functions/<name>/index.ts`. Deploy: `npx supabase functions deploy
<name>`. Add `--no-verify-jwt` for functions that are hit without a Supabase
session or do their own auth: `tips-public`, `enter-demo`, `work-request-portal`, `it-scan-public`,
`public-schedules`, `accept-invite`, `stripe-webhook`, `invoice-inbound`,
`sms-optin`, the `google-oauth-*` / `google-calendar-*` functions, and the
`billing-*` functions. Each such function says so in its header comment;
`config.toml` also sets `verify_jwt = false` for some. Conventions:
- A CORS `ALLOWED_ORIGINS` allowlist (operator.washlyfe.com + localhost ports)
  and a per-request `json()` helper.
- Secrets come from `Deno.env.get(...)` (set via `supabase secrets set`), NEVER
  hardcoded. Functions return `{ error: 'no_key' }` with 503 when a required
  secret is missing so the app degrades gracefully.
- Auth'd functions verify the JWT, then re-check role/location with a
  service-role client before acting.
- `supabase.functions.invoke()` puts non-2xx bodies on the error's `context`
  (a `Response`), not on `data`. Use `src/lib/fnError.ts` to surface the real
  message to users.

## Secrets & safety

- Client may only ever see `VITE_*` vars (`.env.local`). Server secrets live in
  `.env.server` (gitignored) and Supabase function secrets. `.env.example`
  documents the shape.
- Never commit `.env*`, never hardcode keys, never log full tokens. The Stripe
  live key, VAPID private key, service-role key, etc. are NOT in the source tree
  — keep it that way.

## Deploy

- Frontend → Vercel, via the Git integration: **pushing to `main` is the
  production deploy.** Don't also run `vercel deploy --prod`. Live at
  operator.washlyfe.com. Verify by fetching the deployed bundle and grepping for
  expected strings (this is how changes have been confirmed throughout).
- Edge functions → `supabase functions deploy <name>` (separate from the push).
- Migrations → applied separately (see above), then regenerate types.
- iOS shell → Xcode, the `WashLyfe Operator/` project.

## Demo

Demo account (`accounts.is_demo = true`, "WashLyfe Demo"): `owner@`, `manager@`,
`employee@demo.washlyfe.com`. The password is a server secret, not in the repo.
Visitors enter through `/demo` (magic link, then the `enter-demo` function
swaps in the demo session).

## House rules

- **No em dashes in user-facing copy.** Use periods, colons, or commas.
- Comments explain *why*, not *what*; match the surrounding file's style and
  density. Don't add narration comments.
- Keep the bundle lean — prefer inline SVG / small helpers over heavy libs
  (e.g. `components/data/Charts.tsx` instead of a charting library).
- When you finish a change: typecheck, lint, build, then deploy + verify.
