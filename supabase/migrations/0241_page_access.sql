-- Page access set by the super admin (kevan@washlyfe.com) on the Team page.
--
-- One row grants (allowed = true) or blocks (allowed = false) one page for one
-- person or for everyone with one permission role (base role, or the role
-- category when set: regional_manager, executive, finance, corporate_display).
-- A grant opens a page beyond what the role normally gets, including pages kept
-- to named people; a block hides a page, including from Admins. A person's own
-- row wins over their role's row, and both win over the company_settings page
-- permissions and the built-in defaults. The super admin is never blocked.
--
-- Only the super admin writes rows (page_access_save). Everyone reads the rows
-- that apply to them, so the app can show their pages. Server checks call
-- auth_page_granted() (RLS) or read the table with the service role.

create or replace function public.auth_is_super_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.users u where u.id = auth.uid() and lower(u.email) = 'kevan@washlyfe.com')
$$;

-- The caller's permission role, as the app computes it (permRole in rbac.ts).
create or replace function public.auth_perm_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce(u.role_category, u.role) from public.users u where u.id = auth.uid()
$$;

create table public.page_access (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.accounts(id) on delete cascade,
  user_id uuid references public.users(id) on delete cascade,
  perm_role text check (perm_role in ('owner', 'manager', 'employee', 'technician', 'regional_manager', 'executive', 'finance', 'corporate_display')),
  page text not null check (page ~ '^/app/[a-z0-9/_-]+$'),
  allowed boolean not null,
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint page_access_one_subject check ((user_id is null) <> (perm_role is null))
);
create unique index page_access_user_page on public.page_access (user_id, page) where user_id is not null;
create unique index page_access_role_page on public.page_access (account_id, perm_role, page) where perm_role is not null;
create index page_access_account on public.page_access (account_id);

alter table public.page_access enable row level security;

create policy page_access_read on public.page_access for select to authenticated
  using (
    account_id = public.auth_account_id()
    and (user_id = auth.uid() or perm_role = public.auth_perm_role() or public.auth_is_super_admin())
  );
-- No insert/update/delete policies: writes go through page_access_save only.

-- Whether the caller has an explicit grant for a page (their own row first, then
-- their role's). For RLS policies behind pages that can be granted.
create or replace function public.auth_page_granted(p_page text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select pa.allowed from public.page_access pa
    where pa.account_id = public.auth_account_id()
      and pa.page = p_page
      and (pa.user_id = auth.uid() or pa.perm_role = public.auth_perm_role())
    order by (pa.user_id is not null) desc
    limit 1
  ), false)
$$;

-- The same for a given user, for edge functions running as the service role.
create or replace function public.page_granted_for(p_user uuid, p_page text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((
    select pa.allowed from public.page_access pa
    join public.users u on u.id = p_user and u.account_id = pa.account_id
    where pa.page = p_page
      and (pa.user_id = p_user or pa.perm_role = coalesce(u.role_category, u.role))
    order by (pa.user_id is not null) desc
    limit 1
  ), false)
$$;
revoke all on function public.page_granted_for(uuid, text) from public, anon, authenticated;
grant execute on function public.page_granted_for(uuid, text) to service_role;

-- Save a batch of changes: [{user_id | perm_role, page, allowed}] where allowed
-- null removes the row (back to the default). Super admin only; never for the
-- super admin's own login, so they can't lock themselves out.
create or replace function public.page_access_save(p_changes jsonb) returns integer
language plpgsql security definer set search_path = public as $$
declare
  acct uuid := public.auth_account_id();
  me uuid := auth.uid();
  c jsonb;
  uid uuid;
  prole text;
  pg text;
  n int := 0;
begin
  if not public.auth_is_super_admin() then raise exception 'not allowed' using errcode = '42501'; end if;
  if jsonb_typeof(p_changes) <> 'array' then raise exception 'changes must be an array'; end if;
  for c in select * from jsonb_array_elements(p_changes) loop
    uid := nullif(c->>'user_id', '')::uuid;
    prole := nullif(c->>'perm_role', '');
    pg := c->>'page';
    if (uid is null) = (prole is null) then raise exception 'each change needs a user_id or a perm_role'; end if;
    if uid is not null then
      if uid = me then raise exception 'you cannot change your own access'; end if;
      if not exists (select 1 from public.users u where u.id = uid and u.account_id = acct) then
        raise exception 'user not in this account';
      end if;
    end if;
    if c->'allowed' is null or jsonb_typeof(c->'allowed') = 'null' then
      delete from public.page_access
      where account_id = acct and page = pg
        and ((uid is not null and user_id = uid) or (prole is not null and perm_role = prole));
    elsif uid is not null then
      insert into public.page_access (account_id, user_id, page, allowed, updated_by)
      values (acct, uid, pg, (c->>'allowed')::boolean, me)
      on conflict (user_id, page) where user_id is not null
      do update set allowed = excluded.allowed, updated_by = me, updated_at = now();
    else
      insert into public.page_access (account_id, perm_role, page, allowed, updated_by)
      values (acct, prole, pg, (c->>'allowed')::boolean, me)
      on conflict (account_id, perm_role, page) where perm_role is not null
      do update set allowed = excluded.allowed, updated_by = me, updated_at = now();
    end if;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.page_access_save(jsonb) from public, anon;
grant execute on function public.page_access_save(jsonb) to authenticated;
