/**
 * Registro de flota vivo: máquinas, operadores y sus asignaciones en el tiempo.
 *
 * El esquema está en `supabase/flota.sql` y hay que correrlo una vez en el SQL
 * Editor de Supabase; hasta entonces la app funciona con los nombres de fábrica
 * de los nodos y los formularios avisan que falta.
 *
 * Tres entidades porque cambian a tres ritmos distintos: la máquina casi no
 * cambia, el nodo se pasa de una máquina a otra, y el operador rota varias
 * veces al día. Las dos asignaciones guardan `desde`/`hasta`, así que todo lo
 * que se resuelve aquí se resuelve PARA UN INSTANTE: el histórico del 3 de
 * marzo muestra quién manejaba el 3 de marzo, no quién maneja hoy.
 */

import { supabase } from "./supabase";
import { dayRange } from "./ranges";
import { COLOR_DEFAULT, type Maquina, type TipoMaquina } from "./tractores";

/* ============================== tipos ============================== */

/** Una máquina del parque: existe aunque hoy no lleve nodo ni operador. */
export interface MaquinaRow {
  id: string;
  codigo: string;
  nombre: string;
  tipo: TipoMaquina;
  color: string;
  activa: boolean;
}

/**
 * El teléfono NO está aquí a propósito. Se puede escribir pero no se lee: la
 * app consulta con la anon key, que viaja en el bundle del navegador, así que
 * todo lo que se seleccione es público para cualquiera que abra la app o la
 * pestaña de red. La base lo respalda con un GRANT por columna (ver
 * `supabase/flota.sql`), para que no dependa de que nadie lo pida por error.
 */
export interface OperadorRow {
  id: string;
  nombre: string;
  documento: string | null;
  activo: boolean;
}

/** Tramo en que un nodo estuvo montado en una máquina. `hasta: null` = vigente. */
export interface AsignacionNodo {
  id: string;
  node_id: string;
  maquina_id: string;
  desde: string;
  hasta: string | null;
}

/** Turno de un operador sobre una máquina. `hasta: null` = está al mando. */
export interface Turno {
  id: string;
  maquina_id: string;
  operador_id: string;
  desde: string;
  hasta: string | null;
  nota: string | null;
}

/**
 * Todo el registro, en memoria.
 *
 * Se trae entero y se resuelve en el cliente en vez de preguntar por cada
 * nodo y cada fecha. Es una finca: son unas pocas máquinas y un puñado de
 * relevos al día, o sea cientos de filas al año. A cambio, cambiar la fecha del
 * histórico recalcula la identidad de la flota sin volver a la red.
 */
export interface Flota {
  maquinas: MaquinaRow[];
  operadores: OperadorRow[];
  asignaciones: AsignacionNodo[];
  turnos: Turno[];
}

export const FLOTA_VACIA: Flota = {
  maquinas: [],
  operadores: [],
  asignaciones: [],
  turnos: [],
};

/* ============================== errores ============================== */

/** Códigos de PostgREST cuando la tabla o la función todavía no existen. */
const FALTA = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

export class FlotaNoInstalada extends Error {
  constructor() {
    super(
      "Falta crear las tablas de flota. Corre supabase/flota.sql en el SQL Editor de Supabase."
    );
    this.name = "FlotaNoInstalada";
  }
}

/** Nombre o código ya usados por otra máquina/persona: lo detecta el índice único. */
export class Duplicado extends Error {
  constructor(public campo: "nombre" | "codigo") {
    super(
      campo === "nombre"
        ? "Ese nombre ya está registrado."
        : "Ese código ya está registrado."
    );
    this.name = "Duplicado";
  }
}

/** Traduce un error de PostgREST a algo que el formulario pueda mostrar. */
function traducir(error: { code?: string; message?: string; details?: string }): Error {
  if (FALTA.has(error.code ?? "")) return new FlotaNoInstalada();
  if (error.code === "23505") {
    const msg = `${error.message ?? ""} ${error.details ?? ""}`;
    return new Duplicado(msg.includes("codigo") ? "codigo" : "nombre");
  }
  // Las funciones de relevo levantan 22023 con un mensaje ya redactado para
  // que lo lea una persona; se deja pasar tal cual.
  return new Error(error.message ?? "Error desconocido");
}

/* ============================== lectura ============================== */

export async function fetchFlota(): Promise<Flota> {
  const [maq, ope, asi, tur] = await Promise.all([
    supabase.from("maquinas").select("id,codigo,nombre,tipo,color,activa"),
    supabase.from("operadores").select("id,nombre,documento,activo"),
    supabase.from("nodo_maquina").select("id,node_id,maquina_id,desde,hasta"),
    supabase
      .from("maquina_operador")
      .select("id,maquina_id,operador_id,desde,hasta,nota"),
  ]);

  for (const r of [maq, ope, asi, tur]) {
    if (r.error) {
      // Tabla ausente = "aún no instalado", no un fallo: la app sigue viva con
      // los nombres de fábrica y el formulario explica qué falta.
      if (FALTA.has(r.error.code ?? "")) return FLOTA_VACIA;
      throw traducir(r.error);
    }
  }

  return {
    maquinas: (maq.data ?? []) as MaquinaRow[],
    operadores: (ope.data ?? []) as OperadorRow[],
    asignaciones: (asi.data ?? []) as AsignacionNodo[],
    turnos: (tur.data ?? []) as Turno[],
  };
}

/* =========================== resolución =========================== */

/** true si el tramo [desde, hasta) contiene el instante t (epoch ms). */
function vigenteEn(tramo: { desde: string; hasta: string | null }, t: number): boolean {
  const d = Date.parse(tramo.desde);
  if (d > t) return false;
  return tramo.hasta == null || Date.parse(tramo.hasta) > t;
}

/** La máquina en la que estaba montado ese nodo en ese instante. */
export function maquinaDeNodoEn(
  flota: Flota,
  nodeId: string,
  t: number
): MaquinaRow | null {
  const a = flota.asignaciones.find(
    (x) => x.node_id === nodeId && vigenteEn(x, t)
  );
  if (!a) return null;
  return flota.maquinas.find((m) => m.id === a.maquina_id) ?? null;
}

/** Quién manejaba esa máquina en ese instante. */
export function operadorDeMaquinaEn(
  flota: Flota,
  maquinaId: string,
  t: number
): OperadorRow | null {
  const turno = flota.turnos.find(
    (x) => x.maquina_id === maquinaId && vigenteEn(x, t)
  );
  if (!turno) return null;
  return flota.operadores.find((o) => o.id === turno.operador_id) ?? null;
}

/** Máquina y operador de un nodo en un instante. */
export function identidadDeNodoEn(
  flota: Flota,
  nodeId: string,
  t: number
): { maquina: MaquinaRow | null; operador: OperadorRow | null } {
  const maquina = maquinaDeNodoEn(flota, nodeId, t);
  return {
    maquina,
    operador: maquina ? operadorDeMaquinaEn(flota, maquina.id, t) : null,
  };
}

/**
 * Identidad de todos los nodos en un instante, en el formato que consume
 * `setRegistroFlota` (y con él el mapa, el panel y el grabador de video).
 */
export function registroEn(
  flota: Flota,
  t: number
): Record<string, Maquina> {
  const out: Record<string, Maquina> = {};
  for (const a of flota.asignaciones) {
    if (!vigenteEn(a, t)) continue;
    const m = flota.maquinas.find((x) => x.id === a.maquina_id);
    if (!m) continue;
    const op = operadorDeMaquinaEn(flota, m.id, t);
    out[a.node_id] = {
      codigo: m.codigo,
      nombre: m.nombre,
      tipo: m.tipo,
      color: m.color || COLOR_DEFAULT,
      operador: op?.nombre,
    };
  }
  return out;
}

/** Un turno resuelto, para listarlo en el panel. */
export interface TurnoResuelto extends Turno {
  operador: OperadorRow | null;
}

/**
 * Todos los turnos que tocaron un día de Bogotá, en orden.
 *
 * El panel del histórico los muestra completos y no sólo el último: si Juan
 * manejó en la mañana y Pedro de noche, un recorrido de ese día es obra de los
 * dos, y mostrar sólo a uno sería atribuirle mal el trabajo.
 */
export function turnosDelDia(
  flota: Flota,
  maquinaId: string,
  dia: string
): TurnoResuelto[] {
  const { fromISO, toISO } = dayRange(dia);
  const ini = Date.parse(fromISO);
  const fin = Date.parse(toISO);

  return flota.turnos
    .filter((t) => {
      if (t.maquina_id !== maquinaId) return false;
      const d = Date.parse(t.desde);
      const h = t.hasta ? Date.parse(t.hasta) : Infinity;
      return d < fin && h > ini; // se solapa con el día
    })
    .sort((a, b) => Date.parse(a.desde) - Date.parse(b.desde))
    .map((t) => ({
      ...t,
      operador: flota.operadores.find((o) => o.id === t.operador_id) ?? null,
    }));
}

/** Máquinas que hoy no llevan ningún nodo montado (para el desplegable). */
export function maquinasLibres(flota: Flota, t: number): MaquinaRow[] {
  const ocupadas = new Set(
    flota.asignaciones.filter((a) => vigenteEn(a, t)).map((a) => a.maquina_id)
  );
  return flota.maquinas.filter((m) => m.activa && !ocupadas.has(m.id));
}

/** El nodo que lleva montado una máquina en ese instante, si lleva alguno. */
export function nodoDeMaquinaEn(
  flota: Flota,
  maquinaId: string,
  t: number
): string | null {
  return (
    flota.asignaciones.find((a) => a.maquina_id === maquinaId && vigenteEn(a, t))
      ?.node_id ?? null
  );
}

/* ============================ escritura ============================ */

export interface MaquinaInput {
  codigo: string;
  nombre: string;
  tipo: TipoMaquina;
  color: string;
}

export async function crearMaquina(input: MaquinaInput): Promise<MaquinaRow> {
  const { data, error } = await supabase
    .from("maquinas")
    .insert({
      codigo: input.codigo.trim(),
      nombre: input.nombre.trim(),
      tipo: input.tipo,
      color: input.color,
    })
    .select("id,codigo,nombre,tipo,color,activa")
    .single();
  if (error) throw traducir(error);
  return data as MaquinaRow;
}

export async function actualizarMaquina(
  id: string,
  cambios: Partial<MaquinaInput & { activa: boolean }>
): Promise<MaquinaRow> {
  const { data, error } = await supabase
    .from("maquinas")
    .update(cambios)
    .eq("id", id)
    .select("id,codigo,nombre,tipo,color,activa")
    .single();
  if (error) throw traducir(error);
  return data as MaquinaRow;
}

export interface OperadorInput {
  nombre: string;
  documento?: string;
  /** Sólo de escritura: se guarda, nunca vuelve. Ver `OperadorRow`. */
  telefono?: string;
}

export async function crearOperador(
  input: OperadorInput
): Promise<OperadorRow> {
  const { data, error } = await supabase
    .from("operadores")
    .insert({
      nombre: input.nombre.trim(),
      documento: vacioANull(input.documento),
      telefono: vacioANull(input.telefono),
    })
    .select("id,nombre,documento,activo")
    .single();
  if (error) throw traducir(error);
  return data as OperadorRow;
}

/**
 * El formulario no puede mostrar el teléfono guardado, así que llega vacío
 * cuando no se quiso cambiar: un vacío se descarta en vez de escribir null, o
 * editar el nombre de un operador borraría su teléfono sin que nadie lo viera.
 * Para borrarlo a propósito está `telefono: null`.
 */
export async function actualizarOperador(
  id: string,
  cambios: Partial<OperadorInput & { activo: boolean; telefono: string | null }>
): Promise<OperadorRow> {
  const limpios = { ...cambios };
  if (limpios.telefono !== null && !limpios.telefono?.trim()) delete limpios.telefono;

  const { data, error } = await supabase
    .from("operadores")
    .update(limpios)
    .eq("id", id)
    .select("id,nombre,documento,activo")
    .single();
  if (error) throw traducir(error);
  return data as OperadorRow;
}

/**
 * Monta un nodo en una máquina. Cierra en la misma transacción lo que hubiera
 * abierto, tanto del nodo como de la máquina (ver `asignar_nodo` en el SQL).
 */
export async function asignarNodo(
  nodeId: string,
  maquinaId: string,
  desde?: Date
): Promise<void> {
  const { error } = await supabase.rpc("asignar_nodo", {
    p_node_id: nodeId,
    p_maquina_id: maquinaId,
    p_desde: (desde ?? new Date()).toISOString(),
  });
  if (error) throw traducir(error);
}

export async function desasignarNodo(
  nodeId: string,
  hasta?: Date
): Promise<void> {
  const { error } = await supabase.rpc("desasignar_nodo", {
    p_node_id: nodeId,
    p_hasta: (hasta ?? new Date()).toISOString(),
  });
  if (error) throw traducir(error);
}

/** El relevo: cierra el turno anterior y abre el nuevo, atómicamente. */
export async function asignarOperador(
  maquinaId: string,
  operadorId: string,
  desde?: Date,
  nota?: string
): Promise<void> {
  const { error } = await supabase.rpc("asignar_operador", {
    p_maquina_id: maquinaId,
    p_operador_id: operadorId,
    p_desde: (desde ?? new Date()).toISOString(),
    p_nota: vacioANull(nota),
  });
  if (error) throw traducir(error);
}

/** Cierra el turno abierto: la máquina queda sin nadie al mando. */
export async function liberarMaquina(
  maquinaId: string,
  hasta?: Date
): Promise<void> {
  const { error } = await supabase.rpc("liberar_maquina", {
    p_maquina_id: maquinaId,
    p_hasta: (hasta ?? new Date()).toISOString(),
  });
  if (error) throw traducir(error);
}

function vacioANull(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  return t === "" ? null : t;
}
