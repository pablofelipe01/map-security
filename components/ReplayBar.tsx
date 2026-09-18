"use client";

import { useEffect, useRef } from "react";
import { GAP_INTERPOLA_MIN } from "@/lib/replay";
import { CADENCIA_POLLER_MIN } from "@/lib/fleet";

interface Props {
  /** Minuto del día que se está mostrando (0-1439). */
  minute: number;
  onMinute: (m: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  /** Minutos simulados por segundo real. */
  speed: number;
  onSpeed: (s: number) => void;
  /** Ventana con datos; fuera de ella el slider no aporta nada. */
  ventana: { desde: number; hasta: number } | null;
  /** Ancho del panel lateral, para no quedar debajo de él. */
  panelOpen: boolean;
}

/** Cada cuánto avanza el reloj del replay (ms). */
const STEP_MS = 120;

export default function ReplayBar({
  minute,
  onMinute,
  playing,
  onPlaying,
  speed,
  onSpeed,
  ventana,
  panelOpen,
}: Props) {
  const min = ventana?.desde ?? 0;
  const max = ventana?.hasta ?? 1439;

  // El avance vive en un intervalo y no en un rAF porque no se necesita
  // suavidad de 60 fps: el dato de origen tiene resolución de 10 minutos.
  const onMinuteRef = useRef(onMinute);
  onMinuteRef.current = onMinute;
  const minuteRef = useRef(minute);
  minuteRef.current = minute;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = minuteRef.current + (speed * STEP_MS) / 1000;
      if (next >= max) {
        onMinuteRef.current(max);
        onPlaying(false);
        return;
      }
      onMinuteRef.current(next);
    }, STEP_MS);
    return () => clearInterval(id);
  }, [playing, speed, max, onPlaying]);

  const hh = String(Math.floor(minute / 60)).padStart(2, "0");
  const mm = String(Math.floor(minute % 60)).padStart(2, "0");
  const sinDatos = ventana == null;

  return (
    <div
      // El hueco de 362 px para el panel sólo aplica desde `md`. En un celular
      // el panel mide casi el ancho de la pantalla, así que restárselo dejaba
      // esta barra en unos pocos píxeles —slider inservible, hora ilegible—.
      // Ahí el panel se superpone y punto: es una capa sobre el mapa, no una
      // columna al lado.
      className={`absolute bottom-[max(0.875rem,env(safe-area-inset-bottom))] left-3.5 z-[1000] rounded-card border border-border bg-white/95 px-4 py-2.5 shadow-card backdrop-blur-md transition-[right] ${
        panelOpen ? "right-3.5 md:right-[362px]" : "right-3.5"
      }`}
    >
      <div className="flex items-center gap-3">
        <button
          onClick={() => onPlaying(!playing)}
          disabled={sinDatos}
          title={playing ? "Pausar" : "Reproducir"}
          className="h-11 w-11 shrink-0 rounded-full bg-accent text-[13px] text-white disabled:opacity-40 md:h-[38px] md:w-[38px]"
        >
          {playing ? "❚❚" : "▶"}
        </button>

        <input
          type="range"
          className="replay min-w-0 flex-1"
          min={min}
          max={max}
          step={0.5}
          value={minute}
          disabled={sinDatos}
          onChange={(e) => {
            onPlaying(false);
            onMinute(Number(e.target.value));
          }}
        />

        <span className="w-[52px] shrink-0 text-center font-mono text-[15px] font-bold text-accent">
          {sinDatos ? "--:--" : `${hh}:${mm}`}
        </span>

        <select
          value={speed}
          onChange={(e) => onSpeed(Number(e.target.value))}
          title="Velocidad"
          className="h-11 shrink-0 rounded-[10px] border border-border bg-surface px-2 font-mono text-xs md:h-auto md:py-1.5"
        >
          <option value={5}>×5</option>
          <option value={15}>×15</option>
          <option value={60}>×60</option>
        </select>
      </div>

      {/* La honestidad del replay: entre fix y fix la posición es interpolada.
          Decirlo aquí evita que el deslizamiento se lea como una medición. */}
      <p className="mt-1.5 text-[10px] leading-tight text-ink-3">
        {sinDatos
          ? "Ninguna máquina reportó posición este día."
          : `Un fix cada ~${CADENCIA_POLLER_MIN} min: el movimiento entre puntos es interpolado en línea recta. Con huecos de más de ${GAP_INTERPOLA_MIN} min el marcador se queda en el último fix conocido.`}
      </p>
    </div>
  );
}
