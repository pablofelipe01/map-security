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
import { esSilencio } from "./replay";
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
  /**
   * Índices de la pieza dentro de `points`, [idxDesde, idxHasta). Dos piezas
   * seguidas comparten el fix del corte (`idxHasta - 1` de una es `idxDesde` de
   * la siguiente): ahí es donde el rastro cambia de color en el mapa.
   */
  idxDesde: number;
  idxHasta: number;
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
      metros: computeStats(
        enrichTrack(trozo),
        [],
        tramos ? tramos.slice(desdeIdx, fin - 1) : null
      ).totalDistanceM,
      desde: horaDe(trozo[0]),
      hasta: horaDe(trozo[trozo.length - 1]),
      idxDesde: desdeIdx,
      idxHasta: fin,
    });
  }

  return piezas;
}

/** true si el día tuvo más de una máquina (lo único que hace útil partir). */
export function huboCambioDeMaquina(piezas: PiezaRastro[]): boolean {
  return piezas.length > 1;
}

/**
 * Un trozo dibujable del rastro: tramos seguidos de la misma máquina y de la
 * misma naturaleza.
 *
 * `sinSenal` = entre esos dos fixes pasaron más de `GAP_INTERPOLA_MIN` minutos (lib/replay.ts)
 * y el ruteo no alcanzó a cubrir el hueco con un camino creíble (ver
 * `esSilencio`). La línea que los une no es un recorrido sino un silencio del
 * nodo, y el mapa la dibuja punteada para que no se lea como un trayecto
 * medido. Es el mismo criterio con el que el replay deja de deslizar el marcador.
 */
export interface SegmentoRastro {
  color: string;
  sinSenal: boolean;
  latlngs: [number, number][];
}

/**
 * Parte el rastro en segmentos de color y trazo uniformes.
 *
 * Trabaja tramo a tramo (`tramos[i]` va del fix i al i+1) para que la geometría
 * ruteada por vías y el corte por máquina coincidan exactamente: el color
 * cambia en el mismo fix en que cambia en el panel. Sin ruteo todavía, cada
 * tramo es la recta entre sus dos fixes.
 */
export function segmentosDelRastro(
  points: TrackPoint[],
  piezas: PiezaRastro[],
  tramos: Tramo[] | null | undefined,
  colorBase: string
): SegmentoRastro[] {
  if (points.length < 2) return [];

  // Color de cada tramo según la pieza que lo contiene. La pieza k cubre los
  // tramos [idxDesde, idxHasta - 1).
  const colorTramo: string[] = new Array(points.length - 1).fill(colorBase);
  for (const p of piezas) {
    for (let i = p.idxDesde; i < p.idxHasta - 1 && i < colorTramo.length; i++) {
      colorTramo[i] = p.color;
    }
  }

  const out: SegmentoRastro[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const huecoMin = (Date.parse(horaDe(b)) - Date.parse(horaDe(a))) / 60_000;
    const sinSenal = esSilencio(huecoMin, tramos?.[i]);
    // En un silencio no se rutea por vías: el camino más corto entre dos
    // puntos separados por una hora sin reporte afirmaría demasiado.
    const geom: [number, number][] =
      !sinSenal && tramos?.[i]
        ? tramos[i].latlngs
        : [
            [a.lat, a.lon],
            [b.lat, b.lon],
          ];

    const u = out[out.length - 1];
    if (u && u.color === colorTramo[i] && u.sinSenal === sinSenal) {
      // Se cose al anterior sin repetir el fix compartido.
      const ult = u.latlngs[u.latlngs.length - 1];
      for (const q of geom) {
        if (q[0] === ult[0] && q[1] === ult[1]) continue;
        u.latlngs.push(q);
      }
    } else {
      out.push({ color: colorTramo[i], sinSenal, latlngs: [...geom] });
    }
  }
  return out;
}

/** El fix donde el rastro pasa de una máquina a otra, listo para el mapa. */
export interface TransicionRastro {
  lat: number;
  lon: number;
  /** Hora del fix del corte (ISO): el último reporte con la máquina anterior. */
  t: string | null;
  de: string;
  a: string;
  /** Color de la máquina nueva, que es el del tramo que sale del punto. */
  color: string;
}

/**
 * Los puntos de cambio de vehículo del día, uno por cada frontera entre piezas.
 *
 * Caen en el fix compartido por las dos piezas —el último de la máquina
 * anterior—, que es exactamente donde el rastro cambia de color. El pin de la
 * hora REGISTRADA del cambio es otro (`cambios` en app/page.tsx): este dice
 * dónde se ve el cambio en el recorrido, aquel cuándo lo anotó alguien.
 */
export function transicionesDelRastro(
  points: TrackPoint[],
  piezas: PiezaRastro[]
): TransicionRastro[] {
  const out: TransicionRastro[] = [];
  for (let k = 1; k < piezas.length; k++) {
    const p = points[piezas[k].idxDesde];
    if (!p) continue;
    out.push({
      lat: p.lat,
      lon: p.lon,
      t: horaDe(p),
      de: codigoMapa(piezas[k - 1]),
      a: codigoMapa(piezas[k]),
      color: piezas[k].color,
    });
  }
  return out;
}

/**
 * El código como se puede escribir en el mapa. La fuente del mapa sólo trae el
 * rango ASCII (ver FUENTE en components/MapGL.tsx): el "—" de "sin máquina" no
 * se dibujaría, así que se escribe con letras.
 */
function codigoMapa(p: PiezaRastro): string {
  return p.maquinaId ? p.codigo : "SIN MAQ";
}
