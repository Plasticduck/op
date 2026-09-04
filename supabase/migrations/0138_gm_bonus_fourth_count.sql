-- 0138_gm_bonus_fourth_count.sql — a 4th membership package count for sites that
-- run four tiers (e.g. Spotless: Ultra/Extreme/Signature/Turbo). Defaults to 0,
-- so three-tier sites are unaffected.

alter table public.gm_bonus_months add column if not exists fourth_count integer not null default 0;
alter table public.gm_bonus_base   add column if not exists fourth_count integer not null default 0;
