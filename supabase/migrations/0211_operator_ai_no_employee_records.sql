-- Operator AI also can't read injury reports, counseling records or performance
-- reviews on the shared office login (Corporate Display).
--
-- On that login operator_ask_sql looks in ai_no_pay first (0210), so these views stand
-- in for the real tables and refuse when read. This goes by the table Postgres actually
-- resolves rather than by matching words in the query, so "count(*) as reviews" on
-- Google reviews still works, and a comma join can't slip past. operator_ask_sql
-- already refuses "public." names, so the real tables can't be named directly.
create or replace function ai_no_pay.refuse()
returns table (not_available text)
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'This login cannot read injury, counseling or performance review records, so that query is not allowed.';
end;
$$;

create or replace view ai_no_pay.injury_reports with (security_invoker = true) as select * from ai_no_pay.refuse();
create or replace view ai_no_pay.counseling_records with (security_invoker = true) as select * from ai_no_pay.refuse();
create or replace view ai_no_pay.reviews with (security_invoker = true) as select * from ai_no_pay.refuse();

-- AI Insights in the "people" category are written from pay, review and counseling
-- records (generate-insights), so they'd repeat what the views above hold back.
create or replace view ai_no_pay.ai_insights with (security_invoker = true) as
  select id, account_id, location_id, generated_at, category, insight_text, severity,
         acknowledged, acknowledged_by, acknowledged_at, archived
  from public.ai_insights
  where category <> 'people';

grant execute on function ai_no_pay.refuse() to authenticated;
grant select on ai_no_pay.injury_reports, ai_no_pay.counseling_records, ai_no_pay.reviews, ai_no_pay.ai_insights to authenticated;
