import { supabase } from "./supabase";
import type { NodeRow, TrackPoint } from "./types";

const TRACK_COLUMNS =
  "id,node_id,sample_local,gps_time,lat,lon,alt_m,ground_speed," +
  "ground_track_deg,sats,pdop,rx_rssi,snr,rx_snr,hops_away,battery_level,voltage," +
  "nuevo_fix,dist_prev_fix_m,min_since_prev_fix,is_stationary";

/** Lista de nodos disponibles (para el selector). */
export async function fetchNodes(): Promise<NodeRow[]> {
  const { data, error } = await supabase
    .from("nodes")
    .select("node_id,long_name,short_name,last_seen")
    .order("last_seen", { ascending: false });

  if (error) throw error;
  return (data ?? []) as NodeRow[];
}

/**
 * Recorrido LIMPIO de un nodo en un rango (para la polyline).
 * Filtra `nuevo_fix=true` (solo fixes reales) y ordena por tiempo.
 */
export async function fetchTrack(
  nodeId: string,
  fromISO: string,
  toISO: string
): Promise<TrackPoint[]> {
  const { data, error } = await supabase
    .from("v_node_track")
    .select(TRACK_COLUMNS)
    .eq("node_id", nodeId)
    .eq("nuevo_fix", true)
    .gte("sample_local", fromISO)
    .lte("sample_local", toISO)
    .order("sample_local", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as TrackPoint[];
}

// Columnas disponibles en la tabla `node_latest` (1 fila por nodo).
const LATEST_COLUMNS =
  "node_id,sample_local,gps_time,lat,lon,alt_m,sats,ground_speed," +
  "ground_track_deg,snr,battery_level,voltage,precision_bits,last_heard";

/**
 * Última posición del nodo (marcador "en vivo").
 *
 * Lee de la tabla `node_latest`, que el backend mantiene con la ÚLTIMA fila por
 * nodo (actualizada cada minuto). Aquí NO se filtra `nuevo_fix` ni `is_stationary`:
 * el marcador de posición actual SIEMPRE muestra el último punto conocido y su
 * hora, aunque el nodo esté quieto/silencioso. El filtro `nuevo_fix` solo aplica
 * al RASTRO histórico (ver `fetchTrack`), nunca al marcador en vivo.
 *
 * `node_latest` no trae los campos derivados de la vista (is_stationary,
 * dist_prev_fix…); esos son propios del histórico y no del punto "ahora", así que
 * se rellenan como null para encajar en TrackPoint.
 */
export async function fetchLatest(nodeId: string): Promise<TrackPoint | null> {
  const { data, error } = await supabase
    .from("node_latest")
    .select(LATEST_COLUMNS)
    .eq("node_id", nodeId)
    .limit(1);

  if (error) throw error;
  const row = (data ?? [])[0] as unknown as Record<string, unknown> | undefined;
  if (!row) return null;

  // Normaliza a TrackPoint (campos derivados del histórico → null).
  return {
    id: -1,
    node_id: row.node_id as string,
    sample_local: row.sample_local as string,
    gps_time: (row.gps_time as string) ?? null,
    lat: row.lat as number,
    lon: row.lon as number,
    alt_m: (row.alt_m as number) ?? null,
    ground_speed: (row.ground_speed as number) ?? null,
    ground_track_deg: (row.ground_track_deg as number) ?? null,
    sats: (row.sats as number) ?? null,
    pdop: null,
    rx_rssi: null,
    snr: (row.snr as number) ?? null,
    rx_snr: null,
    hops_away: null,
    battery_level: (row.battery_level as number) ?? null,
    voltage: (row.voltage as number) ?? null,
    nuevo_fix: true,
    dist_prev_fix_m: null,
    min_since_prev_fix: null,
    is_stationary: null,
  };
}
