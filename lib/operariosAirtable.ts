/**
 * Operadores: Airtable manda, Supabase copia.
 *
 * LA LISTA VERÍDICA DE CONDUCTORES es la tabla `operarios` de la base
 * "Guaicaramo-Control-Combustible": es la que mantiene la gente de campo, la
 * que usa el control de combustible y la que tiene la cédula de cada uno. La
 * tabla `operadores` de Supabase nació para las pruebas de la torre y hoy es
 * una COPIA: la necesitamos porque los turnos (`maquina_operador`) y los
 * renglones de la planilla (`viajes`) apuntan a su `id` con llave foránea, y
 * esas llaves no pueden apuntar a Airtable.
 *
 * LA LLAVE ENTRE LAS DOS ES LA CÉDULA. Airtable la tiene en todas las filas y
 * sin repetir; el nombre no sirve (en Airtable va en mayúsculas y completo, en
 * las pruebas se escribió "Camilo Rozo"). Por eso no hizo falta agregar una
 * columna a Supabase: `operadores.documento` ya existía.
 *
 * SÓLO SERVIDOR. El token es de escritura sobre una base con cédulas y
 * contraseñas; importarlo desde un componente de cliente lo metería en el
 * bundle. Lo usan las rutas de `app/api/operadores`.
 */

import { supabase } from "./supabase";
import type { OperadorRow } from "./registro";

const BASE = "appAY39ftuE85xx8p"; // Guaicaramo-Control-Combustible
const TABLA = "tbl8v6XpdVaugU56U"; // operarios

export class SinConfigurar extends Error {
  constructor() {
    super("Falta AIRTABLE_CONTROL_COMBUSTIBLE_API_KEY en el entorno del servidor");
  }
}

/** Error que ya viene redactado para mostrárselo a una persona. */
export class Rechazo extends Error {
  constructor(
    mensaje: string,
    readonly status = 409,
  ) {
    super(mensaje);
  }
}

function llave(): string {
  const k = process.env.AIRTABLE_CONTROL_COMBUSTIBLE_API_KEY?.trim();
  if (!k) throw new SinConfigurar();
  return k;
}

/* ============================== utilidades ============================== */

export function soloDigitos(t: unknown): string {
  return String(t ?? "").replace(/\D/g, "");
}

/** Minúsculas, sin tildes y con un solo espacio: para comparar nombres. */
function plano(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

/** Así escribe Airtable los nombres: en mayúsculas y sin espacios de sobra. */
function comoAirtable(nombre: string): string {
  return nombre.trim().replace(/\s+/g, " ").toLocaleUpperCase("es");
}

/* ============================== Airtable ============================== */

interface Operario {
  airtableId: string;
  /** El `id` numérico que lleva la tabla a mano (1, 2, 3…). */
  numero: number | null;
  nombre: string;
  cedula: string;
  activo: boolean;
}

async function airtable(
  ruta: string,
  init?: RequestInit,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLA}${ruta}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${llave()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
    cache: "no-store",
  });
  if (!res.ok) {
    const detalle = await res.text().catch(() => "");
    throw new Error(
      `Airtable respondió ${res.status}${detalle ? `: ${detalle.slice(0, 200)}` : ""}`,
    );
  }
  return (await res.json()) as Record<string, unknown>;
}

async function leerOperarios(): Promise<Operario[]> {
  const out: Operario[] = [];
  let offset: string | undefined;
  do {
    const q = new URLSearchParams({ pageSize: "100" });
    if (offset) q.set("offset", offset);
    const page = (await airtable(`?${q}`)) as {
      records?: { id: string; fields: Record<string, unknown> }[];
      offset?: string;
    };
    for (const r of page.records ?? []) {
      const f = r.fields;
      const nombre = String(f.nombre ?? "").trim();
      const cedula = soloDigitos(f.cedula);
      // Una fila sin nombre o sin cédula no es un conductor que se pueda
      // copiar: sin cédula no hay con qué amarrarla a Supabase.
      if (!nombre || !cedula) continue;
      out.push({
        airtableId: r.id,
        numero: typeof f.id === "number" ? f.id : null,
        nombre,
        cedula,
        activo: f.estado !== "ANULADO",
      });
    }
    offset = page.offset;
  } while (offset);
  return out;
}

/* ============================== Supabase ============================== */

const COLUMNAS = "id,nombre,documento,activo";

async function leerCopia(): Promise<OperadorRow[]> {
  const { data, error } = await supabase.from("operadores").select(COLUMNAS);
  if (error) throw new Error(error.message);
  return (data ?? []) as OperadorRow[];
}

/* ============================ sincronizar ============================ */

export interface Cambio {
  accion: "crear" | "actualizar" | "adoptar" | "desactivar";
  nombre: string;
  /** Para "adoptar" y "actualizar": cómo se llamaba en Supabase. */
  antes?: string;
}

export interface ResultadoSync {
  aplicado: boolean;
  airtable: number;
  supabase: number;
  cambios: Cambio[];
  errores: string[];
}

/**
 * Deja `operadores` de Supabase igual a `operarios` de Airtable.
 *
 * Por cada operario de Airtable:
 * 1. Si hay una fila con su cédula, se le corrigen nombre y estado.
 * 2. Si no, se busca una fila de las pruebas SIN cédula que sea claramente él
 *    y se ADOPTA —se le pone nombre y cédula de Airtable— en vez de crear otra.
 *    Adoptar y no crear es lo que conserva la historia: los turnos y renglones
 *    que ya apuntan a esa fila pasan a decir el nombre verídico. "Claramente él"
 *    es: todas las palabras del nombre de prueba están en el de Airtable
 *    ("Camilo Rozo" ⊂ "CAMILO ROZO PÉREZ"), y el emparejamiento es único en las
 *    dos direcciones. "Antonio" calza con tres operarios: no se adivina.
 * 3. Si tampoco, se crea.
 *
 * Lo que queda en Supabase sin su par en Airtable se DESACTIVA, no se borra:
 * un recorrido de hace un mes tiene que seguir diciendo quién manejaba. Una
 * fila desactivada deja de ofrecerse en los formularios.
 *
 * Con `aplicar: false` sólo dice qué haría. Idempotente: la segunda pasada no
 * encuentra nada que cambiar.
 */
export async function sincronizarOperadores(
  aplicar: boolean,
): Promise<ResultadoSync> {
  const [operarios, copia] = await Promise.all([leerOperarios(), leerCopia()]);
  const cambios: Cambio[] = [];
  const errores: string[] = [];

  const cedulasAirtable = new Set(operarios.map((o) => o.cedula));
  const porCedula = new Map<string, OperadorRow>();
  for (const s of copia) {
    const c = soloDigitos(s.documento);
    if (c) porCedula.set(c, s);
  }

  // Filas de Supabase que no están amarradas a ningún operario por cédula.
  const sueltas = copia.filter(
    (s) => !cedulasAirtable.has(soloDigitos(s.documento)),
  );
  const sinPar = operarios.filter((o) => !porCedula.has(o.cedula));

  // Adopciones: emparejamientos únicos en las dos direcciones. Sólo filas sin
  // cédula: una fila con otra cédula es otra persona, aunque se llame igual.
  const calza = (s: OperadorRow, o: Operario) => {
    const palabrasO = plano(o.nombre).split(" ");
    return plano(s.nombre)
      .split(" ")
      .every((p) => palabrasO.includes(p));
  };
  // Rival de una fila es otra que TAMBIÉN tiene a ese operario como único
  // candidato. "Antonio" no le disputa "ANTONIO DÍAZ …" a "Antonio Díaz":
  // calza con tres operarios, así que nunca se iba a adoptar.
  const unico = new Map<string, Operario>(); // id de fila → su único candidato
  for (const s of sueltas) {
    if (soloDigitos(s.documento)) continue;
    const candidatos = sinPar.filter((o) => calza(s, o));
    if (candidatos.length === 1) unico.set(s.id, candidatos[0]);
  }
  const adopciones = new Map<string, OperadorRow>(); // airtableId → fila
  for (const s of sueltas) {
    const o = unico.get(s.id);
    if (!o) continue;
    const rivales = sueltas.filter((x) => unico.get(x.id) === o);
    if (rivales.length === 1) adopciones.set(o.airtableId, s);
  }
  const adoptadas = new Set([...adopciones.values()].map((s) => s.id));

  const operaciones: (() => Promise<void>)[] = [];
  const actualizar = (id: string, campos: Partial<OperadorRow>) =>
    operaciones.push(async () => {
      const { error } = await supabase
        .from("operadores")
        .update(campos)
        .eq("id", id);
      if (error) throw new Error(error.message);
    });

  // Primero lo que libera nombres (desactivar no los libera, pero adoptar y
  // renombrar sí mueven el nombre de una fila), y al final las altas, para que
  // una alta no choque con `operadores_nombre_uniq` contra una fila que en esta
  // misma pasada se iba a renombrar.
  for (const o of operarios) {
    const s = porCedula.get(o.cedula);
    if (s) {
      if (s.nombre !== o.nombre || s.activo !== o.activo || s.documento !== o.cedula) {
        cambios.push({ accion: "actualizar", nombre: o.nombre, antes: s.nombre });
        actualizar(s.id, { nombre: o.nombre, documento: o.cedula, activo: o.activo });
      }
      continue;
    }
    const a = adopciones.get(o.airtableId);
    if (a) {
      cambios.push({ accion: "adoptar", nombre: o.nombre, antes: a.nombre });
      actualizar(a.id, { nombre: o.nombre, documento: o.cedula, activo: o.activo });
    }
  }

  for (const s of sueltas) {
    if (adoptadas.has(s.id) || !s.activo) continue;
    cambios.push({ accion: "desactivar", nombre: s.nombre });
    actualizar(s.id, { activo: false });
  }

  const altas = sinPar.filter((o) => !adopciones.has(o.airtableId));
  for (const o of altas) cambios.push({ accion: "crear", nombre: o.nombre });

  if (aplicar) {
    for (const op of operaciones) {
      try {
        await op();
      } catch (e) {
        errores.push((e as Error).message);
      }
    }
    if (altas.length) {
      const { error } = await supabase.from("operadores").insert(
        altas.map((o) => ({ nombre: o.nombre, documento: o.cedula, activo: o.activo })),
      );
      if (error) errores.push(error.message);
    }
  }

  return {
    aplicado: aplicar,
    airtable: operarios.length,
    supabase: copia.length,
    cambios,
    errores,
  };
}

/* ============================== alta ============================== */

export interface AltaOperador {
  nombre: string;
  documento: string;
  /** Sólo Supabase: Airtable no lleva teléfono. */
  telefono?: string;
}

/**
 * Da de alta un conductor: primero en Airtable, después en la copia.
 *
 * En ese orden porque Airtable es la verdad: si la copia falla, la próxima
 * sincronización lo trae; al revés quedaría un conductor que sólo existe en la
 * copia y que la sincronización desactivaría.
 *
 * Si la cédula ya está en Airtable no se crea otro: se rechaza diciendo quién
 * es, que es lo que la persona necesita saber para escoger bien.
 */
export async function darDeAlta(input: AltaOperador): Promise<OperadorRow> {
  const nombre = comoAirtable(input.nombre ?? "");
  const cedula = soloDigitos(input.documento);
  if (nombre.length < 3 || nombre.length > 80) {
    throw new Rechazo("El nombre debe tener entre 3 y 80 letras.", 400);
  }
  if (!/^\d{5,11}$/.test(cedula)) {
    throw new Rechazo("La cédula debe tener de 6 a 10 números.", 400);
  }

  const operarios = await leerOperarios();
  const mismo = operarios.find((o) => o.cedula === cedula);
  if (mismo) {
    throw new Rechazo(`Esa cédula ya está en el registro: ${mismo.nombre}.`);
  }
  const homonimo = operarios.find((o) => plano(o.nombre) === plano(nombre));
  if (homonimo) {
    throw new Rechazo(
      `Ya hay un operario llamado ${homonimo.nombre} con otra cédula. Revisa si es la misma persona.`,
    );
  }

  // El `id` numérico lo lleva la tabla a mano y lo usa la app de combustible:
  // se sigue la cuenta. No es atómico, pero las altas son de a una y a mano.
  const siguiente =
    Math.max(0, ...operarios.map((o) => o.numero ?? 0)) + 1;
  await airtable("", {
    method: "POST",
    body: JSON.stringify({
      records: [
        {
          fields: {
            id: siguiente,
            nombre,
            cedula,
            estado: "ACTIVO",
            creado_en: new Date().toISOString(),
          },
        },
      ],
      typecast: true,
    }),
  });

  // La copia. Si ya hubiera una fila con esa cédula o ese nombre (una prueba
  // vieja, desactivada), se reutiliza en vez de chocar con los índices.
  const copia = await leerCopia();
  const previa =
    copia.find((s) => soloDigitos(s.documento) === cedula) ??
    copia.find((s) => plano(s.nombre) === plano(nombre));
  const campos: Record<string, unknown> = { nombre, documento: cedula, activo: true };
  if (input.telefono?.trim()) campos.telefono = input.telefono.trim();

  const q = previa
    ? supabase.from("operadores").update(campos).eq("id", previa.id)
    : supabase.from("operadores").insert(campos);
  const { data, error } = await q.select(COLUMNAS).single();
  if (error) throw new Error(error.message);
  return data as OperadorRow;
}
