/**
 * Convierte el KMZ de vías de Guaicaramo a GeoJSON para servirlo como capa fija
 * del mapa.
 *
 *   node scripts/kmz-a-geojson.mjs "<ruta>/vias.kmz" public/vias-guaicaramo.geojson
 *
 * Se hace a mano (sin dependencias) porque es un archivo que cambia una o dos
 * veces al año: no vale la pena arrastrar un parser de KML al bundle ni al
 * package.json solo para esto. El KMZ es un ZIP con un único doc.kml dentro,
 * y el KML que exporta ArcGIS tiene una forma muy regular: un <Placemark> por
 * vía, con <SchemaData> de atributos y un <LineString> de coordenadas.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { inflateRawSync } from "node:zlib";

/** Saca el primer archivo .kml de un ZIP leyendo sus cabeceras locales. */
function kmlDeKmz(buf) {
  let off = 0;
  while (off + 30 <= buf.length && buf.readUInt32LE(off) === 0x04034b50) {
    const metodo = buf.readUInt16LE(off + 8);
    const compSize = buf.readUInt32LE(off + 18);
    const nameLen = buf.readUInt16LE(off + 26);
    const extraLen = buf.readUInt16LE(off + 28);
    const nombre = buf.toString("utf8", off + 30, off + 30 + nameLen);
    const datos = off + 30 + nameLen + extraLen;
    if (nombre.toLowerCase().endsWith(".kml")) {
      if (compSize === 0) break; // tamaño en el descriptor: no soportado.
      const crudo = buf.subarray(datos, datos + compSize);
      return (metodo === 8 ? inflateRawSync(crudo) : crudo).toString("utf8");
    }
    off = datos + compSize;
  }
  throw new Error("El KMZ no contiene ningún .kml (o usa un ZIP no soportado)");
}

const desescapa = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

/** Atributos que sí se usan en el popup o en el estilo de la capa. */
const CAMPOS = ["TIPO", "CODIGO", "NDESCRIPCI", "COD_BP", "ZONA", "BLOQUE"];

const [, , entrada, salida] = process.argv;
if (!entrada || !salida) {
  console.error("Uso: node scripts/kmz-a-geojson.mjs <vias.kmz|doc.kml> <salida.geojson>");
  process.exit(1);
}

const bruto = readFileSync(entrada);
const kml = entrada.toLowerCase().endsWith(".kmz")
  ? kmlDeKmz(bruto)
  : bruto.toString("utf8");

const features = [];
for (const [, cuerpo] of kml.matchAll(/<Placemark\b[\s\S]*?<\/Placemark>/g).map((m) => [m[0], m[0]])) {
  const props = {};
  for (const m of cuerpo.matchAll(/<SimpleData name="([^"]+)">([\s\S]*?)<\/SimpleData>/g)) {
    const valor = desescapa(m[2]).trim();
    if (valor && CAMPOS.includes(m[1])) props[m[1]] = valor;
  }

  // Un Placemark puede traer varias partes (MultiGeometry): se emite una
  // Feature por cada LineString para no inventar uniones entre tramos sueltos.
  for (const g of cuerpo.matchAll(/<LineString[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)) {
    const coords = g[1]
      .trim()
      .split(/\s+/)
      .map((par) => par.split(",").map(Number))
      // La altura del KML es siempre 0 y solo engorda el archivo.
      .map(([lon, lat]) => [+lon.toFixed(6), +lat.toFixed(6)])
      .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));
    if (coords.length < 2) continue;
    features.push({
      type: "Feature",
      properties: props,
      geometry: { type: "LineString", coordinates: coords },
    });
  }
}

writeFileSync(salida, JSON.stringify({ type: "FeatureCollection", features }));
console.log(`${features.length} vías -> ${salida}`);
