"use client";

import { tipoDeDescripcion, type MaquinaCombustible } from "@/lib/combustible";
import { COLOR_DEFAULT } from "@/lib/tractores";
import { shiftDay, todayLocal } from "@/lib/ranges";
import { MiniIcon } from "./SidePanel";
import TanqueosPanel from "./TanqueosPanel";

interface Props {
  codigo: string;
  /** null mientras carga el catálogo o si el código no está en él. */
  maquina: MaquinaCombustible | null;
  cargando: boolean;
  /** Día en que cierra la ventana; sin él, hoy. */
  fecha?: string;
  onBack: () => void;
}

/**
 * Universo de una máquina que no lleva nodo: sólo existe en la base de
 * combustible. No hay recorrido ni estado que mostrar —no hay GPS—, así que la
 * ficha es su identidad y sus tanqueos, y lo dice en vez de pintar ceros.
 *
 * La ventana es de 30 días y no de 14 como la ficha con nodo: una máquina se
 * tanquea una vez al día o menos, y dos semanas dan muy pocos tramos para que
 * el consumo promedio signifique algo.
 */
const DIAS = 30;

export default function CombustibleView({
  codigo,
  maquina,
  cargando,
  fecha,
  onBack,
}: Props) {
  const hasta = fecha ?? todayLocal();
  const desde = shiftDay(hasta, -(DIAS - 1));

  return (
    <section className="h-full overflow-y-auto px-4 py-5 md:px-8">
      <button className="back-link" onClick={onBack}>
        ‹ Volver al mapa
      </button>

      <div className="my-4 flex flex-wrap items-center gap-4">
        <MiniIcon
          tipo={tipoDeDescripcion(maquina?.descripcion ?? null)}
          color={COLOR_DEFAULT}
          className="h-[72px] w-[72px]"
        />
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight">{codigo}</h1>
          <div className="font-mono text-xs tracking-[1px] text-ink-2">
            {maquina?.descripcion ?? "—"}
          </div>
          <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-border px-[11px] py-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-ink-3">
            Sin nodo de rastreo
          </span>
        </div>
      </div>

      <p className="mb-4 rounded-card border border-border bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
        Esta máquina está en el parque de la app de combustible pero no lleva un
        nodo Meshtastic, así que la torre no sabe dónde está ni cuánto recorrió.
        Si se le monta uno, asígnaselo desde el mapa con este mismo código
        (<b className="font-mono">{codigo}</b>) para que su universo junte
        recorrido y tanqueos.
      </p>

      {cargando && <p className="text-[12.5px] text-ink-3">Cargando…</p>}
      {!cargando && !maquina && (
        <p className="rounded-card border border-st-alerta/40 bg-[#fdf0f0] px-3 py-2 text-xs text-st-alerta">
          No hay ninguna máquina vigente con el código {codigo} en la base de
          combustible.
        </p>
      )}
      {maquina && <TanqueosPanel maquina={maquina} desde={desde} hasta={hasta} />}
    </section>
  );
}
