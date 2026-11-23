-- MW04 (Andrews) moves from Permian Basin - Midland (Davis Jones) to the New
-- Mexico Region under Rance Breed (Kevan, 2026-11-23). Mighty Wash only. New
-- Mexico's sites are rebuilt in site order, and MW04 is taken out of every other
-- region so it can't be in two. Region-driven emails and texts (Site Audits,
-- clock-in alerts) follow this setting; the hard-coded lists changed alongside.

do $$
declare
  acct constant uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  nm constant text[] := array['MW04','MW16','MW17','MW18','MW19','MW20','MW21','MW23','MW26'];
  mw04 text;
  ids jsonb;
  regs jsonb;
begin
  select l.id::text into mw04 from public.locations l where l.account_id = acct and l.name = 'MW04';
  if mw04 is null then raise exception 'MW04 not found'; end if;

  select jsonb_agg(l.id::text order by array_position(nm, l.name)) into ids
  from public.locations l where l.account_id = acct and l.name = any(nm);
  if jsonb_array_length(ids) <> cardinality(nm) then raise exception 'New Mexico sites missing'; end if;

  select company_settings->'regions' into regs from public.accounts where id = acct for update;
  if not exists (select 1 from jsonb_array_elements(regs) r where r->>'name' = 'New Mexico Region') then
    raise exception 'New Mexico Region not found';
  end if;

  select jsonb_agg(
           case when t.r->>'name' = 'New Mexico Region' then jsonb_set(t.r, '{siteIds}', ids)
                else jsonb_set(t.r, '{siteIds}', coalesce(t.r->'siteIds', '[]'::jsonb) - mw04) end
           order by t.ord)
    into regs
  from jsonb_array_elements(regs) with ordinality as t(r, ord);

  update public.accounts set company_settings = jsonb_set(company_settings, '{regions}', regs) where id = acct;
end $$;
