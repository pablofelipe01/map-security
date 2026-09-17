import { bearingDeg, BOGOTA_TZ } from "./geo";
import { MOVIMIENTO_M } from "./fleet";
import { posicionEnTramo, type Tramo } from "./rutas";
import type { TrackPoint } from "./types";
import type { ReplayPos } from "@/components/MapGL";

/**
 * Hasta qué hueco entre fixes se interpola la posición del replay (min).
 *
 * Este es el punto donde el patrón SiriusFleet no se puede copiar tal cual. Su
 * demo recibe telemetría cada 3 s e interpola huecos de hasta 10 min; con la
 * data real, donde CASI TODOS los huecos son de ~9-10 min, esa regla dejaría el
 * replay como una serie de saltos secos: la máquina aparecería y desaparecería
 * en vez de recorrer.
 *
 * Se sube a 20 min (≈2 ciclos del poller) para que el marcador se deslice por
 * el mismo segmento recto que la polilínea ya dibuja. Eso NO agrega
 * información: entre dos fixes nadie sabe por dónde pasó la máquina, y la línea
 * recta es una suposición. Se acepta porque el rastro ya la muestra y porque un
 * replay a saltos no se puede leer — pero la barra lo dice en pantalla, para
 * que nadie confunda el deslizamiento con una medición.
 *
 * Pasado el umbral, el marcador se queda quieto en el último fix conocido en
 * lugar de inventar un trayecto a través de un silencio largo.
 */
export const GAP_INTERPOLA_MIN = 20;

/** Minuto del día (0-1439) en hora de Bogotá al que corresponde un instante. */
export function minuteOfDay(iso: string): number {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("es-CO", {
    timeZone: BOGOTA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get("hour") % 24) * 60 + get("minute") + get("second") / 60;
}

/** Punto con su minuto del día precalculado (se memoiza sobre el objeto). */
type Timed = TrackPoint & { _m?: number };

function minutoDe(p: Timed): number {
  // Memoizado porque el replay evalúa los mismos puntos ~8 veces por segundo y
  // formatToParts es costoso.
  return (p._m ??= minuteOfDay(p.gps_time ?? p.sample_local));
}

/**
 * Posición de una máquina en un minuto del día.
 *
 * Devuelve null sólo si ese día no hubo un solo fix: sin ninguna coordenada de
 * la fecha no hay nada honesto que dibujar.
 *
 * Fuera de la jornada —antes del primer fix o después del último— la máquina
 * sigue en el mapa, parada en el extremo que corresponde y marcada con
 * `fuera: true`. Ahí no se está diciendo dónde estaba a esa hora, que es algo
 * que nadie sabe: se está diciendo "esta máquina existe ese día, y su jornada
 * empieza acá". El marcador se dibuja atenuado justamente para que la
 * diferencia se vea, en vez de desaparecer y dejar el mapa hablando de una
 * flota más chica de la que hubo.
 */
export function positionAt(
  points: TrackPoint[],
  minute: number,
  tramos?: Tramo[] | null
): Omit<ReplayPos, "nodeId"> | null {
  if (points.length === 0) return null;

  let prev: Timed | null = null;
  let next: Timed | null = null;
  let iPrev = -1;
  for (let i = 0; i < points.length; i++) {
    const p = points[i] as Timed;
    if (minutoDe(p) <= minute) {
      prev = p;
      iPrev = i;
    } else {
      next = p;
      break;
    }
  }

  const quieto = (
    p: Timed,
    ref: Timed | null,
    fuera = false
  ): Omit<ReplayPos, "nodeId"> => ({
    lat: p.lat,
    lon: p.lon,
    rumbo: ref ? bearingDeg(ref, p) : null,
    moviendo: false,
    fuera,
  });

  // Todavía no arranca la jornada: espera en su primer fix, atenuada.
  if (!prev) {
    const primero = points[0] as Timed;
    return quieto(primero, null, true);
  }

  const anterior = iPrev > 0 ? (points[iPrev - 1] as Timed) : null;

  // Ya terminó la jornada: se queda en el último fix, atenuada.
  if (!next) return quieto(prev, anterior, true);

  const a = minutoDe(prev);
  const b = minutoDe(next);
  const hueco = b - a;

  // Silencio largo: no se inventa trayecto.
  if (hueco > GAP_INTERPOLA_MIN) return quieto(prev, anterior);

  const f = hueco > 0 ? (minute - a) / hueco : 0;
  const distM = next.dist_prev_fix_m ?? null;
  // "Moviendo" se decide por el desplazamiento del tramo, no por
  // `ground_speed`, igual que en el resto de la app.
  const moviendo = (distM ?? 0) >= MOVIMIENTO_M;

  // Si el tramo se pudo reconstruir por la malla vial, el marcador recorre esa
  // polilínea en vez de cruzar el lote en diagonal: es el mismo trayecto que ya
  // está dibujado debajo, así que el ícono va por donde va el rastro y gira en
  // las curvas. Sigue siendo una hipótesis —ver lib/rutas.ts—, sólo que ahora es
  // la hipótesis razonable en lugar de la recta imposible.
  const tramo = tramos?.[iPrev];
  if (tramo?.porVia && tramo.largoM > 0) {
    const pos = posicionEnTramo(tramo, f);
    return {
      lat: pos.lat,
      lon: pos.lon,
      rumbo: pos.rumbo,
      moviendo,
      fuera: false,
    };
  }

  return {
    lat: prev.lat + (next.lat - prev.lat) * f,
    lon: prev.lon + (next.lon - prev.lon) * f,
    rumbo: bearingDeg(prev, next),
    moviendo,
    fuera: false,
  };
}

/** Rango de minutos con datos: evita arrastrar el slider por horas vacías. */
export function ventanaConDatos(
  tracks: { points: TrackPoint[] }[]
): { desde: number; hasta: number } | null {
  let desde = Infinity;
  let hasta = -Infinity;
  for (const t of tracks) {
    for (const p of t.points as Timed[]) {
      const m = minutoDe(p);
      if (m < desde) desde = m;
      if (m > hasta) hasta = m;
    }
  }
  if (!Number.isFinite(desde)) return null;
  return { desde: Math.floor(desde), hasta: Math.ceil(hasta) };
}
