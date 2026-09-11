import type { EnrichedPoint, Estadia, TrackPoint, TrackStats } from "./types";

export const BOGOTA_TZ = "America/Bogota";

/** Centro por defecto: zona Guaicaramo, Colombia. */
export const DEFAULT_CENTER = { lat: 4.48, lng: -72.95 };

const R = 6371000; // radio terrestre en metros

/**
 * Desplazamiento mínimo de un tramo para contarlo como labor (m).
 * Mismo umbral que usa el backend en `is_stationary`. Vive aquí duplicado y no
 * importado de `fleet.ts` para que `geo.ts` no dependa de la capa de flota.
 */
const MOVIMIENTO_TRAMO_M = 35;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Distancia Haversine en metros entre dos coords. */
export function haversineM(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Rumbo inicial (0-360°) del punto a → b. */
export function bearingDeg(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/**
 * Enriquece los puntos crudos: índice, epoch ms y rumbo calculado.
 * Como `ground_track_deg` suele venir null, calculamos el bearing
 * del punto anterior a este (más honesto que confiar en el radio).
 */
export function enrichTrack(points: TrackPoint[]): EnrichedPoint[] {
  return points.map((p, i) => {
    const prev = points[i - 1];
    const next = points[i + 1];
    let bearing: number | null =
      p.ground_track_deg != null ? p.ground_track_deg : null;

    if (bearing == null) {
      // preferimos rumbo "hacia el siguiente"; si no hay, "desde el anterior".
      if (next) bearing = bearingDeg(p, next);
      else if (prev) bearing = bearingDeg(prev, p);
    }

    return {
      ...p,
      index: i,
      bearingDeg: bearing,
      t: new Date(p.sample_local).getTime(),
    };
  });
}

/**
 * Stats agregadas para el HUD.
 *
 * El rastro (`points`) trae TODOS los fixes reales del rango, incluidos los que
 * el tractor hizo estando quieto (antes se excluían con `en_estadia`, y eso
 * borraba recorrido de verdad). Por eso aquí hay que separar explícitamente:
 * un tramo cuenta como "en labor" sólo si hubo desplazamiento medible. Sumar
 * todos los minutos daría el turno completo y lo contaría además como
 * "detenido" vía las estadías, inflando el doble el tiempo total.
 *
 * Las detenciones y los minutos quieto vienen de `estadias` (las calcula el
 * backend agrupando fixes), no de contar fixes aquí.
 */
export function computeStats(
  points: EnrichedPoint[],
  estadias: Estadia[] = []
): TrackStats {
  const stationaryMin = estadias.reduce((acc, e) => acc + (e.minutos ?? 0), 0);
  const stops = estadias.length;

  if (points.length === 0) {
    // Sin movimiento, pero puede haber estadías (el nodo solo estuvo quieto).
    const first = estadias[0];
    const last = estadias[estadias.length - 1];
    return {
      totalPoints: 0,
      totalDistanceM: 0,
      stops,
      movingMinutes: 0,
      stationaryMinutes: stationaryMin,
      startTime: first?.desde ?? null,
      endTime: last?.hasta ?? null,
      batteryLevel: null,
      maxSpeed: null,
    };
  }

  let dist = 0;
  let movingMin = 0;
  let maxSpeed: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    if (!prev) continue;

    // distancia: usa dist_prev_fix_m del backend si está, si no Haversine.
    const tramoM = p.dist_prev_fix_m ?? haversineM(prev, p);
    const tramoMin = p.min_since_prev_fix ?? 0;

    // Sólo cuenta como labor si el tractor efectivamente se desplazó. Por
    // debajo del umbral es ruido del GPS con la máquina parada.
    if (tramoM < MOVIMIENTO_TRAMO_M) continue;

    dist += tramoM;
    movingMin += tramoMin;

    // Velocidad máxima medida (km/h), no la reportada por el radio.
    if (tramoMin > 0) {
      const kmh = tramoM / 1000 / (tramoMin / 60);
      maxSpeed = maxSpeed == null ? kmh : Math.max(maxSpeed, kmh);
    }
  }

  const battery = [...points].reverse().find((p) => p.battery_level != null);

  return {
    totalPoints: points.length,
    totalDistanceM: dist,
    stops,
    movingMinutes: movingMin,
    stationaryMinutes: stationaryMin,
    startTime: points[0].sample_local,
    endTime: points[points.length - 1].sample_local,
    batteryLevel: battery?.battery_level ?? null,
    maxSpeed,
  };
}

// ----- Formateo -----

/** Hora local Bogotá (HH:mm). */
export function fmtTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString("es-CO", {
    timeZone: BOGOTA_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** Fecha + hora local Bogotá. */
export function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("es-CO", {
    timeZone: BOGOTA_TZ,
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}


/** Distancia legible (m / km). */
export function fmtDist(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(2)} km`;
}

/** Duración en minutos → "Xh Ym" / "Z min". */
export function fmtDuration(minutes: number): string {
  const m = Math.round(minutes);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem ? `${h}h ${rem}m` : `${h}h`;
}



/** Coordenadas legibles: 5 decimales (~1 m) es todo lo que el GPS resuelve. */
export function fmtCoords(lat: number, lon: number): string {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}
