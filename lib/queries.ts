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
 * Última posición REAL de un nodo (marcador "en vivo"), sin importar el rango.
 *
 * IMPORTANTE: NO filtra `nuevo_fix` ni `is_stationary`. El marcador de posición
 * actual SIEMPRE debe mostrar el último punto conocido y su hora, aunque el nodo
 * esté parado/silencioso. En esta data el ~81% de las filas son `nuevo_fix=false`
 * (el poller corrió pero el nodo no reportó posición nueva → repiten la última
 * posición); filtrarlas dejaría el marcador anclado a un fix viejo y el
 * "hace X min" mentiría. El filtro `nuevo_fix` solo aplica al RASTRO (fetchTrack),
 * nunca al marcador en vivo. Seguimos leyendo la vista para conservar los campos
 * derivados (is_stationary, dist_prev_fix…) que usa el popup de detalle.
 */
export async function fetchLatest(nodeId: string): Promise<TrackPoint | null> {
  const { data, error } = await supabase
    .from("v_node_track")
    .select(TRACK_COLUMNS)
    .eq("node_id", nodeId)
    .not("lat", "is", null) // solo descarta filas sin posición (no aplica a esta data)
    .order("sample_local", { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data ?? [])[0] as unknown as TrackPoint) ?? null;
}
