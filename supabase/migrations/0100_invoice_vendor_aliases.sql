-- Vendor aliases: when an invoice arrives under one name but should be filed
-- under a different vendor from the dropdown (e.g. the invoice is printed
-- "Arnold Oil Company Fuels - Lubbock" but Mighty Wash books it as "A-Line Auto
-- Parts"), the invoice-inbound function remaps the extracted vendor to the
-- canonical name before filing. Data-driven so new mappings need no code change.
create table if not exists invoice_vendor_aliases (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references accounts(id) on delete cascade,
  alias_name text not null,       -- vendor name as it arrives / is printed
  canonical_name text not null,   -- the invoice_vendors dropdown name to file under
  created_at timestamptz not null default now()
);

create unique index if not exists invoice_vendor_aliases_uq
  on invoice_vendor_aliases (account_id, lower(alias_name));

alter table invoice_vendor_aliases enable row level security;

create policy invoice_vendor_aliases_select on invoice_vendor_aliases
  for select using (account_id = auth_account_id());
create policy invoice_vendor_aliases_write on invoice_vendor_aliases
  for all using (account_id = auth_account_id() and auth_is_manager_plus())
  with check (account_id = auth_account_id() and auth_is_manager_plus());

-- Mighty Wash: Arnold Oil (Lubbock) files as A-Line Auto Parts.
insert into invoice_vendor_aliases (account_id, alias_name, canonical_name)
values ('54f3e299-1f61-4ed2-9921-3d02160b72e6', 'Arnold Oil Company Fuels - Lubbock', 'A-Line Auto Parts')
on conflict (account_id, lower(alias_name)) do update set canonical_name = excluded.canonical_name;
