-- Site Visits People tab: add Executive, Facilities and IT to the person types.
alter table public.fleet_people drop constraint fleet_people_category_check;
alter table public.fleet_people add constraint fleet_people_category_check
  check (category in ('regional_manager', 'executive', 'maintenance', 'facilities', 'it', 'other'));
