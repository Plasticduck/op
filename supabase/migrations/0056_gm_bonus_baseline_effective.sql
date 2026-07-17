-- 0056_gm_bonus_baseline_effective.sql
-- Make GM bonus baselines effective-dated history instead of one row per site.
-- A reset done while viewing month M is stored with effective_from = M + 1, so it
-- never changes M's own numbers, only months moving forward. Membership and
-- average-months baselines are independent series (kind), each resettable alone.
-- The table is empty in production, so no data backfill is needed.

alter table public.gm_bonus_base drop constraint if exists gm_bonus_base_location_id_key;
alter table public.gm_bonus_base rename column base_date to effective_from;
alter table public.gm_bonus_base add column if not exists kind text not null default 'membership';
alter table public.gm_bonus_base alter column kind drop default;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'gm_bonus_base_kind_check') then
    alter table public.gm_bonus_base
      add constraint gm_bonus_base_kind_check check (kind in ('membership', 'avg'));
  end if;
end $$;

create unique index if not exists gm_bonus_base_loc_kind_eff_idx
  on public.gm_bonus_base (location_id, kind, effective_from);
