-- SPI Calendar — "Calendario del Depa"
-- Shared apartment booking calendar. Run this in your Supabase project:
-- SQL Editor → New query → paste → Run.

-- Needed for the no-overlap exclusion constraint below ("sin choques").
create extension if not exists btree_gist;

create table if not exists public.reservations (
  id          uuid primary key default gen_random_uuid(),
  guest_name  text not null,                 -- who is staying, e.g. "Mamá"
  start_date  date not null,                 -- first night (inclusive)
  end_date    date not null,                 -- last night (inclusive)
  color       text default '#b8923f',        -- chip color in the grid
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint reservations_valid_range check (end_date >= start_date),

  -- "Sin choques": no two reservations may cover the same day.
  -- daterange '[]' makes both endpoints inclusive, matching the grid.
  constraint reservations_no_overlap exclude using gist (
    daterange(start_date, end_date, '[]') with &&
  )
);

-- Keep updated_at fresh on every change.
create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists reservations_set_updated_at on public.reservations;
create trigger reservations_set_updated_at
  before update on public.reservations
  for each row execute function public.set_updated_at();

create index if not exists reservations_start_date_idx on public.reservations (start_date);

-- Shared/team calendar (no auth): anyone with the anon key has full access.
-- TODO: tighten with Supabase Auth + per-user policies if you add sign-in.
alter table public.reservations enable row level security;

drop policy if exists "Public read access" on public.reservations;
create policy "Public read access" on public.reservations
  for select using (true);

drop policy if exists "Public write access" on public.reservations;
create policy "Public write access" on public.reservations
  for all using (true) with check (true);
