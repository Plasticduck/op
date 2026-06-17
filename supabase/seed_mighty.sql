-- One-off showcase seed for the "Mighty Wash" account / "Test Loco" location.
-- Run with the service role (bypasses RLS). Safe-ish to re-run: most inserts are
-- additive; the schedule + closeouts guard against conflicts.
set search_path = public, extensions;

do $$
declare
  acct uuid := '54f3e299-1f61-4ed2-9921-3d02160b72e6';
  loc  uuid := '389bb8b0-120b-4485-98dd-6a434e93c35a';
  owner_u uuid := '4b3cadb7-0a31-424f-81b3-c3c34e102501';
  emp_user uuid := '30354f45-75d2-4e64-90c9-f969d07e3716';
  ben uuid := '211e7131-3a82-4785-910e-d23d32002c4a';

  e_maria uuid; e_jamal uuid; e_sofia uuid; e_caleb uuid; e_nina uuid; e_diego uuid;
  q_tunnel uuid; q_conveyor uuid; q_foam uuid; q_dryer uuid; q_vac uuid; q_pump uuid;
  p_belt uuid; p_brush uuid; p_chain uuid; p_filter uuid; p_nozzle uuid;
  c_open uuid; c_close uuid; c_weekly uuid;
  w1 uuid; w2 uuid; w3 uuid;
  sched uuid;
  wk date := date_trunc('week', current_date)::date; -- Monday
  emps uuid[];
  eid uuid;
  dd int;
begin
  -- 1) Link the benjaminjowersbpj login to the Benjamin Jowers employee + PIN.
  update public.employees
    set user_id = emp_user,
        role_title = coalesce(role_title, 'Attendant'),
        hourly_rate = coalesce(hourly_rate, 16.00),
        start_date = coalesce(start_date, current_date - 210),
        pin_hash = crypt('1234', gen_salt('bf'))
    where id = ben;

  -- 2) Roster
  insert into public.employees (location_id, first_name, last_name, email, phone, role_title, start_date, hourly_rate, uniform_size, status, pin_hash) values
    (loc,'Maria','Lopez','maria.lopez@mightywash.test','555-0142','Shift Lead', current_date-540, 19.50,'M','active', crypt('2468', gen_salt('bf'))) returning id into e_maria;
  insert into public.employees (location_id, first_name, last_name, email, phone, role_title, start_date, hourly_rate, uniform_size, status, pin_hash) values
    (loc,'Jamal','Carter','jamal.carter@mightywash.test','555-0188','Attendant', current_date-300, 15.50,'L','active', crypt('1357', gen_salt('bf'))) returning id into e_jamal;
  insert into public.employees (location_id, first_name, last_name, email, phone, role_title, start_date, hourly_rate, uniform_size, status, pin_hash) values
    (loc,'Sofia','Reyes','sofia.reyes@mightywash.test','555-0199','Attendant', current_date-150, 15.00,'S','active', crypt('8642', gen_salt('bf'))) returning id into e_sofia;
  insert into public.employees (location_id, first_name, last_name, email, phone, role_title, start_date, hourly_rate, uniform_size, status, pin_hash) values
    (loc,'Caleb','Brooks','caleb.brooks@mightywash.test','555-0223','Detailer', current_date-420, 17.00,'XL','active', crypt('9753', gen_salt('bf'))) returning id into e_caleb;
  insert into public.employees (location_id, first_name, last_name, email, phone, role_title, start_date, hourly_rate, uniform_size, status, pin_hash) values
    (loc,'Nina','Patel','nina.patel@mightywash.test','555-0277','Cashier', current_date-90, 16.00,'S','active', crypt('3690', gen_salt('bf'))) returning id into e_nina;
  insert into public.employees (location_id, first_name, last_name, email, phone, role_title, start_date, hourly_rate, uniform_size, status, pin_hash) values
    (loc,'Diego','Ramos','diego.ramos@mightywash.test','555-0301','Maintenance Tech', current_date-800, 22.00,'L','active', crypt('4812', gen_salt('bf'))) returning id into e_diego;

  emps := array[ben, e_maria, e_jamal, e_sofia, e_caleb, e_nina, e_diego];

  -- 3) Equipment
  insert into public.equipment (location_id, name, type, status, purchase_date, last_serviced_at, service_interval_days) values
    (loc,'Bay 1 Tunnel Motor','motor','operational', current_date-700, current_date-35, 90) returning id into q_tunnel;
  insert into public.equipment (location_id, name, type, status, purchase_date, last_serviced_at, service_interval_days) values
    (loc,'Main Conveyor','conveyor','operational', current_date-700, current_date-18, 60) returning id into q_conveyor;
  insert into public.equipment (location_id, name, type, status, purchase_date, last_serviced_at, service_interval_days) values
    (loc,'Foam Cannons','chemical','maintenance', current_date-365, current_date-70, 90) returning id into q_foam;
  insert into public.equipment (location_id, name, type, status, purchase_date, last_serviced_at, service_interval_days) values
    (loc,'Dryer Array','dryer','operational', current_date-500, current_date-12, 120) returning id into q_dryer;
  insert into public.equipment (location_id, name, type, status, purchase_date, last_serviced_at, service_interval_days) values
    (loc,'Vacuum Bank','vacuum','down', current_date-260, current_date-5, 30) returning id into q_vac;
  insert into public.equipment (location_id, name, type, status, purchase_date, last_serviced_at, service_interval_days) values
    (loc,'High-Pressure Pump','pump','operational', current_date-600, current_date-44, 90) returning id into q_pump;

  -- 4) Parts
  insert into public.parts_inventory (location_id, name, sku, quantity_on_hand, reorder_threshold, unit_cost) values
    (loc,'Conveyor Belt Lube','CBL-100', 2, 4, 18.50) returning id into p_belt;
  insert into public.parts_inventory (location_id, name, sku, quantity_on_hand, reorder_threshold, unit_cost) values
    (loc,'Foam Brush Replacement','FBR-22', 6, 3, 64.00) returning id into p_brush;
  insert into public.parts_inventory (location_id, name, sku, quantity_on_hand, reorder_threshold, unit_cost) values
    (loc,'Drive Chain Pins','DCP-7', 1, 6, 3.25) returning id into p_chain;
  insert into public.parts_inventory (location_id, name, sku, quantity_on_hand, reorder_threshold, unit_cost) values
    (loc,'Dryer Filter','DF-9', 14, 4, 9.75) returning id into p_filter;
  insert into public.parts_inventory (location_id, name, sku, quantity_on_hand, reorder_threshold, unit_cost) values
    (loc,'Spray Nozzle','SN-3', 9, 5, 12.00) returning id into p_nozzle;

  -- 5) Checklists + items
  insert into public.checklists (location_id, name, frequency, due_by) values (loc,'Opening Checklist','daily','08:30') returning id into c_open;
  insert into public.checklists (location_id, name, frequency, due_by) values (loc,'Closing Checklist','daily','21:00') returning id into c_close;
  insert into public.checklists (location_id, name, frequency, due_by) values (loc,'Weekly Equipment Check','weekly', null) returning id into c_weekly;
  insert into public.checklist_items (checklist_id, label, order_index)
    select c_open, x.l, x.i from (values ('Power on tunnel + conveyor',0),('Check chemical levels',1),('Inspect brushes',2),('Test wash cycle',3),('Clear vacuum stations',4)) x(l,i);
  insert into public.checklist_items (checklist_id, label, order_index)
    select c_close, x.l, x.i from (values ('Shut down systems',0),('Drain reclaim tank',1),('Empty trash + vacuums',2),('Lock chemical room',3),('Submit closeout',4)) x(l,i);
  insert into public.checklist_items (checklist_id, label, order_index)
    select c_weekly, x.l, x.i from (values ('Grease conveyor bearings',0),('Inspect belt tension',1),('Check dryer filters',2),('Test e-stops',3)) x(l,i);

  -- completions over the last 6 days (opening + closing)
  -- NOTE: completed_by/submitted_by/reported_by/assigned_to reference users
  -- (app logins), not employees. Mighty Wash only has two users: the owner and
  -- Ben's login, so those columns use owner_u / emp_user.
  for dd in 1..6 loop
    insert into public.checklist_completions (checklist_id, location_id, completed_by, completed_at, notes)
      values (c_open, loc, emp_user, (current_date - dd) + time '08:10', case when dd=3 then 'Low on foam concentrate' else null end);
    if dd <> 2 then
      insert into public.checklist_completions (checklist_id, location_id, completed_by, completed_at)
        values (c_close, loc, owner_u, (current_date - dd) + time '20:50');
    end if;
  end loop;

  -- 6) Work orders + parts
  insert into public.work_orders (location_id, equipment_id, title, description, status, priority, assigned_to, created_by, labor_cost, created_at) values
    (loc, q_vac,'Vacuum bank suction loss','Stalls 4 and 5 have weak suction.','open','high', emp_user, owner_u, 0, now()-interval '2 days') returning id into w1;
  insert into public.work_orders (location_id, equipment_id, title, description, status, priority, assigned_to, created_by, labor_cost, created_at) values
    (loc, q_foam,'Replace foam cannon nozzles','Streaky foam coverage on bay 1.','in_progress','medium', owner_u, owner_u, 40, now()-interval '1 day') returning id into w2;
  insert into public.work_orders (location_id, equipment_id, title, description, status, priority, assigned_to, created_by, labor_cost, created_at, closed_at) values
    (loc, q_conveyor,'Conveyor chain re-tension','Chain skipping under load.','closed','medium', owner_u, owner_u, 60, now()-interval '6 days', now()-interval '5 days') returning id into w3;
  insert into public.work_order_parts (work_order_id, part_id, part_name, quantity, unit_cost) values
    (w2, p_nozzle,'Spray Nozzle', 3, 12.00),
    (w3, p_chain,'Drive Chain Pins', 2, 3.25);

  -- 7) Downtime
  insert into public.downtime_events (location_id, equipment_id, reason, reason_category, started_at, ended_at, reported_by) values
    (loc, q_vac,'Suction failure on stalls 4-5','mechanical', now()-interval '2 days', null, emp_user),
    (loc, q_foam,'Clogged foam line','chemical', now()-interval '5 days', now()-interval '5 days'+interval '95 minutes', owner_u),
    (loc, q_dryer,'Breaker tripped','electrical', now()-interval '9 days', now()-interval '9 days'+interval '40 minutes', owner_u);

  -- 8) Closeouts (last 12 days)
  for dd in 1..12 loop
    insert into public.closeouts (location_id, date, submitted_by, total_sales, cash_amount, card_amount, deposit_amount, drawer_count, locked)
    values (loc, current_date - dd, owner_u,
      round((1800 + random()*1600 + case when extract(dow from current_date - dd) in (0,6) then 900 else 0 end)::numeric,2),
      round((300 + random()*250)::numeric,2),
      round((1500 + random()*1300)::numeric,2),
      round((1800 + random()*1500)::numeric,2),
      200, true)
    on conflict (location_id, date) do nothing;
  end loop;

  -- 9) Schedule (this week, published) + shifts
  insert into public.schedules (location_id, week_start_date, created_by, published)
    values (loc, wk, owner_u, true)
    on conflict (location_id, week_start_date) do update set published = true
    returning id into sched;
  -- clear any prior shifts for a clean re-seed of this week
  delete from public.shifts where schedule_id = sched;
  for dd in 0..6 loop
    -- opener + closer + two mids most days
    insert into public.shifts (schedule_id, employee_id, date, start_time, end_time, role_label) values
      (sched, emps[1 + (dd % 7)], wk + dd, '07:00','15:00','Opener'),
      (sched, emps[1 + ((dd+2) % 7)], wk + dd, '12:00','20:00','Closer');
    if dd between 1 and 5 then
      insert into public.shifts (schedule_id, employee_id, date, start_time, end_time, role_label) values
        (sched, emps[1 + ((dd+4) % 7)], wk + dd, '09:00','17:00','Wash'),
        (sched, e_caleb, wk + dd, '10:00','18:00','Detail');
    end if;
  end loop;

  -- 10) Time entries: completed shifts last 6 days + a few clocked-in now
  for dd in 1..6 loop
    foreach eid in array array[ben, e_maria, e_jamal, e_sofia] loop
      insert into public.time_entries (location_id, employee_id, clock_in, clock_out)
        values (loc, eid, (current_date-dd)+time '08:00' + (random()*interval '15 minutes'),
                          (current_date-dd)+time '16:00' + (random()*interval '20 minutes'));
    end loop;
  end loop;
  -- clocked in right now (open entries) → drives "currently working"
  insert into public.time_entries (location_id, employee_id, clock_in) values
    (loc, ben, current_date + time '07:58'),
    (loc, e_maria, current_date + time '06:45'),
    (loc, e_nina, current_date + time '09:05');

  -- 11) Reviews
  insert into public.reviews (employee_id, reviewed_by, review_date, rating, notes, goals, status) values
    (e_maria, owner_u, current_date-40, 5, 'Excellent leadership on the floor.', 'Cross-train on closeouts.', 'completed'),
    (e_jamal, owner_u, current_date-25, 4, 'Reliable, friendly with customers.', 'Speed up bay turnover.', 'completed');
  insert into public.reviews (employee_id, reviewed_by, due_date, status) values
    (ben, owner_u, current_date+10, 'scheduled');

  -- 12) Counseling
  insert into public.counseling_records (employee_id, recorded_by, date, type, description, employee_acknowledged, acknowledged_at) values
    (e_jamal, owner_u, current_date-30, 'verbal','Late arrival twice in one week.', true, now()-interval '29 days');

  -- 13) Injury report
  insert into public.injury_reports (employee_id, location_id, reported_by, incident_date, description, body_part_affected, medical_treatment_required, witness_names) values
    (e_caleb, loc, owner_u, current_date-60, 'Slipped on wet floor near vacuums.', 'Lower back', false, 'Maria Lopez');

  -- 14) Uniform requests
  insert into public.uniform_requests (employee_id, item, size, quantity, status) values
    (e_sofia,'Polo shirt','S',2,'pending'),
    (e_jamal,'Cap','L',1,'ordered'),
    (ben,'Rain jacket','M',1,'fulfilled');
  update public.uniform_requests set fulfilled_at = now()-interval '3 days' where status='fulfilled' and employee_id=ben;

  -- 15) Time-off requests
  insert into public.time_off_requests (location_id, employee_id, start_date, end_date, reason, status) values
    (loc, ben, current_date+14, current_date+16, 'Family trip','pending'),
    (loc, e_sofia, current_date+30, current_date+31, 'Appointment','pending');
  insert into public.time_off_requests (location_id, employee_id, start_date, end_date, reason, status, reviewed_by, reviewed_at) values
    (loc, e_maria, current_date-5, current_date-4, 'Personal day','approved', owner_u, now()-interval '12 days');

  -- 16) Calendar events
  insert into public.calendar_events (location_id, title, description, start_at, end_at, all_day, created_by) values
    (loc,'Team huddle','Weekly all-hands.', (current_date+1)+time '08:00', (current_date+1)+time '08:30', false, owner_u),
    (loc,'New chemical training','Vendor demo for foam system.', (current_date+3)+time '14:00', (current_date+3)+time '15:30', false, owner_u),
    (loc,'Quarterly inventory','Full parts + supplies count.', (current_date+7), null, true, owner_u);

  -- 17) Breaks today (one active, two upcoming)
  insert into public.breaks (location_id, employee_id, scheduled_start, scheduled_end, started_at, created_by) values
    (loc, ben, now()-interval '8 minutes', now()+interval '22 minutes', now()-interval '8 minutes', owner_u);
  insert into public.breaks (location_id, employee_id, scheduled_start, scheduled_end, created_by) values
    (loc, e_maria, now()+interval '90 minutes', now()+interval '120 minutes', owner_u),
    (loc, e_nina, now()+interval '180 minutes', now()+interval '195 minutes', owner_u);

  -- 18) AI insight cards (for showcase without the API key)
  insert into public.ai_insights (account_id, location_id, category, severity, insight_text) values
    (acct, loc, 'ops','warning','The Vacuum Bank has been down for 2 days and is the source of your only open high-priority work order. Stalls 4-5 outages are costing peak-weekend throughput.'),
    (acct, loc, 'ops','info','Drive Chain Pins are at 1 unit (reorder at 6) and Conveyor Belt Lube is at 2 (reorder at 4). Reorder before the weekly equipment check.'),
    (acct, loc, 'financial','info','Weekend closeouts are averaging ~$900 higher than weekdays over the last 12 days — consider adding a mid-shift attendant Saturdays.'),
    (acct, loc, 'people','warning','Jamal Carter has a verbal counseling for repeated late arrivals this month. A quick check-in could prevent escalation.');
end $$;
