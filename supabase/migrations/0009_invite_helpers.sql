-- 0009_invite_helpers.sql — lets the (unauthenticated) accept-invite page show
-- which email an invitation token was issued to, so it can pre-fill + lock the
-- field. Returns null for invalid/expired/consumed tokens.

create or replace function public.get_invitation_email(p_token uuid)
returns text language sql stable security definer set search_path = public as $$
  select email from public.invitations
  where token = p_token and status = 'pending' and expires_at > now()
$$;

grant execute on function public.get_invitation_email(uuid) to anon, authenticated;
