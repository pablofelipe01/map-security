import { supabase } from "./supabase";
import type { NodeRow, TrackPoint, Estadia, FleetItem } from "./types";
import { derivarEstado, FILAS_POR_NODO } from "./fleet";
import { dayRange, bogotaDay, shiftDay } from "./ranges";
import type { SitioRed } from "./red";

const TRACK_COLUMNS =
  "id,node_id,sample_local,gps_time,lat,lon,alt_m,ground_speed," +
  "ground_track_deg,sats,pdop,rx_rssi,snr,rx_snr,hops_away,battery_level,voltage," +
  "nuevo_fix,dist_prev_fix_m,min_since_prev_fix,is_stationary," +
  "es_outlier,en_estadia,spread_ventana_m";

/**
 * Tamaño de página al leer la vista de recorrido.
 *
 * PostgREST corta las respuestas en 1000 filas por defecto y NO avisa: devuelve
 * las primeras 1000 en silencio. Con una ventana de 14 días y un nodo que
 * reporta ~100 fixes diarios eso truncaba la serie justo en los días más
 * recientes —los que importan— y las gráficas mostraban ceros creíbles. Por eso
 * toda lectura de recorrido pagina explícitamente.
 */
const PAGE = 1000;

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
 * Rastro de un tractor en un rango (para la polyline).
 *
 * Filtra sólo lo que es ruido o no es un fix:
 *   nuevo_fix = true   → sólo fixes GPS reales (el 81% de las filas repiten posición)
 *   es_outlier = false → descarta saltos que ensucian la línea
 *
 * NO se filtra `en_estadia`. La versión anterior lo hacía (`en_estadia=false`) y
 * eso borraba recorrido real: en la data del nodo 0d77, 4 de 9 fixes en
 * movimiento —uno con 84 m en 8.6 min e `is_stationary=false`— vienen marcados
 * `en_estadia=true`, así que la mitad del trayecto no se dibujaba. Para un
 * vigilante quieto apenas se notaba; para un tractor en labor es el dato
 * central. Las estadías se siguen pintando encima como pines, con lo que el
 * resultado es completo y además legible.
 */
export async function fetchTrack(
  nodeId: string,
  fromISO: string,
  toISO: string
): Promise<TrackPoint[]> {
  const out: TrackPoint[] = [];

  // Se pagina hasta que una página vuelva incompleta: así una ventana larga
  // (la serie de 14 días del universo de máquina) no se queda muda en el tope
  // de 1000 filas de PostgREST.
  for (let desde = 0; ; desde += PAGE) {
    const { data, error } = await supabase
      .from("v_node_track")
      .select(TRACK_COLUMNS)
      .eq("node_id", nodeId)
      .eq("nuevo_fix", true)
      .eq("es_outlier", false)
      .not("lat", "is", null)
      .gte("sample_local", fromISO)
      .lte("sample_local", toISO)
      .order("sample_local", { ascending: true })
      .range(desde, desde + PAGE - 1);

    if (error) throw error;
    const pagina = (data ?? []) as unknown as TrackPoint[];
    out.push(...pagina);
    if (pagina.length < PAGE) return out;
  }
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
    .order("desde", { ascending: true })
    .range(0, PAGE - 1);

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
 * Últimas filas del poller de un nodo, de la más reciente a la más antigua.
 *
 * Se leen varias (no sólo una) porque con una sola fila es imposible saber si
 * el tractor se movió: hace falta el fix real anterior para medir
 * desplazamiento y velocidad. No se filtra `nuevo_fix` ni `lat`: las filas sin
 * posición son justamente la evidencia de que el nodo está callado, y
 * `derivarEstado` las necesita para distinguir el latido del poller de la
 * posición real.
 */
async function fetchUltimasFilas(
  nodeId: string,
  limite = FILAS_POR_NODO
): Promise<TrackPoint[]> {
  const { data, error } = await supabase
    .from("v_node_track")
    .select(TRACK_COLUMNS)
    .eq("node_id", nodeId)
    .order("sample_local", { ascending: false })
    .limit(limite);

  if (error) throw error;
  return (data ?? []) as unknown as TrackPoint[];
}

/**
 * Último fix GPS real de un nodo SIN límite de tiempo.
 *
 * Sólo se consulta cuando la ventana reciente no trae ninguno, para poder
 * reportar "último fix hace 117 días" en lugar de un vacío. Es el caso real del
 * nodo 97b7, cuya posición quedó congelada el 16-may.
 */
async function fetchUltimoFixHistorico(
  nodeId: string
): Promise<TrackPoint | null> {
  const { data, error } = await supabase
    .from("v_node_track")
    .select(TRACK_COLUMNS)
    .eq("node_id", nodeId)
    .eq("nuevo_fix", true)
    .eq("es_outlier", false)
    .not("lat", "is", null)
    .order("sample_local", { ascending: false })
    .limit(1);

  if (error) throw error;
  return ((data ?? [])[0] as unknown as TrackPoint) ?? null;
}

/**
 * Estado actual de toda la flota (la vista de torre de control).
 *
 * Una consulta por nodo en paralelo: la flota es de unos pocos nodos y postgrest
 * no expone DISTINCT ON. Un nodo que falle entra con estado `sin_gps` en vez de
 * tumbar la vista completa — es normal que un nodo recién dado de alta no tenga
 * fix, y un supervisor prefiere ver 5 tractores y un error que una pantalla en
 * blanco.
 */
export async function fetchFleet(nodes: NodeRow[]): Promise<FleetItem[]> {
  return Promise.all(
    nodes.map(async (node) => {
      try {
        const filas = await fetchUltimasFilas(node.node_id);
        const hayFixReciente = filas.some((f) => f.nuevo_fix && f.lat != null);
        const historico = hayFixReciente
          ? null
          : await fetchUltimoFixHistorico(node.node_id).catch(() => null);
        return { node, ...derivarEstado(filas, historico) };
      } catch {
        return {
          node,
          estado: "sin_gps" as const,
          posicion: null,
          edadFixMin: null,
          latidoPoller: null,
          desplazamientoM: null,
          velocidadKmh: null,
          rumbo: null,
          fixesEnVentana: 0,
          fixConfirmado: false,
        };
      }
    })
  );
}

/**
 * Recorrido de TODAS las máquinas en un día (vista HISTÓRICO).
 *
 * Una consulta por nodo en paralelo. Un nodo que falle entra con la lista de
 * puntos vacía en vez de tumbar la vista: en esta flota es normal que varios
 * nodos no reporten nada, y el supervisor necesita ver los que sí.
 */
export async function fetchTracksDay(
  nodes: NodeRow[],
  dateStr: string
): Promise<{ node: NodeRow; points: TrackPoint[] }[]> {
  const { fromISO, toISO } = dayRange(dateStr);
  return Promise.all(
    nodes.map(async (node) => ({
      node,
      points: await fetchTrack(node.node_id, fromISO, toISO).catch(() => []),
    }))
  );
}

/**
 * Fixes de un nodo en los últimos `dias` días, agrupados por día de Bogotá.
 *
 * Se trae la ventana completa en UNA consulta y se agrupa en el cliente, en vez
 * de hacer una consulta por día: son 14 viajes de red menos y el volumen es
 * trivial (un nodo produce ~144 filas/día y aquí sólo vienen los fixes reales).
 *
 * `hasta` cierra la ventana en un día distinto de hoy: así el universo abierto
 * desde el histórico del 3 de marzo habla de las dos semanas que terminan ese
 * día, y no de las dos que terminan hoy —que es la ventana de otra pregunta—.
 */
export async function fetchDailySeries(
  nodeId: string,
  dias = 14,
  hasta?: string
): Promise<{ date: string; points: TrackPoint[] }[]> {
  const hoy =
    hasta ??
    new Date().toLocaleDateString("sv-SE", {
      timeZone: "America/Bogota",
    });
  const desde = shiftDay(hoy, -(dias - 1));
  const { fromISO } = dayRange(desde);
  const { toISO } = dayRange(hoy);

  const puntos = await fetchTrack(nodeId, fromISO, toISO);

  // Se siembran los 14 días aunque estén vacíos: un hueco en la gráfica es
  // información (ese día la máquina no reportó), y sin sembrarlos las barras
  // se correrían y el eje mentiría.
  const buckets = new Map<string, TrackPoint[]>();
  for (let i = dias - 1; i >= 0; i--) buckets.set(shiftDay(hoy, -i), []);
  for (const p of puntos) {
    const d = bogotaDay(p.sample_local);
    buckets.get(d)?.push(p);
  }
  return [...buckets.entries()].map(([date, points]) => ({ date, points }));
}

/**
 * Detenciones de todas las máquinas en un día.
 *
 * Va aparte de `fetchTracksDay` porque las estadías las calcula el backend en
 * su propia vista: aquí no se re-deriva "estuvo quieto" a partir de los fixes,
 * que es justo el cálculo que el backend ya hace mejor (agrupa por ventana).
 */
export async function fetchEstadiasDay(
  nodes: NodeRow[],
  dateStr: string
): Promise<Record<string, Estadia[]>> {
  const { fromISO, toISO } = dayRange(dateStr);
  const pares = await Promise.all(
    nodes.map(
      async (n) =>
        [
          n.node_id,
          await fetchEstadias(n.node_id, fromISO, toISO).catch(() => []),
        ] as const
    )
  );
  return Object.fromEntries(pares);
}

/**
 * Estado de la red mesh: una fila por sitio (ver `supabase/mesh.sql`).
 *
 * Va aparte del resto de consultas y con su propio manejo de error porque es
 * información de infraestructura, no de flota: que las tablas de la malla no
 * existan todavía —o que la consulta falle— no puede dejar el mapa sin
 * máquinas. Si falla, el mapa se queda sin antenas: no hay lista de respaldo
 * en el código a propósito — ver `lib/red.ts`.
 */
export async function fetchRedMesh(): Promise<SitioRed[]> {
  const { data, error } = await supabase
    .from("v_mesh_health")
    .select(
      "site_id,node_id,site_name,role,lat,lon,dist_gateway_m,notes,estado," +
        "min_sin_senal,ultimo_sondeo,ultimo_status,rtt_ms,hops_towards," +
        "route_text,fallos_consecutivos"
    )
    .order("site_name");

  if (error) throw error;
  // `as unknown` como en el resto del archivo: con la lista de columnas armada
  // por concatenación, supabase-js no puede inferir la forma de la fila.
  return (data ?? []) as unknown as SitioRed[];
}
