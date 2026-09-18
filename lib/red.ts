/**
 * La red mesh de Guaicaramo: los nodos fijos, sus enlaces y su estado.
 *
 * La fuente de verdad es Supabase (`supabase/mesh.sql`): la tabla `mesh_sites`
 * tiene las coordenadas de instalación y la vista `v_mesh_health` las combina
 * con los traceroutes que el gateway hace cada hora. Por eso corregir un pin o
 * calibrar un umbral no exige desplegar la app.
 *
 * ⚠️ AQUÍ NO VAN COORDENADAS. La ubicación de las antenas es información
 * sensible —son la infraestructura de seguridad de un predio de 10.000 ha— y
 * todo lo que se escriba en este archivo termina en el bundle que el navegador
 * descarga y en el repositorio. Este módulo define la FORMA de un sitio y cómo
 * se pinta; el dato viene de `v_mesh_health` en tiempo de ejecución.
 *
 * Consecuencia asumida: si la consulta falla, el mapa no dibuja antenas. Antes
 * había una lista de respaldo para que nunca faltaran; se quitó a propósito.
 * Entre un mapa incompleto y publicar dónde está cada repetidor, se prefiere el
 * mapa incompleto.
 *
 * La validación de las coordenadas contra las distancias del acta vive donde
 * viven los datos: la vista `v_mesh_sites_check`.
 */

/**
 * Color de identidad de la red: cian, para que no se confunda con ninguna
 * máquina (la paleta de flota no tiene cian) ni con las vías (blanco y ámbar).
 */
export const COLOR_RED = "#22d3ee";

/** Qué papel cumple el nodo en la malla. */
export type RolNodo = "gateway" | "repetidor";

/**
 * Estado del enlace, tal como lo calcula `v_mesh_health`. Los nombres son los de
 * la base a propósito: si la app tradujera el vocabulario, un cambio de umbral
 * en la vista habría que acordarlo aquí también.
 */
export type EstadoEnlace = "activa" | "sin_respuesta" | "inactiva" | "sin_datos";

/** Una fila de `v_mesh_health`: el sitio con su estado. */
export interface SitioRed {
  site_id: string;
  node_id: string | null;
  site_name: string;
  role: RolNodo;
  lat: number | null;
  lon: number | null;
  /** Distancia declarada al gateway, en metros. */
  dist_gateway_m: number | null;
  /** Novedad abierta del sitio, si la hay. */
  notes: string | null;
  estado: EstadoEnlace;
  /** Minutos desde la última señal de vida (anuncio propio o sondeo respondido). */
  min_sin_senal: number | null;
  ultimo_sondeo: string | null;
  ultimo_status: string | null;
  rtt_ms: number | null;
  hops_towards: number | null;
  /** Ruta medida del último sondeo, ej. "!9ea29bc4 --> !49b54350". */
  route_text: string | null;
  fallos_consecutivos: number;
}

/** El gateway de una lista de sitios: el centro del que cuelga la malla. */
export function gatewayDe(sitios: SitioRed[]): SitioRed | null {
  return sitios.find((s) => s.role === "gateway" && s.lat != null) ?? null;
}

/**
 * Los enlaces que se dibujan: cada repetidor contra el gateway.
 *
 * Es la topología DECLARADA —radial desde la torre— y no la medida; por eso en
 * el mapa van punteadas. Ya sabemos que difieren: el primer barrido mostró que
 * Trompillos y Cabuyarito llegan por un repetidor intermedio que el firmware ni
 * siquiera identifica. La topología real se está acumulando en `v_mesh_links` y
 * es la que reemplazará a estas líneas cuando haya muestras suficientes.
 */
export function enlacesDeclarados(
  sitios: SitioRed[]
): { desde: SitioRed; hasta: SitioRed }[] {
  const gw = gatewayDe(sitios);
  if (!gw) return [];
  return sitios
    .filter((s) => s.role !== "gateway" && s.lat != null && s.lon != null)
    .map((s) => ({ desde: gw, hasta: s }));
}

/** Etiquetas, colores y ayuda de cada estado. */
export const ENLACE_META: Record<
  EstadoEnlace,
  { label: string; color: string; ayuda: string }
> = {
  activa: {
    label: "Activa",
    color: "#0ca30c",
    ayuda: "Respondió el último sondeo, o se oyó su anuncio hace poco.",
  },
  sin_respuesta: {
    label: "Sin respuesta",
    color: "#fab219",
    ayuda:
      "Falló uno o dos sondeos seguidos. Puede ser una colisión del canal: no se declara caída hasta el tercero.",
  },
  inactiva: {
    label: "Inactiva",
    color: "#b23b3b",
    ayuda: "Tres o más sondeos seguidos sin respuesta. Hay que ir al sitio.",
  },
  sin_datos: {
    label: "Sin datos",
    color: "#7b8794",
    ayuda:
      "Aún no se ha sondeado, o no llegó la consulta de estado. Está instalada; si reporta, no se sabe.",
  },
};

/**
 * El meta de un estado, tolerando valores que la app todavía no conoce.
 *
 * Los umbrales y el vocabulario viven en `v_mesh_health` justamente para poder
 * cambiarlos sin desplegar; el precio es que la base puede devolver un estado
 * nuevo antes de que esta app sepa de él. Cae a "sin datos" —gris, honesto— en
 * vez de romper el mapa por un `undefined.color`.
 */
export function metaDe(estado: string): (typeof ENLACE_META)[EstadoEnlace] {
  return ENLACE_META[estado as EstadoEnlace] ?? ENLACE_META.sin_datos;
}

/** Distancia legible para la ficha del sitio. */
export function fmtDistKm(m: number | null): string {
  if (m == null) return "—";
  return `${(m / 1000).toFixed(2).replace(".", ",")} km`;
}
