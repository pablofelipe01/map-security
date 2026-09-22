/**
 * La planilla de vagones: el registro de despacho, renglón por renglón.
 *
 * Es la hoja de papel de Logística y Transporte pasada a la base. Un renglón es
 * un VIAJE: entra un reporte de que hay vagones llenos en un acopio, se manda
 * un conductor, y de paso se le dice dónde dejar un vagón vacío. El esquema y
 * el porqué de cada columna están en `supabase/vagones.sql`.
 *
 * EN QUÉ SE DIFERENCIA DE `lib/planeacion.ts`. Aquélla registra una intención
 * —a qué acopios va una máquina hoy— y su sujeto es la máquina. Ésta registra
 * lo que pasó, su sujeto es el viaje, y los renglones llegan de a uno a lo
 * largo del día sin saber todavía quién los va a atender. Conviven: la
 * planeación sigue siendo la ruta del día.
 *
 * LO QUE ESTE MÓDULO SÍ APORTA SOBRE EL PAPEL. En la hoja el sitio se escribe
 * como dos números sueltos ("BLOQUE 334, ACOPIO 68") y nadie puede comprobar
 * que ese acopio exista. Acá esos dos números se traducen a un acopio de verdad
 * —con coordenadas— antes de escribir, y si no resuelven la app lo dice. Ver
 * `resolverAcopio`.
 */

import { supabase } from "./supabase";
import type { Acopio } from "./acopios";

/* ============================== tipos ============================== */

/**
 * La H y la C que se escriben a mano en la primera columna de la hoja.
 *
 * No tiene default en la base a propósito: de qué fruto se trata es parte del
 * reporte, y elegir uno por omisión es inventar la mitad del dato.
 */
export type TipoFruto = "hibrido" | "comercial";

export const TIPOS_FRUTO: { valor: TipoFruto; label: string; letra: string }[] = [
  { valor: "hibrido", label: "Híbrido", letra: "H" },
  { valor: "comercial", label: "Comercial", letra: "C" },
];

/** "hibrido" → "H". Lo que va en la casilla estrecha de la tabla. */
export function letraFruto(t: TipoFruto | string): string {
  return TIPOS_FRUTO.find((x) => x.valor === t)?.letra ?? "?";
}

/** "hibrido" → "Híbrido". Para leerlo en un formulario o un tooltip. */
export function nombreFruto(t: TipoFruto | string): string {
  return TIPOS_FRUTO.find((x) => x.valor === t)?.label ?? String(t);
}

/**
 * Un renglón de la planilla, como lo devuelve `v_planilla_vagones`: el viaje
 * con el rótulo de sus dos acopios y el nombre del conductor ya resueltos.
 *
 * Viene de una vista y no de tres consultas porque la pantalla pide el día
 * entero cada vez que cambia la fecha, y cruzar treinta renglones contra 845
 * acopios en el navegador es trabajo que la base ya hizo.
 */
export interface Viaje {
  id: string;
  /** Día de Bogotá, "YYYY-MM-DD". */
  jornada: string;
  /** El "No." de la hoja, desde 1. Lo asigna la base, no el cliente. */
  consecutivo: number;
  tipo_fruto: TipoFruto;
  /** Cuándo entró el reporte (ISO UTC). */
  reportado_en: string;
  /** Cuándo salió la máquina, o null si todavía no sale. */
  salida_en: string | null;
  /** El número pintado en el vagón que se va a ubicar. */
  vagon: string | null;
  observaciones: string | null;

  /** Dónde están los vagones llenos. */
  origen_acopio_id: string;
  origen_codigo: string;
  origen_bloque: string | null;
  origen_lote: string | null;
  origen_num: string | null;
  origen_lat: number;
  origen_lon: number;

  /** Dónde dejar el vagón vacío. Todo null si el reporte era sólo de recoger. */
  destino_acopio_id: string | null;
  destino_codigo: string | null;
  destino_bloque: string | null;
  destino_lote: string | null;
  destino_num: string | null;
  destino_lat: number | null;
  destino_lon: number | null;

  operador_id: string | null;
  operador_nombre: string | null;
}

/** Lo que hace falta para abrir un renglón nuevo. */
export interface ViajeNuevo {
  jornada: string;
  tipo_fruto: TipoFruto;
  origen_acopio_id: string;
  /** ISO UTC. Se omite para que la base selle `now()`. */
  reportado_en?: string;
  salida_en?: string | null;
  destino_acopio_id?: string | null;
  vagon?: string | null;
  operador_id?: string | null;
  observaciones?: string | null;
}

/** Lo que se puede corregir después. La jornada y el "No." no están: son la
 *  identidad del renglón y la base los rechaza (ver `viajes_sellar`). */
export type ViajeCambios = Partial<Omit<ViajeNuevo, "jornada">>;

/* ============================== errores ============================== */

/** Códigos de PostgREST cuando la tabla o la vista todavía no existen. */
const FALTA = new Set(["42P01", "42883", "PGRST202", "PGRST205"]);

export class VagonesNoInstalados extends Error {
  constructor() {
    super(
      "Falta crear la tabla de la planilla. Corre supabase/vagones.sql en el " +
        "SQL Editor de Supabase."
    );
    this.name = "VagonesNoInstalados";
  }
}

/**
 * Traduce un error de PostgREST a algo que el formulario pueda mostrar.
 *
 * Los constraints del esquema no traen mensaje redactado —son checks, no
 * `raise`— así que acá se les pone uno. El trigger sí redacta los suyos en
 * español y ésos pasan tal cual, igual que en `lib/planeacion.ts`.
 */
function traducir(error: { code?: string; message?: string }): Error {
  if (FALTA.has(error.code ?? "")) return new VagonesNoInstalados();

  const msg = error.message ?? "";
  if (error.code === "23514") {
    if (msg.includes("viajes_vagon_con_destino")) {
      return new Error(
        "Para anotar un número de vagón hay que decir dónde se va a ubicar."
      );
    }
    if (msg.includes("viajes_salida_despues_del_reporte")) {
      return new Error("La hora de salida no puede ser anterior a la del reporte.");
    }
    if (msg.includes("viajes_tipo_fruto_valido")) {
      return new Error("El tipo de fruto tiene que ser Híbrido o Comercial.");
    }
  }
  if (error.code === "23503") {
    return new Error(
      "El acopio o el conductor que quedó en el renglón ya no existe en el maestro."
    );
  }

  return new Error(msg || "Error desconocido");
}

/* ============================== lectura ============================== */

/** Columnas de la vista. Explícitas para que agregar una a la base no cambie
 *  sola lo que viaja por la red. */
const COLUMNAS =
  "id,jornada,consecutivo,tipo_fruto,reportado_en,salida_en,vagon,observaciones," +
  "origen_acopio_id,origen_codigo,origen_bloque,origen_lote,origen_num,origen_lat,origen_lon," +
  "destino_acopio_id,destino_codigo,destino_bloque,destino_lote,destino_num,destino_lat,destino_lon," +
  "operador_id,operador_nombre";

/**
 * La hoja de una jornada, en el orden del papel.
 *
 * Tabla ausente = "todavía no instalado", no un fallo: devuelve vacío y la
 * pantalla lo avisa aparte. Mismo criterio que `fetchPlan` y `fetchAcopios`.
 */
export async function fetchPlanilla(jornada: string): Promise<Viaje[]> {
  const { data, error } = await supabase
    .from("v_planilla_vagones")
    .select(COLUMNAS)
    .eq("jornada", jornada)
    .order("consecutivo");

  if (error) {
    if (FALTA.has(error.code ?? "")) return [];
    throw traducir(error);
  }

  return (data ?? []) as unknown as Viaje[];
}

/* ============================== escritura ============================== */

/**
 * Abre un renglón nuevo.
 *
 * No manda `consecutivo`: lo calcula el trigger tomando un lock por jornada,
 * porque dos personas registrando a la vez leerían el mismo "último número" y
 * escribirían las dos el 14. Ver `viajes_numerar` en el esquema.
 *
 * Devuelve el número que le tocó, que es lo que la pantalla necesita para
 * decir "quedó el 14" sin volver a consultar.
 */
export async function registrarViaje(v: ViajeNuevo): Promise<number> {
  const { data, error } = await supabase
    .from("viajes_vagones")
    .insert(limpiar(v))
    .select("consecutivo")
    .single();

  if (error) throw traducir(error);
  return (data as { consecutivo: number }).consecutivo;
}

/**
 * Corrige un renglón.
 *
 * A diferencia de una asignación de recolección —que una vez completada se
 * congela— acá se corrige todo el día: llega el conductor, se anota la salida,
 * cambia el vagón. Ésa es la forma normal de trabajo de la hoja. Lo único que
 * la base rechaza es cambiarle el día o el número al renglón.
 */
export async function corregirViaje(
  id: string,
  cambios: ViajeCambios
): Promise<void> {
  const { error } = await supabase
    .from("viajes_vagones")
    .update(limpiar(cambios))
    .eq("id", id);

  if (error) throw traducir(error);
}

/**
 * Marca la salida de un renglón, ahora.
 *
 * Es el gesto más frecuente del día y por eso tiene su propia función: el que
 * despacha no está editando un formulario, está viendo salir un tractor.
 */
export async function marcarSalida(
  id: string,
  cuando: Date = new Date()
): Promise<void> {
  await corregirViaje(id, { salida_en: cuando.toISOString() });
}

/**
 * Quita las cadenas vacías.
 *
 * Un `<input>` sin llenar devuelve "", y "" guardado en `vagon` u
 * `observaciones` es un valor que parece dato: rompe el `is null` de los
 * conteos y hace que el check de "vagón sin destino" no dispare. Null es lo que
 * quiere decir "no se anotó".
 */
function limpiar<T extends object>(o: T): T {
  const r: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v === undefined) continue;
    r[k] = typeof v === "string" && v.trim() === "" ? null : v;
  }
  return r as T;
}

/* ========================= bloque + acopio ========================= */

/**
 * Traduce lo que dice el papel —"BLOQUE 334, ACOPIO 68"— a un acopio de la
 * tabla.
 *
 * EL PAPEL Y LA TABLA NO ESCRIBEN IGUAL. En la hoja el bloque es un número
 * pelado ("334"); en `acopios` es "B.334", porque así viene rotulado el plano.
 * El número del acopio es `num`, y no siempre es un número: hay "8A", "9A",
 * "1A". Por eso la comparación normaliza los dos lados en vez de exigir que el
 * que despacha escriba el formato de la base — la app se adapta al papel, no al
 * revés.
 *
 * DEVUELVE UNA LISTA, NO UN ACOPIO. De los 845 puntos, (bloque, num) identifica
 * uno solo en todos los casos salvo uno (`B.5 · 2`, que está duplicado en el
 * plano), y hay 44 puntos sin bloque rotulado donde el número solo se repite.
 * Devolver el primero y seguir sería elegir por el usuario en el único momento
 * en que de verdad hay que preguntarle. Cero resultados = el renglón apunta a
 * un acopio que no existe, que es justo el error que el papel no puede ver.
 */
export function resolverAcopio(
  acopios: Acopio[],
  bloque: string,
  num: string
): Acopio[] {
  const b = normBloque(bloque);
  const n = normNum(num);
  if (!n) return [];

  return acopios.filter(
    (a) => normBloque(a.bloque ?? "") === b && normNum(a.num ?? "") === n
  );
}

/**
 * "B.334", "b334", " 334 " → "334". Sin bloque → "".
 *
 * El prefijo "B." es del rótulo del plano y no distingue nada: no hay dos
 * bloques que se diferencien sólo en él.
 */
function normBloque(s: string): string {
  return s.trim().toUpperCase().replace(/^B\.?\s*/, "");
}

/** "8a", " 8A " → "8A". Mayúsculas porque "8a" y "8A" son el mismo punto. */
function normNum(s: string): string {
  return s.trim().toUpperCase();
}

/** Cómo se escribe un acopio en las dos casillas del papel: ["334", "68"]. */
export function casillasDe(a: {
  bloque: string | null;
  num: string | null;
}): [string, string] {
  return [normBloque(a.bloque ?? ""), a.num ?? ""];
}

/* ============================== resumen ============================== */

/** Lo que se lee de un vistazo arriba de la hoja. */
export interface ResumenPlanilla {
  total: number;
  /** Reportados que todavía no salen: el pendiente del día. */
  pendientes: number;
  /** Salidos pero sin conductor anotado — casi siempre es un olvido. */
  sinConductor: number;
  hibrido: number;
  comercial: number;
}

export function resumirPlanilla(viajes: Viaje[]): ResumenPlanilla {
  return {
    total: viajes.length,
    pendientes: viajes.filter((v) => !v.salida_en).length,
    sinConductor: viajes.filter((v) => v.salida_en && !v.operador_id).length,
    hibrido: viajes.filter((v) => v.tipo_fruto === "hibrido").length,
    comercial: viajes.filter((v) => v.tipo_fruto === "comercial").length,
  };
}
