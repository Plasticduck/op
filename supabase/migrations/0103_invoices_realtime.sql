-- The Invoice Approval page subscribes to postgres_changes on ops_invoices to
-- live-refresh as mail arrives and invoices move through the workflow, but the
-- table was never added to the realtime publication, so the UI only updated on a
-- manual refresh (e.g. exported invoices appeared to linger in Approved). Add it.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ops_invoices'
  ) then
    alter publication supabase_realtime add table ops_invoices;
  end if;
end $$;
