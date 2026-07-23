-- "Ask Operator" AI assistant: read-only SQL execution.
-- Runs as the CALLING user (security invoker) so row-level security scopes every
-- result to the caller's account and permitted locations automatically. This is
-- the tenant-isolation guarantee: the function grants no extra reach beyond what
-- the user could already see through the app. Extra guardrails on top of RLS:
-- a single SELECT/WITH statement only, a read-only transaction, an 8s statement
-- timeout, and a hard 1000-row cap.
create or replace function public.operator_ask_sql(query text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  result jsonb;
  q text := btrim(query);
  lowered text;
begin
  -- Allow one optional trailing semicolon; reject any other statement break so a
  -- second stacked statement cannot ride along.
  if right(q, 1) = ';' then
    q := btrim(left(q, length(q) - 1));
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

  set local statement_timeout = '8s';
  set local transaction_read_only = on;

  execute format(
    'select coalesce(jsonb_agg(row_to_json(t)), ''[]''::jsonb) from (select * from (%s) sub limit 1000) t',
    q
  ) into result;
  return result;
end;
$$;

grant execute on function public.operator_ask_sql(text) to authenticated;
