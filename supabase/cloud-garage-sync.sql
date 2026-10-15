-- Private, append-only cloud garage copies. Apply once to the existing Supabase project.
-- No change is made to browser IndexedDB or existing Social/community tables.
create table if not exists public.ride_garage_cloud_snapshots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  garage jsonb not null,
  summary jsonb not null default '{}'::jsonb,
  byte_size integer not null,
  constraint rg_cloud_garage_object check (jsonb_typeof(garage) = 'object'),
  constraint rg_cloud_summary_object check (jsonb_typeof(summary) = 'object'),
  constraint rg_cloud_snapshot_size check (
    byte_size > 0 and byte_size <= 8000000
    and octet_length(garage::text) <= 8000000
  )
);
create index if not exists rg_cloud_snapshots_user_created
  on public.ride_garage_cloud_snapshots(user_id, created_at desc);
alter table public.ride_garage_cloud_snapshots enable row level security;
revoke all on public.ride_garage_cloud_snapshots from public, anon, authenticated;
grant select, insert on public.ride_garage_cloud_snapshots to authenticated;
drop policy if exists "rg_cloud_owner_read" on public.ride_garage_cloud_snapshots;
drop policy if exists "rg_cloud_owner_insert" on public.ride_garage_cloud_snapshots;
create policy "rg_cloud_owner_read"
  on public.ride_garage_cloud_snapshots for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "rg_cloud_owner_insert"
  on public.ride_garage_cloud_snapshots for insert to authenticated
  with check ((select auth.uid()) = user_id);
-- No client UPDATE/DELETE. Previous copies remain recoverable.
