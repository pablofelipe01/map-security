/**
 * Lectura de los registros de portería (Airtable) para un nodo de puesto fijo.
 *
 * Existe para que el token no llegue al navegador. `AIRTABLE_..._API_KEY` es un
 * PAT con permiso de escritura sobre una base con cédulas, nombres y placas: si
 * se expusiera como `NEXT_PUBLIC_` quedaría en el bundle, legible por cualquiera
 * que abra el inspector, y con él se podría autorizar un ingreso. Así que la
 * llamada a Airtable se hace aquí, en el servidor, y el cliente sólo recibe los
 * campos que la ficha muestra (ver `lib/porteria.ts`).
 *
 * El filtro es por `nodo_origen`: la app de portería sella ahí el node_id del
 * nodo desde el que se registró el ingreso, y es el mismo id de la malla. No
 * hay tabla de equivalencias que mantener.
 *
 * GET /api/porteria?node=!2f3f6694&desde=2026-09-08&hasta=2026-09-21
 */

import { dayRange } from "@/lib/ranges";
import type { Porteria, RegistroPorteria } from "@/lib/porteria";

/** Base "Registro Visitantes" y su tabla de eventos de portería. */
const BASE = "apptwIqTras1uPNOc";
const TABLA = "tblVSmlxPdPrqhd30"; // Registros

/**
 * Tope de filas que se traen. Airtable pagina de 100 en 100 y la portería hace
 * ~12 registros diarios, así que 1000 cubre de sobra la ventana de 14 días de
 * la ficha. El tope está para que una ventana larga —o un día raro— no dispare
 * veinte llamadas encadenadas; cuando se alcanza, la respuesta lo dice y la
 * ficha lo advierte en vez de mostrar un total corto como si fuera completo.
 */
const MAX_FILAS = 1000;

/** Sólo ids de nodo de la malla: son los únicos que pueden entrar a la fórmula. */
const NODE_ID = /^![0-9a-fA-F]{1,16}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const node = url.searchParams.get("node") ?? "";
  const desde = url.searchParams.get("desde") ?? "";
  const hasta = url.searchParams.get("hasta") ?? "";

  // La validación no es cosmética: `node` se interpola en una fórmula de
  // Airtable, y aceptar texto libre permitiría cerrar la comilla y reescribir
  // el filtro para leer filas de otros puestos. Con este patrón no hay comillas
  // que cerrar.
  if (!NODE_ID.test(node) || !FECHA.test(desde) || !FECHA.test(hasta)) {
    return json({ error: "Parámetros inválidos" }, 400);
  }

  const key = process.env.AIRTABLE_GUAICARAMO_VISITAS_API_KEY;
  if (!key) {
    return json(
      {
        error:
          "Falta AIRTABLE_GUAICARAMO_VISITAS_API_KEY en el entorno del servidor",
        sinConfigurar: true,
      },
      501
    );
  }

  // La ventana es de días de Bogotá, igual que todo lo demás en la app: de
  // 05:00Z a 05:00Z. Tomar el día UTC dejaría fuera los ingresos de antes de
  // las 5 a.m. — en una portería, justo el turno de entrada.
  const from = dayRange(desde).fromISO;
  const to = dayRange(hasta).toISO;

  const formula =
    `AND({nodo_origen}='${node}',` +
    `IS_AFTER({Creada}, DATETIME_PARSE('${from}')),` +
    `IS_BEFORE({Creada}, DATETIME_PARSE('${to}')))`;

  try {
    const { filas, truncado } = await leerAirtable(key, formula);
    const registros = filas.map(aRegistro);
    // Más nuevo primero: la pregunta de una portería es "¿quién acaba de
    // entrar?", no "¿quién entró hace dos semanas?".
    registros.sort((a, b) => b.t.localeCompare(a.t));
    const body: Porteria = { registros, truncado };
    return json(body, 200);
  } catch (e) {
    return json({ error: String((e as Error)?.message ?? e) }, 502);
  }
}

interface FilaAirtable {
  id: string;
  createdTime: string;
  fields: Record<string, unknown>;
}

async function leerAirtable(key: string, formula: string) {
  const filas: FilaAirtable[] = [];
  let offset: string | undefined;
  let truncado = false;

  for (;;) {
    const q = new URLSearchParams({
      filterByFormula: formula,
      pageSize: "100",
    });
    if (offset) q.set("offset", offset);

    const res = await fetch(
      `https://api.airtable.com/v0/${BASE}/${TABLA}?${q}`,
      {
        headers: { Authorization: `Bearer ${key}` },
        cache: "no-store",
      }
    );
    if (!res.ok) {
      const detalle = await res.text().catch(() => "");
      throw new Error(
        `Airtable respondió ${res.status}${detalle ? `: ${detalle.slice(0, 200)}` : ""}`
      );
    }

    const page = (await res.json()) as {
      records?: FilaAirtable[];
      offset?: string;
    };
    filas.push(...(page.records ?? []));
    offset = page.offset;
    if (!offset) break;
    if (filas.length >= MAX_FILAS) {
      truncado = true;
      break;
    }
  }

  return { filas, truncado };
}

function aRegistro(f: FilaAirtable): RegistroPorteria {
  const c = f.fields;
  const tipo = texto(c.tipo) as RegistroPorteria["tipo"];
  const entrada = texto(c.entry_time);
  const salida = texto(c.exit_time);

  return {
    id: f.id,
    tipo,
    categoria: texto(c.categoria) as RegistroPorteria["categoria"],
    estado: texto(c.status),
    placa: texto(c.placa),
    cedula: texto(c.cedula),
    // El nombre puede venir por el vínculo con Placas (conductor) o con
    // Personas (peatón); son campos de búsqueda, así que llegan como lista.
    nombre:
      primero(c["conductor (from Placas)"]) ??
      primero(c["nombre (from Personas)"]),
    motivo: texto(c.motivo_visita) ?? primero(c["notas (from Placas)"]),
    entrada,
    salida,
    autorizadoPor: texto(c.approved_by),
    supervisor: texto(c.supervisor),
    comentario: texto(c.comment),
    t:
      (tipo === "SALIDA" || tipo === "SALIDA_SIN_ENTRADA"
        ? salida ?? entrada
        : entrada ?? salida) ?? f.createdTime,
  };
}

function texto(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = reparar(v.trim());
  return s === "" ? null : s;
}

function primero(v: unknown): string | null {
  return Array.isArray(v) ? texto(v[0]) : texto(v);
}

/**
 * Arregla los nombres con la eñe rota que llegan de Airtable.
 *
 * La app de portería guarda el texto ya mal codificado —UTF-8 leído como
 * Windows-1252—, así que "CASTAÑEDA" llega escrito "CASTAÃEDA" y "Víctor"
 * como "VÃ­ctor". No se puede arreglar en la fuente desde aquí, y mostrarlo tal
 * cual convierte cada apellido colombiano en ruido. Deshacer el daño es exacto:
 * se vuelven a bytes los caracteres tal como los escribiría Windows-1252 y se
 * leen como UTF-8. Si el resultado no es UTF-8 válido, el texto no estaba roto
 * —o lo está de otra forma— y se devuelve intacto.
 */
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85,
  0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92,
  0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c,
  0x017e: 0x9e, 0x0178: 0x9f,
};

function reparar(s: string): string {
  // La Ã es la firma del daño: sin ella no hay nada que deshacer y no vale la
  // pena tocar el texto.
  if (!/[ÂÃ]/.test(s)) return s;

  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) {
    const cp = s.codePointAt(i)!;
    if (cp > 0xffff) return s; // fuera de Windows-1252: no es este daño
    const b = cp <= 0xff ? cp : CP1252[cp];
    if (b === undefined) return s;
    bytes[i] = b;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return s;
  }
}

function json(body: unknown, status: number) {
  return Response.json(body, {
    status,
    // Son ingresos de hoy: una respuesta cacheada es una portería desactualizada.
    headers: { "Cache-Control": "no-store" },
  });
}
