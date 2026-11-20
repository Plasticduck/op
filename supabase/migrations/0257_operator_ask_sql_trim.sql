-- Operator AI's queries often start with a line break ("\nSELECT ..."). btrim()
-- only strips spaces, so those failed the "starts with SELECT" check and came back
-- as "Only SELECT queries are allowed" (98 refusals before this), costing the model
-- rounds while it rewrote them. Trim all whitespace instead. Nothing else changes.
create or replace function public.operator_ask_sql(query text)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$
declare
  result jsonb;
  q text := regexp_replace(query, '^\s+|\s+$', '', 'g');
  lowered text;
begin
  -- Allow one optional trailing semicolon; reject any other statement break so a
  -- second stacked statement cannot ride along.
  if right(q, 1) = ';' then
    q := regexp_replace(left(q, length(q) - 1), '\s+$', '');
  end if;
  if position(';' in q) > 0 then
    raise exception 'Only a single statement is allowed';
  end if;

  lowered := lower(q);
  if lowered !~ '^(select|with)\s' then
    raise exception 'Only SELECT queries are allowed';
  end if;
  -- Block data-modifying keywords (covers data-modifying CTEs too). The read-only
  -- transaction below is the belt-and-suspenders backstop.
  if lowered ~ '\y(insert|update|delete|drop|alter|truncate|grant|revoke|create|comment|copy|vacuum|reindex|refresh|call|merge|attach|detach)\y' then
    raise exception 'Only read-only SELECT queries are allowed';
  end if;

  -- The shared office login can't read pay. Past the pay names themselves, this
  -- refuses the ways around the views: naming the real tables, hiding a name with a
  -- comment or unicode escape, reading the catalogs, or running SQL held in a string.
  if public.auth_role_category() = 'corporate_display' then
    if lowered ~ '\y(hourly_rate|pin_hash|tips|gm_bonus_base|gm_bonus_months|event_pay_requests|per_diem_requests|mileage_requests)\y'
      or lowered ~ '\ypublic"?\s*\.'
      or lowered ~ '\y(pg_\w+|information_schema|set_config|\w+_to_xml\w*|ts_stat|ts_rewrite)\y'
      or lowered ~ '/\*|--|u&"'
    then
      raise exception 'This login cannot read pay information, so that query is not allowed.';
    end if;
    set local search_path = ai_no_pay, public;
  end if;

  set local statement_timeout = '8s';
  set local transaction_read_only = on;

  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) sub limit 1000) t',
    q
  ) into result;
  return result;
end;
$function$;
