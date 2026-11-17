-- Site Audit NEW (/app/site-audits-new): a graded site audit, kept apart from the
-- older site_audits so neither form's answers have to fit the other's columns.
--
-- Eight sections of green / yellow / red items, each item with comments and
-- photos. A red item fails its section; each passed section is worth 12.5 of 100
-- points; a red Safety item fails the whole audit. The questions and the grading
-- live in the app (src/features/opssuite/siteauditnew/form.ts); a row keeps the
-- answers and, once submitted, the result worked out from them.
--
-- A row is the auditor's draft from the moment they start, so a phone that reloads
-- the page (iOS does, after the camera) reopens the same audit with its answers.
-- Photos go in the site-audit-photos bucket under {account_id}/{audit id}/.
--
-- Pre-launch, the page is Kevan's only. The data is open to Admins and to anyone
-- the super admin grants the page, at the sites they have; a draft is seen only
-- by its auditor. A submitted audit can't be changed, only deleted by an Admin.

create table public.site_audits_v2 (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted')),
  form_version int not null default 1,
  answers jsonb not null default '{}'::jsonb,
  score numeric(5,1) check (score between 0 and 100),
  grade text check (grade in ('A', 'B', 'C', 'D', 'F')),
  safety_failed boolean,
  failed_sections text[] not null default '{}',
  auditor_id uuid default auth.uid() references public.users(id) on delete set null,
  auditor_name text,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_audits_v2_submitted_graded check (
    status = 'draft' or (score is not null and grade is not null and safety_failed is not null and submitted_at is not null)
  )
);

create index site_audits_v2_account_idx on public.site_audits_v2 (account_id, status, submitted_at desc);
create index site_audits_v2_location_idx on public.site_audits_v2 (location_id);
create index site_audits_v2_auditor_idx on public.site_audits_v2 (auditor_id) where status = 'draft';

-- The server stamps when an audit was submitted and last saved.
create or replace function public.site_audits_v2_stamp() returns trigger
language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.status = 'submitted' and (tg_op = 'INSERT' or old.status = 'draft') then
    new.submitted_at := now();
  end if;
  return new;
end $$;

create trigger site_audits_v2_stamp before insert or update on public.site_audits_v2
  for each row execute function public.site_audits_v2_stamp();

alter table public.site_audits_v2 enable row level security;

create policy site_audits_v2_select on public.site_audits_v2 for select using (
  account_id = auth_account_id()
  and (auth_role() = 'owner' or public.auth_page_granted('/app/site-audits-new'))
  and auth_has_location(location_id)
  and (status = 'submitted' or auditor_id = auth.uid())
);

create policy site_audits_v2_insert on public.site_audits_v2 for insert with check (
  account_id = auth_account_id()
  and (auth_role() = 'owner' or public.auth_page_granted('/app/site-audits-new'))
  and auth_has_location(location_id)
  and auditor_id = auth.uid()
);

-- Only the auditor's own draft changes; submitting it is the last change.
create policy site_audits_v2_update on public.site_audits_v2 for update using (
  account_id = auth_account_id()
  and status = 'draft'
  and auditor_id = auth.uid()
) with check (
  account_id = auth_account_id()
  and (auth_role() = 'owner' or public.auth_page_granted('/app/site-audits-new'))
  and auth_has_location(location_id)
  and auditor_id = auth.uid()
);

create policy site_audits_v2_delete on public.site_audits_v2 for delete using (
  account_id = auth_account_id()
  and ((status = 'draft' and auditor_id = auth.uid()) or auth_role() = 'owner')
);
