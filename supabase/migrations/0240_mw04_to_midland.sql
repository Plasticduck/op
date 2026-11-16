-- MW04 (Andrews) joins Permian Basin - Midland under Davis Jones (Kevan,
-- 2026-11-16). Migration 0239 had left it in no region. Mighty Wash only.
-- Midland's sites are rebuilt in site order, and MW04 is taken out of any other
-- region so it can't be in two.

do $$
declare
  acct constant uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  midland constant text[] := array['MW03','MW04','MW06','MW12','MW13','MW14','MW24','MW31'];
  mw04 text;
  ids jsonb;
  regs jsonb;
begin
  select l.id::text into mw04 from public.locations l where l.account_id = acct and l.name = 'MW04';
  if mw04 is null then raise exception 'MW04 not found'; end if;

  select jsonb_agg(l.id::text order by array_position(midland, l.name)) into ids
  from public.locations l where l.account_id = acct and l.name = any(midland);
  if jsonb_array_length(ids) <> cardinality(midland) then raise exception 'Midland sites missing'; end if;

  select company_settings->'regions' into regs from public.accounts where id = acct for update;
  if not exists (select 1 from jsonb_array_elements(regs) r where r->>'name' = 'Permian Basin - Midland') then
    raise exception 'Permian Basin - Midland region not found';
  end if;

  select jsonb_agg(
           case when t.r->>'name' = 'Permian Basin - Midland' then jsonb_set(t.r, '{siteIds}', ids)
                else jsonb_set(t.r, '{siteIds}', coalesce(t.r->'siteIds', '[]'::jsonb) - mw04) end
           order by t.ord)
    into regs
  from jsonb_array_elements(regs) with ordinality as t(r, ord);

  update public.accounts set company_settings = jsonb_set(company_settings, '{regions}', regs) where id = acct;
end $$;
