-- Run AFTER supabase/beta-feedback.sql.
-- Secure owner-only access through a private allowlist, not a public user-controlled profile field.
create table if not exists public.ride_garage_admins (
 user_id uuid primary key references auth.users(id) on delete cascade
);
alter table public.ride_garage_admins enable row level security;
revoke all on public.ride_garage_admins from anon, authenticated;

alter table public.beta_feedback add column if not exists status text not null default 'new';
alter table public.beta_feedback drop constraint if exists beta_feedback_status_check;
alter table public.beta_feedback add constraint beta_feedback_status_check
 check (status in ('new','in_progress','resolved'));
alter table public.beta_feedback enable row level security;

-- SECURITY DEFINER reads a server-controlled allowlist. Riders cannot edit or read it.
create or replace function public.is_ride_garage_admin()
returns boolean language sql stable security definer
set search_path = ''
as $$
 select exists (
  select 1 from public.ride_garage_admins a
  where a.user_id = (select auth.uid())
 );
$$;
revoke all on function public.is_ride_garage_admin() from public;
grant execute on function public.is_ride_garage_admin() to authenticated;

grant select, update on public.beta_feedback to authenticated;
drop policy if exists "Ride Garage admins can read feedback" on public.beta_feedback;
create policy "Ride Garage admins can read feedback" on public.beta_feedback
for select to authenticated using ((select public.is_ride_garage_admin()));
drop policy if exists "Ride Garage admins can update feedback" on public.beta_feedback;
create policy "Ride Garage admins can update feedback" on public.beta_feedback
for update to authenticated
using ((select public.is_ride_garage_admin()))
with check ((select public.is_ride_garage_admin()));

-- Limit admin updates to status (and only rows allowed by the RLS policy).
revoke update on public.beta_feedback from authenticated;
grant update (status) on public.beta_feedback to authenticated;

-- IMPORTANT: manually set your admin UID in this statement BEFORE running it.
-- Copy your UID from Supabase Authentication > Users. Never use a rider's UID.
-- Uncomment and replace YOUR-ADMIN-USER-UUID:
-- insert into public.ride_garage_admins (user_id)
-- values ('YOUR-ADMIN-USER-UUID'::uuid)
-- on conflict (user_id) do nothing;
