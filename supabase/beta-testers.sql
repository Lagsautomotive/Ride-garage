-- Ride Garage: optional, authenticated beta tester enrollment and activity.
-- Run once in Supabase SQL Editor AFTER supabase/admin-dashboard.sql.
-- Existing feedback, social tables and app data are untouched.
-- Only enrolled accounts count as beta testers; anonymous visitors are not counted.
-- Every check-in is throttled server-side to once per 30 minutes.
-- Personal bike data, routes and photos are never uploaded by this feature.

create table if not exists public.ride_garage_beta_testers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  last_active_at timestamptz not null default now(),
  checkins integer not null default 1 check (checkins >= 0)
);

create index if not exists ride_garage_beta_testers_joined_at_idx
  on public.ride_garage_beta_testers (joined_at desc);
create index if not exists ride_garage_beta_testers_last_active_at_idx
  on public.ride_garage_beta_testers (last_active_at desc);

alter table public.ride_garage_beta_testers enable row level security;
revoke all on table public.ride_garage_beta_testers from public, anon, authenticated;
grant select on table public.ride_garage_beta_testers to authenticated;

drop policy if exists "Only Ride Garage admins can view beta testers"
  on public.ride_garage_beta_testers;
create policy "Only Ride Garage admins can view beta testers"
  on public.ride_garage_beta_testers for select to authenticated
  using ((select public.is_ride_garage_admin()));

-- Clients cannot write directly to the table. Each write uses auth.uid()
-- inside a server-side function; callers cannot select a different user.
create or replace function public.rg_beta_join()
returns boolean language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return false; end if;
  insert into public.ride_garage_beta_testers (user_id, joined_at, last_active_at, checkins)
  values (v_uid, now(), now(), 1)
  on conflict (user_id) do nothing;
  return true;
end;
$$;

create or replace function public.rg_beta_is_joined()
returns boolean language sql stable security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.ride_garage_beta_testers
    where user_id = (select auth.uid())
  );
$$;

create or replace function public.rg_beta_check_in()
returns boolean language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return false; end if;
  update public.ride_garage_beta_testers
  set last_active_at = now(), checkins = least(checkins + 1, 2147483647)
  where user_id = v_uid
    and last_active_at <= now() - interval '30 minutes';
  return found;
end;
$$;

create or replace function public.rg_beta_leave()
returns boolean language plpgsql security definer
set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null then return false; end if;
  delete from public.ride_garage_beta_testers where user_id = v_uid;
  return found;
end;
$$;

revoke all on function public.rg_beta_join() from public, anon;
revoke all on function public.rg_beta_is_joined() from public, anon;
revoke all on function public.rg_beta_check_in() from public, anon;
revoke all on function public.rg_beta_leave() from public, anon;

grant execute on function public.rg_beta_join() to authenticated;
grant execute on function public.rg_beta_is_joined() to authenticated;
grant execute on function public.rg_beta_check_in() to authenticated;
grant execute on function public.rg_beta_leave() to authenticated;
