-- Maintenance Log sample data: a handful of schedules and past entries on real Mighty
-- Wash machines at MW01 and MW19, so the Due list, schedules and parts forecast have
-- something to show. Every row is flagged is_sample, so Maintenance Inventory >
-- Settings > Sample data removes it with the rest of the demo. None of these open work
-- orders, so nothing shows on the shared Work Orders pages. Runs once: it does nothing
-- if sample schedules are already there.
--
--   sql.sh supabase/seed/maintenance_log_sample.sql

do $$
declare
  a uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  mw01 uuid := (select id from public.locations where account_id = '54f3e299-1f61-4ed2-9921-3d02160b72e6' and name = 'MW01');
  mw19 uuid := (select id from public.locations where account_id = '54f3e299-1f61-4ed2-9921-3d02160b72e6' and name = 'MW19');
  today date := public.mi__today('54f3e299-1f61-4ed2-9921-3d02160b72e6');
  tz text := 'America/Chicago';
  s uuid;
  cloth_start date;
  d integer;
begin
  if exists (select 1 from public.mi_schedules where account_id = a and is_sample) then
    raise notice 'Sample schedules already loaded.';
    return;
  end if;

  -- Weekly grease, last done 9 days ago: two days overdue. Two past entries.
  insert into public.mi_schedules (account_id, site_id, asset_id, title, instructions, task_type, every_n, every_unit, start_date, last_done_at, next_due_date, is_sample)
  values (a, mw01, (select id from public.equipment where location_id = mw01 and type = 'Take Up Drum Hub Bearing' order by name limit 1),
    'Grease the take-up drum bearings', 'Two pumps of grease on each fitting. Wipe off the old grease that pushes out.', 'lubricate', 1, 'weeks',
    today - 9, ((today - 9)::timestamp + interval '9 hours') at time zone tz, today - 2, true)
  returning id into s;
  insert into public.mi_schedule_parts (schedule_id, part_id, qty)
  select s, id, 1 from public.parts where account_id = a and sku = 'SAMPLE-C04';
  insert into public.mi_log_entries (account_id, site_id, asset_id, schedule_id, entry_type, title, notes, result, performed_at, performed_by_name, labor_minutes, due_date, on_time, source, is_sample)
  select a, mw01, sc.asset_id, s, 'lubrication', sc.title, x.notes, 'ok', ((today - x.ago)::timestamp + interval '9 hours') at time zone tz, 'Sample data', 15, today - x.ago - x.late, x.late = 0, 'web', true
  from public.mi_schedules sc, (values (9, 'Both bearings greased. No noise.', 0), (16, 'Done a day late: the site was short-staffed.', 1)) x(ago, notes, late)
  where sc.id = s;

  -- Top brush cloth by cars washed at MW01: about 92% of the way there.
  select min(gs::date) into cloth_start
  from generate_series(today - 400, today, interval '1 day') gs
  where public.mi__site_cars(a, mw01, gs::date, today) <= 55200;
  insert into public.mi_schedules (account_id, site_id, asset_id, title, instructions, task_type, every_cars, soon_days, start_date, is_sample)
  values (a, mw01, (select id from public.equipment where location_id = mw01 and type = 'Top Brush 1 - Cloth Bundle' order by name limit 1),
    'Replace top brush 1 cloth', 'Swap the whole cloth bundle. Check the hub for wear while it''s off.', 'replace', 60000, 14, coalesce(cloth_start, today - 150), true)
  returning id into s;
  insert into public.mi_schedule_parts (schedule_id, part_id, qty)
  select s, id, 1 from public.parts where account_id = a and sku = 'SAMPLE-C06';

  -- The same cloth at MW19 by the calendar: coming up in 5 days.
  insert into public.mi_schedules (account_id, site_id, asset_id, title, task_type, every_n, every_unit, start_date, last_done_at, next_due_date, is_sample)
  values (a, mw19, (select id from public.equipment where location_id = mw19 and type = 'Top Brush 1 - Cloth Bundle' order by name limit 1),
    'Replace top brush 1 cloth', 'replace', 6, 'months', today - 178, ((today - 178)::timestamp + interval '10 hours') at time zone tz,
    (today - 178 + interval '6 months')::date, true)
  returning id into s;
  insert into public.mi_schedule_parts (schedule_id, part_id, qty)
  select s, id, 1 from public.parts where account_id = a and sku = 'SAMPLE-C06';

  -- Compressor oil every 3 months, done 2 months ago: on track.
  insert into public.mi_schedules (account_id, site_id, asset_id, title, task_type, every_n, every_unit, start_date, last_done_at, next_due_date, is_sample)
  values (a, mw01, (select id from public.equipment where location_id = mw01 and type = 'Air Comp Oil' order by name limit 1),
    'Change the air compressor oil', 'replace', 3, 'months', today - 61, ((today - 61)::timestamp + interval '8 hours') at time zone tz,
    (today - 61 + interval '3 months')::date, true)
  returning id into s;
  insert into public.mi_schedule_parts (schedule_id, part_id, qty)
  select s, id, 2 from public.parts where account_id = a and sku = 'SAMPLE-C03';

  -- RO prefilter every 30 days, done 30 days ago: due today.
  insert into public.mi_schedules (account_id, site_id, asset_id, title, task_type, every_n, every_unit, start_date, last_done_at, next_due_date, is_sample)
  values (a, mw01, (select id from public.equipment where location_id = mw01 and type = 'R.O. Unit' order by name limit 1),
    'Replace the RO prefilter', 'replace', 30, 'days', today - 30, ((today - 30)::timestamp + interval '8 hours') at time zone tz, today, true)
  returning id into s;
  insert into public.mi_schedule_parts (schedule_id, part_id, qty)
  select s, id, 1 from public.parts where account_id = a and sku = 'SAMPLE-C05';
  insert into public.mi_log_entries (account_id, site_id, asset_id, schedule_id, entry_type, title, notes, result, performed_at, performed_by_name, labor_minutes, due_date, on_time, source, is_sample)
  select a, mw01, asset_id, id, 'replacement', title, 'Old filter was brown. Pressure back to normal after.', 'ok', last_done_at, 'Sample data', 20, today - 30, true, 'web', true
  from public.mi_schedules where id = s;

  -- Weekly photo eye check, done 3 days ago: coming up.
  insert into public.mi_schedules (account_id, site_id, asset_id, title, instructions, task_type, every_n, every_unit, start_date, last_done_at, next_due_date, is_sample)
  values (a, mw01, (select id from public.equipment where location_id = mw01 and type = 'Photo Eyes (Entrance)' order by name limit 1),
    'Check and clean the entrance photo eyes', 'Clean both lenses, check alignment with a test car.', 'inspect', 1, 'weeks',
    today - 3, ((today - 3)::timestamp + interval '7 hours') at time zone tz, today + 4, true);

  -- Blower screens every 2 weeks, done 15 days ago: a day overdue.
  insert into public.mi_schedules (account_id, site_id, asset_id, title, task_type, every_n, every_unit, start_date, last_done_at, next_due_date, is_sample)
  values (a, mw01, (select id from public.equipment where location_id = mw01 and type = 'Blower Screen' order by name limit 1),
    'Clean the blower intake screens', 'clean', 2, 'weeks', today - 15, ((today - 15)::timestamp + interval '7 hours') at time zone tz, today - 1, true)
  returning id into s;
  insert into public.mi_log_entries (account_id, site_id, asset_id, schedule_id, entry_type, title, notes, result, performed_at, performed_by_name, labor_minutes, due_date, on_time, source, is_sample)
  select a, mw01, asset_id, id, 'cleaning', title, 'Lots of lint on screens 3 and 4.', 'ok', last_done_at, 'Sample data', 30, today - 14, true, 'web', true
  from public.mi_schedules where id = s;

  -- One repair that needs a follow-up, not on a schedule.
  insert into public.mi_log_entries (account_id, site_id, asset_id, entry_type, title, notes, result, performed_at, performed_by_name, labor_minutes, downtime_minutes, source, is_sample)
  values (a, mw01, (select id from public.equipment where location_id = mw01 and type = 'Wrap Motor' order by name limit 1),
    'repair', 'Wrap motor coupling slipping', 'Tightened the set screws. The coupling insert is worn and should be replaced.', 'follow_up',
    ((today - 4)::timestamp + interval '14 hours') at time zone tz, 'Sample data', 40, 25, 'web', true);
end $$;
