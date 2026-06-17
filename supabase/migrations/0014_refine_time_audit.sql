-- 0014_refine_time_audit.sql
-- The time-entry audit trigger fired on every clock_out change, including
-- normal kiosk punch-outs (which set clock_out but not edited_by). That's
-- noise. Only manual edits set edited_by, so gate the audit on that.

create or replace function public.audit_time_entry_edit()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.edited_by is not null
     and ((new.clock_in is distinct from old.clock_in)
          or (new.clock_out is distinct from old.clock_out)) then
    insert into public.audit_log (table_name, row_id, actor_user_id, action, diff)
    values (
      'time_entries', old.id, auth.uid(), 'time_entry_edited',
      jsonb_build_object(
        'before', jsonb_build_object('clock_in', old.clock_in, 'clock_out', old.clock_out),
        'after',  jsonb_build_object('clock_in', new.clock_in, 'clock_out', new.clock_out)
      )
    );
  end if;
  return new;
end $$;
