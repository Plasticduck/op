-- Company settings corrections (2026-10-22), Mighty Wash only:
--  1. Regional manager name for Permian Basin Region (A) was misspelled
--     "Isabel Castalaneda"; her login is "Isabel Castaneda". The Bonus page reads
--     the same setting, so this fixes both. Corrected in place (same effective
--     date), not added as a new quarter.
--  2. MW33 and MW34 join the Lubbock Region (they were in no region).

update public.accounts
set company_settings = replace(company_settings::text, 'Isabel Castalaneda', 'Isabel Castaneda')::jsonb
where id = '54f3e299-1f61-4ed2-9921-3d02160b72e6'
  and company_settings::text like '%Isabel Castalaneda%';

update public.accounts a
set company_settings = jsonb_set(a.company_settings, '{regions}', (
  select jsonb_agg(
    case when t.r->>'name' = 'Lubbock Region' then
      jsonb_set(t.r, '{siteIds}', coalesce(t.r->'siteIds', '[]'::jsonb) || coalesce((
        select jsonb_agg(l.id::text order by l.name)
        from public.locations l
        where l.account_id = a.id
          and l.name in ('MW33', 'MW34')
          and not (coalesce(t.r->'siteIds', '[]'::jsonb) ? l.id::text)
      ), '[]'::jsonb))
    else t.r end
    order by t.ord)
  from jsonb_array_elements(a.company_settings->'regions') with ordinality as t(r, ord)
))
where a.id = '54f3e299-1f61-4ed2-9921-3d02160b72e6';
