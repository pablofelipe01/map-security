/**
 * Copia los operarios de Airtable a `operadores` de Supabase.
 *
 * GET  /api/operadores/sincronizar  → qué cambiaría, sin tocar nada.
 * POST /api/operadores/sincronizar  → lo aplica.
 *
 * La app llama al POST cada vez que carga la flota (`fetchFlota`), así que un
 * conductor que se agregue o se anule en Airtable aparece en la planilla y en
 * la torre sin que nadie tenga que acordarse de sincronizar. Para que eso no
 * sean dos lecturas de Airtable por cada pantalla que se abre, hay un tope: si
 * ya se sincronizó hace menos de `ESPERA_MS`, el POST contesta sin hacer nada.
 * `?forzar=1` se lo salta.
 *
 * Toda la lógica está en `lib/operariosAirtable.ts`; esto es sólo la puerta.
 */

import {
  Rechazo,
  SinConfigurar,
  sincronizarOperadores,
} from "@/lib/operariosAirtable";

const ESPERA_MS = 2 * 60_000;

/** Vive lo que viva el proceso del servidor: basta para no repetir en ráfaga. */
let ultima = 0;
let enCurso: Promise<unknown> | null = null;

export async function GET() {
  try {
    return Response.json(await sincronizarOperadores(false));
  } catch (e) {
    return error(e);
  }
}

export async function POST(request: Request) {
  const forzar = new URL(request.url).searchParams.get("forzar") === "1";
  if (!forzar && Date.now() - ultima < ESPERA_MS) {
    return Response.json({ omitido: true });
  }
  // Dos pantallas que cargan a la vez comparten la misma pasada en vez de
  // correr dos que se pisen creando las mismas filas.
  if (enCurso) {
    await enCurso.catch(() => {});
    return Response.json({ omitido: true });
  }

  try {
    const p = sincronizarOperadores(true);
    enCurso = p;
    const r = await p;
    // Sólo cuenta como hecha si no hubo errores: si Supabase rechazó algo, la
    // próxima carga vuelve a intentar en vez de esperar dos minutos.
    if (r.errores.length === 0) ultima = Date.now();
    return Response.json(r);
  } catch (e) {
    return error(e);
  } finally {
    enCurso = null;
  }
}

function error(e: unknown) {
  if (e instanceof SinConfigurar) {
    return Response.json({ error: e.message, sinConfigurar: true }, { status: 501 });
  }
  if (e instanceof Rechazo) {
    return Response.json({ error: e.message }, { status: e.status });
  }
  return Response.json(
    { error: String((e as Error)?.message ?? e) },
    { status: 502 },
  );
}
