import { dispositivoDe } from "./dispositivos";
import { puestoDe } from "./puestos";

/**
 * Registro de la flota: node_id → identidad de la máquina.
 *
 * La tabla `nodes` de Supabase sólo trae nombres de fábrica ("Meshtastic 1d35")
 * y ninguno de los atributos que el patrón SiriusFleet muestra en pantalla
 * (código, tipo de máquina, color, operador, labor).
 *
 * Hoy ese registro se diligencia desde la app —clic en el nodo → formulario— y
 * vive en la tabla `node_registry` de Supabase (ver `lib/registro.ts`). Lo que
 * queda en este archivo es el respaldo escrito a mano: sirve para sembrar la
 * flota sin tocar la base y como último recurso si la tabla no responde. El
 * registro de Supabase tiene prioridad sobre `MAQUINAS`.
 *
 * Un node_id que no esté en la tabla NO rompe nada: se muestra con su nombre de
 * fábrica, tipo `tractor` y el color por defecto.
 *
 * Nota de honestidad: esto es CONFIGURACIÓN, no telemetría. `operador` y
 * `labor` son lo que alguien escribió aquí, no lo que la máquina reporta; si
 * cambia el turno, la pantalla seguirá mostrando lo de este archivo hasta que
 * se edite. Por eso la UI los rotula como "según registro".
 */

/**
 * Tipos de máquina que el patrón sabe dibujar.
 *
 * Añadir uno aquí no basta: hay que darle ícono en `lib/icons.ts` —si no, el
 * mapa lo dibuja como tractor— y ampliar el CHECK de `tipo` en
 * `supabase/node_registry.sql`, o la base rechaza el registro.
 */
export type TipoMaquina =
  | "tractor"
  | "camion"
  | "volqueta"
  | "aspersora"
  | "retro"
  /** No es una máquina: un puesto fijo con vigilante. Ver `lib/puestos.ts`. */
  | "porteria";

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

export const COLOR_DEFAULT = "#0154ac";

/** Los tipos, con su etiqueta en español, en el orden en que se usan en campo. */
export const TIPOS_MAQUINA: { valor: TipoMaquina; label: string }[] = [
  { valor: "tractor", label: "Tractor" },
  { valor: "camion", label: "Camión" },
  { valor: "volqueta", label: "Volqueta" },
  { valor: "aspersora", label: "Aspersora" },
  { valor: "retro", label: "Retroexcavadora" },
  { valor: "porteria", label: "Portería" },
];

/**
 * Paleta de identidad: son los colores con los que el mapa distingue máquinas.
 * Están escogidos para diferenciarse entre sí incluso en un rastro delgado
 * sobre imagen satelital, que es donde se ven de verdad.
 *
 * Los tres primeros son los colores de marca (Azul Barranca, Azul Cielo, Verde
 * Alegría); los cinco siguientes son vecinos de esos mismos azules y verdes,
 * porque el manual no trae ocho colores y ocho máquinas hay que poder
 * distinguirlas. Es la concesión asumida: la paleta se ve Sirius, y a cambio
 * dos máquinas quedan más parecidas entre sí de lo que estaban con la paleta
 * anterior (que tenía naranja, rosa y violeta, ninguno de marca).
 */
export const COLORES_FLOTA = [
  "#0154ac", // Azul Barranca
  "#00a3ff", // Azul Cielo
  "#00b602", // Verde Alegría
  "#003a78", // Barranca oscuro
  "#4dc3ff", // Cielo claro
  "#00b37f", // entre Cielo y Alegría
  "#6fa200", // Alegría hacia Cotiledón
  "#8cbf3f", // Cotiledón saturado
];

/**
 * ⚠️ COMPLETAR: asigna cada node_id a la máquina que lo lleva montado.
 *
 * Los node_id de abajo son los seis que hoy existen en `nodes`. Están
 * comentados a propósito: mientras nadie confirme qué nodo va en qué máquina,
 * es más honesto mostrar el nombre de fábrica que inventar una flota.
 */
export const MAQUINAS: Record<string, Maquina> = {
  // "!79350d77": { codigo: "T-01", nombre: "Rocinante", tipo: "tractor",   color: "#0154ac", operador: "", labor: "" },
  // "!2f3f6694": { codigo: "T-02", nombre: "La Mona",   tipo: "tractor",   color: "#00a3ff", operador: "", labor: "" },
  // "!7e46a447": { codigo: "A-01", nombre: "La Nube",   tipo: "aspersora", color: "#00b602", operador: "", labor: "", aplicacion: "" },
  // "!2ad9c5df": { codigo: "R-01", nombre: "El Oso",    tipo: "retro",     color: "#003a78", operador: "", labor: "" },
  // "!86591d35": { codigo: "T-03", nombre: "Tibisay",   tipo: "tractor",   color: "#4dc3ff", operador: "", labor: "" },
  // "!587897b7": { codigo: "T-04", nombre: "",          tipo: "tractor",   color: "#0154ac", operador: "", labor: "" },
};

/**
 * Registro traído de Supabase, en memoria.
 *
 * Es un módulo mutable y no un contexto de React a propósito: `maquinaDe` se
 * llama desde sitios que no son componentes —el dibujo del mapa, el grabador de
 * video— y convertirla en hook obligaría a reescribir esas rutas. A cambio,
 * quien lo actualiza (`app/page.tsx`) debe forzar el redibujo; por eso
 * `setRegistroFlota` devuelve una versión que la página usa como dependencia.
 */
let REGISTRO: Record<string, Maquina> = {};
let REGISTRO_VERSION = 0;

/** Reemplaza el registro vivo. Devuelve el número de versión para redibujar. */
export function setRegistroFlota(r: Record<string, Maquina>): number {
  REGISTRO = r;
  return ++REGISTRO_VERSION;
}

/** true si la flota ya está bautizada (para avisar en pantalla cuando no lo está). */
export function flotaConfigurada(): boolean {
  return Object.keys(REGISTRO).length > 0 || Object.keys(MAQUINAS).length > 0;
}

/**
 * Resuelve la identidad de un nodo: primero los puestos fijos, luego el
 * registro de Supabase, luego el respaldo de este archivo, y si no hay ninguno,
 * los datos de fábrica del nodo. Siempre devuelve algo dibujable: la UI nunca
 * tiene que manejar el caso nulo.
 *
 * Los puestos van de primeros porque no son máquinas: una portería no se monta
 * en un tractor ni la maneja nadie, y su marcador se dibuja en la coordenada
 * declarada en `lib/puestos.ts`. Si el registro de flota pudiera pisarlos, el
 * mapa terminaría con un tractor clavado en un punto fijo. Para dejar de tratar
 * un nodo como puesto hay que sacarlo de ese archivo.
 */
export function maquinaDe(
  nodeId: string,
  longName?: string | null,
  shortName?: string | null
): Maquina {
  const puesto = puestoDe(nodeId);
  if (puesto) {
    return {
      codigo: puesto.codigo,
      nombre: puesto.nombre,
      tipo: "porteria",
      color: puesto.color,
    };
  }

  // El aparato declarado (ver `lib/dispositivos.ts`) pisa el color: es lo único
  // de la identidad que no depende de en qué máquina esté montado hoy. Se aplica
  // aquí y no en cada pantalla para que el marcador, el rastro, la ficha y el
  // video usen el mismo color sin tener que acordarse de consultarlo.
  const disp = dispositivoDe(nodeId);

  const m = REGISTRO[nodeId] ?? MAQUINAS[nodeId];
  if (m) return disp ? { ...m, color: disp.color } : m;
  return {
    codigo: shortName ?? nodeId.slice(-4),
    nombre: longName ?? nodeId,
    tipo: "tractor",
    color: disp?.color ?? COLOR_DEFAULT,
  };
}

/** true si ese nodo ya tiene identidad diligenciada (no está usando el nombre de fábrica). */
export function estaRegistrado(nodeId: string): boolean {
  // Un puesto fijo ya tiene identidad escrita en `lib/puestos.ts`: no hay nada
  // que asignarle, así que la UI no debe pedir que se bautice.
  return nodeId in REGISTRO || nodeId in MAQUINAS || puestoDe(nodeId) != null;
}
