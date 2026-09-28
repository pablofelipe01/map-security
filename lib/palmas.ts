/**
 * Líneas de palma por bloque.
 *
 * El censo vive en un archivo por bloque (`public/palmas/<bloque>.geojson`) y un
 * índice chico (`public/palmas/indice.json`) con los bloques, sus parcelas y la
 * caja de cada una. Los genera `scripts/kmz-palmas-a-geojson.mjs`.
 *
 * Se parte así porque la capa entera no se carga nunca: con el censo de todo el
 * predio serían decenas de MB para dibujar, a la vez, hileras que nadie está
 * mirando. El mapa baja sólo los bloques que la persona elige en el control de
 * capas, y el ruteo (lib/surcos.ts) sólo los bloques por donde pasa un rastro.
 * Ambos comparten esta caché, así que un bloque se pide una vez por sesión.
 */

export type Caja = [oeste: number, sur: number, este: number, norte: number];

export interface ParcelaPalmas {
  /** "9-4": bloque 9, parcela 4. Mismo código que COD_BP del censo. */
  parcela: string;
  lineas: number;
  palmas: number;
  caja: Caja;
}

export interface BloquePalmas {
  bloque: string;
  lineas: number;
  palmas: number;
  caja: Caja;
  parcelas: ParcelaPalmas[];
}

export interface PropsLineaPalma {
  linea: string;
  parcela: string;
  palmas?: number;
}

export interface LineasPalma {
  type: "FeatureCollection";
  features: {
    type: "Feature";
    properties: PropsLineaPalma;
    geometry: { type: "LineString"; coordinates: [number, number][] };
  }[];
}

const BASE = "/palmas";

let indice: Promise<BloquePalmas[]> | null = null;

/** Bloques con censo. Lista vacía si el índice no está: la app sigue sin capa. */
export function indicePalmas(): Promise<BloquePalmas[]> {
  indice ??= fetch(`${BASE}/indice.json`)
    .then((r) => {
      if (!r.ok) throw new Error(`índice de palmas: HTTP ${r.status}`);
      return r.json();
    })
    .then((j: { bloques: BloquePalmas[] }) => j.bloques)
    .catch((e) => {
      console.warn("[palmas]", e);
      indice = null; // se reintenta la próxima vez
      return [];
    });
  return indice;
}

const bloques = new Map<string, Promise<LineasPalma | null>>();

/** Las líneas de un bloque, bajadas una sola vez por sesión. */
export function lineasDeBloque(bloque: string): Promise<LineasPalma | null> {
  let p = bloques.get(bloque);
  if (!p) {
    p = fetch(`${BASE}/${encodeURIComponent(bloque)}.geojson`)
      .then((r) => {
        if (!r.ok) throw new Error(`bloque ${bloque}: HTTP ${r.status}`);
        return r.json() as Promise<LineasPalma>;
      })
      .catch((e) => {
        console.warn("[palmas]", e);
        bloques.delete(bloque);
        return null;
      });
    bloques.set(bloque, p);
  }
  return p;
}

/**
 * Lo que la persona eligió ver: claves de bloque ("9") o de parcela ("9-4").
 * Elegir el bloque entero y además una de sus parcelas es lo mismo que elegir
 * el bloque.
 */
export type SeleccionPalmas = string[];

export const bloqueDe = (clave: string) => clave.split("-")[0];

/** true si la línea de la parcela `parcela` entra en la selección. */
export function seleccionada(sel: SeleccionPalmas, parcela: string): boolean {
  return sel.includes(parcela) || sel.includes(bloqueDe(parcela));
}

/**
 * Lleva lo que se escribe en el buscador a la forma de las claves: "B.9-P.4",
 * "b9 p4", "9 4" y "9-4" dicen lo mismo. Sin esto, quien copia el rótulo del
 * mapa ("B.9-P.4") no encuentra nada.
 */
export function normalizarBusqueda(q: string): string {
  return q
    .toUpperCase()
    .replace(/\bB\.?\s*/g, "")
    .replace(/\bP\.?\s*/g, "")
    .trim()
    .replace(/[\s._/-]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Une la caja de las claves elegidas (para encuadrar el mapa). */
export function cajaDe(idx: BloquePalmas[], claves: string[]): Caja | null {
  let c: Caja | null = null;
  for (const k of claves) {
    const b = idx.find((x) => x.bloque === bloqueDe(k));
    const caja = k.includes("-") ? b?.parcelas.find((p) => p.parcela === k)?.caja : b?.caja;
    if (!caja) continue;
    c = c
      ? [
          Math.min(c[0], caja[0]),
          Math.min(c[1], caja[1]),
          Math.max(c[2], caja[2]),
          Math.max(c[3], caja[3]),
        ]
      : [...caja];
  }
  return c;
}

/** Bloques cuya caja contiene alguno de los puntos [lat, lon]. */
export function bloquesTocados(idx: BloquePalmas[], latlngs: [number, number][]): string[] {
  // ~20 m de margen: un fix en la cabecera de la parcela cae justo afuera de la
  // caja de las hileras y es precisamente el que entra o sale de ellas.
  const M = 0.0002;
  return idx
    .filter(({ caja: [w, s, e, n] }) =>
      latlngs.some(([la, lo]) => lo >= w - M && lo <= e + M && la >= s - M && la <= n + M)
    )
    .map((b) => b.bloque);
}
