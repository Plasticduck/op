-- IT Inventory (2026-10-30): a tracker, not a monitor. Mighty Wash already
-- gets downtime alerts elsewhere, so the device heartbeats from 0192 come out
-- (and the spec's site probe is not planned). Health is now only what people
-- report: "not working" (offline) until someone marks it working, which
-- clears it back to no known problem (unknown). The it_health_events trigger
-- from 0192 still applies those reports.

select cron.unschedule('it-health-sweep') where exists (select 1 from cron.job where jobname = 'it-health-sweep');
drop function if exists public.it_heartbeat(text);
drop function if exists public.it_link_device(uuid, text);
drop function if exists public.it_unlink_device(uuid);
drop function if exists public.it_health_sweep();
drop function if exists public.it_manual_down(uuid);
drop table if exists public.it_device_links;
drop index if exists public.it_assets_heartbeat_idx;

-- Nothing was linked in production; this keeps any test leftovers consistent.
update public.it_assets set monitoring_enabled = false, monitor_method = 'none'
 where monitor_method = 'heartbeat' or monitoring_enabled;

-- Overview numbers without monitoring: "not working" is people's reports, and
-- each site carries its overdue audits (the Audits screen lists sites by it).
drop function if exists public.it_overview(uuid, date);
create or replace function public.it_overview(p_location uuid default null, p_today date default current_date)
returns jsonb language sql stable security invoker set search_path = public as $$
  with a as materialized (
    select a.id, a.location_id, a.category_id, a.health_state, a.warranty_end_date, a.next_audit_date,
           a.last_audit_at, a.sticker_condition,
           st.type as st_type, lower(st.name) as st_name, coalesce(t.printed_count, 0) as printed
      from public.it_assets a
      left join public.it_status_labels st on st.id = a.status_label_id
      left join public.it_asset_tags t on t.account_id = a.account_id and t.tag = a.asset_tag
     where a.deleted_at is null and coalesce(st.type, '') <> 'archived'
       and (p_location is null or a.location_id = p_location)
  ),
  sub as materialized (
    select s.location_id,
           case s.billing_cycle when 'monthly' then s.cost when 'quarterly' then s.cost / 3 when 'annual' then s.cost / 12 end as monthly,
           case when s.auto_renew and coalesce(s.cancel_notice_days, 0) > 0
                then s.renewal_date - s.cancel_notice_days else s.renewal_date end as act_by
      from public.it_subscriptions s
     where s.deleted_at is null and (p_location is null or s.location_id = p_location)
  )
  select jsonb_build_object(
    'total', (select count(*) from a),
    'attention', jsonb_build_object(
      'not_working', (select count(*) from a where health_state = 'offline'),
      'repair',      (select count(*) from a where st_name = 'out for repair'),
      'warranty',    (select count(*) from a where warranty_end_date between p_today and p_today + 60),
      'audits',      (select count(*) from a where next_audit_date < p_today),
      'stickers',    (select count(*) from a where printed = 0 or sticker_condition in ('faded', 'missing')),
      'renewals',    (select count(*) from sub where act_by between p_today and p_today + 60),
      'low_stock',   (select count(*) from public.it_consumables c
                       where c.deleted_at is null and c.low_since is not null
                         and (p_location is null or c.location_id = p_location))
    ),
    'by_site', (select coalesce(jsonb_agg(x order by x.name), '[]'::jsonb) from (
      select l.id, l.name, count(*) as total,
             count(*) filter (where a.health_state = 'offline') as not_working,
             count(*) filter (where a.st_name = 'out for repair') as repair,
             count(*) filter (where a.next_audit_date < p_today) as audits_overdue,
             min(a.next_audit_date) as next_audit,
             max(a.last_audit_at) as last_audit
        from a join public.locations l on l.id = a.location_id
       group by l.id, l.name) x),
    'by_category', (select coalesce(jsonb_agg(x order by x.total desc, x.name), '[]'::jsonb) from (
      select c.id, c.name, c.icon, count(*) as total,
             count(*) filter (where a.health_state = 'offline') as not_working
        from a join public.it_categories c on c.id = a.category_id
       group by c.id, c.name, c.icon) x),
    'spend', jsonb_build_object(
      'monthly', (select coalesce(sum(monthly), 0) from sub),
      'unpriced', (select count(*) from sub where monthly is null),
      'by_site', (select coalesce(jsonb_agg(x order by x.monthly desc), '[]'::jsonb) from (
        select sub.location_id as id, coalesce(l.name, 'Every site') as name, sum(sub.monthly) as monthly, count(*) as items
          from sub left join public.locations l on l.id = sub.location_id
         group by sub.location_id, l.name) x)
    ),
    'repair_spend_90d', (select coalesce(sum(m.cost), 0) from public.it_maintenances m
                          where coalesce(m.completion_date, m.start_date) >= p_today - 90
                            and (p_location is null or m.location_id = p_location))
  )
$$;
grant execute on function public.it_overview(uuid, date) to authenticated;
