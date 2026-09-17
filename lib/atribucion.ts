/**
 * A quién pertenece cada pedazo del recorrido de un nodo.
 *
 * El histórico resuelve la identidad a UN instante (el final del día), y con eso
 * un nodo que se pasó de tractor a media mañana sale dibujado de un solo color:
 * el recorrido entero queda atribuido al segundo tractor y al operador que
 * estaba al cierre. Aquí el rastro se parte en piezas, una por cada tramo en que
 * el nodo estuvo montado en una máquina distinta, y cada pieza lleva el color y
 * las cifras de SU máquina.
 *
 * Dónde se corta, exactamente: en el primer fix posterior al cambio registrado.
 * El tramo que cruza el cambio se pinta con la máquina NUEVA. No se parte en el
 * instante exacto porque entre dos fixes nadie sabe por dónde pasó el nodo —la
 * línea recta que se dibuja ahí ya es una suposición, y cortarla en un punto
 * calculado le daría una precisión que no tiene. El pin de cambio del mapa sí
 * marca el instante registrado, así que la diferencia entre el pin y el cambio
 * de color es visible y es honesta: es el hueco entre dos reportes.
 */

import { computeStats, enrichTrack } from "./geo";
import { unirTramos, type Tramo } from "./rutas";
import { maquinaDeNodoEn, operadorDeMaquinaEn, type Flota } from "./registro";
import { COLOR_DEFAULT } from "./tractores";
import type { TrackPoint } from "./types";

/** Un pedazo del recorrido hecho con una misma máquina. */
export interface PiezaRastro {
  /** null cuando en ese lapso el nodo no estaba montado en ninguna máquina. */
  maquinaId: string | null;
  codigo: string;
  nombre: string;
  color: string;
  operador: string | null;
  /** Fixes de la pieza, como [lat, lon]. */
  latlngs: [number, number][];
  /** La misma pieza ruteada por la malla vial, si se pudo calcular. */
  ruta: [number, number][] | null;
  /** Metros recorridos en la pieza, con el mismo cálculo que el resto de la app. */
  metros: number;
  desde: string | null;
  hasta: string | null;
}

const horaDe = (p: TrackPoint) => p.gps_time ?? p.sample_local;

/**
 * Parte el recorrido de un día según los cambios de máquina del nodo.
 *
 * `tramos` son los que devuelve el ruteo por vías: uno por cada par de fixes
 * consecutivos, así que `tramos[i]` va del punto `i` al `i+1`. Esa correspondencia
 * es la que permite rebanar la geometría ruteada igual que la cruda.
 *
 * Devuelve una sola pieza cuando no hubo cambios, que es el caso normal.
 */
export function partirPorMaquina(
  flota: Flota,
  nodeId: string,
  points: TrackPoint[],
  tramos: Tramo[] | null | undefined
): PiezaRastro[] {
  if (points.length === 0) return [];

  // Máquina de cada fix. Se resuelve punto por punto y no por rangos porque es
  // la misma pregunta que responde el resto de la app ("¿de quién era el nodo
  // en este instante?") y así no hay dos criterios que puedan discrepar.
  const maquinaPorPunto = points.map((p) =>
    maquinaDeNodoEn(flota, nodeId, Date.parse(horaDe(p)))
  );

  // Cortes: índices donde cambia la máquina.
  const cortes: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    if (maquinaPorPunto[i]?.id !== maquinaPorPunto[i - 1]?.id) cortes.push(i);
  }
  cortes.push(points.length);

  const piezas: PiezaRastro[] = [];
  for (let k = 0; k < cortes.length - 1; k++) {
    const ini = cortes[k];
    const fin = cortes[k + 1]; // exclusivo
    const m = maquinaPorPunto[ini];

    // La pieza arranca en el último fix de la anterior para que la línea no
    // quede cortada: el tramo que cruza el cambio se dibuja con el color nuevo.
    const desdeIdx = k === 0 ? ini : ini - 1;
    const trozo = points.slice(desdeIdx, fin);
    if (trozo.length === 0) continue;

    const operador = m ? operadorDeMaquinaEn(flota, m.id, Date.parse(horaDe(trozo[0]))) : null;

    piezas.push({
      maquinaId: m?.id ?? null,
      codigo: m?.codigo ?? "—",
      nombre: m?.nombre ?? "Sin máquina asignada",
      color: m?.color || COLOR_DEFAULT,
      operador: operador?.nombre ?? null,
      latlngs: trozo.map((p) => [p.lat, p.lon] as [number, number]),
      // `tramos[i]` va del punto i al i+1, así que la rebanada que corresponde a
      // los puntos [desdeIdx, fin) es [desdeIdx, fin-1).
      ruta: tramos ? unirTramos(tramos.slice(desdeIdx, fin - 1)) : null,
      metros: computeStats(enrichTrack(trozo), []).totalDistanceM,
      desde: horaDe(trozo[0]),
      hasta: horaDe(trozo[trozo.length - 1]),
    });
  }

  return piezas;
}

/** true si el día tuvo más de una máquina (lo único que hace útil partir). */
export function huboCambioDeMaquina(piezas: PiezaRastro[]): boolean {
  return piezas.length > 1;
}
