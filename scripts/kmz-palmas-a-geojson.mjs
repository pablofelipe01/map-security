/**
 * Convierte las líneas de palma del Departamento Agronómico en un GeoJSON por
 * bloque (public/palmas/<bloque>.geojson) y rehace el índice que usa el mapa
 * (public/palmas/indice.json).
 *
 *   node scripts/kmz-palmas-a-geojson.mjs "Linea 9.kmz" ["Palma 9.kmz"] ...
 *   node scripts/kmz-palmas-a-geojson.mjs public/palmas-lineas-guaicaramo.geojson
 *   node scripts/kmz-palmas-a-geojson.mjs --indice      # sólo rehace el índice
 *
 * Acepta tres cosas, en cualquier orden y cantidad:
 *  - el KMZ/KML de LÍNEAS ("Linea 9.kmz"): un Placemark por hilera con COD_BP
 *    ("9-4"), ID_LINEA ("9-4-72") y la polilínea;
 *  - el KMZ/KML de PALMAS ("Palma 9.kmz"): un punto por palma. Sólo se usa para
 *    contar palmas por línea (el dibujo sale de las líneas);
 *  - un GeoJSON de líneas con `properties.linea` (lo que escribe
 *    scripts/xlsx-palmas-a-geojson.py), que se reparte por bloque.
 *
 * UN ARCHIVO POR BLOQUE porque el mapa no carga la capa entera: la persona elige
 * en el control de capas qué bloque o parcela quiere ver, y sólo se baja ese
 * archivo. Con el censo completo del predio la capa entera pesaría decenas de
 * MB; un bloque son ~100 KB.
 *
 * EL DATUM. Los KMZ que exporta el SIG vienen corridos ~380 m al este y ~290 m
 * al sur (bloque 9, 28 sep 2026): el exportador les aplicó la transformación
 * Datum Bogotá 1975 → WGS84 a coordenadas que ya estaban en MAGNA-SIRGAS (que
 * para esto es WGS84). Se comprobó contra tres cosas independientes: con la
 * transformación deshecha, las 17 665 palmas del bloque caen en el polígono de
 * su propia parcela (public/parcelas-guaicaramo.geojson), el centro del bloque
 * coincide con el del plano a 15 m, y 23 de los 25 fixes en labor del MA106 de
 * ese día quedan a menos de 10 m de una palma (sin corregir: 10 de 25).
 *
 * Como no se sabe si el próximo KMZ vendrá igual, el script NO corrige a
 * ciegas: por cada bloque prueba las dos versiones contra los polígonos de sus
 * parcelas y se queda con la que cae dentro, e imprime el resultado. Si
 * ninguna cae dentro, avisa y escribe la versión cruda.
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const AQUI = dirname(fileURLToPath(import.meta.url));
const DIR = join(AQUI, "..", "public", "palmas");
const PARCELAS = join(AQUI, "..", "public", "parcelas-guaicaramo.geojson");

/**
 * Saca el primer .kml de un ZIP.
 *
 * Se lee el directorio central y no las cabeceras locales (como hace
 * scripts/kmz-a-geojson.mjs): el KMZ de palmas trae los tamaños en cero en la
 * cabecera local y los anota después de los datos, así que la cabecera sola no
 * dice dónde termina cada archivo.
 */
function kmlDeKmz(buf) {
  let fin = buf.length - 22;
  while (fin >= 0 && buf.readUInt32LE(fin) !== 0x06054b50) fin--;
  if (fin < 0) throw new Error("El KMZ no es un ZIP válido");
  const total = buf.readUInt16LE(fin + 10);
  let off = buf.readUInt32LE(fin + 16);
  for (let i = 0; i < total; i++) {
    const metodo = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const comLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const nombre = buf.toString("utf8", off + 46, off + 46 + nameLen);
    if (nombre.toLowerCase().endsWith(".kml")) {
      const datos = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const crudo = buf.subarray(datos, datos + compSize);
      return (metodo === 8 ? inflateRawSync(crudo) : crudo).toString("utf8");
    }
    off += 46 + nameLen + extraLen + comLen;
  }
  throw new Error("El KMZ no contiene ningún .kml");
}

/**
 * Un atributo de la tabla HTML que ArcGIS mete en <description>:
 * `<td>COD_BP</td>\r\r\n<td>9-4</td>`.
 */
function atributo(cuerpo, campo) {
  const m = cuerpo.match(new RegExp(`<td>${campo}</td>\\s*<td>([^<]*)</td>`));
  const v = m?.[1]?.trim();
  return v && v !== "&lt;Nulo&gt;" ? v : null;
}

const coordenadas = (cuerpo) =>
  [...cuerpo.matchAll(/<coordinates>([^<]+)<\/coordinates>/g)].map((m) =>
    m[1]
      .trim()
      .split(/\s+/)
      .map((s) => s.split(",").slice(0, 2).map(Number))
  );

// ------------------------------------------------------------------ datum

const RAD = Math.PI / 180;
const WGS84 = [6378137, 1 / 298.257223563];
const INTL1924 = [6378388, 1 / 297]; // elipsoide del Datum Bogotá 1975
/** Traslación Bogotá 1975 → WGS84 (EPSG:1125), en metros geocéntricos. */
const BOGOTA_A_WGS = [307, 304, -318];

function geoAEcef([lon, lat], [a, f]) {
  const e2 = f * (2 - f);
  const N = a / Math.sqrt(1 - e2 * Math.sin(lat * RAD) ** 2);
  return [
    N * Math.cos(lat * RAD) * Math.cos(lon * RAD),
    N * Math.cos(lat * RAD) * Math.sin(lon * RAD),
    N * (1 - e2) * Math.sin(lat * RAD),
  ];
}

function ecefAGeo([x, y, z], [a, f]) {
  const e2 = f * (2 - f);
  const p = Math.hypot(x, y);
  let lat = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 6; i++) {
    const N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(z + e2 * N * Math.sin(lat), p);
  }
  return [Math.atan2(y, x) / RAD, lat / RAD];
}

/** Deshace la transformación Bogotá → WGS84 que el exportador aplicó de más. */
function deshacerBogota(p) {
  const [x, y, z] = geoAEcef(p, WGS84);
  const [dx, dy, dz] = BOGOTA_A_WGS;
  return ecefAGeo([x - dx, y - dy, z - dz], INTL1924);
}

// ------------------------------------------------------------------ parcelas

function dentro([x, y], anillo) {
  let c = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i];
    const [xj, yj] = anillo[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** "9-4" → anillos exteriores del polígono B.9-P.4 del plano. */
function cargarParcelas() {
  const out = new Map();
  if (!existsSync(PARCELAS)) return out;
  for (const f of JSON.parse(readFileSync(PARCELAS, "utf8")).features) {
    const m = String(f.properties?.cod_bp ?? "").match(/^B\.(\w+)-P\.(\w+)/);
    if (!m) continue;
    const polys =
      f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
    const k = `${m[1]}-${m[2]}`;
    out.set(k, [...(out.get(k) ?? []), ...polys.map((p) => p[0])]);
  }
  return out;
}

/** Fracción de líneas cuyo punto medio cae en el polígono de su parcela. */
function aciertos(lineas, parcelas, mover) {
  let si = 0;
  let con = 0;
  for (const l of lineas) {
    const anillos = parcelas.get(l.parcela);
    if (!anillos) continue;
    con++;
    const a = mover(l.coords[0]);
    const b = mover(l.coords[l.coords.length - 1]);
    const medio = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (anillos.some((r) => dentro(medio, r))) si++;
  }
  return con ? si / con : null;
}

// ------------------------------------------------------------------ lectura

/** ID_LINEA → { parcela, partes: [[lon,lat]...][] } */
const lineas = new Map();
/** ID_LINEA → número de palmas. */
const palmas = new Map();
/** Bloques que llegaron de un GeoJSON ya corregido: no se les prueba datum. */
const sinDatum = new Set();

const parcelaDe = (idLinea) => idLinea.split("-").slice(0, 2).join("-");

const args = process.argv.slice(2);
const soloIndice = args.includes("--indice");
const entradas = args.filter((a) => !a.startsWith("--"));
if (!soloIndice && entradas.length === 0) {
  console.error(
    'uso: node scripts/kmz-palmas-a-geojson.mjs "Linea 9.kmz" ["Palma 9.kmz"] ...  |  --indice'
  );
  process.exit(1);
}

for (const ruta of entradas) {
  const bruto = readFileSync(ruta);
  if (ruta.toLowerCase().endsWith(".geojson") || ruta.toLowerCase().endsWith(".json")) {
    let n = 0;
    for (const f of JSON.parse(bruto.toString("utf8")).features) {
      const id = f.properties?.linea;
      if (!id || f.geometry?.type !== "LineString") continue;
      const l = lineas.get(id) ?? { parcela: parcelaDe(id), partes: [] };
      l.partes.push(f.geometry.coordinates);
      lineas.set(id, l);
      if (f.properties.palmas) palmas.set(id, f.properties.palmas);
      sinDatum.add(id.split("-")[0]);
      n++;
    }
    console.log(`${ruta}: ${n} líneas (GeoJSON)`);
    continue;
  }

  const kml = ruta.toLowerCase().endsWith(".kmz") ? kmlDeKmz(bruto) : bruto.toString("utf8");
  let nl = 0;
  let np = 0;
  for (const [cuerpo] of kml.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/g)) {
    const id = atributo(cuerpo, "ID_LINEA");
    if (!id) continue;
    if (/<LineString>/.test(cuerpo)) {
      const l = lineas.get(id) ?? {
        parcela: atributo(cuerpo, "COD_BP") ?? parcelaDe(id),
        partes: [],
      };
      l.partes.push(...coordenadas(cuerpo).filter((c) => c.length >= 2));
      lineas.set(id, l);
      nl++;
    } else if (/<Point>/.test(cuerpo)) {
      palmas.set(id, (palmas.get(id) ?? 0) + 1);
      np++;
    }
  }
  console.log(`${ruta}: ${nl} líneas, ${np} palmas`);
}

// ------------------------------------------------------------------ escritura

mkdirSync(DIR, { recursive: true });

if (lineas.size) {
  const parcelas = cargarParcelas();
  const porBloque = new Map();
  for (const [id, l] of lineas) {
    const b = id.split("-")[0];
    porBloque.set(b, [...(porBloque.get(b) ?? []), { id, ...l }]);
  }

  for (const [bloque, ls] of porBloque) {
    const partes = ls.flatMap((l) => l.partes.map((coords) => ({ parcela: l.parcela, coords })));
    let mover = (p) => p;
    if (!sinDatum.has(bloque)) {
      const crudo = aciertos(partes, parcelas, mover);
      const corregido = aciertos(partes, parcelas, deshacerBogota);
      const pct = (x) => (x === null ? "sin polígonos" : `${Math.round(x * 100)} %`);
      console.log(
        `bloque ${bloque}: en su parcela — tal cual ${pct(crudo)}, datum corregido ${pct(corregido)}`
      );
      if (crudo !== null && corregido !== null && corregido > crudo + 0.2 && corregido >= 0.6) {
        mover = deshacerBogota;
        console.log(`bloque ${bloque}: se corrige el datum`);
      } else if (crudo !== null && crudo < 0.6) {
        console.warn(
          `AVISO bloque ${bloque}: ni tal cual ni corregido cae en sus parcelas; se escribe tal cual. Revisar el KMZ.`
        );
      }
    }

    const features = ls
      .sort((a, b) => a.id.localeCompare(b.id, "es", { numeric: true }))
      .flatMap((l) =>
        l.partes.map((coords) => ({
          type: "Feature",
          properties: {
            linea: l.id,
            parcela: l.parcela,
            ...(palmas.has(l.id) ? { palmas: palmas.get(l.id) } : {}),
          },
          geometry: {
            type: "LineString",
            coordinates: coords.map((p) => mover(p).map((v) => Math.round(v * 1e6) / 1e6)),
          },
        }))
      );
    const salida = join(DIR, `${bloque}.geojson`);
    writeFileSync(salida, JSON.stringify({ type: "FeatureCollection", features }));
    console.log(`bloque ${bloque}: ${features.length} líneas -> ${salida}`);
  }
}

// ------------------------------------------------------------------ índice

/**
 * El índice es lo único que el mapa baja al arrancar: la lista de bloques y
 * parcelas para el buscador del control de capas y, con su caja, para saber
 * qué bloque pedir cuando un rastro pasa por él (ver lib/palmas.ts).
 */
function caja(coords) {
  let [w, s, e, n] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of coords) {
    if (x < w) w = x;
    if (y < s) s = y;
    if (x > e) e = x;
    if (y > n) n = y;
  }
  return [w, s, e, n].map((v) => Math.round(v * 1e6) / 1e6);
}

const bloques = [];
for (const archivo of readdirSync(DIR).filter((f) => f.endsWith(".geojson"))) {
  const fc = JSON.parse(readFileSync(join(DIR, archivo), "utf8"));
  const pars = new Map();
  for (const f of fc.features) {
    const p = pars.get(f.properties.parcela) ?? { ids: new Set(), palmas: 0, coords: [] };
    if (!p.ids.has(f.properties.linea)) p.palmas += f.properties.palmas ?? 0;
    p.ids.add(f.properties.linea);
    p.coords.push(...f.geometry.coordinates);
    pars.set(f.properties.parcela, p);
  }
  const parcelas = [...pars]
    .sort(([a], [b]) => a.localeCompare(b, "es", { numeric: true }))
    .map(([parcela, p]) => ({
      parcela,
      lineas: p.ids.size,
      palmas: p.palmas,
      caja: caja(p.coords),
    }));
  bloques.push({
    bloque: archivo.replace(/\.geojson$/, ""),
    lineas: parcelas.reduce((s, p) => s + p.lineas, 0),
    palmas: parcelas.reduce((s, p) => s + p.palmas, 0),
    caja: caja(parcelas.flatMap((p) => [p.caja.slice(0, 2), p.caja.slice(2)])),
    parcelas,
  });
}
bloques.sort((a, b) => a.bloque.localeCompare(b.bloque, "es", { numeric: true }));
writeFileSync(join(DIR, "indice.json"), JSON.stringify({ bloques }));
console.log(
  `índice: ${bloques.length} bloques (${bloques.map((b) => b.bloque).join(", ")}) -> ${join(DIR, "indice.json")}`
);
