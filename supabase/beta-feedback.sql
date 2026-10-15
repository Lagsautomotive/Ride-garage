-- Ride Garage beta feedback, run once in Supabase SQL Editor.
create table if not exists public.beta_feedback (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references auth.users(id) on delete cascade,
 category text not null check (category in ('bug','idea','general')),
 message text not null check (char_length(btrim(message)) between 10 and 2000),
 created_at timestamptz not null default now()
);
create index if not exists beta_feedback_user_created_idx on public.beta_feedback (user_id, created_at desc);
alter table public.beta_feedback enable row level security;
revoke all on public.beta_feedback from anon;
grant insert on public.beta_feedback to authenticated;
drop policy if exists "Riders can submit their own feedback" on public.beta_feedback;
create policy "Riders can submit their own feedback" on public.beta_feedback
for insert to authenticated with check ((select auth.uid()) = user_id);
-- No client-side SELECT, UPDATE, DELETE or public read policy.
-- Review entries privately in Supabase Table Editor.
