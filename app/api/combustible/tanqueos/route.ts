/**
 * Tanqueos de una máquina en una ventana de días.
 *
 * GET /api/combustible/tanqueos?codigo=MA106&desde=2026-09-15&hasta=2026-09-28
 */

import { leerTanqueos, SinConfigurar } from "@/lib/combustibleAirtable";

/**
 * `codigo` se interpola en una fórmula de Airtable: con este patrón no hay
 * comillas ni barras que cierren el texto y reescriban el filtro. Cubre todos
 * los códigos reales del parque ("MA106", "BW2011D-4", "TANQUE MOVILE").
 */
const CODIGO = /^[A-Za-z0-9][A-Za-z0-9 .\-]{0,23}$/;
const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const codigo = url.searchParams.get("codigo") ?? "";
  const desde = url.searchParams.get("desde") ?? "";
  const hasta = url.searchParams.get("hasta") ?? "";
  if (!CODIGO.test(codigo) || !FECHA.test(desde) || !FECHA.test(hasta) || desde > hasta) {
    return Response.json({ error: "Parámetros inválidos" }, { status: 400 });
  }

  try {
    return Response.json(await leerTanqueos({ codigo, desde, hasta }));
  } catch (e) {
    if (e instanceof SinConfigurar) {
      return Response.json({ error: e.message, sinConfigurar: true }, { status: 501 });
    }
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
}
