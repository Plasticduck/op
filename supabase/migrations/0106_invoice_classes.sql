create table if not exists invoice_classes (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  class text not null,
  sort_order int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (account_id, class)
);
alter table invoice_classes enable row level security;
drop policy if exists invoice_classes_select on invoice_classes;
create policy invoice_classes_select on invoice_classes for select using (account_id = auth_account_id());
drop policy if exists invoice_classes_write on invoice_classes;
create policy invoice_classes_write on invoice_classes for all using (account_id = auth_account_id() and auth_is_manager_plus()) with check (account_id = auth_account_id() and auth_is_manager_plus());
alter table ops_invoices add column if not exists class_names text[] not null default '{}';

insert into invoice_classes (account_id, class, sort_order) values
('54f3e299-1f61-4ed2-9921-3d02160b72e6','01 - LBK 82nd',0),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','02 - Odessa Kermit',1),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','03 - Midland Loop 250',2),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','04 - Andrews',3),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','05 - LBK 19th St',4),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','06 - Big Spring',5),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','07 - LBK Loop 289',6),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','08 - IBA',7),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','08 - Odessa Tres Hermanas',8),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','09 - LBK 50th',9),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','10 - LBK 80th University',10),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','11 - LBK 114th Quaker',11),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','12 - Midland 4110 North',12),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','13 - Midland 1103 And.',13),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','14 - Sweetwater',14),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','15 - Odessa 52nd St.',15),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','16 - Carlsbad Canyon St.',16),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','17 - Hobbs Joe Harvey',17),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','18 - Hobbs Bender St',18),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','19 - Hobbs Lube',19),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','20 - IN-BAY',20),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','21 - Lovington',21),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','22- 87th and Evans Odessa',22),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','23 - Carlsbad 1600 Skyline',23),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','24 - Midland Briarwood',24),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','25 - Grandview',25),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','26 - Artesia',26),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','27 - Valley Mills',27),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','28 - Robinson',28),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','29 - Killeen',29),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','30 - Harker Heights',30),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','31 - 2800 Midland',31),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','32 - LBK 96th & Indiana',32),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','33 - Dalhart TX',33),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','34 - Hereford TX',34),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','Spotless',35),
('54f3e299-1f61-4ed2-9921-3d02160b72e6','Corporate',36)
on conflict (account_id, class) do update set sort_order = excluded.sort_order, active = true;
