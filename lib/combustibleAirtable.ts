/**
 * Lectura de la base "Guaicaramo-Control-Combustible": el parque de máquinas
 * y sus tanqueos.
 *
 * SÓLO SERVIDOR, por lo mismo que `operariosAirtable.ts`: el token escribe
 * sobre una base con cédulas y contraseñas. Lo usan las rutas de
 * `app/api/combustible`; el navegador recibe sólo los campos de `lib/combustible.ts`.
 *
 * Esa base es el maestro del parque —63 máquinas con descripción, centro de
 * costo y capacidad de tanque— y la app de combustible escribe ahí cada
 * tanqueo con el CÓDIGO de la máquina en texto (`maquina` = "MA106"). No hay
 * link a `tractores`: el cruce, con ella y con los nodos de la torre, es por
 * código (ver `emparejar` en `lib/combustible.ts`).
 */

import type { MaquinaCombustible, Tanqueo } from "./combustible";

const BASE = "appAY39ftuE85xx8p"; // Guaicaramo-Control-Combustible
const TABLA_TRACTORES = "tbldAMbqPHQxMU23q";
const TABLA_REGISTROS = "tblnht8KbfNpKOkFv"; // registros_combustible

/** Tope de filas por consulta; ver el mismo razonamiento en `app/api/porteria`. */
const MAX_FILAS = 2000;

export class SinConfigurar extends Error {
  constructor() {
    super("Falta AIRTABLE_CONTROL_COMBUSTIBLE_API_KEY en el entorno del servidor");
  }
}

function llave(): string {
  const k = process.env.AIRTABLE_CONTROL_COMBUSTIBLE_API_KEY?.trim();
  if (!k) throw new SinConfigurar();
  return k;
}

interface Fila {
  id: string;
  fields: Record<string, unknown>;
}

async function leer(
  tabla: string,
  params: Record<string, string>,
): Promise<{ filas: Fila[]; truncado: boolean }> {
  const filas: Fila[] = [];
  let offset: string | undefined;
  for (;;) {
    const q = new URLSearchParams({ pageSize: "100", ...params });
    if (offset) q.set("offset", offset);
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${tabla}?${q}`, {
      headers: { Authorization: `Bearer ${llave()}` },
      cache: "no-store",
    });
    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      throw new Error(
        `Airtable respondió ${res.status}${detalle ? `: ${detalle.slice(0, 200)}` : ""}`,
      );
    }
    const page = (await res.json()) as { records?: Fila[]; offset?: string };
    filas.push(...(page.records ?? []));
    offset = page.offset;
    if (!offset) return { filas, truncado: false };
    if (filas.length >= MAX_FILAS) return { filas, truncado: true };
  }
}

const txt = (v: unknown) => String(v ?? "").trim();
const num = (v: unknown) => (typeof v === "number" && isFinite(v) ? v : null);

/** Máquinas vigentes del parque. Las anuladas no se ofrecen. */
export async function leerMaquinas(): Promise<MaquinaCombustible[]> {
  const { filas } = await leer(TABLA_TRACTORES, {
    filterByFormula: `NOT({estado}='ANULADO')`,
  });
  return filas
    .map((r) => {
      const f = r.fields;
      // "N/A" es cómo la base dice "no aplica": se deja vacío en vez de
      // mostrarlo como si fuera un centro de costo.
      const limpio = (v: unknown) => {
        const t = txt(v);
        return t && t.toUpperCase() !== "N/A" ? t : null;
      };
      return {
        codigo: txt(f.maquina),
        descripcion: limpio(f.descripcion),
        centroCosto: limpio(f.centro_costo),
        capacidadGal: num(f.capacidad_galones),
        item: num(f.item),
      };
    })
    .filter((m) => m.codigo)
    .sort((a, b) => (a.item ?? 1e9) - (b.item ?? 1e9));
}

/**
 * El horómetro llega como texto ("9445.4", "12.043,4", "N/A", "Horometro
 * dañado"). Los registros anteriores al cambio de campo lo traen numérico en
 * `horometro_viejo`. Lo que no sea un número se devuelve null: un "N/A" leído
 * como 0 fabricaría un consumo absurdo contra el tanqueo anterior.
 */
function horometro(f: Record<string, unknown>): number | null {
  const viejo = num(f.horometro_viejo);
  const t = txt(f.horometro);
  if (!t) return viejo;
  // Una sola coma y ningún punto es decimal a la colombiana.
  const norm = /^\d+,\d+$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
  const n = Number(norm);
  return isFinite(n) && /^\d+(\.\d+)?$/.test(norm) ? n : viejo;
}

/**
 * Tanqueos vigentes entre dos días (incluidos). Con `codigo`, sólo los de esa
 * máquina: el código ya viene validado por la ruta, así que no trae comillas.
 */
export async function leerTanqueos(opts: {
  desde: string;
  hasta: string;
  codigo?: string;
}): Promise<{ tanqueos: Tanqueo[]; truncado: boolean }> {
  const partes = [
    `NOT({estado}='ANULADO')`,
    `DATETIME_FORMAT({fecha},'YYYY-MM-DD')>='${opts.desde}'`,
    `DATETIME_FORMAT({fecha},'YYYY-MM-DD')<='${opts.hasta}'`,
  ];
  if (opts.codigo) partes.push(`{maquina}='${opts.codigo}'`);

  const { filas, truncado } = await leer(TABLA_REGISTROS, {
    filterByFormula: `AND(${partes.join(",")})`,
  });

  const tanqueos: Tanqueo[] = filas.map((r) => {
    const f = r.fields;
    const h = horometro(f);
    return {
      id: r.id,
      fecha: txt(f.fecha),
      registradoEn: txt(f.registrado_en) || null,
      codigo: txt(f.maquina),
      galones: num(f.cantidad) ?? 0,
      horometro: h,
      horometroTexto: h == null ? txt(f.horometro) || null : null,
      operario: txt(f.operario) || null,
      numeroSai: txt(f.numero_sai) || null,
      observaciones: txt(f.observaciones) || null,
    };
  });
  return { tanqueos, truncado };
}
