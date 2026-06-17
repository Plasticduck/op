# Operator (WashLyfe)

Multi-tenant SaaS for car-wash operators: maintenance, people, and reporting in
one app. MaintainX-style work orders / assets / parts, plus scheduling, time
clock, messaging, cashless tipping, social calendar, and Claude-powered
insights. React SPA on Supabase, deployed to **operator.washlyfe.com**, with a
native iOS WebView shell.

> **Working in this repo as an AI agent?** Read **[CLAUDE.md](./CLAUDE.md)**
> first (also surfaced via [AGENTS.md](./AGENTS.md)). It documents the
> architecture conventions, RLS model, migration workflow, and house rules that
> keep changes consistent.

Internal codename: TunnelSync. Product brand: Operator. Company: WashLyfe.

## Stack

- **Frontend:** React 19, Vite, TypeScript, Tailwind v4, React Router v7,
  TanStack Table, React Hook Form + Zod, date-fns, lucide-react, `qrcode`
- **Backend:** Supabase — Postgres with row-level security on every table, Auth,
  Storage (private buckets + signed URLs), Edge Functions (Deno)
- **AI:** Claude via edge functions (insights, schedule suggestions, social
  posts, market analysis)
- **Payments:** Stripe — subscription billing + Stripe Connect for per-site tips
- **Native:** SwiftUI + WKWebView iOS shell in `WashLyfe Operator/`

## What's in it

- **Ops (MaintainX-style):** Work Orders (status pipeline, assignees, parts,
  time & cost, photos, comments), Assets (parent/sub tree, QR codes,
  criticality), Parts (multi-site stock, QR codes, restock log), Categories,
  Vendors, plus Checklists, Closeouts, Downtime, Documents, Contacts, Supplies
- **People:** Employees, Scheduling (drag & drop), Time Clock with kiosk +
  geofence + face-presence check, Timesheets, Reviews, Counseling, Injuries,
  Uniforms, Time Off, Calendar, Breaks
- **Messaging:** GroupMe-style — per-site rooms, DMs, ad-hoc groups, @mentions,
  image attachments, Web Push + iOS notifications
- **Tips:** per-site QR codes (multiple printable poster styles), Stripe Connect
  direct charges to each site's bank, hours-weighted daily disbursement report
- **Dashboard:** role-switched, with a site letter-grade scorecard
- **Reporting:** Work Orders / Asset Health / Reporting Details / Recent
  Activity / Export / Report Library tabs
- **Social calendar**, **AI insights**, **billing**, **settings**

## Local development

```bash
npm install
npm run dev          # http://localhost:5173
```

Requires `.env.local` (gitignored) — see [.env.example](./.env.example):

```
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

Demo logins (password `washlyfe-demo`): `owner@`, `manager@`,
`employee@demo.washlyfe.com`. Or open `/demo`.

## Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Vite dev server |
| `npm run build` | Type-check + production build (run before every commit) |
| `npm run lint` | ESLint |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run db:types` | Regenerate `src/lib/database.types.ts` |
| `npm run seed` | Create demo auth users (needs `.env.server`) |

No test runner. Verify with `npx tsc -b`, `npx eslint src --quiet`, `npm run
build`; manual flows in [`docs/smoke-tests.md`](./docs/smoke-tests.md).

## Database

Migrations: `supabase/migrations/NNNN_name.sql` — sequential, append-only
(schema, RLS, triggers, RPCs). `supabase/seed.sql` loads demo business data;
`supabase/seed.ts` creates demo auth users via the service role.
After a migration, regenerate types (`npm run db:types`).

## Edge functions

`supabase/functions/<name>/index.ts` (Deno), deployed with `supabase functions
deploy <name>`. Each degrades gracefully (HTTP 503 `no_key`) until its secret is
set. Notables: `generate-insights` (`ANTHROPIC_API_KEY`), the `stripe-*`
functions (`STRIPE_*`), `tips-public` / `tips-admin` (Stripe Connect),
`send-push` (VAPID + APNs).

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
supabase secrets set STRIPE_SECRET_KEY=sk_live_... STRIPE_WEBHOOK_SECRET=whsec_... \
  STRIPE_PRICE_SINGLE_MONTHLY=price_... STRIPE_PRICE_SINGLE_YEARLY=price_... \
  STRIPE_PRICE_PER_LOCATION_MONTHLY=price_... APP_URL=https://operator.washlyfe.com
```

## Project layout

See [CLAUDE.md](./CLAUDE.md) for the full annotated map. High level:

```
src/
  routes/        lazy-loaded router + role guards
  components/    ui, layout, data, forms, feedback primitives
  features/      auth, dashboard, marketing, ops, opssuite, people, messages,
                 tips, social, insights, reports, settings
  lib/           supabase client, auth + location contexts, queries/, generated types,
                 scorecard, push, tip posters, native bridge, helpers
supabase/
  migrations/    schema, RLS, triggers, RPCs (0001..)
  functions/     edge functions (Deno)
WashLyfe Operator/   native iOS Xcode project (SwiftUI + WKWebView)
docs/smoke-tests.md  manual test checklist
```

## Deploy

- Frontend → Vercel (`npx vercel deploy --prod`), live at operator.washlyfe.com
- Edge functions → `supabase functions deploy <name>`
- iOS → Xcode (`WashLyfe Operator/`)
