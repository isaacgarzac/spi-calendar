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

  constraint reservations_valid_range check (end_date >= start_date)
);

create or replace function public.check_single_day_overlap()
returns trigger as $$
declare
  existing record;
begin
  for existing in
    select id, start_date, end_date
    from public.reservations
    where id is distinct from new.id
  loop
    if new.start_date <= existing.end_date and new.end_date >= existing.start_date then
      if (
        least(new.end_date, existing.end_date) - greatest(new.start_date, existing.start_date) + 1
      ) > 1 then
        raise exception 'No se permiten superposiciones de más de un día';
      end if;
    end if;
  end loop;

  return new;
end;
$$ language plpgsql;

alter table public.reservations drop constraint if exists reservations_no_overlap;
drop trigger if exists reservations_single_day_overlap_trigger on public.reservations;
create trigger reservations_single_day_overlap_trigger
  before insert or update on public.reservations
  for each row execute function public.check_single_day_overlap();

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
