-- ===========================================================================
-- ⚠️ SUPERSEDIDO por supabase/flota.sql, que separa máquina, operador y nodo en
-- entidades propias con vigencia en el tiempo. Este archivo se conserva porque
-- aquella migración lee esta tabla para no perder lo ya diligenciado. Si vas a
-- montar el registro desde cero, corre sólo flota.sql.
--
-- Registro de flota: node_id -> identidad de la máquina (nombre y código).
--
-- Reemplaza al mapa estático de `lib/tractores.ts`: lo que aquí se guarda lo
-- ven todos los que abren la app, y la unicidad de nombre y código la hace la
-- base, no el navegador.
--
-- Cómo aplicarlo: pegar este archivo completo en el SQL Editor de Supabase
-- (Dashboard → SQL Editor → New query → Run). Es idempotente.
--
-- ⚠️ La app escribe con la anon key, que es pública (va en el bundle del
-- navegador). Estas policies permiten a cualquiera que tenga la URL de la app
-- registrar y renombrar máquinas. Es aceptable para una herramienta interna de
-- finca; si algún día la app se expone fuera, hay que pasar estas policies a
-- `to authenticated` y montar login.
-- ===========================================================================

create table if not exists public.node_registry (
  node_id    text primary key,
  nombre     text not null,
  codigo     text not null,
  tipo       text not null default 'tractor',
  color      text not null default '#0a55a5',
  operador   text,
  labor      text,
  aplicacion text,
  updated_at timestamptz not null default now(),

  constraint node_registry_nombre_no_vacio check (length(btrim(nombre)) > 0),
  constraint node_registry_codigo_no_vacio check (length(btrim(codigo)) > 0)
);

-- Los tipos que `lib/icons.ts` sabe dibujar. Un valor fuera de la lista dejaría
-- al mapa sin ícono, por eso lo restringe la base. Va como constraint aparte y
-- no dentro del CREATE TABLE porque `create table if not exists` no toca una
-- tabla que ya existe: así, ampliar la lista de tipos se aplica también a las
-- bases donde este archivo ya se corrió antes.
alter table public.node_registry
  drop constraint if exists node_registry_tipo_valido;
alter table public.node_registry
  add constraint node_registry_tipo_valido
  check (tipo in ('tractor', 'camion', 'volqueta', 'aspersora', 'retro', 'porteria'));

-- Sin FK a `nodes`: el registro puede prepararse antes de que el nodo aparezca
-- en la red, y un nodo que se dé de baja no debe borrar su historia de nombres.

-- El pedido original: que no se dupliquen nombres. Se compara en minúsculas
-- para que "La Mona" y "la mona" no convivan como dos máquinas distintas.
create unique index if not exists node_registry_nombre_uniq
  on public.node_registry (lower(btrim(nombre)));

create unique index if not exists node_registry_codigo_uniq
  on public.node_registry (lower(btrim(codigo)));

-- `updated_at` lo pone la base y no el cliente: así dice cuándo se guardó de
-- verdad, no qué hora tenía el portátil de quien guardó.
create or replace function public.node_registry_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists node_registry_touch on public.node_registry;
create trigger node_registry_touch
  before insert or update on public.node_registry
  for each row execute function public.node_registry_touch();

-- --------------------------------- RLS ---------------------------------
alter table public.node_registry enable row level security;

drop policy if exists "node_registry lectura" on public.node_registry;
create policy "node_registry lectura"
  on public.node_registry for select
  to anon, authenticated
  using (true);

drop policy if exists "node_registry alta" on public.node_registry;
create policy "node_registry alta"
  on public.node_registry for insert
  to anon, authenticated
  with check (true);

drop policy if exists "node_registry edicion" on public.node_registry;
create policy "node_registry edicion"
  on public.node_registry for update
  to anon, authenticated
  using (true)
  with check (true);

-- A propósito NO hay policy de DELETE: desde la app no se puede borrar un
-- registro, sólo corregirlo. Dar de baja una máquina se hace desde el
-- dashboard.
