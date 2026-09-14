"use client";

import Image from "next/image";
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
    <header className="relative z-[1200] flex h-[76px] items-center gap-5 border-b border-border bg-surface px-5">
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
            className={`rounded-full px-[22px] py-[10px] text-xs font-bold tracking-[1.5px] transition ${
              mode === m
                ? "bg-accent text-white shadow-card"
                : "bg-transparent text-ink-2 hover:text-ink"
            }`}
          >
            {m === "live" ? "EN VIVO" : "HISTÓRICO"}
          </button>
        ))}
      </div>

      {/* Día (sólo histórico) */}
      {mode === "history" && (
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            onClick={() => onDate(shiftDay(date, -1))}
            title="Día anterior"
            className="h-[38px] w-[38px] rounded-[10px] border border-border bg-surface text-lg leading-none text-ink-2 hover:border-accent-2 hover:text-accent"
          >
            ‹
          </button>
          <input
            type="date"
            value={date}
            max={hoy}
            onChange={(e) => e.target.value && onDate(e.target.value)}
            className="rounded-[10px] border border-border bg-surface px-3 py-[9px] font-mono text-[13.5px] text-ink"
          />
          <button
            onClick={() => onDate(shiftDay(date, 1))}
            disabled={date >= hoy}
            title="Día siguiente"
            className="h-[38px] w-[38px] rounded-[10px] border border-border bg-surface text-lg leading-none text-ink-2 hover:border-accent-2 hover:text-accent disabled:opacity-35"
          >
            ›
          </button>
        </div>
      )}

      {/* Frescura del dato: el techo de 10 min tiene que estar siempre a la vista */}
      <Frescura latido={latidoPoller} caidoMin={POLLER_CAIDO_MIN} />

      {/* Chips de la flota */}
      <div className="ml-auto flex min-w-0 gap-2 overflow-x-auto [scrollbar-width:none]">
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
              className={`flex shrink-0 items-center gap-2 rounded-full border py-2 pl-[11px] pr-[15px] text-[12.5px] font-semibold transition ${
                sel
                  ? "border-accent bg-[#eaf2fb] text-accent"
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
    return (
      <span className="hidden shrink-0 items-center gap-1.5 rounded-full border border-st-alerta/40 bg-[#fdf0f0] px-3.5 py-2 text-[11.5px] font-semibold text-st-alerta md:flex">
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
