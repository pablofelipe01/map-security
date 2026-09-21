/**
 * Convierte public/acopios-guaicaramo.geojson en supabase/acopios-datos.sql.
 *
 *     node scripts/acopios-a-sql.mjs
 *
 * Los acopios no se capturan desde la app: salen del plano del Departamento
 * Agronómico, que `scripts/pdf-acopios-a-geojson.py` convierte en GeoJSON. Este
 * script es el último tramo de esa cadena — del archivo que pinta el mapa a la
 * tabla contra la que se planea— y existe para que las dos copias no puedan
 * desfasarse a mano: si el plano cambia, se vuelve a correr y se vuelve a pegar
 * el SQL en el editor de Supabase.
 *
 * Va por archivo generado y no por escritura directa con la anon key a
 * propósito. La tabla `acopios` no tiene policy de INSERT (ver
 * `supabase/acopios.sql`): mover un punto manda un tractor a otra parte, y eso
 * no debería poder hacerse desde un navegador. El SQL Editor corre como
 * `postgres`, salta el RLS y deja el cambio anotado en un archivo del repo.
 *
 * DOS COSAS QUE DECIDE ESTE SCRIPT y conviene saber antes de leer la salida:
 *
 *  1. LA LLAVE es la coordenada redondeada a 6 decimales (~11 cm), porque el
 *     número del acopio no identifica nada: hay 162 números distintos para 845
 *     puntos. La consecuencia está explicada en el esquema.
 *
 *  2. EL CÓDIGO que ve una persona ("B.9-P.2 (R.) · 37") tiene que ser único
 *     para poder elegirlo en una lista, y el plano no lo garantiza. Los que
 *     chocan se desempatan con un sufijo (a), (b)… asignado de occidente a
 *     oriente, que es estable mientras los puntos no se muevan.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const ENTRADA = join(AQUI, "..", "public", "acopios-guaicaramo.geojson");
const SALIDA = join(AQUI, "..", "supabase", "acopios-datos.sql");

/** De qué plano salen estos puntos. Va en la columna `origen` de cada fila. */
const ORIGEN = "Acopios Guaicaramo 2026";

/** Literal de texto para SQL, o NULL si no hay dato. */
const txt = (v) => {
  const s = typeof v === "string" ? v.trim() : "";
  return s ? `'${s.replace(/'/g, "''")}'` : "NULL";
};

/* --------------------------- leer el GeoJSON --------------------------- */

const geo = JSON.parse(readFileSync(ENTRADA, "utf8"));
const puntos = [];

for (const f of geo.features ?? []) {
  if (f.geometry?.type !== "Point") continue;
  const [lon, lat] = f.geometry.coordinates;
  const p = f.properties ?? {};
  puntos.push({
    // 6 decimales: es la precisión con la que el extractor escribe el centro
    // del símbolo, y ~11 cm sobra para distinguir dos acopios.
    clave: `${lat.toFixed(6)},${lon.toFixed(6)}`,
    bloque: p.bloque ?? null,
    lote: p.lote ?? null,
    num: p.num ?? null,
    lat,
    lon,
  });
}

if (puntos.length === 0) {
  console.error(`No se encontró ningún punto en ${ENTRADA}`);
  process.exit(1);
}

/* ------------------------ códigos únicos y legibles ------------------------ */

// Lo que diría una persona señalando el acopio. El lote ya trae el bloque
// adentro ("B.9-P.2 (R.)"), así que repetirlo sólo alarga la lista.
const rotulo = (p) => {
  const lote = p.lote?.trim() || (p.bloque?.trim() ? `${p.bloque.trim()} · s/lote` : "Sin lote");
  return `${lote} · ${p.num?.trim() || "s/n"}`;
};

// Desempate: primero se agrupa por el rótulo, y sólo los grupos con más de uno
// reciben sufijo. Ordenar por longitud y luego latitud hace que la letra
// dependa sólo de dónde está el punto, no del orden en que venga el archivo:
// reprocesar el plano no debería renombrar acopios que no se movieron.
const grupos = new Map();
for (const p of puntos) {
  p.rotulo = rotulo(p);
  const k = p.rotulo.toLowerCase();
  if (!grupos.has(k)) grupos.set(k, []);
  grupos.get(k).push(p);
}

const LETRAS = "abcdefghijklmnopqrstuvwxyz";
let conSufijo = 0;

for (const grupo of grupos.values()) {
  if (grupo.length === 1) {
    grupo[0].codigo = grupo[0].rotulo;
    continue;
  }
  grupo.sort((a, b) => a.lon - b.lon || a.lat - b.lat);
  grupo.forEach((p, i) => {
    // Más de 26 homónimos no pasa hoy (el grupo más grande es de 3), pero si
    // pasara, caer en "(aa)" es mejor que repetir la letra en silencio.
    const suf = i < 26 ? LETRAS[i] : `${LETRAS[Math.floor(i / 26) - 1]}${LETRAS[i % 26]}`;
    p.codigo = `${p.rotulo} (${suf})`;
    conSufijo++;
  });
}

/* ------------------------------ reportar ------------------------------ */

const sinLote = puntos.filter((p) => !p.lote?.trim());
const sinNum = puntos.filter((p) => !p.num?.trim());
const claves = new Set(puntos.map((p) => p.clave));

if (claves.size !== puntos.length) {
  // Dos acopios a menos de 11 cm es el plano diciendo algo raro, y la llave no
  // los distinguiría: el upsert se comería uno. Mejor parar que importar mal.
  console.error(
    `ERROR: ${puntos.length - claves.size} punto(s) comparten coordenada a 6 decimales. ` +
      `Revisa la extracción antes de importar.`
  );
  process.exit(1);
}

/* --------------------------- escribir el SQL --------------------------- */

const filas = puntos
  .map(
    (p) =>
      `  (${txt(p.clave)}, ${txt(p.bloque)}, ${txt(p.lote)}, ${txt(p.num)}, ` +
      `${txt(p.codigo)}, ${p.lat}, ${p.lon})`
  )
  .join(",\n");

const listaSinRotulo = sinLote
  .map((p) => `--   ${p.codigo.padEnd(28)} ${p.lat}, ${p.lon}`)
  .join("\n");

const sql = `-- ===========================================================================
-- Acopios de Guaicaramo: datos.
--
-- GENERADO por \`node scripts/acopios-a-sql.mjs\` desde
-- public/acopios-guaicaramo.geojson. NO editar a mano: la próxima corrida lo
-- pisa. Para corregir un punto se corrige el GeoJSON (o el extractor) y se
-- vuelve a generar.
--
-- Origen de los puntos: ${ORIGEN}.
-- Puntos: ${puntos.length}. Sin lote en el plano: ${sinLote.length}. Sin número: ${sinNum.length}.
-- Códigos que necesitaron sufijo de desempate: ${conSufijo}.
--
-- Cómo aplicarlo: correr antes \`supabase/acopios.sql\` (crea las tablas) y
-- después pegar este archivo completo en el SQL Editor de Supabase. Es
-- idempotente: reimportar no duplica, actualiza por coordenada.
--
-- Qué hace con lo que ya estaba: los puntos que siguen en el plano se
-- actualizan y quedan activos; los que ya no aparecen se marcan \`activo = false\`
-- en vez de borrarse, porque una jornada pasada que los visitó tiene que seguir
-- diciendo a dónde fue. El conteo final dice cuántos quedaron de cada lado —
-- vale la pena mirarlo.
-- ===========================================================================

drop table if exists _acopios_import;
create temporary table _acopios_import (
  clave  text primary key,
  bloque text,
  lote   text,
  num    text,
  codigo text not null,
  lat    double precision not null,
  lon    double precision not null
);

insert into _acopios_import (clave, bloque, lote, num, codigo, lat, lon) values
${filas};

insert into public.acopios (clave, bloque, lote, num, codigo, lat, lon, origen)
select clave, bloque, lote, num, codigo, lat, lon, ${txt(ORIGEN)}
  from _acopios_import
on conflict (clave) do update
   set bloque = excluded.bloque,
       lote   = excluded.lote,
       num    = excluded.num,
       codigo = excluded.codigo,
       lat    = excluded.lat,
       lon    = excluded.lon,
       origen = excluded.origen,
       activo = true;

update public.acopios a
   set activo = false
 where a.activo
   and not exists (select 1 from _acopios_import i where i.clave = a.clave);

drop table _acopios_import;

select count(*) filter (where activo)        as activos,
       count(*) filter (where not activo)    as dados_de_baja,
       count(*) filter (where lote is null)  as sin_lote,
       count(*) filter (where num is null)   as sin_numero
  from public.acopios;

-- Los ${sinLote.length} puntos que el plano dejó sin lote. El número vive en una capa
-- aparte del PDF y se empareja por cercanía, así que estos son los que el
-- emparejamiento no alcanzó. Son acopios reales y se pueden planear igual; si
-- alguien los identifica en campo, se corrigen con un UPDATE sobre \`clave\`:
--
${listaSinRotulo}
`;

writeFileSync(SALIDA, sql, "utf8");

console.log(`${puntos.length} acopios → ${SALIDA}`);
console.log(`  sin lote: ${sinLote.length}   sin número: ${sinNum.length}   con sufijo: ${conSufijo}`);
