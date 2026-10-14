"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  casillasDe,
  fetchVueltasPendientes,
  letraFruto,
  nombreFruto,
  type Viaje,
} from "@/lib/vagones";
import { fmtTime } from "@/lib/geo";
import { todayLocal } from "@/lib/ranges";
import { SUPABASE_READY } from "@/lib/supabase";

/**
 * Las vueltas pendientes por recoger, en lista. Es lo que abre el QR de la
 * planilla.
 *
 * SE LEE EN EL CELULAR Y NO SE ESCRIBE. El que la abre está en el campo, de
 * pie: quiere saber a dónde hay que ir, no corregir la hoja. Por eso no hay
 * formulario ni se toca un renglón; corregir sigue siendo cosa de la planilla.
 *
 * ACÁ SÍ HAY POLL, al revés que en la planilla: aquí nadie escribe, así que
 * recargar no le mueve nada a nadie, y el que mira necesita enterarse de la
 * vuelta que se anotó hace un minuto en la oficina.
 */
const CADA_MS = 60_000;

export default function VueltasPendientesPage() {
  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leido, setLeido] = useState<Date | null>(null);

  const cargar = useCallback(async () => {
    try {
      setViajes(await fetchVueltasPendientes());
      setError(null);
      setLeido(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar la lista.");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    if (!SUPABASE_READY) {
      setCargando(false);
      setError("Falta configurar Supabase en .env.local.");
      return;
    }
    void cargar();
    const t = setInterval(() => void cargar(), CADA_MS);
    return () => clearInterval(t);
  }, [cargar]);

  const hoy = todayLocal();

  return (
    <main className="h-dvh overflow-y-auto overscroll-contain bg-bg">
      <header className="sticky top-0 z-20 border-b border-border bg-surface px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-card md:px-4">
        <div className="flex items-center gap-x-4">
          <Link href="/despacho" className="back-link shrink-0">
            ← Planilla
          </Link>
          <h1 className="card-h2 !mb-0 mr-auto">Vueltas pendientes</h1>
          <button
            type="button"
            className="btn-chip"
            onClick={() => void cargar()}
            disabled={cargando}
          >
            Actualizar
          </button>
        </div>
        {leido && (
          <p className="mt-1 text-[11px] text-ink-3">
            {viajes.length === 1
              ? "1 vuelta por recoger"
              : `${viajes.length} vueltas por recoger`}{" "}
            · actualizado {fmtTime(leido.toISOString())}
          </p>
        )}
      </header>

      <div className="mx-auto w-full max-w-[640px] px-3 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-3">
        {error && (
          <p className="mb-3 rounded-[10px] bg-[#fdecec] px-3 py-2 text-[12px] leading-tight text-st-alerta">
            {error}
          </p>
        )}

        {cargando ? (
          <p className="py-10 text-center text-[13px] text-ink-3">Cargando…</p>
        ) : viajes.length === 0 && !error ? (
          <p className="card px-4 py-10 text-center text-[13px] text-ink-2">
            No hay vueltas pendientes por recoger.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {viajes.map((v) => (
              <Vuelta key={v.id} viaje={v} hoy={hoy} />
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

/**
 * Una vuelta: dónde están los vagones llenos, grande, porque es lo que se
 * busca; lo demás, debajo y más chico. Con el mismo tinte y la misma franja
 * que la vuelta pendiente tiene en la planilla, para que se reconozca.
 */
function Vuelta({ viaje, hoy }: { viaje: Viaje; hoy: string }) {
  const [origenB, origenN] = casillasDe({
    bloque: viaje.origen_bloque,
    num: viaje.origen_num,
  });
  const [destinoB, destinoN] = casillasDe({
    bloque: viaje.destino_bloque,
    num: viaje.destino_num,
  });

  return (
    <li className="card border-l-4 border-l-accent-2 bg-accent-2/10 p-3">
      <div className="mb-1.5 flex items-center gap-2 text-[12px] text-ink-2">
        <span className="mono font-bold text-ink-3">#{viaje.consecutivo}</span>
        <span
          title={nombreFruto(viaje.tipo_fruto)}
          className="mono inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border bg-surface text-[10px] font-bold text-ink-2"
        >
          {letraFruto(viaje.tipo_fruto)}
        </span>
        <span className="mono ml-auto">
          {/* La fecha sólo si no es de hoy: una vuelta de ayer que sigue acá
              es la que más importa ver. */}
          {viaje.jornada !== hoy && (
            <strong className="text-st-detenida">{viaje.jornada} · </strong>
          )}
          reporte {fmtTime(viaje.reportado_en)}
        </span>
      </div>

      <p className="t-label mb-0.5">Vagones llenos</p>
      <p className="mono text-[20px] font-extrabold leading-tight text-ink">
        {origenB || "—"} · {origenN || "—"}
      </p>
      {viaje.origen_codigo && (
        <p className="text-[11px] text-ink-3">{viaje.origen_codigo}</p>
      )}

      {viaje.destino_acopio_id && (
        <p className="mt-2 text-[12.5px] text-ink-2">
          Ubicar vagón{viaje.vagon ? ` ${viaje.vagon}` : ""} en{" "}
          <span className="mono font-bold text-ink">
            {destinoB || "—"} · {destinoN || "—"}
          </span>
        </p>
      )}

      {viaje.observaciones && (
        <p className="mt-2 text-[12px] leading-snug text-ink-2">
          {viaje.observaciones}
        </p>
      )}
    </li>
  );
}
