/**
 * Registro de la flota: node_id → identidad de la máquina.
 *
 * La tabla `nodes` de Supabase sólo trae nombres de fábrica ("Meshtastic 1d35")
 * y ninguno de los atributos que el patrón SiriusFleet muestra en pantalla
 * (código, tipo de máquina, color, operador, labor). Como la app es de solo
 * lectura, ese registro vive aquí: editar este archivo es la forma de dar de
 * alta y bautizar la flota.
 *
 * Un node_id que no esté en la tabla NO rompe nada: se muestra con su nombre de
 * fábrica, tipo `tractor` y el color por defecto.
 *
 * Nota de honestidad: esto es CONFIGURACIÓN, no telemetría. `operador` y
 * `labor` son lo que alguien escribió aquí, no lo que la máquina reporta; si
 * cambia el turno, la pantalla seguirá mostrando lo de este archivo hasta que
 * se edite. Por eso la UI los rotula como "según registro".
 */

/** Tipos de máquina que el patrón sabe dibujar. */
export type TipoMaquina = "tractor" | "aspersora" | "retro";

export interface Maquina {
  /** Código operativo corto, va en la etiqueta del mapa. Ej. "T-01". */
  codigo: string;
  /** Nombre con el que la conoce la gente en campo. Ej. "Rocinante". */
  nombre: string;
  tipo: TipoMaquina;
  /** Color de identidad: pinta el ícono y su rastro en el mapa. */
  color: string;
  operador?: string;
  labor?: string;
  /** Insumo que está aplicando, si la labor es de aplicación. */
  aplicacion?: string;
}

export const COLOR_DEFAULT = "#0a55a5";

/**
 * ⚠️ COMPLETAR: asigna cada node_id a la máquina que lo lleva montado.
 *
 * Los node_id de abajo son los seis que hoy existen en `nodes`. Están
 * comentados a propósito: mientras nadie confirme qué nodo va en qué máquina,
 * es más honesto mostrar el nombre de fábrica que inventar una flota.
 */
export const MAQUINAS: Record<string, Maquina> = {
  // "!79350d77": { codigo: "T-01", nombre: "Rocinante", tipo: "tractor",   color: "#0a55a5", operador: "", labor: "" },
  // "!2f3f6694": { codigo: "T-02", nombre: "La Mona",   tipo: "tractor",   color: "#eb6834", operador: "", labor: "" },
  // "!7e46a447": { codigo: "A-01", nombre: "La Nube",   tipo: "aspersora", color: "#1baf7a", operador: "", labor: "", aplicacion: "" },
  // "!2ad9c5df": { codigo: "R-01", nombre: "El Oso",    tipo: "retro",     color: "#eda100", operador: "", labor: "" },
  // "!86591d35": { codigo: "T-03", nombre: "Tibisay",   tipo: "tractor",   color: "#e87ba4", operador: "", labor: "" },
  // "!587897b7": { codigo: "T-04", nombre: "",          tipo: "tractor",   color: "#7b4fd0", operador: "", labor: "" },
};

/** true si la flota ya está bautizada (para avisar en pantalla cuando no lo está). */
export const FLOTA_CONFIGURADA = Object.keys(MAQUINAS).length > 0;

/**
 * Resuelve la identidad de un nodo, con respaldo en los datos de fábrica.
 * Siempre devuelve algo dibujable: la UI nunca tiene que manejar el caso nulo.
 */
export function maquinaDe(
  nodeId: string,
  longName?: string | null,
  shortName?: string | null
): Maquina {
  const m = MAQUINAS[nodeId];
  if (m) return m;
  return {
    codigo: shortName ?? nodeId.slice(-4),
    nombre: longName ?? nodeId,
    tipo: "tractor",
    color: COLOR_DEFAULT,
  };
}
