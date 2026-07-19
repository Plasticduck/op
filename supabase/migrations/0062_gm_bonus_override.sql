-- 0062_gm_bonus_override.sql
-- Admin override of a site's GM bonus for a month. When set, it replaces the
-- calculated GM total (and AGM = override / 2). Null means "use the calculation".
alter table public.gm_bonus_months
  add column if not exists gm_override numeric;
