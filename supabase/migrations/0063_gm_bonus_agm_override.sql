-- 0063_gm_bonus_agm_override.sql
-- Independent AGM override alongside gm_override. When set, agm_override replaces
-- the AGM total. GM and AGM overrides are independent: a GM override does not feed
-- the AGM. AGM auto-calculates (half of the calculated GM) only when agm_override
-- is null.
alter table public.gm_bonus_months
  add column if not exists agm_override numeric;
