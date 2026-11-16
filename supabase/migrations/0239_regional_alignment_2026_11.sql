-- Regional realignment (2026-11-16, Kevan), Mighty Wash only.
--
--  Regions (company_settings.regions, read by the dashboards, Site Performance,
--  violations, Bonuses, On the Clock and the clock-in alert texts):
--    Lubbock Region            MW01 05 07 09 10 11 32 33 34 (MW14 moved out, MW32 in)
--    Permian Basin - Odessa    MW02 08 15 22 25             (was Permian Basin Region (A))
--    Permian Basin - Midland   MW03 06 12 13 14 24 31       (was Permian Basin Region (B))
--    New Mexico Region         unchanged
--    Central Region            unchanged
--  MW04 (Andrews) is in no region now (it shows under "Other").
--
--  Regional managers (company_settings.regionalManagers, effective-dated by
--  quarter): the renamed regions keep their history; from Q4 2026 Davis Jones runs
--  Midland (Lester Young before), and Central Region is vacant (Davis before).
--  An empty name marks the vacancy so the earlier manager doesn't carry forward.
--
--  Lester Young comes off the invoice approver list.

do $$
declare
  acct constant uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  q4 constant text := '2026-10-01';
  cs jsonb;
  rm jsonb;
  new_regions jsonb;
  wanted int;
  found int;
begin
  select company_settings into cs from public.accounts where id = acct for update;
  if cs is null then raise exception 'Mighty Wash account not found'; end if;
  rm := coalesce(cs->'regionalManagers', '{}'::jsonb);

  with spec(ord, name, sites) as (values
    (1, 'Corporate', array[]::text[]),
    (2, 'Lubbock Region', array['MW01','MW05','MW07','MW09','MW10','MW11','MW32','MW33','MW34']),
    (3, 'Permian Basin - Odessa', array['MW02','MW08','MW15','MW22','MW25']),
    (4, 'Permian Basin - Midland', array['MW03','MW06','MW12','MW13','MW14','MW24','MW31']),
    (5, 'New Mexico Region', array['MW16','MW17','MW18','MW19','MW20','MW21','MW23','MW26']),
    (6, 'Central Region', array['MW27','MW28','MW29','MW30','Spotless'])
  )
  select jsonb_agg(jsonb_build_object('name', s.name, 'siteIds', coalesce((
           select jsonb_agg(l.id::text order by array_position(s.sites, l.name))
           from public.locations l
           where l.account_id = acct and l.name = any(s.sites)), '[]'::jsonb)) order by s.ord),
         (select sum(cardinality(sites)) from spec),
         (select count(*) from public.locations l, spec s2 where l.account_id = acct and l.name = any(s2.sites))
    into new_regions, wanted, found
  from spec s;
  if found <> wanted then raise exception 'expected % sites, matched %', wanted, found; end if;

  rm := (rm - 'Permian Basin Region (A)' - 'Permian Basin Region (B)')
    || jsonb_build_object(
         'Permian Basin - Odessa', coalesce(rm->'Permian Basin Region (A)', '{}'::jsonb),
         'Permian Basin - Midland', coalesce(rm->'Permian Basin Region (B)', '{}'::jsonb) || jsonb_build_object(q4, 'Davis Jones'),
         'Central Region', coalesce(rm->'Central Region', '{}'::jsonb) || jsonb_build_object(q4, ''));

  cs := jsonb_set(cs, '{regions}', new_regions);
  cs := jsonb_set(cs, '{regionalManagers}', rm);
  if jsonb_typeof(cs->'invoiceApproverEmails') = 'array' then
    cs := jsonb_set(cs, '{invoiceApproverEmails}', coalesce((
      select jsonb_agg(e order by o)
      from jsonb_array_elements_text(cs->'invoiceApproverEmails') with ordinality as t(e, o)
      where lower(e) <> 'lester@mighty-wash.com'), '[]'::jsonb));
  end if;

  update public.accounts set company_settings = cs where id = acct;
end $$;
