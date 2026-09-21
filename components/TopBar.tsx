"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { FleetItem } from "@/lib/types";
import {
  CADENCIA_POLLER_MIN,
  ESTADO_META,
  edadMin,
  fmtEdad,
  ordenarFlota,
} from "@/lib/fleet";
import { maquinaDe } from "@/lib/tractores";
import { fmtTime, BOGOTA_TZ } from "@/lib/geo";
import { shiftDay, todayLocal } from "@/lib/ranges";

interface Props {
  mode: "live" | "history";
  onMode: (m: "live" | "history") => void;
  date: string;
  onDate: (d: string) => void;
  fleet: FleetItem[] | null;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  /** Último `sample_local` visto: latido del poller. */
  latidoPoller: string | null;
}

/** Si el poller lleva más de esto sin correr, el que falla es el poller. */
const POLLER_CAIDO_MIN = CADENCIA_POLLER_MIN * 2.5;

export default function TopBar({
  mode,
  onMode,
  date,
  onDate,
  fleet,
  selectedId,
  onSelect,
  latidoPoller,
}: Props) {
  const items = fleet ? ordenarFlota(fleet) : [];
  const hoy = todayLocal();

  return (
    /*
     * Móvil primero: en un celular los seis bloques de esta barra no caben en
     * una fila, así que se deja envolver y los chips de flota bajan a su propio
     * renglón (`basis-full`). Desde `md` se restaura la fila única de 76 px de
     * siempre — de ahí que cada ajuste móvil tenga su `md:` que lo deshace.
     *
     * El `padding-top` respeta la muesca: con `viewportFit: "cover"` (ver
     * app/layout.tsx) la página se pinta bajo la barra de estado, y sin esto el
     * logo quedaría debajo del reloj del sistema.
     */
    <header className="relative z-[1200] flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-surface px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] md:h-[76px] md:flex-nowrap md:gap-5 md:px-5 md:py-0">
      {/* Marca */}
      <div className="flex shrink-0 items-center gap-2.5">
        <Image
          src="/Logo-Sirius.png"
          alt="Sirius"
          width={1015}
          height={450}
          priority
          className="h-[34px] w-auto"
        />
        <span className="border-l-2 border-border pl-3 text-[15px] font-extrabold tracking-[3px] text-accent">
          FLEET
        </span>
        <Clock />
      </div>

      {/* Modo */}
      <div className="flex shrink-0 rounded-full border border-border bg-surface-2 p-[3px]">
        {(["live", "history"] as const).map((m) => (
          <button
            key={m}
            onClick={() => onMode(m)}
            className={`grid min-h-11 place-items-center rounded-full px-4 text-xs font-bold tracking-[1.5px] transition md:min-h-0 md:px-[22px] md:py-[10px] ${
              mode === m
                ? "bg-accent text-white shadow-card"
                : "bg-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {m === "live" ? "EN VIVO" : "HISTÓRICO"}
          </button>
        ))}
      </div>

      {/*
        Entrada al despacho. Va pegada al selector de modo pero fuera de él a
        propósito: EN VIVO e HISTÓRICO son dos maneras de mirar lo mismo, y el
        despacho es otra cosa —decidir en vez de observar—. Meterlo como un
        tercer botón del grupo diría que es un tercer modo de la torre, y el
        primer clic de alguien buscando "el histórico" caería en una pantalla
        donde se reasignan tractores.
      */}
      <Link
        href="/despacho"
        title="Planear a qué acopios va cada máquina"
        className="grid min-h-11 shrink-0 place-items-center rounded-full border border-border bg-surface px-4 text-xs font-bold tracking-[1.5px] text-ink-2 transition hover:border-accent-2 hover:text-accent md:min-h-0 md:py-[10px]"
      >
        DESPACHO
      </Link>

      {/* Día (sólo histórico) */}
      {mode === "history" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => onDate(shiftDay(date, -1))}
            title="Día anterior"
            className="h-11 w-11 rounded-[10px] border border-border bg-surface text-lg leading-none text-ink-2 hover:border-accent-2 hover:text-accent md:h-[38px] md:w-[38px]"
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            max={hoy}
            onChange={(e) => e.target.value && onDate(e.target.value)}
            className="h-11 rounded-[10px] border border-border bg-surface px-3 font-mono text-[13.5px] text-ink md:h-auto md:py-[9px]"
          />
          <button
            onClick={() => onDate(shiftDay(date, 1))}
            disabled={date >= hoy}
            title="Día siguiente"
            className="h-11 w-11 rounded-[10px] border border-border bg-surface text-lg leading-none text-ink-2 hover:border-accent-2 hover:text-accent disabled:opacity-35 md:h-[38px] md:w-[38px]"
          >
            ›
          </button>
        </div>
      )}

      {/* Frescura del dato: el techo de 10 min tiene que estar siempre a la vista */}
      <Frescura latido={latidoPoller} caidoMin={POLLER_CAIDO_MIN} />

      {/* Chips de la flota */}
      <div className="order-last flex basis-full gap-2 overflow-x-auto [scrollbar-width:none] md:order-none md:ml-auto md:min-w-0 md:basis-auto">
        {items.map((i) => {
          const maq = maquinaDe(
            i.node.node_id,
            i.node.long_name,
            i.node.short_name
          );
          const sel = i.node.node_id === selectedId;
          return (
            <button
              key={i.node.node_id}
              onClick={() => onSelect(i.node.node_id)}
              title={ESTADO_META[i.estado].ayuda}
              className={`flex min-h-11 shrink-0 items-center gap-2 rounded-full border pl-[11px] pr-[15px] text-[12.5px] font-semibold transition md:min-h-0 md:py-2 ${
                sel
                  ? "border-accent bg-[#ecf1f4] text-accent"
                  : "border-border bg-surface text-ink-2 hover:border-accent-2 hover:text-ink"
              }`}
            >
              <span className={`st-dot ${i.estado}`} />
              {maq.codigo} · {maq.nombre}
            </button>
          );
        })}
      </div>
    </header>
  );
}

/** Reloj de la torre de control, en hora de Bogotá. */
function Clock() {
  const [now, setNow] = useState<string>("—");
  useEffect(() => {
    const tick = () =>
      setNow(
        new Date().toLocaleTimeString("es-CO", {
          timeZone: BOGOTA_TZ,
          hour12: false,
        }) + " COT"
      );
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);
  // El reloj arranca en "—" y se llena en el cliente: renderizar la hora en el
  // servidor produciría un desfase de hidratación garantizado.
  return <span className="hidden font-mono text-xs text-ink-3 sm:inline">{now}</span>;
}

/**
 * Edad del dato.
 *
 * Existe porque "tiempo real" aquí tiene un techo duro: el poller corre cada
 * 10 min y el nodo manda un fix cada ~9 min. Un tractor a 6 km/h recorre ~1 km
 * entre reporte y reporte, así que el punto en pantalla puede estar hasta un
 * kilómetro desactualizado. Esconderlo sería peligroso.
 *
 * También separa dos fallas que se confunden: si TODOS los nodos se quedan
 * viejos a la vez, lo que se cayó es el poller (plataforma), no los tractores.
 */
function Frescura({
  latido,
  caidoMin,
}: {
  latido: string | null;
  caidoMin: number;
}) {
  // Reloj propio: la edad debe envejecer en pantalla aunque no lleguen datos.
  const [, tick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => tick((t) => t + 1), 30_000);
    return () => clearInterval(id);
  }, []);

  const edad = edadMin(latido);
  const caido = edad != null && edad > caidoMin;

  if (caido) {
    // Esta advertencia NO se esconde en móvil, al revés que el estado normal de
    // abajo. Que el poller lleve rato sin correr significa que ninguna posición
    // en pantalla es actual, y el celular es justamente el aparato que se mira
    // en campo, parado al lado de un lote, decidiendo si el tractor que marca el
    // mapa sigue ahí. Ocultarla por falta de espacio convertiría la pantalla
    // pequeña en la más engañosa de todas. Ocupa su propio renglón completo
    // (`basis-full`) para que quepa entera sin competir con nada.
    return (
      <span className="order-last flex basis-full shrink-0 items-center justify-center gap-1.5 rounded-full border border-st-alerta/40 bg-[#fdf0f0] px-3.5 py-2 text-center text-[11.5px] font-semibold text-st-alerta md:order-none md:basis-auto md:justify-start md:text-left">
        Poller sin correr {fmtEdad(edad)} — ningún dato es actual
      </span>
    );
  }

  const restante =
    edad != null ? Math.max(0, Math.ceil(CADENCIA_POLLER_MIN - edad)) : null;

  return (
    <span
      className="hidden shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-2 px-3.5 py-2 text-[11.5px] text-ink-2 lg:flex"
      title={`La fuente entrega una muestra cada ${CADENCIA_POLLER_MIN} min. La posición de un tractor puede tener hasta esa antigüedad.`}
    >
      <span className="st-dot activa" />
      barrido{" "}
      <b className="font-mono text-ink">{latido ? fmtTime(latido) : "—"}</b>
      {restante != null && (
        <span className="text-ink-3">· próximo ~{restante} min</span>
      )}
    </span>
  );
}
