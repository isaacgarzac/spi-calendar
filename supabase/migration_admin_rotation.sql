-- SPI Calendar — Migración: modo admin (server-side), congelado Jul–Oct 2026 y rotación Nov26→Dic27.
-- Correr en Supabase: SQL Editor → New query → pegar → Run.
-- Requiere que supabase/schema.sql ya se haya ejecutado antes.

-- =====================================================================
-- 0. Extensiones
-- =====================================================================
-- En Supabase pgcrypto vive en el esquema `extensions` (no en public).
create extension if not exists pgcrypto with schema extensions;

-- =====================================================================
-- 1. Nueva columna: locked
--    Marca las reservas congeladas (Jul–Oct) y las de rotación.
-- =====================================================================
alter table public.reservations
  add column if not exists locked boolean not null default false;

-- =====================================================================
-- 2. Secreto del admin (una sola password, guardada como HASH bcrypt)
--    Nunca viaja al cliente. Solo lectura desde funciones SECURITY DEFINER.
-- =====================================================================
create table if not exists public.admin_config (
  id            smallint primary key default 1,
  password_hash text not null,
  constraint admin_config_singleton check (id = 1)
);

-- Cerrar la tabla al público: ni anon ni authenticated pueden tocarla.
alter table public.admin_config enable row level security;
revoke all on public.admin_config from anon, authenticated;
-- (sin políticas => RLS niega todo; las funciones SECURITY DEFINER la leen igual)

-- Verifica la password contra el hash. Devuelve true/false.
create or replace function public.admin_verify(p_password text)
returns boolean
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select exists (
    select 1 from public.admin_config
    where id = 1 and password_hash = crypt(p_password, password_hash)
  );
$$;

-- Endpoint para el "login": el frontend lo llama para activar el modo edición.
create or replace function public.admin_login(p_password text)
returns boolean
language sql
security definer
set search_path = public, extensions, pg_temp
as $$
  select public.admin_verify(p_password);
$$;

-- =====================================================================
-- 3. RPCs de escritura (validan password server-side).
--    El trigger de "sin choques" existente sigue aplicando dentro de estas.
-- =====================================================================
create or replace function public.admin_create_reservation(
  p_password   text,
  p_guest_name text,
  p_start_date date,
  p_end_date   date,
  p_color      text default '#b8923f',
  p_locked     boolean default false
)
returns public.reservations
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  row public.reservations;
begin
  if not public.admin_verify(p_password) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  insert into public.reservations (guest_name, start_date, end_date, color, locked)
  values (p_guest_name, p_start_date, p_end_date, p_color, p_locked)
  returning * into row;

  return row;
end;
$$;

create or replace function public.admin_update_reservation(
  p_password   text,
  p_id         uuid,
  p_guest_name text,
  p_start_date date,
  p_end_date   date
)
returns public.reservations
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  row public.reservations;
begin
  if not public.admin_verify(p_password) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  update public.reservations
     set guest_name = p_guest_name,
         start_date = p_start_date,
         end_date   = p_end_date
   where id = p_id
  returning * into row;

  return row;
end;
$$;

create or replace function public.admin_delete_reservation(
  p_password text,
  p_id       uuid
)
returns void
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  if not public.admin_verify(p_password) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;

  delete from public.reservations where id = p_id;
end;
$$;

-- Permitir que el anon key SOLO ejecute estas funciones (la password es el candado).
grant execute on function public.admin_login(text)                                     to anon, authenticated;
grant execute on function public.admin_create_reservation(text, text, date, date, text, boolean) to anon, authenticated;
grant execute on function public.admin_update_reservation(text, uuid, text, date, date)          to anon, authenticated;
grant execute on function public.admin_delete_reservation(text, uuid)                            to anon, authenticated;
-- admin_verify queda de uso interno (no se otorga a anon).
revoke execute on function public.admin_verify(text) from anon, authenticated;

-- =====================================================================
-- 4. RLS: público = SOLO LECTURA. Se quita la escritura pública anterior.
-- =====================================================================
drop policy if exists "Public read access"  on public.reservations;
drop policy if exists "Public write access"  on public.reservations;

create policy "Public read access" on public.reservations
  for select using (true);
-- (sin política de insert/update/delete => escritura directa con anon key queda bloqueada;
--  las mutaciones solo pasan por las RPC admin_* de arriba)

-- =====================================================================
-- 5. Congelar Jul–Oct 2026: marcar las reservas ya existentes como locked.
-- =====================================================================
update public.reservations
   set locked = true
 where start_date <= '2026-10-31'
   and end_date   >= '2026-07-01';

-- =====================================================================
-- 6. Sembrar rotación semanal 2-nov-2026 → dic-2027 (61 semanas, completa la última).
--    Orden cíclico: Nana → Jaime → Javier → Ale. Semanas completas LUNES→DOMINGO
--    (SIN día de cambio compartido; el domingo 1-nov-2026 queda vacío).
--    2-nov-2026 = lunes. Semana 61 arranca 27-dic-2027 y cierra 2-ene-2028.
-- =====================================================================
insert into public.reservations (guest_name, start_date, end_date, locked)
select
  (array['Nana','Jaime','Javier','Ale'])[(n % 4) + 1],
  ('2026-11-02'::date + n * 7),        -- lunes (inicio)
  ('2026-11-02'::date + n * 7 + 6),    -- domingo (fin)
  true
from generate_series(0, 60) as n;
