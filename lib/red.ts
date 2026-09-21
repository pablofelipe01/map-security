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
 * Color de identidad de la red: Sutileza, el azul pastel del manual de marca.
 * Es el "brillo blanco-azulado" de la estrella Sirius, y es además lo que el
 * manual pide para tecnología ("colores sutiles pasteles de la paleta"). Sobre
 * la imagen satelital contrasta sin competir con las vías (blanco y ámbar) ni
 * con ninguna máquina: la paleta de flota es de azules saturados y verdes, no
 * de pasteles.
 */
export const COLOR_RED = "#bcd7ea";

/**
 * Color de los sitios que están en OTRA red (otro protocolo de radio, fuera de
 * la malla LoRa): Azul Cielo, el azul brillante del manual.
 *
 * Es azul y no verde a propósito: ninguno de los cuatro colores de estado lo
 * usa, así que se lee de un vistazo que ese punto no lo mide este mapa. Y es el
 * Cielo y no el Barranca porque un azul oscuro a 40 px sobre imagen satelital
 * se pierde; contra el pastel de la malla (`COLOR_RED`) se distingue solo.
 */
export const COLOR_OTRA_RED = "#00a3ff";

/** Qué papel cumple el nodo en la malla. */
export type RolNodo = "gateway" | "repetidor";

/**
 * Estado del enlace, tal como lo calcula `v_mesh_health`. Los nombres son los de
 * la base a propósito: si la app tradujera el vocabulario, un cambio de umbral
 * en la vista habría que acordarlo aquí también.
 */
export type EstadoEnlace =
  | "activa"
  | "sin_respuesta"
  | "inactiva"
  | "sin_datos"
  /**
   * Está encendida, pero en otra red: habla otro protocolo y el gateway de la
   * malla no la puede sondear. No es un estado medido sino declarado, y por eso
   * se pinta distinto en vez de mentir con el verde de "activa".
   */
  | "otra_red";

/** Una fila de `v_mesh_health`: el sitio con su estado. */
export interface SitioRed {
  site_id: string;
  node_id: string | null;
  site_name: string;
  role: RolNodo;
  /**
   * A qué red pertenece el sitio. `"mesh"` es la malla LoRa que este mapa
   * sondea; cualquier otro valor es el nombre de la red ajena y se muestra tal
   * cual en la ficha. Null si la base todavía no tiene la columna.
   */
  red: string | null;
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
  otra_red: {
    label: "Otra red",
    color: COLOR_OTRA_RED,
    ayuda:
      "Encendida, pero en otra red: habla otro protocolo y esta malla no la sondea. El estado es declarado, no medido.",
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

/**
 * Sitios que están en otra red, mientras la base no lo diga.
 *
 * La fuente de verdad es `mesh_sites.red` (ver `supabase/mesh.sql`). Esto es el
 * puente para las bases a las que todavía no se les corrió ese archivo: sin él,
 * Casa Hacienda —encendida, pero hablando otro protocolo— acumula timeouts del
 * gateway y el mapa la pinta roja, que es decir "ve al sitio, se cayó" sobre una
 * antena que está funcionando.
 *
 * Qué SÍ puede vivir aquí: el slug del sitio y el nombre de su red. Lo que no
 * puede es la coordenada — por eso esto no es la lista de respaldo que se quitó
 * a propósito (ver el encabezado del archivo): si la consulta falla, este mapa
 * sigue sin dibujar antenas.
 *
 * En cuanto `mesh_sites.red` exista, el valor de la base manda y este mapa se
 * puede vaciar.
 */
export const OTRAS_REDES: Record<string, string> = {
  "casa-hacienda": "Otra red",
};

/**
 * Marca como `otra_red` los sitios de `OTRAS_REDES` que la base todavía no sabe
 * clasificar.
 *
 * Sólo actúa cuando la fila viene SIN `red`, es decir cuando la columna no
 * existe: si la base ya opina, la base gana. El estado medido se descarta a
 * propósito —los 91 sondeos fallidos son reales, pero miden una malla a la que
 * este sitio no pertenece— y por eso también se limpian los contadores, para no
 * dejar en la ficha una evidencia que contradice la conclusión.
 */
export function aplicarOtrasRedes(sitios: SitioRed[]): SitioRed[] {
  return sitios.map((s) => {
    const red = OTRAS_REDES[s.site_id];
    if (!red || s.red != null) return s;
    return {
      ...s,
      red,
      estado: "otra_red" as const,
      fallos_consecutivos: 0,
      ultimo_status: null,
    };
  });
}

/** Si el sitio no pertenece a la malla LoRa que este mapa sondea. */
export function esOtraRed(s: Pick<SitioRed, "red" | "estado">): boolean {
  return s.estado === "otra_red" || (s.red != null && s.red !== "mesh");
}

/** Nombre legible de la red ajena, para la ficha del sitio. */
export function nombreRed(s: Pick<SitioRed, "red" | "estado">): string {
  if (!esOtraRed(s)) return "Malla LoRa";
  return s.red && s.red !== "mesh" ? s.red : "Otra red";
}
