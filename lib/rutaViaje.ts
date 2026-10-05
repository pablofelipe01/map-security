/**
 * La vuelta de un renglón de la planilla: de la planta a los acopios y de
 * regreso, por las vías, con un tiempo estimado.
 *
 * QUÉ RECORRIDO SE SUPONE. El renglón dice dónde están los vagones llenos y,
 * a veces, dónde dejar uno vacío. El tractor sale de la planta, deja el vacío
 * (si hay), engancha los llenos y vuelve:
 *
 *     Planta → vacío → llenos → Planta      (con ubicación de vagones)
 *     Planta → llenos → Planta              (sólo recoger)
 *
 * Lo de ida va hasta los llenos; la vuelta es lo que se hace cargado.
 *
 * EL TIEMPO ES UNA SUPOSICIÓN, Y LA PANTALLA LO DICE. `lib/planeacion.ts`
 * explica por qué la app no convierte metros en minutos: no mide la velocidad
 * de nadie. Acá se hace igual porque Logística lo pidió, pero con velocidades
 * que la persona ve y puede cambiar (`ParametrosVuelta`), no con un número
 * escondido. Si el tiempo sale mal, el arreglo está a la vista.
 *
 * La distancia sí sale de la malla: es el mismo ruteo de `lib/rutas.ts` que usa
 * la planeación, con las mismas abstenciones. Un trayecto que no se pudo
 * resolver por vías queda en recta y marcado (`porVia: false`), y suma metros
 * que no son de verdad: la pantalla lo avisa.
 */

import { MOVIMIENTO_M } from "./fleet";
import { haversineM } from "./geo";
import { RADIO_ORIGEN_M } from "./planeacion";
import { rutearRastro, type Grafo } from "./rutas";
import type { Viaje } from "./vagones";

/* ============================== la planta ============================== */

/**
 * De dónde sale y a dónde vuelve cada tractor.
 *
 * null mientras nadie la haya ubicado: la planilla sigue funcionando y la
 * columna de ruta dice que falta la planta, en vez de rutear desde un punto
 * inventado.
 */
export const PLANTA: { lat: number; lon: number; nombre: string } | null = {
  // 4°28'37.22"N 72°57'40.76"W
  lat: 4.477006,
  lon: -72.961322,
  nombre: "Planta",
};

/* ============================== tiempos ============================== */

/** Lo que convierte metros en minutos. Todo es supuesto y todo es editable. */
export interface ParametrosVuelta {
  /** Velocidad media yendo, con el tractor suelto o con el vagón vacío (km/h). */
  velIdaKmh: number;
  /** Velocidad media volviendo con los vagones llenos (km/h). */
  velVueltaKmh: number;
  /** Desenganchar y dejar el vagón vacío (min). */
  minDejarVacio: number;
  /** Enganchar los vagones llenos (min). */
  minEnganche: number;
}

/**
 * Valores de arranque, hasta que Logística ponga los suyos.
 *
 * Un tractor con vagón por vía balastrada anda a 15-20 km/h suelto y bastante
 * menos cargado; las maniobras son del orden de minutos. Son un punto de
 * partida razonable, no una medición.
 */
export const PARAMETROS_POR_DEFECTO: ParametrosVuelta = {
  velIdaKmh: 18,
  velVueltaKmh: 12,
  minDejarVacio: 5,
  minEnganche: 10,
};

/** Clave de localStorage: los parámetros son preferencia de quien despacha. */
export const CLAVE_PARAMETROS = "despacho.parametrosVuelta";

/** Acepta lo guardado sólo si cada campo es un número positivo. */
export function parametrosValidos(x: unknown): ParametrosVuelta | null {
  if (!x || typeof x !== "object") return null;
  const o = x as Record<string, unknown>;
  const r = { ...PARAMETROS_POR_DEFECTO };
  for (const k of Object.keys(r) as (keyof ParametrosVuelta)[]) {
    const v = o[k];
    if (v === undefined) continue;
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return null;
    r[k] = v;
  }
  // Velocidad cero es una división por cero, no un tractor quieto.
  if (r.velIdaKmh <= 0 || r.velVueltaKmh <= 0) return null;
  return r;
}

/* ============================== ruta ============================== */

export type SentidoTramo = "ida" | "vuelta";

/** Un salto de la vuelta: de la planta al vacío, del vacío a los llenos… */
export interface TramoVuelta {
  sentido: SentidoTramo;
  desde: string;
  hasta: string;
  latlngs: [number, number][];
  metros: number;
  /** false = no se resolvió por vías y es la recta entre los dos puntos. */
  porVia: boolean;
  /** Minutos andando, sin maniobras. */
  minutos: number;
}

/** Un punto donde para el tractor, para numerarlo en el mapa. */
export interface PuntoVuelta {
  lat: number;
  lon: number;
  rotulo: string;
  codigo: string;
  tipo: "planta" | "vacio" | "llenos";
}

export interface RutaVuelta {
  tramos: TramoVuelta[];
  puntos: PuntoVuelta[];
  metrosIda: number;
  metrosVuelta: number;
  /** Andando, ida. */
  minIda: number;
  /** Andando, vuelta. */
  minVuelta: number;
  /** Desenganche del vacío más enganche de los llenos. */
  minManiobras: number;
  /** Todo junto: lo que tarda desde que sale hasta que vuelve. */
  minTotal: number;
  /** Cuántos tramos quedaron en recta. */
  sinVia: number;
  /** El renglón pide dejar un vacío en un acopio sin coordenada: no se ruteó. */
  vacioSinUbicar: boolean;
}

/** Por qué un renglón no tiene ruta. */
export type SinRuta = "sin_planta" | "sin_grafo" | "llenos_sin_ubicar";

export type ResultadoRuta =
  | { ok: true; ruta: RutaVuelta }
  | { ok: false; motivo: SinRuta };

export const MOTIVO_SIN_RUTA: Record<SinRuta, string> = {
  sin_planta: "Falta ubicar la planta",
  sin_grafo: "No cargaron las vías",
  llenos_sin_ubicar: "Acopio sin coordenada",
};

const ubicado = (lat: number | null, lon: number | null) =>
  lat !== null && lon !== null && Number.isFinite(lat) && Number.isFinite(lon);

/**
 * Rutea la vuelta completa de un renglón.
 *
 * El vacío se salta si su acopio está "por ubicar" (sin coordenada): la vuelta
 * se calcula igual hasta los llenos, que es el viaje que de verdad importa, y
 * el panel lo dice. Si los que no tienen coordenada son los llenos, no hay
 * vuelta que calcular.
 */
export function rutaDeViaje(
  g: Grafo | null,
  v: Viaje,
  p: ParametrosVuelta,
  planta = PLANTA
): ResultadoRuta {
  if (!planta) return { ok: false, motivo: "sin_planta" };
  if (!g) return { ok: false, motivo: "sin_grafo" };
  if (!ubicado(v.origen_lat, v.origen_lon)) {
    return { ok: false, motivo: "llenos_sin_ubicar" };
  }

  const puntos: PuntoVuelta[] = [
    { lat: planta.lat, lon: planta.lon, rotulo: "P", codigo: planta.nombre, tipo: "planta" },
  ];
  const dejaVacio = !!v.destino_acopio_id && ubicado(v.destino_lat, v.destino_lon);
  // Vacío y llenos en el mismo acopio (pasa: "4·19 → 4·19") es UNA parada con
  // dos maniobras, no un tramo de 0 m que el ruteo deja en recta y que haría
  // avisar de una aproximación que no existe.
  const vacioAparte =
    dejaVacio &&
    haversineM(
      { lat: v.destino_lat!, lon: v.destino_lon! },
      { lat: v.origen_lat, lon: v.origen_lon }
    ) >= MOVIMIENTO_M;
  if (vacioAparte) {
    puntos.push({
      lat: v.destino_lat!,
      lon: v.destino_lon!,
      rotulo: String(puntos.length),
      codigo: v.destino_codigo ?? "Vacío",
      tipo: "vacio",
    });
  }
  puntos.push({
    lat: v.origen_lat,
    lon: v.origen_lon,
    rotulo: String(puntos.length),
    codigo: v.origen_codigo,
    tipo: "llenos",
  });

  const tramos: TramoVuelta[] = [];
  const paradas = [...puntos, puntos[0]];
  for (let i = 1; i < paradas.length; i++) {
    const a = paradas[i - 1];
    const b = paradas[i];
    // La planta puede quedar a un costado de la malla (patio, báscula): se le
    // abre el radio de anclaje como a la posición de una máquina en la
    // planeación. Entre acopios basta el radio de siempre.
    const radio = a.tipo === "planta" || b.tipo === "planta" ? RADIO_ORIGEN_M : undefined;
    const [t] = rutearRastro(g, [[a.lat, a.lon], [b.lat, b.lon]], radio);
    if (!t) continue;
    const sentido: SentidoTramo = a.tipo === "llenos" ? "vuelta" : "ida";
    const vel = sentido === "ida" ? p.velIdaKmh : p.velVueltaKmh;
    tramos.push({
      sentido,
      desde: a.codigo,
      hasta: b.codigo,
      latlngs: t.latlngs,
      metros: t.largoM,
      porVia: t.porVia,
      minutos: (t.largoM / 1000 / vel) * 60,
    });
  }

  const suma = (s: SentidoTramo, k: "metros" | "minutos") =>
    tramos.filter((t) => t.sentido === s).reduce((acc, t) => acc + t[k], 0);

  const minManiobras =
    p.minEnganche + (dejaVacio ? p.minDejarVacio : 0);
  const minIda = suma("ida", "minutos");
  const minVuelta = suma("vuelta", "minutos");

  return {
    ok: true,
    ruta: {
      tramos,
      puntos,
      metrosIda: suma("ida", "metros"),
      metrosVuelta: suma("vuelta", "metros"),
      minIda,
      minVuelta,
      minManiobras,
      minTotal: minIda + minVuelta + minManiobras,
      sinVia: tramos.filter((t) => !t.porVia).length,
      vacioSinUbicar:
        !!v.destino_acopio_id && !ubicado(v.destino_lat, v.destino_lon),
    },
  };
}

/**
 * Hora estimada de regreso a la planta, si ya salió.
 *
 * Sin salida no hay desde dónde contar: la columna muestra sólo la duración.
 */
export function regresoEstimado(v: Viaje, r: RutaVuelta): string | null {
  if (!v.salida_en) return null;
  return new Date(new Date(v.salida_en).getTime() + r.minTotal * 60000).toISOString();
}

/** Kilómetros con un decimal: "12,4 km". */
export function fmtKm(m: number): string {
  return `${(m / 1000).toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 1 })} km`;
}
