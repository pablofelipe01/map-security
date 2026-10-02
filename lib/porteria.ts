/**
 * Registros de ingreso de una portería.
 *
 * Los puestos fijos de `lib/puestos.ts` no son máquinas: Control 1 es la
 * portería de entrada, y lo que pasa ahí no se mide con el GPS sino con la app
 * de control de acceso, que escribe en una base de Airtable ("Registro
 * Visitantes", tabla `Registros`). Cada fila es un evento de portería —una
 * entrada o una salida, de un vehículo o de un peatón— y trae el nodo que la
 * originó en `nodo_origen`, con el mismo `node_id` de la malla.
 *
 * Ese campo es todo el pegamento que hace falta: el mapa ya sabe qué nodo es la
 * portería, así que la ficha de ese nodo puede preguntar por sus registros sin
 * que haya que declarar en ninguna parte "Control 1 es la portería tal de
 * Airtable". Si mañana se instala un nodo en otra portería y la app de acceso
 * escribe su `nodo_origen`, la ficha de ese nodo muestra sus ingresos sola.
 *
 * La lectura NO se hace desde el navegador: el token de Airtable es de
 * escritura sobre datos de personas (cédulas, nombres, placas) y publicarlo en
 * el bundle lo regalaría a cualquiera que abra el inspector. Por eso el token
 * vive sólo en el servidor y el cliente pasa por `/api/porteria`, que además
 * devuelve únicamente los campos de esta interfaz.
 */

/** Qué clase de evento es. Son los valores del campo `tipo` de Airtable. */
export type TipoEvento = "ENTRADA" | "SALIDA" | "MANUAL" | "SALIDA_SIN_ENTRADA";

/** Qué entró o salió. Valores del campo `categoria`. */
export type CategoriaEvento = "VEHICULO" | "PEATON" | "FIN_DE_SEMANA";

/** Un evento de portería, ya limpio de los nombres de campo de Airtable. */
export interface RegistroPorteria {
  id: string;
  tipo: TipoEvento | null;
  categoria: CategoriaEvento | null;
  /** `status`: APROBADO, NEGADO, PENDIENTE, SALIDA_SIN_ENTRADA. */
  estado: string | null;
  placa: string | null;
  cedula: string | null;
  /** Conductor (si vino en vehículo) o persona (si entró a pie). */
  nombre: string | null;
  motivo: string | null;
  entrada: string | null; // ISO UTC
  salida: string | null; // ISO UTC
  /**
   * Salida supuesta para una entrada que nunca registró la suya (ver
   * `estimarSalidas`). La calcula el cliente; no viene de Airtable ni se
   * escribe allá. Null o ausente cuando hay salida real o no aplica.
   */
  salidaEstimada?: string | null; // ISO UTC
  autorizadoPor: string | null;
  supervisor: string | null;
  comentario: string | null;
  /**
   * Instante con el que se ordena y se agrupa por día: la hora del evento que
   * la fila representa (entrada para una ENTRADA, salida para una SALIDA), y
   * como último recurso la hora de creación de la fila. Nunca es null porque
   * Airtable siempre sella `Creada`.
   */
  t: string; // ISO UTC
}

export interface Porteria {
  registros: RegistroPorteria[];
  /** true si la ventana tenía más filas de las que se trajeron (ver el tope en la ruta). */
  truncado: boolean;
}

/** El error que devuelve `/api/porteria` cuando no puede responder. */
export interface PorteriaError {
  error: string;
  /** true cuando falta el token: no es una falla, es que no está configurado. */
  sinConfigurar?: boolean;
}

/**
 * Trae los registros de un puesto entre dos días de Bogotá (ambos incluidos).
 *
 * Lanza con el mensaje que devuelva la ruta, para que la ficha pueda decir qué
 * pasó en vez de quedarse en blanco.
 */
export async function fetchPorteria(
  nodeId: string,
  desde: string,
  hasta: string
): Promise<Porteria> {
  const q = new URLSearchParams({ node: nodeId, desde, hasta });
  const res = await fetch(`/api/porteria?${q}`, { cache: "no-store" });
  const body = await res.json();
  if (!res.ok) {
    const e = body as PorteriaError;
    const err = new Error(e?.error ?? `HTTP ${res.status}`);
    (err as Error & { sinConfigurar?: boolean }).sinConfigurar =
      e?.sinConfigurar;
    throw err;
  }
  return body as Porteria;
}

/** true si la fila es en sí misma un evento de salida (sin entrada asociada). */
export function esFilaSalida(r: RegistroPorteria): boolean {
  return r.tipo === "SALIDA" || r.tipo === "SALIDA_SIN_ENTRADA";
}

/**
 * true si el registro dice que alguien salió.
 *
 * La app de portería NO crea una fila nueva al marcar la salida: le pone
 * `exit_time` a la misma fila de la ENTRADA. Las filas tipo SALIDA son sólo
 * las salidas sin entrada previa. Contar únicamente esas daba "200 entradas,
 * 3 salidas" en Control 1 (2 oct), cuando 166 de esas entradas ya tenían su
 * salida anotada.
 */
export function tieneSalida(r: RegistroPorteria): boolean {
  return esFilaSalida(r) || r.salida != null || r.salidaEstimada != null;
}

/**
 * Estadías más largas que esto no entran al promedio (h): son salidas que se
 * marcaron días después, no visitas, y con ellas el promedio se iría a la
 * deriva justo por el error que se quiere tapar.
 */
const ESTADIA_MAX_H = 24;

/** Promedio de estadía (min) por categoría, con cuántas estadías lo sostienen. */
export interface PromedioEstadia {
  minutos: number;
  muestras: number;
}

export type PromediosEstadia = Partial<
  Record<CategoriaEvento | "GENERAL", PromedioEstadia>
>;

/**
 * Pone una salida estimada a las entradas que no registraron la suya.
 *
 * En Control 1 una de cada cinco entradas aprobadas quedaba sin salida, casi
 * todas de vehículos y muchas con días abiertas: en portería se olvida marcar
 * la salida. Se le asigna la hora de entrada más la estadía promedio de su
 * categoría (vehículo, peatón…), calculada con las estadías cerradas de la
 * misma ventana. Si la categoría no tiene estadías cerradas se usa el promedio
 * general.
 *
 * Una entrada cuya salida estimada todavía no llega (`ahora`) se deja sin
 * estimar: lo más probable es que esa persona siga adentro, y darla por salida
 * sería decir algo falso hoy mismo.
 *
 * La ficha la muestra como una salida más, sin distinguirla. Airtable no se
 * toca: en cuanto la portería marque la salida real, esa reemplaza a esta, y
 * en el código sigue separada en `salidaEstimada` por si hace falta auditarla.
 */
export function estimarSalidas(
  registros: RegistroPorteria[],
  ahora: number = Date.now()
): { registros: RegistroPorteria[]; promedios: PromediosEstadia } {
  const suma = new Map<string, { min: number; n: number }>();
  const sumar = (k: string, min: number) => {
    const a = suma.get(k) ?? { min: 0, n: 0 };
    a.min += min;
    a.n++;
    suma.set(k, a);
  };
  for (const r of registros) {
    if (esFilaSalida(r) || !r.entrada || !r.salida) continue;
    const min = (Date.parse(r.salida) - Date.parse(r.entrada)) / 60_000;
    if (!(min > 0) || min > ESTADIA_MAX_H * 60) continue;
    sumar("GENERAL", min);
    if (r.categoria) sumar(r.categoria, min);
  }

  const promedios: PromediosEstadia = {};
  for (const [k, { min, n }] of suma) {
    promedios[k as keyof PromediosEstadia] = { minutos: min / n, muestras: n };
  }

  const out = registros.map((r) => {
    if (esFilaSalida(r) || !r.entrada || r.salida || r.estado === "NEGADO") return r;
    const prom = (r.categoria && promedios[r.categoria]) || promedios.GENERAL;
    if (!prom) return r;
    const t = Date.parse(r.entrada) + prom.minutos * 60_000;
    if (!Number.isFinite(t) || t > ahora) return r;
    return { ...r, salidaEstimada: new Date(t).toISOString() };
  });
  return { registros: out, promedios };
}

/** Cuenta los eventos de cada tipo en una tanda de registros. */
export function resumirPorteria(registros: RegistroPorteria[]) {
  let entradas = 0;
  let salidas = 0;
  let estimadas = 0;
  let adentro = 0;
  let vehiculos = 0;
  let peatones = 0;
  let negados = 0;
  for (const r of registros) {
    if (!esFilaSalida(r)) {
      entradas++;
      if (r.salidaEstimada != null) estimadas++;
      // Aprobado, sin salida y todavía dentro de la estadía promedio.
      else if (r.salida == null && r.estado !== "NEGADO") adentro++;
    }
    if (tieneSalida(r)) salidas++;
    if (r.categoria === "VEHICULO") vehiculos++;
    else if (r.categoria === "PEATON") peatones++;
    if (r.estado === "NEGADO") negados++;
  }
  return { entradas, salidas, estimadas, adentro, vehiculos, peatones, negados };
}
