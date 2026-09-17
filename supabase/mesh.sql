-- ===========================================================================
-- Red mesh: sitios de las antenas fijas y registro de traceroutes.
--
-- Para qué: saber si las 7 antenas del predio están respondiendo, y con qué
-- ruta real. Hoy eso no se puede contestar — el ingestor (`node_track.py`) sólo
-- escribe los 6 nodos con GPS, así que de las antenas no hay ni una fila en
-- `node_positions`.
--
-- Cómo aplicarlo: pegar este archivo completo en el SQL Editor de Supabase
-- (Dashboard → SQL Editor → New query → Run). Es idempotente.
--
-- ⚠️ ESTE ARCHIVO ES ADITIVO. No toca ninguna tabla, vista, policy ni grant que
-- ya exista: no altera `nodes`, `node_positions`, `v_node_track`,
-- `v_node_estadias` ni las tablas de flota. Sólo crea objetos nuevos, todos con
-- prefijo `mesh_` / `traceroute`. Si algo de aquí hay que revertir, se borran
-- esos objetos y el resto del proyecto queda exactamente como estaba.
--
-- Y por el mismo motivo, el único punto donde este módulo LEE del pipeline
-- existente —`node_positions.last_heard`— pasa por una función y no por un JOIN
-- directo: una vista que referencia una columna se vuelve dependiente de ella, y
-- Postgres empieza a rechazar cambios en esa tabla ("cannot alter column ...
-- because other objects depend on it"). La función deja el acoplamiento en un
-- solo sitio y no le pone candado al esquema de nadie. Ver `mesh_last_heard`.
--
-- Quién escribe: el proceso del gateway, con la SERVICE key (que salta RLS).
-- Quién lee: la app, con la anon key, y sólo de lectura. Por eso abajo hay
-- policies de SELECT y ninguna de INSERT/UPDATE/DELETE — al revés que en
-- `flota.sql`, donde sí escribe el navegador.
-- ===========================================================================

-- ------------------------------ SITIOS ------------------------------
-- Dónde está instalada cada antena. Es el registro de la infraestructura: el
-- SITIO es lo permanente, el radio que tiene montado encima no. Forsoza ya
-- cambió de antena una vez, y a Brisas todavía no le confirmamos el node_id.
--
-- Por eso la llave es el sitio y no el node_id, que es la única diferencia
-- contra el diseño original: con `node_id` como primary key, Brisas no se puede
-- registrar hasta que alguien lea su hex completo en el nodeDB, y hasta entonces
-- el mapa perdería ese pin. `node_id` queda igual de utilizable para los JOIN
-- porque va con índice único.
create table if not exists public.mesh_sites (
  site_id        text primary key,          -- slug estable: 'forsoza', 'brisas'
  node_id        text,                      -- null = hex sin confirmar
  site_name      text not null,
  role           text not null,
  lat            double precision,
  lon            double precision,
  coord_source   text,
  -- Distancia declarada en el acta de instalación, en metros. No es decorativa:
  -- es contra lo que se valida la coordenada (ver `v_mesh_sites_check`).
  dist_gateway_m integer,
  installed_on   date,
  notes          text,
  updated_at     timestamptz not null default now(),

  constraint mesh_sites_site_name_no_vacio check (length(btrim(site_name)) > 0),
  constraint mesh_sites_coords_completas
    check ((lat is null) = (lon is null)),
  constraint mesh_sites_lat_rango check (lat is null or lat between -90 and 90),
  constraint mesh_sites_lon_rango check (lon is null or lon between -180 and 180)
);

-- Los CHECK de vocabulario van como constraint aparte, igual que en flota.sql:
-- `create table if not exists` no toca una tabla que ya existe, así que ampliar
-- una lista de valores se aplica también donde el archivo ya se corrió.
alter table public.mesh_sites drop constraint if exists mesh_sites_role_valido;
alter table public.mesh_sites add constraint mesh_sites_role_valido
  check (role in ('gateway', 'repetidor'));

alter table public.mesh_sites drop constraint if exists mesh_sites_coord_source_valido;
alter table public.mesh_sites add constraint mesh_sites_coord_source_valido
  check (coord_source is null
         or coord_source in ('instalacion', 'gps_campo', 'fixed_position'));

-- Un node_id no puede estar en dos sitios a la vez. Parcial, porque varios
-- sitios pueden tener el hex sin confirmar (null) al mismo tiempo.
create unique index if not exists mesh_sites_node_uniq
  on public.mesh_sites (node_id) where node_id is not null;

-- --------------------------- TRACEROUTES ---------------------------
-- Un registro por sondeo. La fila del FALLO también se inserta: si sólo se
-- guardaran los éxitos no habría forma de distinguir "no respondió" de "no lo
-- sondeamos", y con eso se pierde el cálculo de disponibilidad, que es el dato
-- que se quiere ("Forsoza lleva 3 días caída").
create table if not exists public.traceroutes (
  id               bigserial primary key,
  node_id          text        not null,     -- destino sondeado
  requested_at     timestamptz not null default now(),
  responded_at     timestamptz,              -- null = no respondió
  status           text        not null,
  rtt_ms           integer,
  hop_limit        smallint    not null,     -- con qué hopLimit se pidió
  hops_towards     smallint,                 -- 0 = enlace directo
  hops_back        smallint,
  -- Entre comillas porque `asymmetric` es palabra RESERVADA en Postgres (va en
  -- `between symmetric/asymmetric`). El nombre de la columna queda idéntico.
  "asymmetric"     boolean,                  -- la ruta de ida ≠ la de vuelta
  snr_final_db     real,                     -- SNR del último salto al destino
  route_text       text,
  -- Por qué se disparó este sondeo. Importa para la estadística: con sondeo
  -- adaptativo los reintentos sólo ocurren cuando algo ya iba mal, así que
  -- mezclarlos con los del barrido normal hace ver la disponibilidad peor de lo
  -- que es. Va entre comillas por si acaso: `trigger` es palabra clave.
  "trigger"        text        not null,
  gateway_node_id  text,                     -- en la Pi conviven dos radios
  error            text,
  created_at       timestamptz not null default now(),

  -- La llave de idempotencia: el escritor puede reintentar el INSERT con
  -- on_conflict y no duplica el sondeo.
  constraint traceroutes_sondeo_uniq unique (node_id, requested_at),

  -- Un 'ok' sin hora de respuesta sería un éxito que nadie vio volver. Sólo
  -- aplica a 'ok': una fila 'heard' no responde a nada nuestro.
  constraint traceroutes_ok_con_respuesta
    check (status <> 'ok' or responded_at is not null),
  constraint traceroutes_rtt_positivo check (rtt_ms is null or rtt_ms >= 0),
  constraint traceroutes_saltos_positivos
    check ((hops_towards is null or hops_towards >= 0)
       and (hops_back    is null or hops_back    >= 0))
);

-- `heard` no es un sondeo: es vida confirmada por el anuncio del propio nodo,
-- sin gastar aire. Se registra igual porque si no, un repetidor sano que se
-- anuncia y por eso NO se sondea no deja rastro en la base, y el mapa lo
-- pintaría "sin datos" para siempre — un sitio vivo dibujado como desconocido.
-- Se escribe con `trigger = 'pasivo'`.
--
-- Ojo al leer disponibilidad: una fila `heard` NO es un sondeo respondido. Para
-- medir "de los sondeos que se hicieron, cuántos contestaron" hay que filtrar
-- `status in ('ok','timeout','error')`, o el resultado sale inflado.
alter table public.traceroutes drop constraint if exists traceroutes_status_valido;
alter table public.traceroutes add constraint traceroutes_status_valido
  check (status in ('ok', 'timeout', 'error', 'heard'));

alter table public.traceroutes drop constraint if exists traceroutes_trigger_valido;
alter table public.traceroutes add constraint traceroutes_trigger_valido
  check ("trigger" in ('heartbeat', 'reintento', 'manual', 'pasivo'));

-- Sin FK hacia `nodes` a propósito, por dos razones: hoy las antenas ni
-- siquiera están en esa tabla, y un sondeo a un nodo desconocido tiene que
-- quedar registrado igual — es justamente el caso interesante.
create index if not exists traceroutes_node_idx
  on public.traceroutes (node_id, requested_at desc);

-- Para el corte de "desde la última señal de vida" en `v_mesh_health`. Cubre
-- 'ok' y 'heard': las dos son vida, aunque sólo una sea una respuesta.
drop index if exists public.traceroutes_ok_idx;
create index if not exists traceroutes_vida_idx
  on public.traceroutes (node_id, requested_at desc)
  where status in ('ok', 'heard');

-- ------------------------- SALTOS MEDIDOS -------------------------
-- Un registro por salto. Esta tabla es la topología REAL: con ella se dibujan
-- las aristas del mapa y se puede preguntar "cómo estuvo el enlace
-- Cabuyarito→Torre este mes". Va relacional y no como jsonb en la tabla padre
-- porque si no, cada consulta de aristas tendría que hacer unnest.
--
-- Tres trampas del protocolo que el ESCRITOR tiene que manejar antes de
-- insertar aquí (quedan escritas donde se van a leer):
--   · el SNR viene en cuartos de dB → hay que dividir por 4;
--   · -128 significa "desconocido", no -128 dB → va como null, o el mapa se
--     llena de enlaces fantasma malísimos;
--   · `snrTowards` trae len(route)+1 entradas, porque el destino agrega la
--     suya; si el largo no cuadra, el firmware mandó algo inconsistente y el
--     SNR de esa dirección entera no es fiable.
create table if not exists public.traceroute_hops (
  traceroute_id  bigint   not null
                 references public.traceroutes(id) on delete cascade,
  direction      text     not null,
  hop_index      smallint not null,   -- 0 = primer salto desde el origen
  from_node_id   text,
  to_node_id     text,
  snr_db         real,                -- null = el firmware lo reportó desconocido

  primary key (traceroute_id, direction, hop_index),
  constraint traceroute_hops_indice_positivo check (hop_index >= 0),
  -- Cota de cordura: el SNR de LoRa vive entre -25 y +15 dB. Un valor fuera de
  -- ahí es casi siempre el crudo sin dividir entre 4, o el -128 sin convertir.
  constraint traceroute_hops_snr_plausible
    check (snr_db is null or snr_db between -30 and 20)
);

alter table public.traceroute_hops
  drop constraint if exists traceroute_hops_direction_valida;
alter table public.traceroute_hops
  add constraint traceroute_hops_direction_valida
  check (direction in ('towards', 'back'));

create index if not exists traceroute_hops_arista_idx
  on public.traceroute_hops (from_node_id, to_node_id);

-- =============================== APOYO ===============================

-- Distancia en metros entre dos coordenadas (haversine).
--
-- A mano y no con PostGIS: el proyecto ya evita depender de extensiones (ver la
-- nota de flota.sql), y esto se usa para validar 6 filas, no para indexar
-- geometrías.
create or replace function public.mesh_dist_m(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
) returns double precision
language sql
immutable
as $$
  select 2 * 6371000 * asin(sqrt(
    sin(radians(lat2 - lat1) / 2) ^ 2 +
    cos(radians(lat1)) * cos(radians(lat2)) * sin(radians(lon2 - lon1) / 2) ^ 2
  ));
$$;

-- Última vez que el gateway oyó a un nodo, según el pipeline existente.
--
-- Es el ÚNICO punto de contacto de este módulo con `node_positions`, y va en una
-- función y no en un JOIN dentro de la vista a propósito: una vista que
-- referencia columnas de otra tabla se vuelve dependiente de ellas, y a partir
-- de ahí Postgres rechaza cambiarlas. El cuerpo de una función no se rastrea,
-- así que el ingestor puede seguir evolucionando su esquema sin tropezarse con
-- nada de lo que hay aquí.
--
-- Y por eso mismo atrapa los errores: si algún día esa tabla se renombra o
-- pierde la columna, este módulo devuelve null ("no sé cuándo se oyó") en vez de
-- tumbar la consulta del mapa.
create or replace function public.mesh_last_heard(p_node_id text)
returns timestamptz
language plpgsql
stable
as $$
declare v timestamptz;
begin
  if p_node_id is null then return null; end if;
  execute 'select max(last_heard) from public.node_positions where node_id = $1'
    into v using p_node_id;
  return v;
exception
  when undefined_table or undefined_column or insufficient_privilege then
    return null;
end;
$$;

-- =============================== VISTAS ===============================

-- Una fila por sitio: es lo que pinta el mapa.
--
-- Los umbrales viven aquí arriba, en un CTE, para poder calibrarlos sin tocar la
-- app ni volver a desplegar. Hoy salen de la cadencia acordada: barrido cada 60
-- min escalonado, con reintento a los 5 min hasta 3 veces.
-- Se recrea entera (drop + create) y no con `create or replace`, porque esa
-- forma falla en cuanto cambia la lista de columnas. Los GRANT se vuelven a dar
-- al final del archivo, que es donde viven.
drop view if exists public.v_mesh_health;
create view public.v_mesh_health as
with umbral as (
  select
    -- Si se oyó al nodo hace menos de esto, está vivo y no hace falta sondearlo.
    interval '20 minutes' as oido_reciente,
    -- Cuánto vale un traceroute exitoso antes de considerarlo viejo. Algo más
    -- que el barrido (60 min) para que un sondeo que se corrió tarde no deje el
    -- sitio en ámbar sin motivo.
    interval '90 minutes' as sondeo_vigente,
    -- Fallos consecutivos para declarar caída. Con 3 y reintento a 5 min, una
    -- caída real se confirma en ~10 min; con 1 el mapa parpadearía con cada
    -- colisión del canal, que es normal en LoRa.
    3                     as fallos_inactiva
),
ultimo as (
  select distinct on (node_id)
         node_id, requested_at, responded_at, status, rtt_ms,
         hops_towards, hops_back, "asymmetric", snr_final_db, route_text, "trigger"
    from public.traceroutes
   order by node_id, requested_at desc
),
ultima_vida as (
  -- 'heard' cuenta como vida igual que 'ok': el nodo habló, aunque no fuera con
  -- nosotros. Si no se contara, un sitio sano que se anuncia acumularía
  -- "fallos" y terminaría pintado de rojo por el solo hecho de no ser sondeado.
  select node_id, max(requested_at) as vida_at
    from public.traceroutes
   where status in ('ok', 'heard')
   group by node_id
),
fallos as (
  -- Fallos seguidos DESDE la última señal de vida. Si nunca hubo, cuentan todos.
  -- Sólo timeout y error son fallos: 'heard' no es un sondeo fallido.
  select t.node_id, count(*)::int as n
    from public.traceroutes t
    left join ultima_vida v on v.node_id = t.node_id
   where t.status in ('timeout', 'error')
     and (v.vida_at is null or t.requested_at > v.vida_at)
   group by t.node_id
),
gateway_activo as (
  -- Un gateway no se puede sondear a sí mismo, así que su prueba de vida es
  -- otra: que esté escribiendo sondeos. Si hace 10 minutos pidió un traceroute,
  -- está encendido — preguntárselo a la malla no aportaría nada.
  select gateway_node_id as node_id, max(requested_at) as escribio_at
    from public.traceroutes
   where gateway_node_id is not null
   group by gateway_node_id
)
select
  s.site_id,
  s.node_id,
  s.site_name,
  s.role,
  s.lat,
  s.lon,
  s.coord_source,
  s.dist_gateway_m,
  s.notes,
  h.last_heard,
  -- La última señal de vida venga de donde venga: del pipeline de posiciones
  -- (sólo los móviles están ahí) o del registro de sondeos (las antenas).
  greatest(h.last_heard, v.vida_at) as ultima_senal,
  round(extract(epoch from now() - greatest(h.last_heard, v.vida_at)) / 60)::int
    as min_sin_senal,
  t.requested_at  as ultimo_sondeo,
  t.status        as ultimo_status,
  t."trigger"     as ultimo_trigger,
  t.rtt_ms,
  t.hops_towards,
  t.hops_back,
  t."asymmetric",
  t.snr_final_db,
  t.route_text,
  coalesce(f.n, 0) as fallos_consecutivos,
  case
    -- Sin coordenada no hay nada que pintar, aunque el nodo responda.
    when s.lat is null or s.lon is null then 'sin_datos'
    -- El gateway: vivo porque está escribiendo (ver `gateway_activo`).
    when s.role = 'gateway' and g.escribio_at >= now() - u.sondeo_vigente
      then 'activa'
    -- Barato y pasivo: el nodo se anuncia solo, sin gastar aire.
    when h.last_heard >= now() - u.oido_reciente then 'activa'
    when t.status in ('ok', 'heard')
     and t.requested_at >= now() - u.sondeo_vigente then 'activa'
    when coalesce(f.n, 0) >= u.fallos_inactiva then 'inactiva'
    when coalesce(f.n, 0) >= 1 then 'sin_respuesta'
    -- Ni se ha oído ni se ha sondeado: no sabemos, y decirlo es lo correcto.
    else 'sin_datos'
  end as estado
from public.mesh_sites s
cross join umbral u
left join lateral (select public.mesh_last_heard(s.node_id) as last_heard) h on true
left join ultimo        t on t.node_id = s.node_id
left join fallos        f on f.node_id = s.node_id
left join ultima_vida   v on v.node_id = s.node_id
left join gateway_activo g on g.node_id = s.node_id;

-- Aristas medidas: la topología real, para dibujarla encima de la declarada.
--
-- La MEDIANA y no el promedio: una sola muestra con SNR raro —una colisión, un
-- aguacero— no puede mover la arista entera. `veces` dice cuánto peso tiene esa
-- mediana; una arista vista dos veces no es un enlace establecido.
drop view if exists public.v_mesh_links;
create view public.v_mesh_links as
select
  hp.from_node_id,
  hp.to_node_id,
  -- Par normalizado, para que el mapa pueda dibujar UNA línea por enlace en vez
  -- de dos superpuestas (ida y vuelta son filas distintas, y deben serlo: un
  -- enlace asimétrico es un hallazgo, no un error).
  least(hp.from_node_id, hp.to_node_id)    as node_a,
  greatest(hp.from_node_id, hp.to_node_id) as node_b,
  hp.direction,
  count(*)::int                            as veces,
  percentile_cont(0.5) within group (order by hp.snr_db::double precision)
                                           as snr_mediano_db,
  min(hp.snr_db)                           as snr_min_db,
  max(tr.requested_at)                     as visto_por_ultima_vez
from public.traceroute_hops hp
join public.traceroutes tr on tr.id = hp.traceroute_id
where hp.from_node_id is not null
  and hp.to_node_id is not null
  -- `!ffffffff` es el "relay desconocido" del protocolo: cuando un nodo no sabe
  -- el id completo de quien repitió, el firmware manda 0xffffffff. Es un dato
  -- legítimo del sondeo —por eso se guarda en `traceroute_hops`— pero NO es un
  -- nodo: si entrara al grafo aparecería como un hub fantasma conectado a media
  -- malla. El salto se descarta aquí, no al insertar, para no perder la
  -- evidencia de que esa ruta tuvo un tramo sin identificar.
  and hp.from_node_id <> '!ffffffff'
  and hp.to_node_id   <> '!ffffffff'
  -- Un nodo consigo mismo tampoco es una arista.
  and hp.from_node_id <> hp.to_node_id
  and tr.requested_at >= now() - interval '24 hours'
group by hp.from_node_id, hp.to_node_id, hp.direction;

-- Validación de coordenadas: la que antes era un script aparte.
--
-- Un dígito transpuesto en una latitud mueve un nodo kilómetros sin que se note
-- sobre la imagen satelital; contra la distancia del acta, salta. Si falla UNA
-- fila es esa coordenada; si fallan TODAS, la mala es la del gateway, que es el
-- centro contra el que se mide.
drop view if exists public.v_mesh_sites_check;
create view public.v_mesh_sites_check as
select
  s.site_id,
  s.site_name,
  s.dist_gateway_m                                  as declarado_m,
  round(public.mesh_dist_m(g.lat, g.lon, s.lat, s.lon))::int as medido_m,
  round(abs(public.mesh_dist_m(g.lat, g.lon, s.lat, s.lon)
            - s.dist_gateway_m))::int              as error_m,
  abs(public.mesh_dist_m(g.lat, g.lon, s.lat, s.lon)
      - s.dist_gateway_m) <= 50                    as cuadra
from public.mesh_sites s
cross join (
  select lat, lon from public.mesh_sites
   where role = 'gateway' and lat is not null
   limit 1
) g
where s.role <> 'gateway'
  and s.lat is not null
  and s.dist_gateway_m is not null;

-- ================================ RLS ================================
-- Lectura pública (la app usa la anon key, que va en el bundle del navegador) y
-- ninguna policy de escritura: el que escribe es el proceso del gateway con la
-- service key, que no pasa por RLS. Así, alguien con la URL de la app puede ver
-- el estado de la red pero no inventar un sondeo.
alter table public.mesh_sites      enable row level security;
alter table public.traceroutes     enable row level security;
alter table public.traceroute_hops enable row level security;

do $$
declare t text;
begin
  foreach t in array array['mesh_sites','traceroutes','traceroute_hops']
  loop
    execute format('drop policy if exists "%s lectura" on public.%I', t, t);
    execute format(
      'create policy "%s lectura" on public.%I for select to anon, authenticated using (true)',
      t, t);
  end loop;
end $$;

-- Las policies deciden qué filas se pueden tocar; los GRANT deciden si el rol
-- puede tocar la tabla siquiera. Explícitos, para que el archivo funcione lo
-- corra quien lo corra.
grant usage on schema public to anon, authenticated;
grant select on
  public.mesh_sites, public.traceroutes, public.traceroute_hops,
  public.v_mesh_health, public.v_mesh_links, public.v_mesh_sites_check
  to anon, authenticated;

-- El proyecto trae `alter default privileges ... grant all on tables`, así que
-- toda tabla nueva nace con INSERT, DELETE y TRUNCATE para el rol público
-- aunque nadie los pida. RLS frena los dos primeros, pero TRUNCATE NO pasa por
-- RLS: el privilegio es lo único que lo detiene.
revoke insert, update, delete, truncate on
  public.mesh_sites, public.traceroutes, public.traceroute_hops
  from anon, authenticated;

grant execute on function public.mesh_dist_m(
  double precision, double precision, double precision, double precision)
  to anon, authenticated;
grant execute on function public.mesh_last_heard(text) to anon, authenticated;

-- ================================ SITIOS ================================
-- ⚠️ LAS COORDENADAS NO VAN EN ESTE ARCHIVO. Dónde está cada antena es
-- información sensible —es la infraestructura de seguridad del predio— y este
-- repositorio es público. La carga de `mesh_sites` vive fuera de git, en
-- `supabase/mesh-sitios.local.sql` (ignorado por .gitignore), y se pega en el
-- SQL Editor una sola vez, después de este archivo.
--
-- Este archivo crea la estructura vacía; el otro la llena. Esa separación es el
-- motivo por el que todo aquí es idempotente: se puede volver a correr para
-- actualizar tablas y vistas sin tocar ni una coordenada.
--
-- Para reconstruir el archivo local desde la base, si se perdió:
--   select format(
--     'insert into public.mesh_sites (site_id,node_id,site_name,role,lat,lon,'
--     'coord_source,dist_gateway_m,notes) values (%L,%L,%L,%L,%L,%L,%L,%L,%L) '
--     'on conflict (site_id) do nothing;',
--     site_id, node_id, site_name, role, lat, lon, coord_source,
--     dist_gateway_m, notes)
--     from public.mesh_sites order by site_name;

-- ⚠️ NOTA PARA EL ESCRITOR DE TRACEROUTE
-- No hagas upsert de las antenas en `nodes`. Es tentador —dejaría los 7 nodos
-- registrados de una vez— pero `nodes` es la lista que la app recorre para armar
-- la flota: cada fila nueva aparece como una máquina más en el panel, en estado
-- "Sin GPS", y además dispara una consulta de recorrido por nodo y por día. Las
-- antenas ya tienen su registro propio en `mesh_sites`, que es donde la app las
-- va a leer. Por eso `traceroutes.node_id` es texto libre y sin FK.

-- ============================= CORRECCIONES =============================
-- Van DESPUÉS de la semilla y como UPDATE, no editando el INSERT de arriba: el
-- INSERT lleva `on conflict do nothing`, así que en una base ya sembrada no
-- cambiaría nada. Esto sí, y es idempotente.

-- Torre Oficinas cambió de radio. El `!2ad9c5df` que traía el acta no se oye
-- desde el 15-abr-2026; el que está conectado hoy al Pi es `!9ea29bc4`
-- ("Mission Pack"), que es el que firma los sondeos en `gateway_node_id`.
-- Con el node_id viejo, ninguna arista de la malla cruzaba contra este sitio.
--
-- Es exactamente el caso que justificó que la llave fuera `site_id`: el sitio
-- siguió siendo el mismo y su coordenada sigue validada contra las 6 distancias
-- del acta; lo único que cambió fue el aparato montado encima.
update public.mesh_sites
   set node_id = '!9ea29bc4',
       notes = 'Gateway con backhaul Starlink. Radio actual !9ea29bc4 ("Mission Pack"); '
               || 'hasta abr-2026 estuvo !2ad9c5df, que dejó de oírse el 15-abr-2026. '
               || 'La coordenada se tomó del extremo de la línea Oficina-Kiosco del KML y '
               || 'quedó confirmada porque las 6 distancias del acta reproducen desde ahí '
               || 'con menos de 15 m de error.',
       updated_at = now()
 where site_id = 'torre-oficinas'
   and node_id is distinct from '!9ea29bc4';
