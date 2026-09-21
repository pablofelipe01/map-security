/**
 * Puestos fijos: nodos que no van montados en una máquina sino instalados en un
 * sitio (portería, báscula, bodega…).
 *
 * Son distintos de la flota en lo único que importa para el mapa: su posición
 * NO se mide, se declara. El nodo sigue mandando fixes GPS —y con ellos su
 * ruido de ±20-30 m—, pero una portería no se mueve, así que dibujarla donde
 * cayó el último fix la hace bailar sobre el lote y le inventa un "recorrido"
 * de cientos de metros al final del día. Aquí se fija la coordenada de una vez
 * y el mapa la usa para ese nodo.
 *
 * Esto es CONFIGURACIÓN escrita a mano, igual que el respaldo de `MAQUINAS` en
 * `lib/tractores.ts`: lo que diga este archivo es lo que se dibuja, aunque el
 * aparato esté en otra parte. Si una portería se traslada, hay que venir a
 * corregir la coordenada — el nodo no lo va a avisar.
 *
 * No vive en el registro de flota de Supabase a propósito: ese registro modela
 * "qué máquina lleva este nodo y quién la maneja", y un puesto fijo no tiene ni
 * máquina ni operador al mando. Meterlo allá obligaría a inventarle una máquina
 * fantasma para colgarle una coordenada.
 */

export interface Puesto {
  /** Nombre con el que se conoce el sitio. Va en la ficha del nodo. */
  nombre: string;
  /** Código corto: es lo que se lee en la etiqueta del marcador. */
  codigo: string;
  /** Posición declarada del puesto (la que se dibuja). */
  lat: number;
  lon: number;
  /** Color de identidad del marcador. */
  color: string;
}

/**
 * Los puestos, por node_id.
 *
 * Control 1 (la portería de entrada): 4°28'52.78"N 72°57'06.08"W, convertido
 * a grados decimales
 * (4 + 28/60 + 52.78/3600 y 72 + 57/60 + 6.08/3600, negativo por ser W).
 */
export const PUESTOS: Record<string, Puesto> = {
  "!2f3f6694": {
    nombre: "Control 1",
    codigo: "C1",
    lat: 4.481328,
    lon: -72.951689,
    color: "#0154ac",
  },
};

/** El puesto de ese nodo, o null si el nodo va montado en una máquina. */
export function puestoDe(nodeId: string): Puesto | null {
  return PUESTOS[nodeId] ?? null;
}

/** true si el nodo es una instalación fija y no una máquina. */
export function esPuesto(nodeId: string): boolean {
  return nodeId in PUESTOS;
}

/**
 * Puestos declarados SIN nodo: sitios que existen en campo pero todavía no
 * tienen un aparato de la malla instalado.
 *
 * Los de arriba se dibujan porque su nodo aparece en la flota; estos no tienen
 * a qué colgarse, así que el mapa los pinta por su cuenta —igual que las
 * antenas: son instalación, no telemetría— y salen en los dos modos, en vivo e
 * histórico. No llevan estado ni anillo porque no hay nada que reportar: dicen
 * dónde está el puesto, no cómo está.
 *
 * Control 3: 4°32'39.54"N 72°57'28.66"W en grados decimales
 * (4 + 32/60 + 39.54/3600 y 72 + 57/60 + 28.66/3600, negativo por ser W).
 */
export const PUESTOS_SIN_NODO: Puesto[] = [
  {
    nombre: "Control 3",
    codigo: "C3",
    lat: 4.544317,
    lon: -72.957961,
    color: "#0154ac",
  },
];
