-- ===========================================================================
-- Flota: máquinas, operadores y sus asignaciones en el tiempo.
--
-- Reemplaza a `node_registry` (supabase/node_registry.sql), que metía tres
-- cosas en una sola fila. En campo esas tres cosas cambian a ritmos distintos:
--
--   · la MÁQUINA es la que casi no cambia (un tractor es un tractor),
--   · el NODO se desmonta de una máquina y se monta en otra,
--   · el OPERADOR rota varias veces al día (Juan en la mañana, Pedro de noche).
--
-- Por eso hay dos tablas de hechos con vigencia (`desde` / `hasta`) en vez de
-- columnas que se pisan. Con eso, el histórico del 3 de marzo puede decir quién
-- manejaba el 3 de marzo, y no quién maneja hoy — que es la única razón por la
-- que vale la pena guardar historia.
--
-- Cómo aplicarlo: pegar este archivo completo en el SQL Editor de Supabase
-- (Dashboard → SQL Editor → New query → Run). Es idempotente y al final migra
-- lo que ya hubiera en `node_registry`.
--
-- ⚠️ La app escribe con la anon key, que es pública (va en el bundle del
-- navegador). Estas policies permiten a cualquiera que tenga la URL de la app
-- registrar máquinas, operadores y relevos. Es aceptable para una herramienta
-- interna de finca; si algún día la app se expone fuera, hay que pasarlas a
-- `to authenticated` y montar login.
-- ===========================================================================

-- `gen_random_uuid()` es núcleo de Postgres desde la 13, así que no se pide
-- ninguna extensión: crearlas requiere permisos de superusuario que un rol de
-- aplicación no tiene, y era la línea que más probable hacía fallar todo el
-- archivo por algo que no hacía falta.

-- ------------------------------- MÁQUINAS -------------------------------
create table if not exists public.maquinas (
  id         uuid primary key default gen_random_uuid(),
  codigo     text not null,
  nombre     text not null,
  tipo       text not null default 'tractor',
  color      text not null default '#0a55a5',
  -- Dar de baja una máquina no la borra: su historia de recorridos y de
  -- operadores tiene que seguir siendo legible. `activa = false` sólo la saca
  -- de los desplegables.
  activa     boolean not null default true,
  creada_en  timestamptz not null default now(),

  constraint maquinas_codigo_no_vacio check (length(btrim(codigo)) > 0),
  constraint maquinas_nombre_no_vacio check (length(btrim(nombre)) > 0)
);

-- Los tipos que `lib/icons.ts` sabe dibujar. Va como constraint aparte y no
-- dentro del CREATE TABLE porque `create table if not exists` no toca una tabla
-- que ya existe: así, ampliar la lista se aplica también donde ya se corrió.
alter table public.maquinas drop constraint if exists maquinas_tipo_valido;
alter table public.maquinas add constraint maquinas_tipo_valido
  check (tipo in ('tractor', 'camion', 'volqueta', 'aspersora', 'retro', 'porteria'));

-- Que no se dupliquen nombres ni códigos. En minúsculas y sin espacios de
-- sobra, para que "La Mona" y "la mona " no convivan como dos máquinas.
create unique index if not exists maquinas_codigo_uniq
  on public.maquinas (lower(btrim(codigo)));
create unique index if not exists maquinas_nombre_uniq
  on public.maquinas (lower(btrim(nombre)));

-- ------------------------------ OPERADORES ------------------------------
create table if not exists public.operadores (
  id         uuid primary key default gen_random_uuid(),
  nombre     text not null,
  documento  text,
  telefono   text,
  activo     boolean not null default true,
  creado_en  timestamptz not null default now(),

  constraint operadores_nombre_no_vacio check (length(btrim(nombre)) > 0)
);

create unique index if not exists operadores_nombre_uniq
  on public.operadores (lower(btrim(nombre)));

-- --------------------- NODO → MÁQUINA (con vigencia) ---------------------
-- "Qué máquina lleva montado este nodo, y desde cuándo".
create table if not exists public.nodo_maquina (
  id         uuid primary key default gen_random_uuid(),
  node_id    text not null,
  maquina_id uuid not null references public.maquinas(id) on delete restrict,
  desde      timestamptz not null default now(),
  hasta      timestamptz,

  constraint nodo_maquina_rango check (hasta is null or hasta > desde)
);

create index if not exists nodo_maquina_node_idx
  on public.nodo_maquina (node_id, desde desc);

-- Un nodo está en una sola máquina a la vez, y una máquina lleva un solo nodo
-- a la vez. Lo impone la base con índices parciales: dos personas reasignando
-- al mismo tiempo no pueden dejar el registro diciendo dos cosas.
create unique index if not exists nodo_maquina_nodo_abierto_uniq
  on public.nodo_maquina (node_id) where hasta is null;
create unique index if not exists nodo_maquina_maquina_abierta_uniq
  on public.nodo_maquina (maquina_id) where hasta is null;

-- ------------------- MÁQUINA → OPERADOR (con vigencia) -------------------
-- El relevo de turno. El operador se asigna a la MÁQUINA y no al nodo: quien
-- se sube se sube al tractor, y si mañana ese tractor lleva otro nodo, el turno
-- de Pedro no tiene por qué enterarse.
create table if not exists public.maquina_operador (
  id          uuid primary key default gen_random_uuid(),
  maquina_id  uuid not null references public.maquinas(id) on delete restrict,
  operador_id uuid not null references public.operadores(id) on delete restrict,
  desde       timestamptz not null default now(),
  hasta       timestamptz,
  nota        text,

  constraint maquina_operador_rango check (hasta is null or hasta > desde)
);

create index if not exists maquina_operador_maquina_idx
  on public.maquina_operador (maquina_id, desde desc);

-- Una máquina tiene un solo operador al mando, y una persona maneja una sola
-- máquina a la vez.
create unique index if not exists maquina_operador_maquina_abierta_uniq
  on public.maquina_operador (maquina_id) where hasta is null;
create unique index if not exists maquina_operador_operador_abierto_uniq
  on public.maquina_operador (operador_id) where hasta is null;

-- ============================== RELEVOS ==============================
-- Un relevo son dos escrituras —cerrar lo anterior, abrir lo nuevo— que tienen
-- que pasar juntas o no pasar. Hacerlo desde el navegador con dos llamadas
-- deja una ventana en la que la máquina no tiene operador, o tiene dos. Por eso
-- van como funciones: PostgREST las ejecuta en una sola transacción.

create or replace function public.asignar_nodo(
  p_node_id text,
  p_maquina_id uuid,
  p_desde timestamptz default now()
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_choque timestamptz;
begin
  -- Reasignar "hacia atrás" de lo ya registrado dejaría rangos invertidos.
  -- Mejor negarse con un mensaje legible que guardar una historia imposible.
  select max(desde) into v_choque
    from public.nodo_maquina
   where hasta is null and (node_id = p_node_id or maquina_id = p_maquina_id);

  if v_choque is not null and v_choque >= p_desde then
    raise exception 'La asignación vigente empezó el % : el relevo tiene que ser posterior.', v_choque
      using errcode = '22023';
  end if;

  update public.nodo_maquina set hasta = p_desde
   where hasta is null and (node_id = p_node_id or maquina_id = p_maquina_id);

  insert into public.nodo_maquina (node_id, maquina_id, desde)
       values (p_node_id, p_maquina_id, p_desde)
    returning id into v_id;

  return v_id;
end;
$$;

/** Desmonta el nodo de su máquina sin montarlo en otra. */
create or replace function public.desasignar_nodo(
  p_node_id text,
  p_hasta timestamptz default now()
) returns void
language plpgsql
as $$
begin
  update public.nodo_maquina set hasta = p_hasta
   where node_id = p_node_id and hasta is null and desde < p_hasta;
end;
$$;

create or replace function public.asignar_operador(
  p_maquina_id uuid,
  p_operador_id uuid,
  p_desde timestamptz default now(),
  p_nota text default null
) returns uuid
language plpgsql
as $$
declare
  v_id uuid;
  v_choque timestamptz;
begin
  select max(desde) into v_choque
    from public.maquina_operador
   where hasta is null
     and (maquina_id = p_maquina_id or operador_id = p_operador_id);

  if v_choque is not null and v_choque >= p_desde then
    raise exception 'El turno vigente empezó el % : el relevo tiene que ser posterior.', v_choque
      using errcode = '22023';
  end if;

  -- Se cierran los dos frentes: el turno que tenía esta máquina y el que
  -- tuviera esta persona en otra máquina. Nadie maneja dos a la vez.
  update public.maquina_operador set hasta = p_desde
   where hasta is null
     and (maquina_id = p_maquina_id or operador_id = p_operador_id);

  insert into public.maquina_operador (maquina_id, operador_id, desde, nota)
       values (p_maquina_id, p_operador_id, p_desde, p_nota)
    returning id into v_id;

  return v_id;
end;
$$;

/** Cierra el turno abierto de una máquina: queda sin operador al mando. */
create or replace function public.liberar_maquina(
  p_maquina_id uuid,
  p_hasta timestamptz default now()
) returns void
language plpgsql
as $$
begin
  update public.maquina_operador set hasta = p_hasta
   where maquina_id = p_maquina_id and hasta is null and desde < p_hasta;
end;
$$;

-- ================================= RLS =================================
alter table public.maquinas         enable row level security;
alter table public.operadores       enable row level security;
alter table public.nodo_maquina     enable row level security;
alter table public.maquina_operador enable row level security;

do $$
declare t text;
begin
  foreach t in array array['maquinas','operadores','nodo_maquina','maquina_operador']
  loop
    execute format('drop policy if exists "%s lectura" on public.%I', t, t);
    execute format(
      'create policy "%s lectura" on public.%I for select to anon, authenticated using (true)', t, t);

    execute format('drop policy if exists "%s alta" on public.%I', t, t);
    execute format(
      'create policy "%s alta" on public.%I for insert to anon, authenticated with check (true)', t, t);

    execute format('drop policy if exists "%s edicion" on public.%I', t, t);
    execute format(
      'create policy "%s edicion" on public.%I for update to anon, authenticated using (true) with check (true)', t, t);
  end loop;
end $$;

-- A propósito NO hay policy de DELETE en ninguna: desde la app se corrige y se
-- da de baja, nunca se borra. Un recorrido de hace un mes tiene que poder
-- seguir diciendo de quién era la máquina.

-- Las policies deciden QUÉ FILAS se pueden tocar; los GRANT deciden si el rol
-- puede tocar la tabla siquiera. Supabase los pone solos cuando las tablas las
-- crea el rol `postgres`, pero no si las crea otro rol: en ese caso la app
-- recibiría "permission denied for table maquinas" con las policies perfectas.
-- Explícitos cuestan nada y hacen que el archivo funcione lo corra quien lo
-- corra.
grant usage on schema public to anon, authenticated;
grant select, insert, update on
  public.maquinas, public.operadores, public.nodo_maquina, public.maquina_operador
  to anon, authenticated;

-- El TELÉFONO del operador se escribe pero no se lee. La app consulta con la
-- anon key, que va en el bundle del navegador: todo lo que el rol público pueda
-- seleccionar es, en la práctica, público — basta abrir la pestaña de red. Que
-- `lib/registro.ts` no lo pida no alcanza, porque cualquiera puede pedirlo a
-- mano con la misma llave. El GRANT por columna es lo único que lo impide de
-- verdad: se quita el SELECT de toda la tabla y se devuelve columna por
-- columna, salvo `telefono`. INSERT y UPDATE siguen a nivel de tabla, así que
-- el número se puede seguir registrando y corrigiendo desde el formulario.
--
-- Ojo: con esto un `select *` sobre `operadores` falla con "permission denied
-- for column telefono". Es a propósito — obliga a nombrar las columnas — pero
-- si algún día algo empieza a fallar ahí, ésta es la razón. `documento` (la
-- cédula) sigue siendo legible; si también hay que taparlo, se saca de esta
-- lista y de los `select` de `lib/registro.ts`.
revoke select on public.operadores from anon, authenticated;
grant select (id, nombre, documento, activo, creado_en)
  on public.operadores to anon, authenticated;

-- Y se quita lo que Supabase concede solo. El proyecto trae configurado
-- `alter default privileges ... grant all on tables to anon, authenticated`, así
-- que toda tabla nueva nace con DELETE y TRUNCATE para el rol público aunque
-- nadie los pida. Con DELETE no pasa gran cosa —no hay policy de borrado y RLS
-- lo frena igual— pero TRUNCATE NO pasa por RLS: el privilegio es lo único que
-- lo detiene. Hoy no es alcanzable desde PostgREST, que no emite TRUNCATE, pero
-- dejar el privilegio puesto es confiar en ese detalle para siempre.
revoke delete, truncate on
  public.maquinas, public.operadores, public.nodo_maquina, public.maquina_operador
  from anon, authenticated;

grant execute on function public.asignar_nodo(text, uuid, timestamptz)                 to anon, authenticated;
grant execute on function public.desasignar_nodo(text, timestamptz)                    to anon, authenticated;
grant execute on function public.asignar_operador(uuid, uuid, timestamptz, text)       to anon, authenticated;
grant execute on function public.liberar_maquina(uuid, timestamptz)                    to anon, authenticated;

-- =========================== MIGRACIÓN =============================
-- Lo que ya se hubiera diligenciado en `node_registry` pasa al modelo nuevo:
-- cada fila se vuelve una máquina, su nodo queda asignado a ella, y el texto
-- libre del campo `operador` se convierte en una persona con turno abierto.
-- Corre una sola vez de verdad: en la segunda pasada no hay nada que insertar.
do $$
declare r record;
        v_maquina uuid;
        v_operador uuid;
begin
  if not exists (
    select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'node_registry'
  ) then
    return;
  end if;

  for r in execute 'select * from public.node_registry' loop
    insert into public.maquinas (codigo, nombre, tipo, color)
         values (r.codigo, r.nombre, r.tipo, r.color)
    on conflict do nothing;

    select id into v_maquina from public.maquinas
     where lower(btrim(codigo)) = lower(btrim(r.codigo));

    if v_maquina is null then continue; end if;

    if not exists (select 1 from public.nodo_maquina
                    where node_id = r.node_id and hasta is null) then
      insert into public.nodo_maquina (node_id, maquina_id, desde)
           values (r.node_id, v_maquina, coalesce(r.updated_at, now()))
      on conflict do nothing;
    end if;

    if coalesce(btrim(r.operador), '') <> '' then
      insert into public.operadores (nombre) values (btrim(r.operador))
      on conflict do nothing;

      select id into v_operador from public.operadores
       where lower(btrim(nombre)) = lower(btrim(r.operador));

      if v_operador is not null
         and not exists (select 1 from public.maquina_operador
                          where maquina_id = v_maquina and hasta is null) then
        insert into public.maquina_operador (maquina_id, operador_id, desde, nota)
             values (v_maquina, v_operador, coalesce(r.updated_at, now()),
                     'Migrado de node_registry')
        on conflict do nothing;
      end if;
    end if;
  end loop;
end $$;

-- `node_registry` se deja en pie, sin uso, por si hay que revisar qué había
-- antes. La app ya no la lee ni la escribe.
