-- seed.sql — business sample data (no auth users; those are created by seed.ts).
-- Idempotent-ish: safe to run on a fresh DB. Uses fixed IDs for the demo
-- account + locations so seed.ts can reference them.

insert into public.accounts (id, name, is_demo, plan)
values ('00000000-0000-0000-0000-0000000000a1', 'WashLyfe Demo', true, 'multi')
on conflict (id) do nothing;

insert into public.locations (id, account_id, name, address, timezone, closeout_time)
values
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1',
   'Highway 40', '4400 Highway 40, Columbia, MO', 'America/Chicago', '21:00'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1',
   'Downtown', '210 E Broadway, Columbia, MO', 'America/Chicago', '20:00')
on conflict (id) do nothing;

-- Equipment ------------------------------------------------------------------
insert into public.equipment (location_id, name, type, status, last_serviced_at, service_interval_days)
values
  ('00000000-0000-0000-0000-0000000000b1', 'Bay 2 Tunnel Motor', 'motor', 'operational', current_date - 40, 90),
  ('00000000-0000-0000-0000-0000000000b1', 'Conveyor System', 'conveyor', 'operational', current_date - 20, 60),
  ('00000000-0000-0000-0000-0000000000b1', 'Foam Brushes', 'brushes', 'down', current_date - 75, 90),
  ('00000000-0000-0000-0000-0000000000b2', 'Dryer Array', 'dryer', 'operational', current_date - 10, 120),
  ('00000000-0000-0000-0000-0000000000b2', 'Vacuum Bank', 'vacuum', 'maintenance', current_date - 5, 30);

-- Parts inventory ------------------------------------------------------------
insert into public.parts_inventory (location_id, name, sku, quantity_on_hand, reorder_threshold, unit_cost)
values
  ('00000000-0000-0000-0000-0000000000b1', 'Conveyor Belt Lube', 'CBL-100', 2, 4, 18.50),
  ('00000000-0000-0000-0000-0000000000b1', 'Foam Brush Replacement', 'FBR-22', 0, 2, 64.00),
  ('00000000-0000-0000-0000-0000000000b1', 'Drive Chain Pins', 'DCP-7', 4, 6, 3.25),
  ('00000000-0000-0000-0000-0000000000b2', 'Dryer Filter', 'DF-9', 12, 4, 9.75);

-- Checklists + items ---------------------------------------------------------
with c as (
  insert into public.checklists (location_id, name, frequency, due_by)
  values
    ('00000000-0000-0000-0000-0000000000b1', 'Opening Checklist', 'daily', '08:00'),
    ('00000000-0000-0000-0000-0000000000b1', 'Tunnel Exit Inspection', 'daily', '20:00'),
    ('00000000-0000-0000-0000-0000000000b2', 'Opening Checklist', 'daily', '08:00')
  returning id, name
)
insert into public.checklist_items (checklist_id, label, order_index)
select c.id, x.label, x.idx
from c
cross join lateral (
  values
    ('Power on all systems', 0),
    ('Check chemical levels', 1),
    ('Inspect conveyor belt', 2),
    ('Test wash cycle', 3),
    ('Clear vacuum stations', 4)
) as x(label, idx)
where c.name = 'Opening Checklist';

-- Employees (HR records; user_id linked later by seed.ts where applicable) ----
insert into public.employees (location_id, first_name, last_name, email, role_title, start_date, hourly_rate, status)
values
  ('00000000-0000-0000-0000-0000000000b1', 'Marcus', 'Tate', 'marcus@demo.washlyfe.com', 'Lead Attendant', current_date - 400, 17.50, 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'Priya', 'Sharma', 'priya@demo.washlyfe.com', 'Attendant', current_date - 220, 15.00, 'active'),
  ('00000000-0000-0000-0000-0000000000b1', 'Aaron', 'Wells', 'aaron@demo.washlyfe.com', 'Attendant', current_date - 90, 15.00, 'active'),
  ('00000000-0000-0000-0000-0000000000b2', 'Dana', 'Cole', 'dana@demo.washlyfe.com', 'Site Manager', current_date - 700, 24.00, 'active');

-- A couple of open work orders + a downtime event for dashboard realism ------
insert into public.work_orders (location_id, equipment_id, title, description, status, priority)
select l.id, e.id, 'Bay 2 tunnel motor — vibration', 'Intermittent vibration under load', 'open', 'high'
from public.locations l
join public.equipment e on e.location_id = l.id and e.name = 'Bay 2 Tunnel Motor'
where l.id = '00000000-0000-0000-0000-0000000000b1';

insert into public.downtime_events (location_id, equipment_id, reason, reason_category, started_at, ended_at)
select l.id, e.id, 'Foam brush motor seized', 'mechanical', now() - interval '3 days', now() - interval '3 days' + interval '2 hours 18 minutes'
from public.locations l
join public.equipment e on e.location_id = l.id and e.name = 'Foam Brushes'
where l.id = '00000000-0000-0000-0000-0000000000b1';
