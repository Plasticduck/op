# CLAUDE.md — guide for AI agents working in this repo

This file is read automatically by Claude Code and other agents. Read it before
making changes. `AGENTS.md` points here; keep both in sync if you split them.

## What this is

**Operator** (internal codename TunnelSync; the live product is branded
"Operator", the company is WashLyfe) is a B2B SaaS for car-wash operators:
maintenance + people + reporting, modeled closely on MaintainX for the
work-order/asset/parts side. Single React SPA on Supabase, deployed to Vercel
at **operator.washlyfe.com**, with a thin native iOS WebView shell.

Multi-tenant: every row is scoped to an `account` (one car-wash company) and
usually a `location` (one physical site). Three roles: `owner`, `manager`,
`employee`.

## Stack

- **Frontend:** React 19 + Vite + TypeScript, Tailwind v4, React Router v7
  (data router), TanStack Table, React Hook Form + Zod, date-fns, lucide-react,
  `qrcode`.
- **Backend:** Supabase — Postgres with **row-level security on every table**,
  Auth, Storage (private buckets + signed URLs), Edge Functions (Deno).
- **AI:** Claude via edge functions (`generate-insights`, `suggest-schedule`,
  `suggest-social-post`, `analyze-market-deals`). Model id lives in each
  function; default `claude-sonnet-4-6`.
- **Payments:** Stripe — subscription billing (Checkout + Customer Portal +
  webhook) and **Stripe Connect** for per-site cashless tips (direct charges,
  money settles in each site's own bank).
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

There is no test runner. **Verify changes with `npx tsc -b`, `npx eslint src
--quiet`, and `npm run build`** — all three must pass. Manual smoke flows live
in `docs/smoke-tests.md`.

## Repo map

```
src/
  routes/index.tsx          Router. lazy lz(), mgr() = owner|manager gate, s() = Suspense.
  components/
    layout/                 AppShell, Sidebar, BottomNav, TopBar, CommandPalette (Cmd-K)
    ui/                     Button, Input, Select, Modal, Badge, Logo, ...
    data/                   DataTable, StatCardRow, Charts (inline-SVG), MonthGrid, QrCodeImage
    forms/  feedback/
  features/
    auth/                   login / signup / forgot / accept-invite (AuthLayout)
    dashboard/              role-switched dashboard (owner/manager vs employee)
    marketing/              public landing / pricing / demo / legal (WashLyfe brand)
    ops/                    MaintainX-style: work-orders, assets, parts, categories,
                            vendors, checklists, closeouts, downtime, documents,
                            contacts, supplies
    opssuite/               site reviews/audits, invoices, inventory, market research, violations
    people/                 employees, schedule (drag+drop), timeclock (kiosk + geofence/face),
                            timesheets, reviews, counseling, injuries, uniforms, time-off,
                            calendar, breaks
    messages/               GroupMe-style chat: site rooms + DMs + groups, @mentions, images
    tips/                   cashless tipping (public TipPage + admin TipsAdminPage)
    social/                 social media calendar + AI post suggestions
    insights/  reports/  settings/
  lib/
    supabase.ts             client singleton (ANON key only)
    auth.ts                 useAuth() -> { profile: {id, account_id, role, location_ids,...} }
    rbac.ts                 Role type + helpers
    locations.tsx           LocationProvider + useLocations() (active-site switcher)
    queries/*.ts            ONE typed module per domain — all DB access goes through these
    database.types.ts       GENERATED from Postgres — never hand-edit
    scorecard.ts            site letter-grade computation (dashboard)
    punch.ts / push.ts / nativeBridge.ts / tipPoster.ts / fnError.ts / weather.ts ...
supabase/
  migrations/NNNN_name.sql  sequential, append-only. 0001..0042 and counting.
  functions/<name>/index.ts Deno edge functions
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
  removes its padding and lets the page own its scroll. If you add such a page,
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

## Database & migrations

- Migrations are **sequential, append-only** SQL: `supabase/migrations/NNNN_name.sql`.
  Never edit a migration that's already been applied; add a new one.
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
<name>` (add `--no-verify-jwt` for public ones the customer hits unauthenticated:
`tips-public`, `enter-demo`). Conventions:
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

- Frontend → Vercel: `npx vercel deploy --prod --yes`. Live at
  operator.washlyfe.com. Verify by fetching the deployed bundle and grepping for
  expected strings (this is how changes have been confirmed throughout).
- Edge functions → `supabase functions deploy <name>`.
- iOS shell → Xcode, the `WashLyfe Operator/` project.

## Demo

Demo account (`accounts.is_demo = true`). Logins (password `washlyfe-demo`):
`owner@`, `manager@`, `employee@demo.washlyfe.com`. Or hit `/demo`.

## House rules

- **No em dashes in user-facing copy.** Use periods, colons, or commas.
- Comments explain *why*, not *what*; match the surrounding file's style and
  density. Don't add narration comments.
- Keep the bundle lean — prefer inline SVG / small helpers over heavy libs
  (e.g. `components/data/Charts.tsx` instead of a charting library).
- When you finish a change: typecheck, lint, build, then deploy + verify.
