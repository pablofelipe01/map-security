import { supabase } from "./supabase";
import type { NodeRow, TrackPoint, Estadia, NodeLatest } from "./types";

const TRACK_COLUMNS =
  "id,node_id,sample_local,gps_time,lat,lon,alt_m,ground_speed," +
  "ground_track_deg,sats,pdop,rx_rssi,snr,rx_snr,hops_away,battery_level,voltage," +
  "nuevo_fix,dist_prev_fix_m,min_since_prev_fix,is_stationary," +
  "es_outlier,en_estadia,spread_ventana_m";

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
 * Rastro de MOVIMIENTO REAL de un nodo en un rango (para la polyline).
 *
 * Filtra fixes reales que además NO son ruido y NO caen dentro de una estadía:
 *   nuevo_fix = true            → solo fixes GPS reales
 *   es_outlier = false          → descarta saltos/ruido que ensucian la línea
 *   en_estadia = false          → los puntos "quieto" ya son pines (v_node_estadias)
 * Así la línea dibuja únicamente el trayecto entre lugares, sin marañas en las paradas.
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
    .eq("es_outlier", false)
    .eq("en_estadia", false)
    .gte("sample_local", fromISO)
    .lte("sample_local", toISO)
    .order("sample_local", { ascending: true });

  if (error) throw error;
  return (data ?? []) as unknown as TrackPoint[];
}

/**
 * Estadías ("estuvo aquí") de un nodo que solapan el rango visible.
 * Cada fila es un pin ya calculado por el backend (lat_pin/lon_pin + duración).
 * Solape: la estadía empieza antes del fin del rango y termina después del inicio.
 */
export async function fetchEstadias(
  nodeId: string,
  fromISO: string,
  toISO: string
): Promise<Estadia[]> {
  const { data, error } = await supabase
    .from("v_node_estadias")
    .select("node_id,desde,hasta,minutos,n_fixes,lat_pin,lon_pin")
    .eq("node_id", nodeId)
    .lte("desde", toISO)
    .gte("hasta", fromISO)
    .order("desde", { ascending: true });

  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    node_id: r.node_id,
    desde: r.desde,
    hasta: r.hasta,
    minutos: Number(r.minutos),
    n_fixes: Number(r.n_fixes),
    lat: Number(r.lat_pin),
    lon: Number(r.lon_pin),
  }));
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

/**
 * Última posición de CADA nodo, para la vista "Todos los nodos".
 *
 * Hace una consulta por nodo en paralelo en vez de un DISTINCT ON: postgrest no
 * expone DISTINCT ON y la flota es de unos pocos nodos, así que el costo es
 * trivial. Si algún día crece, esto se reemplaza por una vista `node_latest`
 * en el backend y una sola consulta.
 *
 * Un nodo que falla o no reporta posición entra con `latest: null` en vez de
 * tumbar toda la vista: es normal que un nodo recién dado de alta no tenga fix.
 */
export async function fetchOverview(nodes: NodeRow[]): Promise<NodeLatest[]> {
  return Promise.all(
    nodes.map(async (node) => ({
      node,
      latest: await fetchLatest(node.node_id).catch(() => null),
    }))
  );
}
