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

/** Cuenta los eventos de cada tipo en una tanda de registros. */
export function resumirPorteria(registros: RegistroPorteria[]) {
  let entradas = 0;
  let salidas = 0;
  let vehiculos = 0;
  let peatones = 0;
  let negados = 0;
  for (const r of registros) {
    if (r.tipo === "SALIDA" || r.tipo === "SALIDA_SIN_ENTRADA") salidas++;
    else entradas++;
    if (r.categoria === "VEHICULO") vehiculos++;
    else if (r.categoria === "PEATON") peatones++;
    if (r.estado === "NEGADO") negados++;
  }
  return { entradas, salidas, vehiculos, peatones, negados };
}
