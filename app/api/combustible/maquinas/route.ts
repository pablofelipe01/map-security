/**
 * Parque de máquinas de la base de combustible.
 *
 * GET /api/combustible/maquinas
 *
 * Lo pide el índice de universos para listar también las máquinas que no
 * llevan nodo. Cambia muy poco, así que se guarda unos minutos en memoria del
 * servidor: abrir el índice varias veces no debe gastar el cupo de 5 req/s de
 * la base, que comparte con la app de combustible.
 */

import { leerMaquinas, SinConfigurar } from "@/lib/combustibleAirtable";
import type { MaquinaCombustible } from "@/lib/combustible";

const VIGENCIA_MS = 5 * 60_000;
let cache: { t: number; maquinas: MaquinaCombustible[] } | null = null;

export async function GET() {
  try {
    if (!cache || Date.now() - cache.t > VIGENCIA_MS) {
      cache = { t: Date.now(), maquinas: await leerMaquinas() };
    }
    return Response.json({ maquinas: cache.maquinas });
  } catch (e) {
    if (e instanceof SinConfigurar) {
      return Response.json({ error: e.message, sinConfigurar: true }, { status: 501 });
    }
    return Response.json({ error: String((e as Error)?.message ?? e) }, { status: 502 });
  }
}
