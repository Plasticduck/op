-- Allow a "Human Resources" (hr) document category (company handbook, iSolved
-- login instructions, etc.). Drop the existing documents category check (its
-- auto-generated name may vary) and re-add it with 'hr' included.
do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
    where contype = 'c' and conrelid = 'public.documents'::regclass
      and pg_get_constraintdef(oid) ilike '%category%' and pg_get_constraintdef(oid) ilike '%sop%'
  loop
    execute format('alter table public.documents drop constraint %I', r.conname);
  end loop;
end $$;

alter table public.documents add constraint documents_category_check
  check (category in ('sop', 'sds', 'policy', 'hr', 'other'));
