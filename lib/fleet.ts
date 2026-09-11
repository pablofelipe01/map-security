import { haversineM, bearingDeg } from "./geo";
import type { TrackPoint, FleetItem, TractorEstado } from "./types";

/**
 * Reglas de "tiempo real" para la flota de tractores.
 *
 * TECHO DURO: el poller de Supabase corre cada 10 minutos (144 filas/día por
 * nodo, en :00 :10 :20…). Y el nodo Meshtastic manda un fix GPS cada ~9 min.
 * Por lo tanto la app NO puede mostrar movimiento continuo: lo más fresco que
 * existe es "dónde estaba hace entre 0 y ~10 minutos". Refrescar el navegador
 * más rápido que el poller no trae información nueva, sólo consume cuota.
 *
 * De ahí la decisión de diseño: en vez de fingir un punto que se desliza, la UI
 * muestra la última posición CONFIRMADA junto con su edad, siempre visible.
 */
export const CADENCIA_POLLER_MIN = 10;

/**
 * Edad máxima del último fix GPS para considerar al tractor "reportando".
 *
 * 25 min ≈ 2.5 ciclos del poller: tolera que se pierda un reporte por cobertura
 * mesh sin declarar falla, pero no dos seguidos.
 *
 * El patrón SiriusFleet usa 3 minutos para este mismo umbral, porque su demo
 * simula telemetría cada 3 segundos. Con la cadencia real de 10 min ese valor
 * dejaría a las seis máquinas en "Sin señal" de forma permanente: el umbral
 * tiene que salir de la frecuencia de la fuente, no del diseño.
 */
export const SIN_SENAL_MIN = 25;

/**
 * Desplazamiento mínimo entre fixes reales para llamarlo movimiento (m).
 * Igual al umbral que usa el backend en `is_stationary`: por debajo de 35 m la
 * diferencia cae dentro del error del GPS del nodo.
 */
export const MOVIMIENTO_M = 35;

/** Cuántas filas del poller se leen por nodo (~5 h de historia). */
export const FILAS_POR_NODO = 30;

/**
 * Edad en minutos de un instante ISO, o null si no hay fecha válida.
 * Se usa contra `gps_time` (cuándo estuvo el tractor ahí de verdad), nunca
 * contra `sample_local` (cuándo corrió el poller): confundirlos es lo que hacía
 * que un nodo congelado desde mayo apareciera "en vivo".
 */
export function edadMin(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

/**
 * Etiquetas, colores y orden por estado.
 *
 * Las claves coinciden con las clases CSS del patrón (`.st-dot.activa`,
 * `.mk.offline`…), así que el color de un punto en el mapa y el de su fila en
 * el panel no pueden desincronizarse.
 *
 * El patrón tiene un cuarto estado, `mantenimiento` (rojo), alimentado por
 * tickets abiertos. Aquí no existe esa fuente, así que el cuarto estado es
 * `sin_gps`: el nodo está en la red pero nunca entregó coordenadas. El rojo
 * queda reservado para la falla de plataforma (poller caído), que es lo único
 * de esa gravedad que esta app puede detectar.
 */
export const ESTADO_META: Record<
  TractorEstado,
  { label: string; color: string; texto: string; orden: number; ayuda: string }
> = {
  activa: {
    label: "Activa",
    color: "#0ca30c",
    texto: "text-st-activa",
    orden: 0,
    ayuda: "Se desplazó entre los dos últimos fixes GPS.",
  },
  detenida: {
    label: "Detenida",
    color: "#fab219",
    texto: "text-st-detenida",
    orden: 1,
    ayuda: "Reporta posición, pero no se ha movido del sitio.",
  },
  offline: {
    label: "Sin señal",
    color: "#7b8794",
    texto: "text-st-offline",
    orden: 2,
    ayuda: `Su último fix GPS tiene más de ${SIN_SENAL_MIN} min. La posición del mapa es la última conocida, no la actual.`,
  },
  sin_gps: {
    label: "Sin GPS",
    color: "#7b8794",
    texto: "text-st-offline",
    orden: 3,
    ayuda: "El nodo está en la red pero nunca ha entregado coordenadas.",
  },
};

/**
 * Deriva el estado de un tractor a partir de sus últimas filas del poller.
 *
 * `filas` viene ordenada de más reciente a más antigua (como la trae la query).
 * Se distinguen tres cosas que en la data cruda es fácil confundir:
 *   - el latido del poller  → `sample_local` de la fila más reciente
 *   - la última posición dibujable → primera fila con lat/lon
 *   - el último fix GPS real → primera fila con `nuevo_fix = true`
 *
 * Sólo el tercero sirve para decir "el tractor está aquí AHORA".
 */
export function derivarEstado(
  filas: TrackPoint[],
  ultimoFixHistorico: TrackPoint | null
): Omit<FleetItem, "node"> {
  const latido = filas[0]?.sample_local ?? null;
  const conPosicion = filas.find((f) => f.lat != null && f.lon != null) ?? null;

  // Fixes GPS reales, del más nuevo al más viejo.
  const reales = filas.filter((f) => f.nuevo_fix && f.lat != null && f.lon != null);
  // Si en la ventana leída no hay ninguno, caemos al último de la historia:
  // así podemos decir "hace 117 días" en vez de un "sin datos" mudo.
  const ultimoFix = reales[0] ?? ultimoFixHistorico ?? null;
  const fixAnterior = reales[1] ?? null;

  const edadFix = edadMin(ultimoFix?.gps_time ?? null);
  const posicion = ultimoFix ?? conPosicion;

  // Desplazamiento y velocidad medidos entre fixes reales consecutivos.
  // NO se usa `ground_speed`: en esta data viene 0-14 sin unidad coherente y el
  // propio backend la marca como no confiable. Distancia/tiempo es verificable.
  let desplazamientoM: number | null = null;
  let velocidadKmh: number | null = null;
  let rumbo: number | null = null;

  if (ultimoFix && fixAnterior) {
    const a = { lat: fixAnterior.lat, lon: fixAnterior.lon };
    const b = { lat: ultimoFix.lat, lon: ultimoFix.lon };
    desplazamientoM = ultimoFix.dist_prev_fix_m ?? haversineM(a, b);
    const min = ultimoFix.min_since_prev_fix ?? null;
    if (min != null && min > 0) {
      velocidadKmh = desplazamientoM / 1000 / (min / 60);
    }
    if (desplazamientoM >= MOVIMIENTO_M) rumbo = bearingDeg(a, b);
  }

  let estado: TractorEstado;
  if (!posicion) {
    estado = "sin_gps";
  } else if (edadFix == null || edadFix > SIN_SENAL_MIN) {
    // Incluye el caso "tiene lat/lon pero ningún fix confirmado": la posición
    // existe pero no sabemos de cuándo es, y eso es SIN SEÑAL, no "en vivo".
    estado = "offline";
  } else if (desplazamientoM != null) {
    // Con dos fixes reales, manda la medición: metros recorridos sobre el
    // umbral. Se prefiere a `is_stationary` del backend porque esa bandera se
    // calcula sobre una ventana y ya se comprobó que discrepa (fixes con 84 m
    // de desplazamiento marcados como parte de una estadía).
    estado = desplazamientoM >= MOVIMIENTO_M ? "activa" : "detenida";
  } else if (ultimoFix?.is_stationary === true) {
    // Sin desplazamiento medible, la bandera del backend es la mejor pista.
    estado = "detenida";
  } else {
    // Fix fresco pero es el primero: hay posición confirmada y aún no hay con
    // qué comparar. No afirmamos un movimiento que no medimos.
    estado = "detenida";
  }

  return {
    estado,
    posicion,
    edadFixMin: edadFix,
    latidoPoller: latido,
    desplazamientoM,
    velocidadKmh,
    rumbo,
    fixesEnVentana: reales.length,
    fixConfirmado: reales.length > 0,
  };
}

/** Orden de la torre de control: primero lo que exige atención. */
export function ordenarFlota(items: FleetItem[]): FleetItem[] {
  return [...items].sort((a, b) => {
    const d = ESTADO_META[a.estado].orden - ESTADO_META[b.estado].orden;
    if (d !== 0) return d;
    return (a.edadFixMin ?? Infinity) - (b.edadFixMin ?? Infinity);
  });
}

/** Conteo por estado, para los contadores del panel. */
export function contarEstados(items: FleetItem[]): Record<TractorEstado, number> {
  const base: Record<TractorEstado, number> = {
    activa: 0,
    detenida: 0,
    offline: 0,
    sin_gps: 0,
  };
  for (const i of items) base[i.estado]++;
  return base;
}

/** Velocidad legible; "—" cuando no hay dos fixes con qué medirla. */
export function fmtVel(kmh: number | null): string {
  if (kmh == null) return "—";
  if (kmh < 0.5) return "0 km/h";
  return `${kmh.toFixed(1)} km/h`;
}

/**
 * Edad legible y compacta para la columna de la torre de control.
 * Redondea a minutos porque la fuente tiene resolución de ~10 min: mostrar
 * segundos sugeriría una precisión que no existe.
 */
export function fmtEdad(min: number | null): string {
  if (min == null) return "sin fecha";
  const m = Math.round(min);
  if (m < 1) return "ahora";
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d} d`;
}
