-- IT Inventory Phase 2 (2026-10-30): repairs and service (it_maintenances,
-- from 0182, gets its screens now).
--
-- Logging a repair can take the item out of service: its status becomes Out
-- for Repair and the status it had is kept on the record. Marking the repair
-- done records the downtime (from when it went out to when it came back) and
-- puts it back to that status, unless someone has changed it since (retired
-- it, say) or another open repair still has it out. Past repairs can be
-- logged as already done, with the downtime typed in.

alter table public.it_maintenances
  add column if not exists prior_status_id   uuid references public.it_status_labels(id) on delete set null,
  add column if not exists out_of_service_at timestamptz;
create index if not exists it_maintenances_open_idx on public.it_maintenances (asset_id)
  where completion_date is null and deleted_at is null;

create or replace function public.it_log_repair(
  p_asset uuid, p_type uuid, p_title text,
  p_supplier uuid default null, p_is_warranty boolean default false, p_cost numeric default null,
  p_start date default null, p_completed date default null, p_downtime_minutes integer default null,
  p_out_of_service boolean default false, p_notes text default null
) returns uuid language plpgsql security invoker set search_path = public as $$
declare
  a      public.it_assets%rowtype;
  repair uuid;
  prior  uuid;
  out_at timestamptz;
  id_    uuid;
  res    jsonb;
begin
  select * into a from public.it_assets where id = p_asset and deleted_at is null;
  if not found or not it_can_write(a.location_id) then
    raise exception 'You can''t log repairs for this item' using errcode = '42501';
  end if;
  if btrim(coalesce(p_title, '')) = '' then
    raise exception 'Say what''s being done.';
  end if;
  if p_completed is not null and p_completed < coalesce(p_start, current_date) then
    raise exception 'It can''t be done before it started.';
  end if;

  if p_out_of_service and p_completed is null then
    select id into repair from public.it_status_labels
     where account_id = a.account_id and deleted_at is null and lower(name) = 'out for repair';
    if repair is null then
      select id into repair from public.it_status_labels
       where account_id = a.account_id and deleted_at is null and type = 'undeployable' order by sort_order limit 1;
    end if;
    if repair is not null then
      out_at := now();
      if a.status_label_id is distinct from repair then
        prior := a.status_label_id;
      else
        -- Already out for another repair: it comes back to what it was before that one.
        select prior_status_id into prior from public.it_maintenances
         where asset_id = a.id and completion_date is null and deleted_at is null and out_of_service_at is not null
         order by out_of_service_at limit 1;
      end if;
    end if;
  end if;

  insert into public.it_maintenances
    (account_id, location_id, asset_id, maintenance_type_id, title, supplier_id, is_warranty, cost,
     start_date, completion_date, downtime_minutes, notes, prior_status_id, out_of_service_at)
  values
    (a.account_id, a.location_id, a.id, p_type, btrim(p_title), p_supplier, coalesce(p_is_warranty, false), p_cost,
     coalesce(p_start, current_date), p_completed, case when p_completed is not null then p_downtime_minutes end,
     nullif(btrim(coalesce(p_notes, '')), ''), prior, out_at)
  returning id into id_;

  if repair is not null and a.status_label_id is distinct from repair then
    res := public.it_set_status(array[a.id], repair, 'In for repair: ' || btrim(p_title));
    perform set_config('it.note', '', true);
    if not coalesce((res -> 0 ->> 'ok')::boolean, false) then
      raise exception '%', coalesce(res -> 0 ->> 'error', 'Couldn''t change its status');
    end if;
  end if;
  return id_;
end $$;
grant execute on function public.it_log_repair(uuid, uuid, text, uuid, boolean, numeric, date, date, integer, boolean, text) to authenticated;

create or replace function public.it_finish_repair(
  p_id uuid, p_completed date default null, p_cost numeric default null, p_note text default null
) returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  m        public.it_maintenances%rowtype;
  a        public.it_assets%rowtype;
  done_on  date := coalesce(p_completed, current_date);
  back_at  timestamptz;
  mins     integer;
  restored text;
  res      jsonb;
begin
  select * into m from public.it_maintenances where id = p_id and deleted_at is null;
  if not found or not it_can_write(m.location_id) then
    raise exception 'You can''t update this repair' using errcode = '42501';
  end if;
  if m.completion_date is not null then
    raise exception 'This one is already done.';
  end if;
  if done_on < m.start_date then
    raise exception 'It can''t be done before it started.';
  end if;

  -- Downtime runs until now, or the end of the day it was done if that's past.
  if m.out_of_service_at is not null then
    back_at := case when done_on >= (now() at time zone 'America/Chicago')::date then now()
                    else ((done_on + 1)::timestamp at time zone 'America/Chicago') end;
    mins := greatest(0, round(extract(epoch from (back_at - m.out_of_service_at)) / 60))::integer;
  end if;

  update public.it_maintenances
     set completion_date = done_on,
         cost = coalesce(p_cost, cost),
         downtime_minutes = coalesce(mins, downtime_minutes),
         notes = case when nullif(btrim(coalesce(p_note, '')), '') is null then notes
                      else concat_ws(E'\n', notes, btrim(p_note)) end
   where id = m.id;

  -- Back to what it was: only if it's still out of service (not retired or
  -- changed since) and no other open repair still has it out.
  select * into a from public.it_assets where id = m.asset_id;
  if m.prior_status_id is not null and a.deleted_at is null
     and (select type from public.it_status_labels where id = a.status_label_id) = 'undeployable'
     and a.status_label_id is distinct from m.prior_status_id
     and not exists (select 1 from public.it_maintenances o
                      where o.asset_id = m.asset_id and o.id <> m.id and o.completion_date is null
                        and o.deleted_at is null and o.out_of_service_at is not null) then
    res := public.it_set_status(array[a.id], m.prior_status_id, 'Back from repair: ' || m.title);
    perform set_config('it.note', '', true);
    if coalesce((res -> 0 ->> 'ok')::boolean, false) then
      select name into restored from public.it_status_labels where id = m.prior_status_id;
    end if;
  end if;
  return jsonb_build_object('downtime_minutes', mins, 'restored', restored);
end $$;
grant execute on function public.it_finish_repair(uuid, date, numeric, text) to authenticated;
