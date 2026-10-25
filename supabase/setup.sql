-- Run once in Supabase: SQL Editor -> New query -> paste -> Run.
create table if not exists public.fixtures (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by text not null,
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.fixtures enable row level security;

-- The portal is already behind its own password screen, so the table is
-- open to the portal's public key.
drop policy if exists "portal access" on public.fixtures;
create policy "portal access" on public.fixtures
  for all to anon, authenticated using (true) with check (true);

-- Let the portal's public (anon) key reach the table through the Data API.
grant usage on schema public to anon, authenticated;
grant select, insert, update, delete on public.fixtures to anon, authenticated;
