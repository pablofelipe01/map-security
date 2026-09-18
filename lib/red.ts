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
 * Hay una sola excepción, y no debilita lo anterior: `antenasDelEntorno()` lee
 * antenas de `NEXT_PUBLIC_ANTENAS_EXTRA` para poder pintar un sitio que todavía
 * no está en `mesh_sites`. El dato sigue sin tocar el repositorio —vive en
 * `.env.local` o en las variables del despliegue—, que es lo que esta regla
 * protege. Ver la nota completa en esa función.
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

/**
 * Antenas declaradas en el entorno, para pintarlas sin pasar por Supabase.
 *
 * Por qué existe: dar de alta una antena es un INSERT en `mesh_sites`, y hasta
 * que alguien lo corra el sitio no existe para la app. Esta salida de emergencia
 * permite verla en el mapa mientras tanto.
 *
 * Por qué NO contradice la regla de arriba: lo que no puede pasar es que una
 * coordenada quede escrita en el REPOSITORIO, que es público, permanente e
 * indexable. `NEXT_PUBLIC_ANTENAS_EXTRA` vive en `.env.local` (ignorado por git)
 * o en las variables del despliegue. Que el valor termine en el bundle no
 * agrega exposición: el bundle ya recibe las coordenadas de todas las antenas,
 * porque `v_mesh_health` se lee con la anon key, que también es pública.
 *
 * Lo que sí cuesta: es una SEGUNDA fuente de verdad. Una antena declarada aquí
 * no se corrige con un UPDATE — hay que tocar el entorno y volver a desplegar.
 * Por eso es un puente hacia el INSERT, no un reemplazo: en cuanto el sitio
 * exista en `mesh_sites`, la fila de la base manda (ver `fusionarSitios`) y la
 * variable se puede borrar.
 *
 * Formato (JSON, una lista):
 *   [{"site_id":"x","site_name":"X","role":"repetidor","lat":0,"lon":0}]
 *
 * Si el JSON viene malformado se ignora y se avisa por consola: una variable
 * mal pegada no puede dejar el mapa en blanco.
 */
export function antenasDelEntorno(): SitioRed[] {
  // Referencia estática y literal: Next sólo sustituye `process.env.NEXT_PUBLIC_*`
  // en el bundle cuando lo ve escrito así, no a través de una variable.
  const crudo = process.env.NEXT_PUBLIC_ANTENAS_EXTRA;
  if (!crudo || !crudo.trim()) return [];

  let lista: unknown;
  try {
    lista = JSON.parse(crudo);
  } catch {
    console.warn("NEXT_PUBLIC_ANTENAS_EXTRA no es JSON válido; se ignora.");
    return [];
  }
  if (!Array.isArray(lista)) {
    console.warn("NEXT_PUBLIC_ANTENAS_EXTRA debe ser una lista; se ignora.");
    return [];
  }

  return lista.flatMap((x): SitioRed[] => {
    const s = x as Record<string, unknown>;
    const lat = typeof s.lat === "number" ? s.lat : NaN;
    const lon = typeof s.lon === "number" ? s.lon : NaN;
    const site_id = typeof s.site_id === "string" ? s.site_id.trim() : "";
    const site_name = typeof s.site_name === "string" ? s.site_name.trim() : "";
    // Las mismas cotas que los CHECK de `mesh_sites`: si una antena declarada a
    // mano no las cumple, el problema es el dato, no el mapa.
    const ok =
      site_id &&
      site_name &&
      Number.isFinite(lat) &&
      Number.isFinite(lon) &&
      Math.abs(lat) <= 90 &&
      Math.abs(lon) <= 180;
    if (!ok) {
      console.warn("Antena del entorno incompleta o fuera de rango; se ignora:", x);
      return [];
    }
    return [
      {
        site_id,
        node_id: typeof s.node_id === "string" ? s.node_id : null,
        site_name,
        role: s.role === "gateway" ? "gateway" : "repetidor",
        lat,
        lon,
        dist_gateway_m:
          typeof s.dist_gateway_m === "number" ? s.dist_gateway_m : null,
        notes: typeof s.notes === "string" ? s.notes : null,
        // Sin sondeos no hay nada que afirmar. "sin_datos" es el mismo estado al
        // que llega `v_mesh_health` para un sitio que todavía no se ha sondeado:
        // gris, "está instalada; si reporta, no se sabe". No se inventa un
        // "activa" ni un "inactiva" que nadie midió.
        estado: "sin_datos",
        min_sin_senal: null,
        ultimo_sondeo: null,
        ultimo_status: null,
        rtt_ms: null,
        hops_towards: null,
        route_text: null,
        fallos_consecutivos: 0,
      },
    ];
  });
}

/**
 * Los sitios de la base más los del entorno, sin duplicar.
 *
 * La base SIEMPRE gana: si alguien ya corrió el INSERT, ese sitio tiene estado
 * real —sondeos, fallos, ruta medida— y la entrada del entorno es una copia
 * congelada que sólo podría contradecirlo.
 */
export function fusionarSitios(
  deLaBase: SitioRed[],
  delEntorno: SitioRed[]
): SitioRed[] {
  const yaEsta = new Set(deLaBase.map((s) => s.site_id));
  return [...deLaBase, ...delEntorno.filter((s) => !yaEsta.has(s.site_id))];
}
