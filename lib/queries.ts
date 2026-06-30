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

/**
 * Última posición real de un nodo (marcador "en vivo").
 * Trae el fix nuevo más reciente sin importar el rango.
 */
export async function fetchLatest(nodeId: string): Promise<TrackPoint | null> {
  const { data, error } = await supabase
    .from("v_node_track")
    .select(TRACK_COLUMNS)
    .eq("node_id", nodeId)
    .eq("nuevo_fix", true)
    .order("sample_local", { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data ?? [])[0] as unknown as TrackPoint) ?? null;
}
