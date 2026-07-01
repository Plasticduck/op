-- 0044_company_settings.sql
-- Company-level options managed from Settings > Company: corporate info and the
-- region -> site configuration. Stored as a single jsonb blob on the account so
-- new fields don't need a migration each time.
--
-- Shape:
--   {
--     "corporate": { "legal_name", "address", "phone", "email", "website" },
--     "regions":   [ { "name": "Lubbock Region", "siteIds": ["<uuid>", ...] } ]
--   }
--
-- Reads: any account member (accounts_select). Writes: owner only
-- (accounts_update already enforces auth_role() = 'owner'). No new policies.

alter table public.accounts
  add column if not exists company_settings jsonb not null default '{}'::jsonb;
