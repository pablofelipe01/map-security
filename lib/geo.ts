import type {
  EnrichedPoint,
  StationaryStint,
  TrackPoint,
  TrackStats,
} from "./types";

export const BOGOTA_TZ = "America/Bogota";

/** Centro por defecto: zona Guaicaramo, Colombia. */
export const DEFAULT_CENTER = { lat: 4.48, lng: -72.95 };

const R = 6371000; // radio terrestre en metros
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
 * Agrupa rachas consecutivas de `is_stationary=true` en "paradas".
 * El tiempo de permanencia suma `min_since_prev_fix` de la racha.
 */
export function computeStationaryStints(
  points: EnrichedPoint[]
): StationaryStint[] {
  const stints: StationaryStint[] = [];
  let cur: EnrichedPoint[] | null = null;

  const flush = () => {
    if (!cur || cur.length === 0) return;
    const startPoint = cur[0];
    const endPoint = cur[cur.length - 1];
    // sumamos los minutos de permanencia de la racha (incluye el primero
    // que entró en quietud usando su min_since_prev_fix si existe).
    const totalMinutes = cur.reduce(
      (acc, p) => acc + (p.min_since_prev_fix ?? 0),
      0
    );
    stints.push({
      startIndex: startPoint.index,
      endIndex: endPoint.index,
      lat: endPoint.lat,
      lon: endPoint.lon,
      totalMinutes,
      startPoint,
      endPoint,
    });
    cur = null;
  };

  for (const p of points) {
    if (p.is_stationary) {
      if (!cur) cur = [];
      cur.push(p);
    } else {
      flush();
    }
  }
  flush();
  return stints;
}

/** Stats agregadas del recorrido para el HUD. */
export function computeStats(points: EnrichedPoint[]): TrackStats {
  if (points.length === 0) {
    return {
      totalPoints: 0,
      totalDistanceM: 0,
      stops: 0,
      movingMinutes: 0,
      stationaryMinutes: 0,
      startTime: null,
      endTime: null,
      batteryLevel: null,
      maxSpeed: null,
    };
  }

  let dist = 0;
  let movingMin = 0;
  let stationaryMin = 0;
  let maxSpeed: number | null = null;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    if (prev) {
      // distancia: usa dist_prev_fix_m del backend si está, si no Haversine.
      dist += p.dist_prev_fix_m ?? haversineM(prev, p);
    }
    const mins = p.min_since_prev_fix ?? 0;
    if (p.is_stationary) stationaryMin += mins;
    else movingMin += mins;

    if (p.ground_speed != null) {
      maxSpeed = maxSpeed == null ? p.ground_speed : Math.max(maxSpeed, p.ground_speed);
    }
  }

  const stints = computeStationaryStints(points);
  const battery = [...points].reverse().find((p) => p.battery_level != null);

  return {
    totalPoints: points.length,
    totalDistanceM: dist,
    stops: stints.length,
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

/** "hace X min" relativo a ahora. */
export function fmtAgo(iso: string | null): string {
  if (!iso) return "—";
  const diffMs = Date.now() - new Date(iso).getTime();
  const min = Math.round(diffMs / 60000);
  if (min < 1) return "ahora";
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `hace ${h}h ${m}m`;
  const d = Math.floor(h / 24);
  return `hace ${d}d`;
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

/** Punto cardinal desde un rumbo en grados. */
export function compass(deg: number | null): string {
  if (deg == null) return "—";
  const dirs = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return dirs[Math.round(deg / 45) % 8];
}

/** Valor o guion para nullables. */
export function orDash(
  v: number | string | null | undefined,
  suffix = "",
  digits?: number
): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && digits != null) return `${v.toFixed(digits)}${suffix}`;
  return `${v}${suffix}`;
}
