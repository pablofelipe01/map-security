/**
 * Ruteo dentro del lote, por las calles entre hileras de palma.
 *
 * EL PROBLEMA. lib/rutas.ts rellena el silencio entre dos fixes con el camino
 * por las vías. Pero un tractor de aplicaciones pasa la jornada DENTRO del lote:
 * el MA106 el 28 sep estuvo 5 h en el bloque 9 y casi ningún fix quedó a menos
 * de 35 m de una vía. Ahí el ruteo por vías se abstiene y el rastro queda como
 * rectas de 50-150 m que cruzan las hileras en diagonal, algo que un tractor
 * no puede hacer: entre dos hileras de palma sólo se avanza a lo largo de la
 * calle, y se cambia de calle en la cabecera.
 *
 * LA IDEA. Con el censo de líneas (lib/palmas.ts) cada parcela se vuelve un
 * juego de "calles": el eje entre dos hileras vecinas, con su principio y su
 * fin. Un fix dentro del lote se ubica en una calle y en una posición a lo largo
 * de ella. Entre dos fixes en calles distintas el tractor tuvo que ir y volver:
 * baja por su calle hasta la cabecera, pasa a otra, la recorre entera, vuelve a
 * pasar, y así hasta la calle del fix siguiente. Es el zigzag de la labor.
 *
 * CUÁNTAS CALLES. Entre la calle del fix A y la del fix B puede haber, digamos,
 * seis. Recorrerlas todas una por una son 6 × 234 m; saltar directo de la
 * primera a la última por la cabecera son ~300 m. Los fixes no dicen cuál fue,
 * pero sí cuánto tiempo pasó: se prueban todos los pasos posibles (de 1 en 1,
 * de 2 en 2… hasta el salto directo) y se queda el zigzag cuyo largo más se
 * parece a lo que la máquina alcanza a recorrer en ese tiempo a paso de labor
 * (`VEL_LABOR_KMH`). Sin tiempo, el salto directo, que es lo mínimo seguro.
 *
 * LO QUE ESTO NO ES. Como el resto del ruteo, es una reconstrucción: el dibujo
 * respeta que el tractor anda por las calles y gira en las cabeceras, y tiene
 * el largo que el tiempo permite, pero cuáles calles exactas recorrió entre dos
 * fixes nadie lo sabe. Los fixes nunca se mueven.
 */

import { DEFAULT_CENTER } from "./geo";
import {
  bloquesTocados,
  indicePalmas,
  lineasDeBloque,
  type LineasPalma,
} from "./palmas";

/**
 * Velocidad supuesta en labor (km/h). Una aplicación de fertilizante con
 * tractor anda a 4-6 km/h. `ground_speed` del nodo no sirve para afinarla (ver
 * lib/types.ts), así que es una constante: sólo decide cuántas calles "caben"
 * entre dos fixes, no dónde queda ninguno.
 */
const VEL_LABOR_KMH = 5;

/** Pasado este silencio no se estima recorrido por tiempo (min). */
const MAX_MIN_PRESUPUESTO = 30;

/**
 * Cuánto puede salirse un fix del principio o el fin de su calle y seguir
 * contando como "en la calle" (m). El GPS del nodo yerra ~5-10 m, y en la
 * cabecera el tractor gira más allá de la última palma.
 */
const HOLGURA_CABECERA_M = 15;

/**
 * Hileras a menos de esto en su eje se tratan como la misma (m). El censo parte
 * una hilera en dos cuando la cruza un canal o un claro; son la misma calle.
 */
const MISMA_HILERA_M = 1.5;

/** Dos hileras son del mismo juego si su rumbo difiere menos de esto (°). */
const TOL_RUMBO = 10;

const M_LAT = 111320;
const M_LON = 111320 * Math.cos((DEFAULT_CENTER.lat * Math.PI) / 180);

type Punto = [number, number]; // metros locales [x, y]
const aPlano = ([lat, lon]: [number, number]): Punto => [lon * M_LON, lat * M_LAT];
const aGeo = ([x, y]: Punto): [number, number] => [y / M_LAT, x / M_LON];
const dist = (a: Punto, b: Punto) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** El eje entre dos hileras vecinas, en coordenadas del juego (s a lo largo, o de lado). */
interface Calle {
  o: number;
  s0: number;
  s1: number;
}

/** Un juego de hileras paralelas de una parcela. */
interface Juego {
  parcela: string;
  /** Unitario a lo largo de las hileras y su normal. */
  u: Punto;
  v: Punto;
  /** Calles ordenadas por `o`. */
  calles: Calle[];
  /** Separación típica entre calles (m). */
  paso: number;
  /** Caja en metros locales, con holgura, para descartar rápido. */
  caja: [number, number, number, number];
}

export interface Surcos {
  juegos: Juego[];
}

/** Dónde cae un punto dentro de las calles. */
export interface Ubicacion {
  juego: Juego;
  j: number;
  /** Posición a lo largo de la calle, ya recortada a su largo. */
  s: number;
}

// ---------------------------------------------------------------- modelo

const aJuego = (j: Juego, s: number, o: number): Punto => [
  j.u[0] * s + j.v[0] * o,
  j.u[1] * s + j.v[1] * o,
];

function mediana(xs: number[]): number {
  const a = [...xs].sort((x, y) => x - y);
  return a[a.length >> 1] ?? 0;
}

/** Arma los juegos de calles de las líneas de un bloque. */
export function construirSurcos(fc: LineasPalma): Surcos {
  const porParcela = new Map<string, [Punto, Punto][]>();
  for (const f of fc.features) {
    const c = f.geometry.coordinates;
    if (c.length < 2) continue;
    // Una hilera es una recta: basta con sus extremos.
    const a = aPlano([c[0][1], c[0][0]]);
    const b = aPlano([c[c.length - 1][1], c[c.length - 1][0]]);
    if (dist(a, b) < 5) continue;
    const l = porParcela.get(f.properties.parcela) ?? [];
    l.push([a, b]);
    porParcela.set(f.properties.parcela, l);
  }

  const juegos: Juego[] = [];
  for (const [parcela, hileras] of porParcela) {
    // Siembra en triángulo: las hileras de una parcela pueden estar trazadas
    // en cualquiera de tres rumbos (0°, 60°, 120°), y el censo mezcla. Cada
    // rumbo es un juego de calles aparte.
    const grupos: { rumbo: number; hs: [Punto, Punto][] }[] = [];
    for (const [a, b] of hileras) {
      const r = ((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI + 180) % 180;
      const g = grupos.find((x) => {
        const d = Math.abs(x.rumbo - r);
        return Math.min(d, 180 - d) < TOL_RUMBO;
      });
      if (g) g.hs.push([a, b]);
      else grupos.push({ rumbo: r, hs: [[a, b]] });
    }

    for (const g of grupos) {
      // Muy pocas hileras en un rumbo: son retazos de borde, no un juego.
      if (g.hs.length < 4) continue;
      const rad = (g.rumbo * Math.PI) / 180;
      const u: Punto = [Math.cos(rad), Math.sin(rad)];
      const v: Punto = [-u[1], u[0]];
      const proy = (p: Punto) => [p[0] * u[0] + p[1] * u[1], p[0] * v[0] + p[1] * v[1]];

      // Hileras en coordenadas del juego, fundiendo los tramos de una misma
      // hilera partida.
      const filas = g.hs
        .map(([a, b]) => {
          const [sa, oa] = proy(a);
          const [sb, ob] = proy(b);
          return { o: (oa + ob) / 2, s0: Math.min(sa, sb), s1: Math.max(sa, sb) };
        })
        .sort((x, y) => x.o - y.o);
      const unidas: Calle[] = [];
      for (const f of filas) {
        const u0 = unidas[unidas.length - 1];
        if (u0 && f.o - u0.o < MISMA_HILERA_M) {
          u0.s0 = Math.min(u0.s0, f.s0);
          u0.s1 = Math.max(u0.s1, f.s1);
        } else unidas.push({ ...f });
      }
      if (unidas.length < 4) continue;

      const paso = mediana(unidas.slice(1).map((f, i) => f.o - unidas[i].o));
      const calles: Calle[] = [];
      for (let i = 1; i < unidas.length; i++) {
        const a = unidas[i - 1];
        const b = unidas[i];
        // Hueco mayor que dos pasos: hay un canal, una vía o un claro entre las
        // dos hileras. No es una calle por la que se ande de corrido.
        if (b.o - a.o > paso * 2.2) continue;
        const s0 = Math.max(a.s0, b.s0);
        const s1 = Math.min(a.s1, b.s1);
        if (s1 - s0 < 10) continue;
        calles.push({ o: (a.o + b.o) / 2, s0, s1 });
      }
      if (calles.length < 2) continue;

      const pts = g.hs.flat();
      const H = HOLGURA_CABECERA_M + paso;
      juegos.push({
        parcela,
        u,
        v,
        calles,
        paso,
        caja: [
          Math.min(...pts.map((p) => p[0])) - H,
          Math.min(...pts.map((p) => p[1])) - H,
          Math.max(...pts.map((p) => p[0])) + H,
          Math.max(...pts.map((p) => p[1])) + H,
        ],
      });
    }
  }
  return { juegos };
}

function ubicar(sur: Surcos, p: Punto): Ubicacion | null {
  let mejor: (Ubicacion & { d: number }) | null = null;
  for (const juego of sur.juegos) {
    const [x0, y0, x1, y1] = juego.caja;
    if (p[0] < x0 || p[0] > x1 || p[1] < y0 || p[1] > y1) continue;
    const s = p[0] * juego.u[0] + p[1] * juego.u[1];
    const o = p[0] * juego.v[0] + p[1] * juego.v[1];
    const cs = juego.calles;
    // Búsqueda binaria de la calle más cercana por su eje.
    let lo = 0;
    let hi = cs.length - 1;
    while (hi - lo > 1) {
      const m = (lo + hi) >> 1;
      if (cs[m].o < o) lo = m;
      else hi = m;
    }
    for (const j of [lo, hi]) {
      const c = cs[j];
      const lado = Math.abs(o - c.o);
      if (lado > juego.paso) continue;
      const fuera = Math.max(0, c.s0 - s, s - c.s1);
      if (fuera > HOLGURA_CABECERA_M) continue;
      const d = lado + fuera;
      if (!mejor || d < mejor.d) {
        mejor = { juego, j, s: Math.min(c.s1, Math.max(c.s0, s)), d };
      }
    }
  }
  return mejor;
}

/**
 * Hasta dónde se le busca calle a un fix de cabecera cuando el otro extremo
 * del tramo sí está en una calle del mismo juego (m). Es el tractor que salió a
 * la cabecera a cargar —el MA106 vuelve cada hora a un punto a ~20 m del final
 * de las hileras—: sin esto, el tramo de vuelta a la calle sería una recta de
 * cientos de metros cruzando el lote.
 */
const RADIO_CABECERA_M = 60;

/** La calle de `juego` más cercana a `p`, si está a menos de `radio`. */
function ubicarEn(juego: Juego, p: Punto, radio: number): Ubicacion | null {
  const s = p[0] * juego.u[0] + p[1] * juego.u[1];
  const o = p[0] * juego.v[0] + p[1] * juego.v[1];
  let mejor: (Ubicacion & { d: number }) | null = null;
  juego.calles.forEach((c, j) => {
    const sc = Math.min(c.s1, Math.max(c.s0, s));
    const d = Math.hypot(s - sc, o - c.o);
    if (d <= radio && (!mejor || d < mejor.d)) mejor = { juego, j, s: sc, d };
  });
  return mejor;
}

/** Como `ubicarEn`, en cualquier juego cuya caja toque el punto. */
function ubicarCerca(sur: Surcos, p: Punto, radio: number): Ubicacion | null {
  let mejor: Ubicacion | null = null;
  let dMejor = Infinity;
  for (const juego of sur.juegos) {
    const [x0, y0, x1, y1] = juego.caja;
    if (p[0] < x0 - radio || p[0] > x1 + radio || p[1] < y0 - radio || p[1] > y1 + radio) continue;
    const u = ubicarEn(juego, p, radio);
    if (!u) continue;
    const c = juego.calles[u.j];
    const d = dist(p, aJuego(juego, u.s, c.o));
    if (d < dMejor) {
      dMejor = d;
      mejor = u;
    }
  }
  return mejor;
}

/**
 * Hasta dónde se le busca calle en el lote de sus vecinos a un fix que cayó en
 * otro lote (m). Es el borde entre dos parcelas: el GPS del nodo yerra 5-10 m y
 * las cabeceras de dos lotes vecinos quedan a pocos metros, así que un fix ahí
 * no dice de qué lado estaba el tractor. Más lejos, el fix sí dice que salió.
 */
const RADIO_BORDE_M = 25;

/**
 * Ubica en las calles todos los fixes de un rastro, con continuidad.
 *
 * Cada fix por separado se va a la calle más cercana, de cualquier lote y de
 * cualquier rumbo. En el borde entre parcelas eso falla: el MA106 el 28 sep
 * labró sólo la 9-4, pero dos fixes suyos cayeron sobre la linde con la 9-3 y
 * uno quedó en las calles de la 9-3, que están sembradas en otro rumbo. El
 * tramo de salida se dibujaba entonces por la cabecera de la 9-3, con las
 * líneas cruzadas respecto al cultivo, en una parcela donde no estuvo.
 *
 * Por eso, si ningún vecino del fix (el anterior o el siguiente) está en su
 * mismo juego de calles, y el fix queda a menos de `RADIO_BORDE_M` de una calle
 * del juego de un vecino, se pasa a ese juego: un tractor no cambia de lote
 * por un solo reporte que cae justo en la linde.
 */
export function ubicarRastro(
  sur: Surcos,
  latlngs: [number, number][]
): (Ubicacion | null)[] {
  const pts = latlngs.map(aPlano);
  const crudas = pts.map((p) => ubicar(sur, p));
  return crudas.map((u, i) => {
    if (!u) return u;
    const vecinos = [crudas[i - 1], crudas[i + 1]].filter(
      (v): v is Ubicacion => !!v
    );
    if (!vecinos.length || vecinos.some((v) => v.juego === u.juego)) return u;
    let mejor: Ubicacion | null = null;
    let dMejor = Infinity;
    for (const v of vecinos) {
      const alt = ubicarEn(v.juego, pts[i], RADIO_BORDE_M);
      if (!alt) continue;
      const d = dist(pts[i], aJuego(v.juego, alt.s, v.juego.calles[alt.j].o));
      if (d < dMejor) {
        dMejor = d;
        mejor = alt;
      }
    }
    return mejor ?? u;
  });
}

/** Identifica una ubicación para la caché de tramos. */
export function claveUbicacion(sur: Surcos, u: Ubicacion | null | undefined): string {
  return u ? `${sur.juegos.indexOf(u.juego)}.${u.j}` : "-";
}

// ---------------------------------------------------------------- zigzag

const extremo = (c: Calle, e: 0 | 1) => (e === 0 ? c.s0 : c.s1);

/** Largo de una polilínea en metros locales. */
function largo(pts: Punto[]): number {
  let m = 0;
  for (let i = 1; i < pts.length; i++) m += dist(pts[i - 1], pts[i]);
  return m;
}

/**
 * El zigzag de la calle `a.j` a la calle `b.j` saltando de `paso` en `paso`,
 * con el primer giro en el extremo `e`.
 */
function zigzag(a: Ubicacion, b: Ubicacion, paso: number, e: 0 | 1): Punto[] {
  const J = a.juego;
  const dir = Math.sign(b.j - a.j);
  const pts: Punto[] = [aJuego(J, a.s, J.calles[a.j].o)];
  let j = a.j;
  let lado = e;
  pts.push(aJuego(J, extremo(J.calles[j], lado), J.calles[j].o));
  for (;;) {
    const sig = Math.abs(b.j - j) <= paso ? b.j : j + dir * paso;
    // El paso de una calle a otra va por la cabecera, tocando el extremo de
    // cada calle intermedia. Con una recta directa, en un lote de borde
    // irregular el salto largo cortaría hileras en diagonal.
    for (let k = j + dir; k !== sig + dir; k += dir) {
      const ck = J.calles[k];
      pts.push(aJuego(J, extremo(ck, lado), ck.o));
    }
    const c = J.calles[sig];
    j = sig;
    if (j === b.j) break;
    lado = lado === 0 ? 1 : 0;
    pts.push(aJuego(J, extremo(c, lado), c.o));
  }
  pts.push(aJuego(J, b.s, J.calles[b.j].o));
  return pts;
}

/** El camino por las calles entre dos ubicaciones del mismo juego. */
function entreCalles(a: Ubicacion, b: Ubicacion, presupuestoM: number | null): Punto[] {
  const J = a.juego;
  if (a.j === b.j) return [aJuego(J, a.s, J.calles[a.j].o), aJuego(J, b.s, J.calles[b.j].o)];
  const n = Math.abs(b.j - a.j);
  let mejor: Punto[] | null = null;
  let mejorCosto = Infinity;
  for (let paso = 1; paso <= n; paso++) {
    for (const e of [0, 1] as const) {
      const pts = zigzag(a, b, paso, e);
      const L = largo(pts);
      // Sin presupuesto, el más corto; con presupuesto, el que más se le parece.
      const costo = presupuestoM === null ? L : Math.abs(L - presupuestoM);
      if (costo < mejorCosto) {
        mejorCosto = costo;
        mejor = pts;
      }
    }
  }
  return mejor!;
}

/**
 * De la ubicación hasta el punto de la cabecera del lote más cercano a `hacia`.
 *
 * No basta con salir por el extremo de la propia calle: si el fix está en una
 * calle corta de la punta del lote y el destino queda al otro lado, esa salida
 * deja un tramo largo cruzando las hileras. Se elige el extremo de calle de
 * todo el juego más cercano a `hacia`, y hasta él se va por las calles y la
 * cabecera (el zigzag mínimo).
 */
function salida(u: Ubicacion, hacia: Punto): Punto[] {
  const J = u.juego;
  let mejor: Ubicacion = u;
  let dMejor = Infinity;
  J.calles.forEach((c, j) => {
    for (const s of [c.s0, c.s1]) {
      const d = dist(aJuego(J, s, c.o), hacia);
      if (d < dMejor) {
        dMejor = d;
        mejor = { juego: J, j, s };
      }
    }
  });
  return entreCalles(u, mejor, null);
}

// ---------------------------------------------------------------- API

/**
 * Resultado de mirar un tramo contra las calles:
 *  - `completo`: los dos fixes están en calles del mismo juego y el tramo sale
 *    entero por ellas;
 *  - `salida` / `entrada`: sólo un extremo está en una calle; se da el trocito
 *    por la calle hasta la cabecera, y el resto lo resuelve el ruteo por vías
 *    desde ahí;
 *  - null: ningún fix está en una calle.
 */
export type ResultadoSurco =
  | { tipo: "completo"; latlngs: [number, number][] }
  | {
      tipo: "parcial";
      /** Trocito del fix A a la cabecera (o null si A no está en calle). */
      salida: [number, number][] | null;
      /** Trocito de la cabecera al fix B (o null si B no está en calle). */
      entrada: [number, number][] | null;
    }
  | null;

/**
 * Mira un tramo entre dos fixes contra las calles de palma.
 *
 * `minutos` es el tiempo entre los fixes; con él se elige el zigzag (ver el
 * encabezado). Los fixes van tal cual al principio y al final: lo que se dibuja
 * entre medias se pega al eje de la calle.
 */
export function rutearPorSurcos(
  sur: Surcos,
  a: [number, number],
  b: [number, number],
  minutos: number | null,
  /** Ubicaciones ya resueltas con continuidad (ver `ubicarRastro`). */
  pre?: { ua: Ubicacion | null; ub: Ubicacion | null }
): ResultadoSurco {
  const pa = aPlano(a);
  const pb = aPlano(b);
  let ua = pre ? pre.ua : ubicar(sur, pa);
  let ub = pre ? pre.ub : ubicar(sur, pb);
  if (!ua && !ub) return null;
  // Uno en calle y el otro en la cabecera del mismo lote: se ancla también.
  // Si no, en la cabecera de otro lote vecino: el tramo sale de un lote y
  // entra al otro por sus cabeceras.
  if (ua && !ub) {
    ub = ubicarEn(ua.juego, pb, RADIO_CABECERA_M) ?? ubicarCerca(sur, pb, RADIO_CABECERA_M);
  }
  if (ub && !ua) {
    ua = ubicarEn(ub.juego, pa, RADIO_CABECERA_M) ?? ubicarCerca(sur, pa, RADIO_CABECERA_M);
  }

  const pegar = (medio: Punto[]): [number, number][] => [a, ...medio.map(aGeo), b];

  if (ua && ub && ua.juego === ub.juego) {
    const presupuesto =
      minutos !== null && minutos > 0 && minutos <= MAX_MIN_PRESUPUESTO
        ? (minutos * VEL_LABOR_KMH * 1000) / 60
        : null;
    return { tipo: "completo", latlngs: dedup(pegar(entreCalles(ua, ub, presupuesto))) };
  }

  const salA = ua ? salida(ua, pb) : null;
  // Se entra al lote de B por la cabecera más cercana a donde salió A.
  const entB = ub ? salida(ub, salA ? salA[salA.length - 1] : pa).reverse() : null;
  return {
    tipo: "parcial",
    salida: salA ? dedup([a, ...salA.map(aGeo)]) : null,
    entrada: entB ? dedup([...entB.map(aGeo), b]) : null,
  };
}

/**
 * Quita los vértices que no cambian el dibujo (Douglas-Peucker a 1 m). La
 * cabecera toca el extremo de cada calle, y en un borde recto son decenas de
 * puntos alineados. Tiene que ser Douglas-Peucker y no "quitar el que no
 * dobla" punto a punto: eso va limando una cabecera curva hasta volverla una
 * recta que corta las hileras.
 */
function dedup(pts: [number, number][]): [number, number][] {
  if (pts.length <= 2) return pts;
  const P = pts.map(aPlano);
  const queda = new Array<boolean>(pts.length).fill(false);
  queda[0] = queda[pts.length - 1] = true;
  const pila: [number, number][] = [[0, pts.length - 1]];
  while (pila.length) {
    const [i, k] = pila.pop()!;
    let peor = -1;
    let dMax = 1;
    for (let m = i + 1; m < k; m++) {
      const d = aSegmento(P[m], P[i], P[k]);
      if (d > dMax) {
        dMax = d;
        peor = m;
      }
    }
    if (peor >= 0) {
      queda[peor] = true;
      pila.push([i, peor], [peor, k]);
    }
  }
  return pts.filter((_, i) => queda[i]);
}

/** Distancia de `p` al segmento a-b (m). */
function aSegmento(p: Punto, a: Punto, b: Punto): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

// ---------------------------------------------------------------- carga

const modelos = new Map<string, Promise<Surcos | null>>();

function surcosDeBloque(bloque: string): Promise<Surcos | null> {
  let p = modelos.get(bloque);
  if (!p) {
    p = lineasDeBloque(bloque).then((fc) => (fc ? construirSurcos(fc) : null));
    modelos.set(bloque, p);
  }
  return p;
}

/**
 * Las calles de los bloques por donde pasan los puntos dados, o null si
 * ninguno pasa por un bloque con censo. Baja sólo esos bloques.
 */
export async function surcosPara(latlngs: [number, number][]): Promise<Surcos | null> {
  const idx = await indicePalmas();
  const bs = bloquesTocados(idx, latlngs);
  if (!bs.length) return null;
  const partes = (await Promise.all(bs.map(surcosDeBloque))).filter(
    (s): s is Surcos => s !== null
  );
  if (!partes.length) return null;
  return { juegos: partes.flatMap((s) => s.juegos) };
}
