/**
 * Ruteo por la malla vial de Guaicaramo.
 *
 * EL PROBLEMA. El nodo Meshtastic entrega un fix cada ~9-10 min. A la velocidad
 * de un tractor eso son cientos de metros —a veces kilómetros— entre un punto y
 * el siguiente. Uniendo los fixes con una recta, el rastro corta lotes en
 * diagonal y atraviesa potreros por donde ninguna máquina pasó: el dibujo es
 * más falso que el dato, porque el tractor casi siempre va por una vía.
 *
 * LA IDEA. Se construye un grafo con las vías del predio (el mismo GeoJSON que
 * ya pinta el mapa) y entre cada par de fixes consecutivos se busca el camino
 * más corto por esa malla. El resultado se pega a las vías reales y el recorrido
 * se lee fluido, que es como de verdad se movió la máquina.
 *
 * LO QUE ESTO NO ES. Sigue siendo una RECONSTRUCCIÓN, no una medición: entre dos
 * fixes nadie sabe por dónde pasó el tractor, y el camino más corto es apenas la
 * hipótesis más razonable. Por eso cada tramo dice en `porVia` si se resolvió
 * por la malla o si quedó como la recta de antes, y por eso el ruteo se abstiene
 * en los tres casos donde inventaría más de lo que aporta:
 *
 *  1. el fix está lejos de cualquier vía (la máquina está labrando dentro del
 *     lote, no transitando);
 *  2. el desplazamiento es tan corto que cae dentro del error del GPS;
 *  3. el camino por vías da una vuelta desproporcionada frente a la recta —ahí
 *     el grafo está mal conectado o el tractor efectivamente cortó campo través.
 *
 * En esos casos se devuelve la recta, igual que antes. Nunca se mueve un fix de
 * su lugar: la polilínea entra y sale del punto medido; lo único que se rellena
 * es el silencio entre dos mediciones.
 */

import { DEFAULT_CENTER } from "./geo";

/** Mismo archivo que usa la capa de vías del mapa (ver components/MapGL.tsx). */
const VIAS_URL = "/vias-guaicaramo.geojson";

/**
 * Radio máximo para dar un fix por "sobre una vía" (m).
 *
 * Se toma igual a MOVIMIENTO_M (lib/fleet.ts): por debajo de 35 m la diferencia
 * entre dos posiciones ya no se distingue del error del GPS del nodo, así que
 * pegar el punto a una vía dentro de ese radio no está corrigiendo el dato, está
 * eligiendo entre lecturas indistinguibles. Más allá, el fix dice otra cosa —que
 * la máquina NO está en la vía— y hay que respetarlo.
 */
export const RADIO_SNAP_M = 35;

/**
 * Cuánto se le tolera al camino por vías estirarse frente a la línea recta.
 *
 * Un rodeo moderado es normal (las vías no van en diagonal). Pasado el doble más
 * 250 m de holgura, lo más probable es que falte una vía en el GeoJSON y el
 * algoritmo esté dando media vuelta al predio para llegar al lote de al lado.
 * Dibujar esa vuelta sería peor que la recta: se prefiere no afirmar nada.
 */
const FACTOR_DESVIO = 2.2;
const HOLGURA_DESVIO_M = 250;

/**
 * Desplazamiento mínimo entre fixes para molestarse en rutear (m).
 * Igual al umbral de movimiento del resto de la app: por debajo, la máquina
 * estaba quieta y el "recorrido" sería ruido.
 */
const MIN_TRAMO_M = 35;

/**
 * Tolerancia para coser la topología de las vías (m).
 *
 * El GeoJSON viene de topografía, no de un grafo de navegación: dos vías que se
 * cruzan en el terreno pueden no compartir un vértice en el archivo. Sin coser,
 * cada vía sería una isla y no habría ruta posible. Se parten los segmentos en
 * sus cruces reales y se unen los extremos que caen a menos de 3 m del interior
 * de otra vía (las "T"). 3 m es la precisión con la que están dibujadas: más
 * apretado deja la malla rota, más suelto empieza a inventar empalmes.
 */
const TOL_COSIDO_M = 3;

/** Lado de la celda del índice espacial (m). */
const CELDA_M = 60;

/** Proyección plana local: a esta escala y latitud, el error es despreciable. */
const M_LAT = 111320;
const M_LON = 111320 * Math.cos((DEFAULT_CENTER.lat * Math.PI) / 180);

/** Un tramo del recorrido: del fix i al fix i+1. */
export interface Tramo {
  /** Polilínea [lat, lon] con ambos extremos incluidos. */
  latlngs: [number, number][];
  /** true = resuelto por la malla vial. false = recta entre los dos fixes. */
  porVia: boolean;
  /** Largo de la polilínea en metros. */
  largoM: number;
}

// ---------------------------------------------------------------- grafo

export interface Grafo {
  /** Nodos en metros locales. */
  nx: number[];
  ny: number[];
  /** Lista de adyacencia: vecinos[i][k] con su peso pesos[i][k]. */
  vecinos: number[][];
  pesos: number[][];
  /** Extremos de cada arista (para proyectar un punto sobre la malla). */
  ea: number[];
  eb: number[];
  /** Celda → aristas que la tocan. */
  celdas: Map<string, number[]>;
}

type Punto = [number, number]; // [x, y] en metros locales

const dist = (a: Punto, b: Punto) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const enT = (a: Punto, b: Punto, t: number): Punto => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

/** Parámetro t de la proyección de p sobre la recta a-b (sin recortar). */
function proyT(p: Punto, a: Punto, b: Punto): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  if (!l2) return 0;
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2;
}

/** Recorre las celdas que cubre una caja, sin materializar la lista. */
function porCeldas(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cb: (clave: string) => void
) {
  const cx0 = Math.floor(x0 / CELDA_M);
  const cx1 = Math.floor(x1 / CELDA_M);
  const cy0 = Math.floor(y0 / CELDA_M);
  const cy1 = Math.floor(y1 / CELDA_M);
  for (let x = cx0; x <= cx1; x++) {
    for (let y = cy0; y <= cy1; y++) cb(`${x}:${y}`);
  }
}

/**
 * Arma el grafo a partir del GeoJSON de vías.
 *
 * Tres pasos: aplanar a segmentos rectos, cortarlos donde se cruzan o se tocan
 * (el cosido descrito arriba) y fundir los extremos que coinciden dentro de 1 m
 * para que dos vías que comparten esquina compartan también nodo.
 */
function construir(geojson: {
  features: {
    properties: Record<string, unknown> | null;
    geometry: { type: string; coordinates: unknown };
  }[];
}): Grafo {
  const segA: Punto[] = [];
  const segB: Punto[] = [];

  for (const f of geojson.features) {
    // Las proyectadas todavía no existen en el terreno: rutear por ellas sería
    // mandar al tractor por una vía que no está construida.
    if (f.properties?.TIPO === "Proyectada") continue;
    const lineas =
      f.geometry.type === "MultiLineString"
        ? (f.geometry.coordinates as number[][][])
        : f.geometry.type === "LineString"
        ? [f.geometry.coordinates as number[][]]
        : [];
    for (const linea of lineas) {
      for (let i = 1; i < linea.length; i++) {
        const a: Punto = [linea[i - 1][0] * M_LON, linea[i - 1][1] * M_LAT];
        const b: Punto = [linea[i][0] * M_LON, linea[i][1] * M_LAT];
        if (a[0] === b[0] && a[1] === b[1]) continue;
        segA.push(a);
        segB.push(b);
      }
    }
  }

  // Índice espacial provisional sobre los segmentos crudos, para no comparar
  // cada segmento contra los 12 000 restantes.
  const rejilla = new Map<string, number[]>();
  for (let i = 0; i < segA.length; i++) {
    porCeldas(
      Math.min(segA[i][0], segB[i][0]),
      Math.min(segA[i][1], segB[i][1]),
      Math.max(segA[i][0], segB[i][0]),
      Math.max(segA[i][1], segB[i][1]),
      (k) => {
        const l = rejilla.get(k);
        if (l) l.push(i);
        else rejilla.set(k, [i]);
      }
    );
  }

  // Puntos de corte de cada segmento, como parámetros t.
  const cortes: number[][] = segA.map(() => []);
  const tol2 = TOL_COSIDO_M * TOL_COSIDO_M;

  for (let i = 0; i < segA.length; i++) {
    const cand = new Set<number>();
    porCeldas(
      Math.min(segA[i][0], segB[i][0]) - TOL_COSIDO_M,
      Math.min(segA[i][1], segB[i][1]) - TOL_COSIDO_M,
      Math.max(segA[i][0], segB[i][0]) + TOL_COSIDO_M,
      Math.max(segA[i][1], segB[i][1]) + TOL_COSIDO_M,
      (k) => rejilla.get(k)?.forEach((j) => cand.add(j))
    );

    for (const j of cand) {
      if (j <= i) continue;
      const p = segA[i];
      const pr: Punto = [segB[i][0] - p[0], segB[i][1] - p[1]];
      const q = segA[j];
      const qs: Punto = [segB[j][0] - q[0], segB[j][1] - q[1]];
      const den = pr[0] * qs[1] - pr[1] * qs[0];

      // Cruce propio (X): las dos vías se atraviesan, hay que partir ambas.
      if (Math.abs(den) > 1e-9) {
        const t = ((q[0] - p[0]) * qs[1] - (q[1] - p[1]) * qs[0]) / den;
        const u = ((q[0] - p[0]) * pr[1] - (q[1] - p[1]) * pr[0]) / den;
        if (t > 0 && t < 1 && u > 0 && u < 1) {
          cortes[i].push(t);
          cortes[j].push(u);
          continue;
        }
      }

      // Empalme en T: el extremo de una cae sobre el cuerpo de la otra.
      const pares: [Punto, number][] = [
        [segA[j], i],
        [segB[j], i],
        [segA[i], j],
        [segB[i], j],
      ];
      for (const [extremo, destino] of pares) {
        const t = proyT(extremo, segA[destino], segB[destino]);
        if (t <= 0 || t >= 1) continue;
        const sobre = enT(segA[destino], segB[destino], t);
        const dx = extremo[0] - sobre[0];
        const dy = extremo[1] - sobre[1];
        if (dx * dx + dy * dy <= tol2) cortes[destino].push(t);
      }
    }
  }

  // Nodos: se funden los puntos que caen en la misma celda de 1 m. Dos vías
  // dibujadas por separado rara vez comparten el decimal exacto.
  const idPorClave = new Map<string, number>();
  const nx: number[] = [];
  const ny: number[] = [];
  const nodo = (p: Punto): number => {
    const k = `${Math.round(p[0])}_${Math.round(p[1])}`;
    let i = idPorClave.get(k);
    if (i === undefined) {
      i = nx.length;
      idPorClave.set(k, i);
      nx.push(p[0]);
      ny.push(p[1]);
    }
    return i;
  };

  const vecinos: number[][] = [];
  const pesos: number[][] = [];
  const ea: number[] = [];
  const eb: number[] = [];

  for (let i = 0; i < segA.length; i++) {
    const ts = [...new Set([0, 1, ...cortes[i]])].sort((x, y) => x - y);
    for (let k = 1; k < ts.length; k++) {
      const A = enT(segA[i], segB[i], ts[k - 1]);
      const B = enT(segA[i], segB[i], ts[k]);
      const w = dist(A, B);
      if (w < 0.2) continue; // esquirla del corte: no aporta camino.
      const a = nodo(A);
      const b = nodo(B);
      if (a === b) continue;
      (vecinos[a] ??= []).push(b);
      (pesos[a] ??= []).push(w);
      (vecinos[b] ??= []).push(a);
      (pesos[b] ??= []).push(w);
      ea.push(a);
      eb.push(b);
    }
  }

  // Índice definitivo, ahora sobre las aristas ya partidas: es contra este que
  // se proyecta cada fix del tractor.
  const celdas = new Map<string, number[]>();
  for (let i = 0; i < ea.length; i++) {
    porCeldas(
      Math.min(nx[ea[i]], nx[eb[i]]),
      Math.min(ny[ea[i]], ny[eb[i]]),
      Math.max(nx[ea[i]], nx[eb[i]]),
      Math.max(ny[ea[i]], ny[eb[i]]),
      (k) => {
        const l = celdas.get(k);
        if (l) l.push(i);
        else celdas.set(k, [i]);
      }
    );
  }

  return { nx, ny, vecinos, pesos, ea, eb, celdas };
}

/**
 * El grafo, construido una sola vez por sesión y compartido.
 *
 * Se arma en el navegador en vez de precalcularse en un archivo aparte para que
 * no exista una segunda copia de las vías que pueda quedar desfasada de la que
 * pinta el mapa: la fuente de verdad sigue siendo el GeoJSON. Cuesta ~200 ms una
 * vez, y el archivo ya está en la caché del navegador porque el mapa lo pidió.
 */
let grafoPromesa: Promise<Grafo | null> | null = null;

export function grafoVias(): Promise<Grafo | null> {
  grafoPromesa ??= fetch(VIAS_URL)
    .then((r) => {
      if (!r.ok) throw new Error(`vías: HTTP ${r.status}`);
      return r.json();
    })
    .then(construir)
    .catch((e) => {
      // Sin vías no hay ruteo, pero la app sigue: los rastros vuelven a ser
      // rectas, que es exactamente el comportamiento anterior.
      console.warn("[rutas] no se pudo armar el grafo de vías:", e);
      return null;
    });
  return grafoPromesa;
}

// ---------------------------------------------------------------- proyección

interface Anclaje {
  arista: number;
  /** Posición sobre la arista, 0 = extremo `ea`, 1 = extremo `eb`. */
  t: number;
  /** Punto proyectado, en metros locales. */
  p: Punto;
  /** Distancia del fix a la vía (m). */
  d: number;
}

/** La vía más cercana a un punto, si hay alguna dentro del radio. */
function anclar(g: Grafo, p: Punto, radio: number): Anclaje | null {
  let mejor: Anclaje | null = null;
  porCeldas(p[0] - radio, p[1] - radio, p[0] + radio, p[1] + radio, (k) => {
    const lista = g.celdas.get(k);
    if (!lista) return;
    for (const i of lista) {
      const a: Punto = [g.nx[g.ea[i]], g.ny[g.ea[i]]];
      const b: Punto = [g.nx[g.eb[i]], g.ny[g.eb[i]]];
      const t = Math.min(1, Math.max(0, proyT(p, a, b)));
      const sobre = enT(a, b, t);
      const d = dist(p, sobre);
      if (d <= radio && (!mejor || d < mejor.d)) {
        mejor = { arista: i, t, p: sobre, d };
      }
    }
  });
  return mejor;
}

// ---------------------------------------------------------------- A*

/** Montículo binario mínimo. Lo justo para la cola de prioridad del A*. */
class Cola {
  private f: number[] = [];
  private v: number[] = [];

  get vacia() {
    return this.f.length === 0;
  }

  push(valor: number, prioridad: number) {
    this.f.push(prioridad);
    this.v.push(valor);
    let i = this.f.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.f[p] <= this.f[i]) break;
      this.swap(p, i);
      i = p;
    }
  }

  pop(): [number, number] {
    const top: [number, number] = [this.v[0], this.f[0]];
    const uf = this.f.pop()!;
    const uv = this.v.pop()!;
    if (this.f.length) {
      this.f[0] = uf;
      this.v[0] = uv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.f.length && this.f[l] < this.f[m]) m = l;
        if (r < this.f.length && this.f[r] < this.f[m]) m = r;
        if (m === i) break;
        this.swap(m, i);
        i = m;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.f[a], this.f[b]] = [this.f[b], this.f[a]];
    [this.v[a], this.v[b]] = [this.v[b], this.v[a]];
  }
}

/** Largo de una arista, en metros. */
function largoArista(g: Grafo, i: number): number {
  return Math.hypot(g.nx[g.ea[i]] - g.nx[g.eb[i]], g.ny[g.ea[i]] - g.ny[g.eb[i]]);
}

/**
 * Camino más corto entre dos puntos anclados a la malla.
 *
 * A* con heurística euclidiana —admisible, porque en el plano ninguna vía es más
 * corta que la recta— y con un techo duro de distancia: apenas el mejor
 * candidato pendiente supera `limite`, la búsqueda se abandona. Sin ese techo,
 * dos fixes en extremos desconectados de la malla harían recorrer el grafo
 * entero para terminar devolviendo null.
 *
 * Como los anclajes caen en medio de una arista y no sobre un nodo, la búsqueda
 * arranca desde los dos extremos de la arista de origen (con su costo parcial) y
 * termina en cualquiera de los dos de la de destino, quedándose con la mejor
 * combinación.
 */
function caminoMasCorto(
  g: Grafo,
  desde: Anclaje,
  hasta: Anclaje,
  limite: number
): { nodos: number[]; largoM: number } | null {
  const tx = hasta.p[0];
  const ty = hasta.p[1];
  const h = (n: number) => Math.hypot(g.nx[n] - tx, g.ny[n] - ty);

  const coste = new Map<number, number>();
  const previo = new Map<number, number>();
  const abierta = new Cola();

  const largoIni = largoArista(g, desde.arista);
  for (const [n, off] of [
    [g.ea[desde.arista], desde.t],
    [g.eb[desde.arista], 1 - desde.t],
  ] as [number, number][]) {
    const c = off * largoIni;
    if (!coste.has(n) || coste.get(n)! > c) {
      coste.set(n, c);
      abierta.push(n, c + h(n));
    }
  }

  const largoFin = largoArista(g, hasta.arista);
  const metas = new Map<number, number>([
    [g.ea[hasta.arista], hasta.t * largoFin],
    [g.eb[hasta.arista], (1 - hasta.t) * largoFin],
  ]);

  let mejorTotal = Infinity;
  let mejorNodo = -1;

  while (!abierta.vacia) {
    const [n, f] = abierta.pop();
    // Nada de lo que queda puede mejorar lo ya encontrado (ni entrar en el
    // techo): se corta acá.
    if (f >= mejorTotal || f > limite) break;
    const gn = coste.get(n);
    if (gn === undefined) continue;

    const remate = metas.get(n);
    if (remate !== undefined && gn + remate < mejorTotal) {
      mejorTotal = gn + remate;
      mejorNodo = n;
    }

    const vs = g.vecinos[n];
    if (!vs) continue;
    for (let k = 0; k < vs.length; k++) {
      const m = vs[k];
      const ng = gn + g.pesos[n][k];
      if (ng > limite) continue;
      const actual = coste.get(m);
      if (actual === undefined || ng < actual) {
        coste.set(m, ng);
        previo.set(m, n);
        abierta.push(m, ng + h(m));
      }
    }
  }

  if (mejorNodo < 0) return null;

  const nodos: number[] = [];
  let c: number | undefined = mejorNodo;
  while (c !== undefined) {
    nodos.push(c);
    c = previo.get(c);
  }
  nodos.reverse();
  return { nodos, largoM: mejorTotal };
}

// ---------------------------------------------------------------- API

const latDe = (y: number) => y / M_LAT;
const lonDe = (x: number) => x / M_LON;

/** Recta pelada entre dos fixes: el comportamiento de siempre. */
function tramoRecto(a: [number, number], b: [number, number]): Tramo {
  return {
    latlngs: [a, b],
    porVia: false,
    largoM: dist(aPlano(a), aPlano(b)),
  };
}

const aPlano = ([lat, lon]: [number, number]): Punto => [lon * M_LON, lat * M_LAT];

/**
 * Caché de tramos ya resueltos.
 *
 * En vivo la app recarga el día completo cada minuto, y el 99 % de los tramos es
 * idéntico al del minuto anterior: sin caché se re-rutearía toda la jornada de
 * las seis máquinas en cada sondeo. La clave son los dos fixes redondeados a
 * 5 decimales (~1 m), que es toda la resolución que tiene el GPS del nodo.
 */
const cache = new Map<string, Tramo>();
const CACHE_MAX = 20_000;

function clave(a: [number, number], b: [number, number], radio: number) {
  return `${a[0].toFixed(5)},${a[1].toFixed(5)}>${b[0].toFixed(5)},${b[1].toFixed(5)}@${radio}`;
}

/**
 * Resuelve un solo tramo entre dos fixes consecutivos.
 *
 * `radio` es hasta dónde se busca una vía para anclar cada extremo. Por defecto
 * es `RADIO_SNAP_M` (35 m), que es el que corresponde cuando se está
 * reconstruyendo un recorrido medido. La planeación lo abre a propósito; el
 * porqué está en `lib/planeacion.ts`.
 */
function rutearTramo(
  g: Grafo,
  a: [number, number],
  b: [number, number],
  radio: number = RADIO_SNAP_M
): Tramo {
  const pa = aPlano(a);
  const pb = aPlano(b);
  const recta = dist(pa, pb);

  // Quieto: rutear ruido del GPS sólo produciría zigzag sobre la vía.
  if (recta < MIN_TRAMO_M) return tramoRecto(a, b);

  const anclaA = anclar(g, pa, radio);
  const anclaB = anclar(g, pb, radio);
  // Alguno de los dos no está sobre una vía: el tractor está dentro del lote.
  if (!anclaA || !anclaB) return tramoRecto(a, b);

  const limite = recta * FACTOR_DESVIO + HOLGURA_DESVIO_M;

  // Mismo tramo de vía: no hay nada que buscar, se va derecho por la arista.
  if (anclaA.arista === anclaB.arista) {
    const latlngs = dedup([
      a,
      aGeo(anclaA.p),
      aGeo(anclaB.p),
      b,
    ]);
    return { latlngs, porVia: true, largoM: largoDe(latlngs) };
  }

  const camino = caminoMasCorto(g, anclaA, anclaB, limite);
  if (!camino) return tramoRecto(a, b);

  // Rodeo desproporcionado: probablemente falta una vía en el archivo.
  if (camino.largoM > limite) return tramoRecto(a, b);

  const latlngs = dedup([
    a,
    aGeo(anclaA.p),
    ...camino.nodos.map((n): [number, number] => [latDe(g.ny[n]), lonDe(g.nx[n])]),
    aGeo(anclaB.p),
    b,
  ]);
  return { latlngs, porVia: true, largoM: largoDe(latlngs) };
}

const aGeo = (p: Punto): [number, number] => [latDe(p[1]), lonDe(p[0])];

/** Quita vértices repetidos (el anclaje suele caer justo sobre un nodo). */
function dedup(pts: [number, number][]): [number, number][] {
  const out: [number, number][] = [];
  for (const p of pts) {
    const u = out[out.length - 1];
    if (u && dist(aPlano(u), aPlano(p)) < 0.5) continue;
    out.push(p);
  }
  return out;
}

function largoDe(pts: [number, number][]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += dist(aPlano(pts[i - 1]), aPlano(pts[i]));
  return m;
}

/**
 * Rutea un rastro completo: devuelve un tramo por cada par de fixes
 * consecutivos, de modo que `tramos[i]` va del fix `i` al fix `i+1` y hay
 * exactamente `latlngs.length - 1` tramos. Esa correspondencia uno a uno es la
 * que le permite al replay saber en qué tramo está la máquina a cada minuto.
 */
export function rutearRastro(
  g: Grafo,
  latlngs: [number, number][],
  radio: number = RADIO_SNAP_M
): Tramo[] {
  const out: Tramo[] = [];
  for (let i = 1; i < latlngs.length; i++) {
    const a = latlngs[i - 1];
    const b = latlngs[i];
    const k = clave(a, b, radio);
    let tramo = cache.get(k);
    if (!tramo) {
      tramo = rutearTramo(g, a, b, radio);
      // Vaciado brusco en vez de LRU: son datos derivados y baratos de recalcular,
      // y un día completo de la flota cabe de sobra antes del tope.
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(k, tramo);
    }
    out.push(tramo);
  }
  return out;
}

/** Une los tramos en una sola polilínea, sin repetir los fixes compartidos. */
export function unirTramos(tramos: Tramo[]): [number, number][] {
  const out: [number, number][] = [];
  for (const t of tramos) {
    for (const p of t.latlngs) {
      const u = out[out.length - 1];
      if (u && u[0] === p[0] && u[1] === p[1]) continue;
      out.push(p);
    }
  }
  return out;
}

/**
 * Posición a la fracción `f` (0-1) del tramo, avanzando por su polilínea.
 *
 * El reparto es por distancia, no por tiempo: dentro de un tramo no hay más
 * mediciones, así que suponer velocidad constante es lo único que se puede
 * hacer. Devuelve también el rumbo del trocito por el que va pasando, que es lo
 * que hace que el ícono del tractor gire al tomar una curva en vez de apuntar
 * siempre a la línea recta entre fixes.
 */
export function posicionEnTramo(
  tramo: Tramo,
  f: number
): { lat: number; lon: number; rumbo: number } {
  const pts = tramo.latlngs;
  const objetivo = Math.max(0, Math.min(1, f)) * tramo.largoM;
  let acum = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = dist(aPlano(pts[i - 1]), aPlano(pts[i]));
    if (acum + d >= objetivo || i === pts.length - 1) {
      const local = d > 0 ? (objetivo - acum) / d : 0;
      const k = Math.max(0, Math.min(1, local));
      const [latA, lonA] = pts[i - 1];
      const [latB, lonB] = pts[i];
      return {
        lat: latA + (latB - latA) * k,
        lon: lonA + (lonB - lonA) * k,
        rumbo: rumboEntre(pts[i - 1], pts[i]),
      };
    }
    acum += d;
  }
  const [lat, lon] = pts[pts.length - 1];
  return { lat, lon, rumbo: rumboEntre(pts[0], pts[pts.length - 1]) };
}

/** Rumbo 0-360° entre dos puntos, sobre el plano local (basta a esta escala). */
function rumboEntre(a: [number, number], b: [number, number]): number {
  const dx = (b[1] - a[1]) * M_LON;
  const dy = (b[0] - a[0]) * M_LAT;
  return ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
}
