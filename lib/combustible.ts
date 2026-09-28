/**
 * Combustible: el parque de máquinas y los tanqueos que registra la app de
 * control de combustible (Airtable). Tipos, lectura desde el navegador y el
 * cruce con los nodos de la torre.
 *
 * La lectura a Airtable la hace el servidor (`lib/combustibleAirtable.ts`);
 * aquí sólo se habla con `/api/combustible/*`.
 */

import type { TipoMaquina } from "./tractores";

export interface MaquinaCombustible {
  /** Código de la máquina, tal como lo escribe la app de combustible. Ej. "MA106". */
  codigo: string;
  /** Ej. "TRACTOR KUBOTA M9540". */
  descripcion: string | null;
  centroCosto: string | null;
  capacidadGal: number | null;
  /** Orden del listado en la base. */
  item: number | null;
}

export interface Tanqueo {
  id: string;
  /** Día del tanqueo, YYYY-MM-DD. */
  fecha: string;
  /** Cuándo se digitó (ISO). Ordena los tanqueos del mismo día. */
  registradoEn: string | null;
  codigo: string;
  galones: number;
  /** Lectura del horómetro, si es un número. */
  horometro: number | null;
  /** Lo que se escribió en el horómetro cuando no es un número ("N/A", "dañado"). */
  horometroTexto: string | null;
  operario: string | null;
  numeroSai: string | null;
  observaciones: string | null;
}

/* ============================== lectura ============================== */

async function pedir<T>(ruta: string): Promise<T> {
  const res = await fetch(ruta, { cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error ?? `HTTP ${res.status}`);
  return body as T;
}

export async function fetchMaquinasCombustible(): Promise<MaquinaCombustible[]> {
  return (await pedir<{ maquinas: MaquinaCombustible[] }>("/api/combustible/maquinas"))
    .maquinas;
}

export async function fetchTanqueos(
  codigo: string,
  desde: string,
  hasta: string,
): Promise<{ tanqueos: Tanqueo[]; truncado: boolean }> {
  const q = new URLSearchParams({ codigo, desde, hasta });
  return pedir(`/api/combustible/tanqueos?${q}`);
}

/* ============================== cruce ============================== */

/** Mayúsculas y sólo letras y dígitos: "MA 101" y "MA-101" son "MA101". */
export function normCodigo(c: string): string {
  return c.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/**
 * La máquina de Airtable que corresponde a un código de la torre.
 *
 * Primero exacto tras normalizar. Si no, se acepta que el de la torre sea el
 * FINAL del de Airtable ("936" → "LZT936"), porque en campo a los camiones se
 * les dice por los números de la placa — pero sólo si hay UNA sola candidata.
 * "Kubota 108" no calza con nada: M108 es un modelo con seis máquinas, y
 * adivinar cuál pegaría los tanqueos de otra. Esa se corrige poniéndole en el
 * registro de flota el código de Airtable.
 */
export function emparejar(
  codigoTorre: string,
  catalogo: MaquinaCombustible[],
): MaquinaCombustible | null {
  const c = normCodigo(codigoTorre);
  if (!c) return null;
  const exacta = catalogo.find((m) => normCodigo(m.codigo) === c);
  if (exacta) return exacta;
  if (c.length < 3) return null;
  const sufijo = catalogo.filter((m) => normCodigo(m.codigo).endsWith(c));
  return sufijo.length === 1 ? sufijo[0] : null;
}

/**
 * Tipo de dibujo para una máquina que sólo existe en Airtable, leído de la
 * primera palabra de su descripción. Lo que no es tractor, camión, volqueta ni
 * retro (excavadoras, bulldozer, cargadores…) va como `retro`: es el ícono de
 * maquinaria amarilla que hay.
 */
export function tipoDeDescripcion(d: string | null): TipoMaquina {
  const p = (d ?? "").toUpperCase();
  if (p.startsWith("TRACTOR")) return "tractor";
  if (p.startsWith("CAMION") || p.startsWith("CAMIÓN")) return "camion";
  if (p.startsWith("VOLQUETA")) return "volqueta";
  return "retro";
}

/* ============================== consumo ============================== */

/**
 * Qué mide el campo `horometro` de la app de combustible.
 *
 * Se llama horómetro, pero en los camiones lo que se digita es el ODÓMETRO: en
 * JUZ461 y LZT936 sube ~280-300 entre un día y el siguiente, que son
 * kilómetros, no horas. Leerlo como horas daría un camión de 300 h diarias y un
 * consumo de 0,1 gal/h. Así que un camión rinde en km/gal y lo demás consume
 * en gal/h.
 */
export type Medidor = "horometro" | "odometro";

export function medidorDe(m: MaquinaCombustible): Medidor {
  return tipoDeDescripcion(m.descripcion) === "camion" ? "odometro" : "horometro";
}

export const MEDIDOR_META: Record<
  Medidor,
  { label: string; tramo: string; rendimiento: string; maxTramo: number }
> = {
  // Más que esto entre dos tanqueos es una lectura mal digitada o un tanqueo
  // que no se registró en medio, y el número que saldría sería mentira.
  horometro: { label: "Horómetro", tramo: "h", rendimiento: "gal/h", maxTramo: 120 },
  odometro: { label: "Odómetro", tramo: "km", rendimiento: "km/gal", maxTramo: 3000 },
};

export interface TanqueoConConsumo extends Tanqueo {
  /** Horas o km desde el tanqueo anterior con lectura válida. */
  tramo: number | null;
  /** gal/h (horómetro) o km/gal (odómetro) de ese tramo. */
  rendimiento: number | null;
  /** true si se cargó más de lo que cabe en el tanque. */
  excedeTanque: boolean;
}

/**
 * Consumo de cada tanqueo: lo que entra al tanque repone lo que se quemó desde
 * el tanqueo anterior, así que se mide contra la lectura del tanqueo previo.
 * Sólo si las dos lecturas son números y el tramo es plausible; si no, null
 * —un consumo inventado es peor que un hueco—.
 *
 * Devuelve más nuevo primero.
 */
export function conConsumo(
  tanqueos: Tanqueo[],
  maquina: MaquinaCombustible,
): TanqueoConConsumo[] {
  const medidor = medidorDe(maquina);
  const { maxTramo } = MEDIDOR_META[medidor];
  const orden = [...tanqueos].sort((a, b) =>
    (a.registradoEn ?? a.fecha).localeCompare(b.registradoEn ?? b.fecha),
  );
  let previo: number | null = null;
  const out = orden.map((t) => {
    let tramo: number | null = null;
    if (t.horometro != null && previo != null) {
      const d = t.horometro - previo;
      if (d > 0 && d <= maxTramo) tramo = d;
    }
    if (t.horometro != null) previo = t.horometro;
    let rendimiento: number | null = null;
    if (tramo && t.galones > 0) {
      rendimiento = medidor === "odometro" ? tramo / t.galones : t.galones / tramo;
    }
    return {
      ...t,
      tramo,
      rendimiento,
      excedeTanque: maquina.capacidadGal != null && t.galones > maquina.capacidadGal,
    };
  });
  return out.reverse();
}

export function fmtGal(g: number): string {
  return g.toLocaleString("es-CO", { maximumFractionDigits: 1 });
}
