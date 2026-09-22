/**
 * Los acopios: los puntos donde se junta el fruto para recogerlo.
 *
 * El esquema está en `supabase/acopios.sql` y los puntos en
 * `supabase/acopios-datos.sql`; hay que correr los dos en el SQL Editor de
 * Supabase. Hasta entonces esto devuelve una lista vacía y la pantalla que los
 * pida avisa que faltan, igual que hace `lib/registro.ts` con la flota.
 *
 * POR QUÉ ESTO EXISTE SI EL MAPA YA PINTA LOS ACOPIOS. El mapa los lee del
 * GeoJSON (`public/acopios-guaicaramo.geojson`) porque lo único que necesita es
 * dibujar 845 puntos, y para eso un archivo estático es más rápido que una
 * consulta. Pero una asignación tiene que apuntar a un acopio que exista mañana,
 * y una fila del GeoJSON no tiene identidad: es la posición número 412 de un
 * arreglo. La tabla es la que le da nombre propio.
 *
 * Las dos copias no pueden desfasarse a mano: `scripts/acopios-a-sql.mjs`
 * genera la tabla A PARTIR del GeoJSON. Si el plano cambia, se regenera y se
 * vuelve a importar.
 */

import { haversineM } from "./geo";
import { supabase } from "./supabase";

/* ============================== tipos ============================== */

/** Un acopio, tal como está en la tabla. */
export interface Acopio {
  id: string;
  /** Coordenada redondeada a 6 decimales: la identidad estable del punto. */
  clave: string;
  /** Los tres vienen del rótulo del plano y pueden faltar (ver más abajo). */
  bloque: string | null;
  lote: string | null;
  num: string | null;
  /** Lo que lee una persona: "B.9-P.2 (R.) · 37". Único. */
  codigo: string;
  lat: number;
  lon: number;
}

/* ============================== errores ============================== */

/** Códigos de PostgREST cuando la tabla todavía no existe. */
const FALTA = new Set(["42P01", "PGRST202", "PGRST205"]);

export class AcopiosNoInstalados extends Error {
  constructor() {
    super(
      "Falta crear la tabla de acopios. Corre supabase/acopios.sql y después " +
        "supabase/acopios-datos.sql en el SQL Editor de Supabase."
    );
    this.name = "AcopiosNoInstalados";
  }
}

/* ============================== lectura ============================== */

/**
 * Todos los acopios activos, ordenados por código.
 *
 * Se traen enteros —845 filas, unos 60 KB— y se filtran en el cliente. Es la
 * misma decisión que toma `fetchFlota`: el catálogo no cambia en el día, y
 * tenerlo en memoria hace que buscar en el desplegable no toque la red.
 *
 * Los inactivos se quedan fuera a propósito: son puntos que salieron del plano
 * y no se pueden planear. Las jornadas pasadas que los visitaron los siguen
 * mostrando, porque esas leen el acopio por el join de `v_plan_jornada`, no por
 * esta lista.
 */
export async function fetchAcopios(): Promise<Acopio[]> {
  const { data, error } = await supabase
    .from("acopios")
    .select("id,clave,bloque,lote,num,codigo,lat,lon")
    .eq("activo", true)
    .order("codigo");

  if (error) {
    // Tabla ausente = "aún no instalado", no un fallo.
    if (FALTA.has(error.code ?? "")) return [];
    throw new Error(error.message);
  }

  return (data ?? []) as Acopio[];
}

/* ============================== agrupar ============================== */

/** Un lote con sus acopios, para armar el selector en dos pasos. */
export interface GrupoLote {
  /** Como lo rotula el plano ("B.9-P.2 (R.)"), o null si no lo trae. */
  lote: string | null;
  /** El bloque del lote, cuando el plano lo trae. */
  bloque: string | null;
  /** Lo que se muestra como encabezado del grupo. */
  titulo: string;
  acopios: Acopio[];
}

/** Encabezado del grupo "los que el plano no alcanzó a rotular". */
export const SIN_LOTE = "Sin lote en el plano";

/**
 * Agrupa por lote para el selector del coordinador.
 *
 * Elegir entre 845 acopios en una lista plana no es elegir, es buscar. El
 * coordinador piensa en lotes —"hoy se recoge en el B.9"— así que el selector
 * se arma lote → acopio y esta función le da la forma.
 *
 * Los 44 puntos que el plano dejó sin rotular van todos a un grupo al final. No
 * se esconden: son acopios reales a los que se puede mandar un tractor, y
 * dejarlos fuera del selector los volvería inalcanzables desde la app.
 */
export function agruparPorLote(acopios: Acopio[]): GrupoLote[] {
  const mapa = new Map<string, GrupoLote>();

  for (const a of acopios) {
    const lote = a.lote?.trim() || null;
    const k = lote ?? "￿"; // sin lote: al final del orden alfabético
    let g = mapa.get(k);
    if (!g) {
      g = {
        lote,
        bloque: a.bloque?.trim() || null,
        titulo: lote ?? SIN_LOTE,
        acopios: [],
      };
      mapa.set(k, g);
    }
    g.acopios.push(a);
  }

  return [...mapa.entries()]
    .sort((x, y) => x[0].localeCompare(y[0], "es", { numeric: true }))
    .map(([, g]) => g);
}

/**
 * Los lotes más cercanos a un punto, cada uno completo y con la distancia de
 * su acopio más próximo.
 *
 * Ofrecer los N ACOPIOS más cercanos —que es lo obvio— produce una lista donde
 * el mismo lote aparece tres veces seguidas con números distintos: "B.3-P.8 ·
 * 18", "B.3-P.8 · 17", "B.3-P.8 · 16". Leerla cuesta, y además no es la unidad
 * en la que se decide: nadie manda un tractor al punto 17, lo manda al B.3-P.8.
 * Por lote el mismo espacio ofrece seis destinos en vez de doce mitades.
 *
 * El lote va COMPLETO aunque algunos de sus puntos queden lejos: si se
 * recortara a los cercanos, el botón que agrega el lote entero agregaría en
 * realidad un pedazo, y el coordinador se enteraría en el campo.
 */
export function lotesCercanos(
  acopios: Acopio[],
  desde: { lat: number; lon: number },
  cuantos = 6
): { grupo: GrupoLote; metros: number }[] {
  const mapa = new Map<string, GrupoLote>();

  for (const a of acopios) {
    const lote = a.lote?.trim() || null;
    // Sin lote, cada punto va solo. Los 44 que el plano no rotuló están
    // desperdigados por todo el predio: juntarlos en un grupo diría que son
    // vecinos, que es justo lo único que este listado promete.
    const k = lote ?? `￿${a.id}`;
    let g = mapa.get(k);
    if (!g) {
      g = {
        lote,
        bloque: a.bloque?.trim() || null,
        titulo: lote ?? a.codigo,
        acopios: [],
      };
      mapa.set(k, g);
    }
    g.acopios.push(a);
  }

  return [...mapa.values()]
    .map((grupo) => ({
      grupo,
      metros: Math.min(...grupo.acopios.map((a) => haversineM(desde, a))),
    }))
    .sort((x, y) => x.metros - y.metros)
    .slice(0, cuantos);
}

/* ============================== buscar ============================== */

/** Quita tildes y baja a minúsculas, para que "B.9" encuentre lo mismo que "b.9". */
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");

/**
 * Filtra por texto libre contra el código, el lote y el bloque.
 *
 * Todos los términos tienen que aparecer en alguna parte, así que "b9 37"
 * encuentra el acopio 37 del bloque 9 sin que el coordinador tenga que escribir
 * el código exacto con sus puntos y su "(R.)".
 */
export function buscarAcopios(acopios: Acopio[], texto: string): Acopio[] {
  const terminos = norm(texto).split(/\s+/).filter(Boolean);
  if (terminos.length === 0) return acopios;

  return acopios.filter((a) => {
    const heno = norm(`${a.codigo} ${a.lote ?? ""} ${a.bloque ?? ""} ${a.num ?? ""}`);
    return terminos.every((t) => heno.includes(t));
  });
}

/* ============================== cercanía ============================== */

/**
 * El acopio activo más cercano a un punto, dentro de `radioM`.
 *
 * Para el clic en el mapa: el coordinador señala dónde quiere mandar la máquina
 * y esto traduce el clic al acopio que quiso señalar. El radio existe para que
 * un clic en medio de un potrero no termine asignando un acopio que está a tres
 * kilómetros; devuelve null y la interfaz dice que ahí no hay nada.
 *
 * Recorre los 845 sin índice espacial: son cuatro operaciones por punto y pasa
 * una vez por clic. Un grid aquí sería complejidad sin beneficio medible.
 */
export function acopioMasCercano(
  acopios: Acopio[],
  lat: number,
  lon: number,
  radioM = 150
): { acopio: Acopio; distanciaM: number } | null {
  let mejor: Acopio | null = null;
  let mejorD = Infinity;

  const p = { lat, lon };
  for (const a of acopios) {
    const d = haversineM(p, a);
    if (d < mejorD) {
      mejorD = d;
      mejor = a;
    }
  }

  return mejor && mejorD <= radioM ? { acopio: mejor, distanciaM: mejorD } : null;
}
