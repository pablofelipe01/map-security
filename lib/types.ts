// Tipos del backend Supabase (solo lectura).
// Reflejan la vista `v_node_track` y la tabla `nodes`.

/** Una fila de la tabla `nodes` (dimensión, 1 por nodo). */
export interface NodeRow {
  node_id: string; // ej. "!86591d35"
  long_name: string | null;
  short_name: string | null;
  last_seen: string | null; // ISO UTC
}

/**
 * Un punto del recorrido (`v_node_track`).
 * Muchos campos son nullable: este nodo no manda telemetría completa,
 * y `ground_track_deg` viene null en la data real (el rumbo se computa en el front).
 */
export interface TrackPoint {
  id: number;
  node_id: string;
  sample_local: string; // ISO UTC (cuándo corrió el poller)
  gps_time: string | null; // ISO UTC (timestamp del fix GPS)
  lat: number;
  lon: number;
  alt_m: number | null; // ruidosa: solo informativa
  ground_speed: number | null; // NO confiable
  ground_track_deg: number | null; // rumbo 0-360 (suele venir null)
  sats: number | null;
  pdop: number | null;
  rx_rssi: number | null;
  snr: number | null;
  rx_snr: number | null;
  hops_away: number | null;
  battery_level: number | null;
  voltage: number | null;
  nuevo_fix: boolean; // true = fix GPS real
  dist_prev_fix_m: number | null; // metros desde el fix distinto anterior
  min_since_prev_fix: number | null; // minutos desde el fix distinto anterior
  is_stationary: boolean | null; // true = se quedó quieto (<35 m)
  es_outlier: boolean | null; // true = fix descartado por salto/ruido (no dibujar)
  en_estadia: boolean | null; // true = el fix cae dentro de una estadía (es pin, no rastro)
  spread_ventana_m: number | null; // dispersión de la ventana usada para clasificar
}

/**
 * Una "estadía" (pin "estuvo aquí") calculada por el backend en `v_node_estadias`.
 * Reemplaza al cálculo cliente de paradas: el servidor agrupa los fixes quietos
 * en un solo punto representativo (lat_pin/lon_pin) con su duración.
 */
export interface Estadia {
  node_id: string;
  desde: string; // ISO UTC — inicio de la permanencia
  hasta: string; // ISO UTC — fin de la permanencia
  minutos: number; // duración total en minutos
  n_fixes: number; // cuántos fixes reales cayeron en la estadía
  lat: number; // lat_pin (punto representativo)
  lon: number; // lon_pin
}

/** Punto enriquecido en el cliente (rumbo calculado, índice, etc.). */
export interface EnrichedPoint extends TrackPoint {
  index: number;
  /** Rumbo en grados calculado del punto anterior a este (fallback de ground_track_deg). */
  bearingDeg: number | null;
  /** Epoch ms del sample_local, para playback y gradientes. */
  t: number;
}

/**
 * Última posición conocida de un nodo, para la vista "Todos los nodos".
 * `latest` es null si el nodo existe en `nodes` pero aún no reporta posición.
 */
export interface NodeLatest {
  node: NodeRow;
  latest: TrackPoint | null;
}

/** Estado operativo derivado de un tractor. Ver `lib/fleet.ts`. */
export type TractorEstado = "activa" | "detenida" | "offline" | "sin_gps";

/**
 * Una fila de la torre de control: un tractor con su estado derivado.
 *
 * Separa a propósito tres tiempos que la data cruda mezcla:
 *  - `latidoPoller`: cuándo corrió el poller (siempre fresco, no dice nada del tractor)
 *  - `edadFixMin`: edad del último fix GPS real (esto SÍ dice dónde está el tractor)
 *  - `posicion`: la fila que se dibuja en el mapa
 */
export interface FleetItem {
  node: NodeRow;
  estado: TractorEstado;
  /** Fila con la posición a dibujar. null = nunca reportó coordenadas. */
  posicion: TrackPoint | null;
  /** Minutos desde el último fix GPS real. null = no hay fix fechado. */
  edadFixMin: number | null;
  /** Último `sample_local` visto (latido del poller, no del nodo). */
  latidoPoller: string | null;
  /** Metros entre los dos últimos fixes reales. */
  desplazamientoM: number | null;
  /** km/h calculados de distancia/tiempo (no de `ground_speed`). */
  velocidadKmh: number | null;
  /** Rumbo entre los dos últimos fixes, si hubo desplazamiento real. */
  rumbo: number | null;
  /** Cuántos fixes reales trajo la ventana leída. */
  fixesEnVentana: number;
  /** false = la posición mostrada no proviene de un fix confirmado. */
  fixConfirmado: boolean;
}

/** Stats agregadas del recorrido para el HUD. */
export interface TrackStats {
  totalPoints: number;
  totalDistanceM: number;
  stops: number;
  movingMinutes: number;
  stationaryMinutes: number;
  startTime: string | null; // ISO UTC
  endTime: string | null; // ISO UTC
  batteryLevel: number | null;
  maxSpeed: number | null;
}
