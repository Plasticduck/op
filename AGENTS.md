# AGENTS.md

This repo's full agent guide lives in **[CLAUDE.md](./CLAUDE.md)** — read it
first. It covers the stack, repo map, the load-bearing architecture conventions
(queries layer, side-by-side list+detail pattern, RLS helpers, edge-function
conventions), how to run migrations and regenerate types, deploy steps, and the
house rules.

## TL;DR for any agent

- **Product:** "Operator" — multi-tenant car-wash ops/maintenance/people SaaS
  (MaintainX-style). React 19 + Vite + TypeScript + Tailwind v4 on Supabase
  (Postgres + RLS, Auth, Storage, Deno edge functions). Deployed to Vercel at
  operator.washlyfe.com. Native iOS WebView shell in `WashLyfe Operator/`.
- **Before declaring done:** `npx tsc -b`, `npx eslint src --quiet`, and
  `npm run build` must all pass. No test runner.
- **All DB access goes through `src/lib/queries/<domain>.ts`.** Never inline
  `supabase.from()` in components.
- **`src/lib/database.types.ts` is generated** — regenerate after any schema
  change; never hand-edit.
- **Every table needs RLS.** Reuse `auth_account_id()`,
  `auth_is_manager_plus()`, `auth_has_location()`.
- **Secrets:** only `VITE_*` reaches the client. Never commit `.env*` or
  hardcode keys.
- **Copy:** no em dashes in user-facing text.

See [CLAUDE.md](./CLAUDE.md) for everything else.
