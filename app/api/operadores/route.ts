/**
 * Alta de un conductor: se escribe en Airtable (la lista verídica) y se copia
 * a Supabase. Ver `lib/operariosAirtable.ts`.
 *
 * POST /api/operadores  { nombre, documento, telefono? }  →  OperadorRow
 *
 * Existe como ruta y no como llamada desde el navegador porque el token de
 * Airtable no puede salir del servidor.
 */

import { darDeAlta, Rechazo, SinConfigurar } from "@/lib/operariosAirtable";

export async function POST(request: Request) {
  let body: { nombre?: unknown; documento?: unknown; telefono?: unknown };
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Cuerpo inválido" }, { status: 400 });
  }

  try {
    const operador = await darDeAlta({
      nombre: typeof body.nombre === "string" ? body.nombre : "",
      documento: typeof body.documento === "string" ? body.documento : "",
      telefono: typeof body.telefono === "string" ? body.telefono : undefined,
    });
    return Response.json(operador, { status: 201 });
  } catch (e) {
    if (e instanceof SinConfigurar) {
      return Response.json({ error: e.message }, { status: 501 });
    }
    if (e instanceof Rechazo) {
      return Response.json({ error: e.message }, { status: e.status });
    }
    return Response.json(
      { error: String((e as Error)?.message ?? e) },
      { status: 502 },
    );
  }
}
