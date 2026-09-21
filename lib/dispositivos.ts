/**
 * Qué aparato lleva cada nodo.
 *
 * La tabla `nodes` de Supabase no trae el modelo de hardware: todos los nodos
 * llegan iguales, con su hex y su nombre de fábrica. Pero no todos son el mismo
 * aparato, y la diferencia se nota en campo: un Wio Tracker es un rastreador
 * con GPS propio y batería propia, no un radio Meshtastic de los que se montan
 * en la cabina. Reporta distinto, se carga distinto y cuando se calla se revisa
 * distinto.
 *
 * Por eso el mapa lo distingue: mismo ícono de máquina —lo que se ve moviéndose
 * SÍ es un tractor— pero con color propio y una etiqueta que dice qué aparato
 * es. Así nadie tiene que acordarse de memoria de cuál era el nodo raro.
 *
 * Esto es CONFIGURACIÓN escrita a mano, igual que `PUESTOS` en `lib/puestos.ts`
 * o el respaldo de `MAQUINAS` en `lib/tractores.ts`: lo que diga este archivo es
 * lo que se pinta. Si el Wio se pasa a otra máquina, hay que venir a corregir el
 * node_id — el aparato no lo va a avisar.
 *
 * No vive en el registro de flota de Supabase a propósito: ese registro modela
 * "qué máquina lleva este nodo y quién la maneja", y el modelo del aparato no es
 * ni máquina ni operador. Un cambio de tractor no cambia el hardware.
 */

export interface Dispositivo {
  /** Etiqueta corta: es lo que se lee en el marcador y en la ficha. */
  etiqueta: string;
  /**
   * Color de identidad del nodo. Pisa al del registro de flota (ver
   * `maquinaDe` en `lib/tractores.ts`): el aparato es lo que lo hace especial,
   * así que su color manda sobre el que se haya elegido en el formulario. Para
   * devolverle el color del registro, hay que sacarlo de este archivo.
   */
  color: string;
  /** Una línea de contexto para la ficha del nodo. */
  nota?: string;
}

/**
 * Los nodos con aparato declarado, por node_id.
 *
 * Verde Alegría (#00b602) es color de marca y hoy no lo usa ninguna máquina
 * registrada, así que el Wio se lee de inmediato entre los azules de la flota.
 */
export const DISPOSITIVOS: Record<string, Dispositivo> = {
  "!43462e94": {
    etiqueta: "Wio Tracker",
    color: "#00b602",
    nota: "Rastreador con GPS y batería propios, no un radio de cabina.",
  },
};

/** El aparato declarado de ese nodo, o null si es un nodo corriente. */
export function dispositivoDe(nodeId: string): Dispositivo | null {
  return DISPOSITIVOS[nodeId] ?? null;
}
