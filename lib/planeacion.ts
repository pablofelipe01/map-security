/**
 * El plan del día: a qué acopios va cada máquina, en qué orden, y por dónde.
 *
 * Es lo primero en esta app que registra una INTENCIÓN. Todo lo demás —el
 * rastro, las estadías, el registro de flota— responde a "qué pasó"; esto
 * responde a "qué va a pasar", y esa diferencia manda en dos cosas:
 *
 * 1. EL ESTADO LO DECLARA UNA PERSONA. El poller corre cada 10 minutos y el nodo
 *    entrega un fix cada ~9 (ver README): a 6 km/h eso es hasta un kilómetro de
 *    incertidumbre. "El tractor llegó al acopio" no es algo que esta app pueda
 *    saber, así que no lo deduce. Marcar una parada como completada es un acto
 *    de alguien que lo sabe, y queda fechado en `estado_en`.
 *
 * 2. LA RUTA PLANEADA ES UNA PROPUESTA, no una medición. Eso la hace distinta
 *    del ruteo histórico de `lib/rutas.ts`, que reconstruye y por eso se
 *    abstiene en cuanto empieza a inventar. Aquí no hay nada que respetar
 *    todavía: el camino sugerido no contradice ningún dato, porque el dato no
 *    existe. Por eso la planeación puede permitirse anclar a las vías desde más
 *    lejos, y por eso lo dice en pantalla.
 *
 * El esquema y las funciones están en `supabase/acopios.sql`.
 */

import { haversineM } from "./geo";
import { grafoVias, rutearRastro, unirTramos, type Grafo, type Tramo } from "./rutas";
import { supabase } from "./supabase";
import type { Acopio } from "./acopios";

/* ============================== tipos ============================== */

/**
 * Qué se sabe de una parada.
 *   planeada   — el coordinador la puso en la ruta
 *   en_curso   — se despachó la máquina
 *   completada — alguien reportó que se recogió
 *   cancelada  — ya no va (queda como constancia de que se planeó)
 */
export type EstadoParada = "planeada" | "en_curso" | "completada" | "cancelada";

export const ESTADOS_PARADA: { valor: EstadoParada; label: string }[] = [
  { valor: "planeada", label: "Planeada" },
  { valor: "en_curso", label: "En curso" },
  { valor: "completada", label: "Completada" },
  { valor: "cancelada", label: "Cancelada" },
];

/**
 * Una parada del plan, como la devuelve `v_plan_jornada`: la asignación ya
 * cruzada con el nombre y el color de su máquina y la posición de su acopio.
 *
 * Viene de una vista y no de tres consultas porque la pantalla de despacho la
 * pide entera en cada cambio de fecha. Lo que la vista NO resuelve es qué nodo
 * lleva hoy esa máquina: eso ya lo contesta `lib/registro.ts` para un instante
 * cualquiera, y tenerlo contestado en dos sitios es tenerlo contestado mal.
 */
export interface Parada {
  id: string;
  /** Día de Bogotá, "YYYY-MM-DD". */
  jornada: string;
  /** Posición en la ruta del día, desde 1. */
  orden: number;
  estado: EstadoParada;
  /** Cuándo se declaró el estado actual (ISO UTC). */
  estado_en: string;
  nota: string | null;

  maquina_id: string;
  maquina_codigo: string;
  maquina_nombre: string;
  maquina_tipo: string;
  maquina_color: string;

  acopio_id: string;
  acopio_codigo: string;
  bloque: string | null;
  lote: string | null;
  num: string | null;
  lat: number;
  lon: number;
}

/** El plan de una máquina para una jornada, con sus paradas en orden. */
export interface RutaMaquina {
  maquinaId: string;
  codigo: string;
  nombre: string;
  color: string;
  paradas: Parada[];
}

/* ============================== errores ============================== */

const FALTA = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

export class PlaneacionNoInstalada extends Error {
  constructor() {
    super(
      "Falta crear las tablas de planeación. Corre supabase/acopios.sql en el " +
        "SQL Editor de Supabase."
    );
    this.name = "PlaneacionNoInstalada";
  }
}

/**
 * Traduce un error de PostgREST a algo que el formulario pueda mostrar.
 *
 * Las funciones y el trigger del esquema levantan 22023 con mensajes ya
 * redactados para que los lea una persona ("No se puede sacar del plan lo que ya
 * se trabajó…"); esos se dejan pasar tal cual.
 */
function traducir(error: { code?: string; message?: string }): Error {
  if (FALTA.has(error.code ?? "")) return new PlaneacionNoInstalada();
  if (error.code === "23505") {
    return new Error("Esa máquina ya tiene ese acopio en la ruta de hoy.");
  }
  return new Error(error.message ?? "Error desconocido");
}

/* ============================== lectura ============================== */

/** El plan completo de una jornada ("YYYY-MM-DD"), todas las máquinas. */
export async function fetchPlan(jornada: string): Promise<Parada[]> {
  const { data, error } = await supabase
    .from("v_plan_jornada")
    .select("*")
    .eq("jornada", jornada)
    .order("maquina_codigo")
    .order("orden");

  if (error) {
    if (FALTA.has(error.code ?? "")) return [];
    throw traducir(error);
  }

  return (data ?? []) as Parada[];
}

/**
 * Agrupa las paradas por máquina.
 *
 * Las canceladas quedan fuera de la ruta: el coordinador está mirando a dónde
 * va la máquina, y una parada que ya no va sólo estorba. Siguen en la base y se
 * pueden consultar aparte — que es justo lo que se quiere poder revisar al otro
 * día cuando alguien pregunte por qué no se recogió en tal lote.
 */
export function rutasPorMaquina(paradas: Parada[]): RutaMaquina[] {
  const mapa = new Map<string, RutaMaquina>();

  for (const p of paradas) {
    if (p.estado === "cancelada") continue;
    let r = mapa.get(p.maquina_id);
    if (!r) {
      r = {
        maquinaId: p.maquina_id,
        codigo: p.maquina_codigo,
        nombre: p.maquina_nombre,
        color: p.maquina_color,
        paradas: [],
      };
      mapa.set(p.maquina_id, r);
    }
    r.paradas.push(p);
  }

  for (const r of mapa.values()) r.paradas.sort((a, b) => a.orden - b.orden);

  return [...mapa.values()].sort((a, b) =>
    a.codigo.localeCompare(b.codigo, "es", { numeric: true })
  );
}

/**
 * Acopios que quedaron asignados a más de una máquina en la jornada.
 *
 * El esquema NO lo prohíbe a propósito —en un lote grande es normal mandar dos
 * máquinas al mismo sitio— pero casi siempre es un descuido, así que la
 * pantalla lo señala. Avisar es trabajo de la interfaz; prohibirlo desde la base
 * obligaría al coordinador a mentirle.
 */
export function acopiosRepetidos(paradas: Parada[]): Map<string, Parada[]> {
  const por = new Map<string, Parada[]>();
  for (const p of paradas) {
    if (p.estado === "cancelada") continue;
    const l = por.get(p.acopio_id);
    if (l) l.push(p);
    else por.set(p.acopio_id, [p]);
  }
  for (const [k, v] of por) if (v.length < 2) por.delete(k);
  return por;
}

/* ============================== escritura ============================== */

/**
 * Deja la ruta de una máquina exactamente como dice `acopioIds`, en ese orden.
 *
 * Va por RPC y no por tres llamadas seguidas porque son muchas escrituras
 * —cerrar lo que salió del plan, insertar lo nuevo, renumerar todo— que tienen
 * que pasar juntas o no pasar. Desde el navegador, entre una y otra el plan
 * queda a medias. Mismo criterio que los relevos en `lib/registro.ts`.
 *
 * Devuelve cuántas paradas quedaron.
 */
export async function planearJornada(
  maquinaId: string,
  jornada: string,
  acopioIds: string[]
): Promise<number> {
  const { data, error } = await supabase.rpc("planear_jornada", {
    p_maquina_id: maquinaId,
    p_jornada: jornada,
    p_acopios: acopioIds,
  });

  if (error) throw traducir(error);
  return (data as number) ?? 0;
}

/** Agrega un acopio al final de la ruta del día, sin tocar el resto. */
export async function agregarParada(
  maquinaId: string,
  jornada: string,
  acopioId: string,
  nota?: string
): Promise<string> {
  const { data, error } = await supabase.rpc("agregar_parada", {
    p_maquina_id: maquinaId,
    p_jornada: jornada,
    p_acopio_id: acopioId,
    p_nota: nota ?? null,
  });

  if (error) throw traducir(error);
  return data as string;
}

/**
 * Declara el estado de una parada.
 *
 * `estado_en` lo sella la base, no el cliente: es un hecho sobre la escritura, y
 * dejarlo en manos del que escribe significa que el día que alguien actualice
 * con otra herramienta quede mintiendo. La base también rechaza reabrir lo
 * completado o lo cancelado, con un mensaje en español que llega tal cual.
 */
export async function marcarParada(
  id: string,
  estado: EstadoParada,
  nota?: string | null
): Promise<void> {
  const cambios: Record<string, unknown> = { estado };
  if (nota !== undefined) cambios.nota = nota;

  const { error } = await supabase
    .from("asignaciones_recoleccion")
    .update(cambios)
    .eq("id", id);

  if (error) throw traducir(error);
}

/* ============================== ruteo ============================== */

/**
 * Hasta dónde se busca una vía para anclar el ORIGEN de un trayecto planeado.
 *
 * El histórico usa 35 m (`RADIO_SNAP_M`) y tiene razón: allá, un fix lejos de
 * toda vía está diciendo que la máquina NO estaba en la vía, y pegarla a una
 * sería corregir el dato. Aquí no hay dato que corregir. El tractor está
 * labrando dentro del lote —que es donde debe estar— y la pregunta no es por
 * dónde pasó sino por dónde le conviene salir. 250 m es el ancho típico de un
 * lote de palma: más allá, la vía más cercana ya no es "la salida de este lote"
 * y volver a la recta dice más.
 *
 * El destino no necesita esto: el 99 % de los acopios está a menos de 35 m de
 * una vía (mediana 4.6 m), medido contra `public/vias-guaicaramo.geojson`.
 */
export const RADIO_ORIGEN_M = 250;

/** Un trayecto propuesto entre dos puntos del plan. */
export interface Trayecto {
  /** La polilínea a dibujar, [lat, lon]. */
  latlngs: [number, number][];
  /** Metros por el camino propuesto. */
  metros: number;
  /**
   * false = no se pudo resolver por la malla y esto es la recta entre los dos
   * puntos. La pantalla TIENE que decirlo: una recta de 3 km sobre el cultivo no
   * es una ruta, es la falta de una.
   */
  porVia: boolean;
}

/** La ruta completa de una máquina: un trayecto por cada salto del plan. */
export interface RutaPropuesta {
  trayectos: Trayecto[];
  /** Metros de toda la ruta, sumando los trayectos. */
  metrosTotal: number;
  /** Cuántos trayectos quedaron sin resolver por vías. */
  sinVia: number;
}

const deTramo = (t: Tramo): Trayecto => ({
  latlngs: t.latlngs,
  metros: t.largoM,
  porVia: t.porVia,
});

/**
 * Propone por dónde iría la máquina: de donde está hoy al primer acopio, y de
 * cada acopio al siguiente.
 *
 * `origen` es la última posición conocida de la máquina, o null si no tiene nodo
 * o nunca reportó. Sin origen la ruta arranca en el primer acopio, que sigue
 * sirviendo para ver el orden de las paradas y cuánto suman entre ellas.
 *
 * LO QUE ESTO NO ES —y vale repetirlo porque en una pantalla de planeación se
 * confunde fácil—: un cálculo de tiempo de llegada. Devuelve metros por un
 * camino plausible. Convertirlos en minutos exigiría una velocidad que esta app
 * no mide (`ground_speed` del nodo no es confiable; ver `lib/types.ts`), y un
 * "llega a las 10:40" inventado es peor que no decir nada.
 */
export function rutaPropuesta(
  g: Grafo,
  origen: { lat: number; lon: number } | null,
  acopios: { lat: number; lon: number }[]
): RutaPropuesta {
  const trayectos: Trayecto[] = [];

  // El primer salto va aparte porque es el único que arranca fuera de una vía:
  // el resto son acopio → acopio, y los acopios están sobre las vías.
  if (origen && acopios.length > 0) {
    const t = rutearRastro(g, [[origen.lat, origen.lon], [acopios[0].lat, acopios[0].lon]], RADIO_ORIGEN_M);
    if (t[0]) trayectos.push(deTramo(t[0]));
  }

  for (let i = 1; i < acopios.length; i++) {
    const t = rutearRastro(g, [
      [acopios[i - 1].lat, acopios[i - 1].lon],
      [acopios[i].lat, acopios[i].lon],
    ]);
    if (t[0]) trayectos.push(deTramo(t[0]));
  }

  return {
    trayectos,
    metrosTotal: trayectos.reduce((s, t) => s + t.metros, 0),
    sinVia: trayectos.filter((t) => !t.porVia).length,
  };
}

/** La ruta entera como una sola polilínea, para dibujarla de un trazo. */
export function polilineaDe(ruta: RutaPropuesta): [number, number][] {
  return unirTramos(
    ruta.trayectos.map((t) => ({ latlngs: t.latlngs, porVia: t.porVia, largoM: t.metros }))
  );
}

/**
 * Distancia en línea recta de un punto a un acopio, en metros.
 *
 * Para ordenar candidatos en el selector ("los acopios más cercanos a esta
 * máquina") sin construir el grafo. Es una cota inferior de lo que va a
 * recorrer, nunca la distancia real, y por eso no se muestra como "faltan X
 * metros" en ninguna parte.
 */
export function distanciaRecta(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  return haversineM(a, b);
}

/**
 * El grafo de vías, si se puede construir.
 *
 * Reexportado para que la pantalla de despacho no tenga que importar de
 * `lib/rutas.ts` —que es el módulo del histórico— sólo para conseguirlo. Es el
 * mismo grafo y la misma caché: se arma una vez por sesión, cueste lo que
 * cueste, y lo comparten la reconstrucción y la planeación.
 */
export { grafoVias };

/* Aquí vivía `acopiosCercanos`, que devolvía los N acopios más próximos. Lo
   reemplazó `lotesCercanos` en `lib/acopios.ts`: el selector ofrece lotes, no
   puntos sueltos, y una lista de puntos cercanos repetía el mismo lote tres
   veces seguidas (ver la nota allá). */
