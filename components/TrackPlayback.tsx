"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, SkipBack, SkipForward, Gauge } from "lucide-react";
import type { EnrichedPoint } from "@/lib/types";
import { fmtTime, fmtDateTime } from "@/lib/geo";

interface Props {
  points: EnrichedPoint[];
  index: number | null; // null = mostrar todo (sin playback)
  onIndexChange: (i: number | null) => void;
}

const SPEEDS = [1, 2, 4, 8];

export default function TrackPlayback({ points, index, onIndexChange }: Props) {
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(2);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const last = points.length - 1;

  // índice efectivo cuando está en "mostrar todo"
  const effIndex = index == null ? last : index;

  useEffect(() => {
    if (!playing) {
      if (timer.current) clearInterval(timer.current);
      return;
    }
    timer.current = setInterval(() => {
      onIndexChange(
        // avanzar desde el índice actual
        (() => {
          const cur = index == null ? -1 : index;
          const next = cur + 1;
          if (next >= points.length) {
            setPlaying(false);
            return last;
          }
          return next;
        })()
      );
    }, 1100 / speed);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, speed, index, points.length]);

  if (points.length === 0) return null;

  const toggle = () => {
    if (!playing) {
      // si está al final o en "todo", reinicia
      if (index == null || index >= last) onIndexChange(0);
    }
    setPlaying((p) => !p);
  };

  const cur = points[Math.min(effIndex, last)];

  return (
    <div className="glass-strong rounded-2xl p-3">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="chip bg-live-cyan/15 text-live-cyan">
            {effIndex + 1}/{points.length}
          </span>
          <span className="font-mono text-sm text-slate-200">
            {fmtDateTime(cur?.sample_local ?? null)}
          </span>
          <span className="text-[10px] text-slate-500">(Bogotá)</span>
        </div>
        <button
          onClick={() => {
            const i = SPEEDS.indexOf(speed);
            setSpeed(SPEEDS[(i + 1) % SPEEDS.length]);
          }}
          className="btn-ghost px-2 py-1 text-xs"
          title="Velocidad"
        >
          <Gauge size={13} /> {speed}×
        </button>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={() => onIndexChange(0)}
          className="btn-ghost p-1.5"
          title="Inicio"
        >
          <SkipBack size={16} />
        </button>
        <button
          onClick={toggle}
          className="grid h-10 w-10 place-items-center rounded-full bg-live-cyan text-base-900 shadow-glow-cyan transition hover:scale-105"
          title={playing ? "Pausar" : "Reproducir"}
        >
          {playing ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
        </button>
        <button
          onClick={() => {
            setPlaying(false);
            onIndexChange(null);
          }}
          className="btn-ghost p-1.5"
          title="Ver todo el recorrido"
        >
          <SkipForward size={16} />
        </button>

        <input
          type="range"
          className="playback flex-1"
          min={0}
          max={last}
          value={effIndex}
          onChange={(e) => {
            setPlaying(false);
            onIndexChange(Number(e.target.value));
          }}
        />
        <span className="w-12 text-right font-mono text-xs text-slate-400">
          {fmtTime(cur?.sample_local ?? null)}
        </span>
      </div>
    </div>
  );
}
