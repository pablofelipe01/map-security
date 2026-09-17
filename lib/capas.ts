/**
 * Identificadores de las fuentes y capas del mapa.
 *
 * Viven fuera de `components/MapGL.tsx` porque el grabador de video
 * (`lib/video.ts`) tiene que apagar los rastros de las demás máquinas y añadir
 * sus propias capas sobre el mismo mapa. Compartir las cadenas por aquí evita
 * que una se renombre en un archivo y el otro deje de encontrarla en silencio:
 * un id equivocado en MapLibre no lanza error, sólo no dibuja.
 */

/** Rastros de todas las máquinas (líneas del recorrido). */
export const CAPA_RASTROS = "trails";
/** Puntos de inicio y fin de cada rastro. */
export const CAPA_EXTREMOS = "trail-ends";
/** Pines de cambio de máquina/operador, y su rótulo de hora. */
export const CAPA_CAMBIOS = "cambios-registro";
export const CAPA_CAMBIOS_HORA = "cambios-registro-hora";

/** Enlaces declarados de la red mesh, y su rótulo de distancia. */
export const CAPA_RED = "red-enlaces";
export const CAPA_RED_ETIQ = "red-enlaces-etiq";

/** Capas temporales que sólo existen mientras se graba un video. */
export const SRC_VIDEO_RUTA = "video-ruta";
export const CAPA_VIDEO_RUTA = "video-ruta";
export const SRC_VIDEO_AVANCE = "video-avance";
export const CAPA_VIDEO_AVANCE = "video-avance";
