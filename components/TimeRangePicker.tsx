"use client";

import { useState } from "react";
import { CalendarRange, RefreshCw } from "lucide-react";
import {
  RANGE_LABELS,
  fromLocalInput,
  toLocalInput,
  type RangeKey,
  type TimeRange,
} from "@/lib/ranges";

interface Props {
  rangeKey: RangeKey;
  custom: TimeRange | null;
  onChange: (key: RangeKey, custom?: TimeRange) => void;
  onRefresh: () => void;
  loading?: boolean;
}

const PRESETS: Exclude<RangeKey, "custom">[] = ["24h", "today", "yesterday", "7d"];

export default function TimeRangePicker({
  rangeKey,
  custom,
  onChange,
  onRefresh,
  loading,
}: Props) {
  const [showCustom, setShowCustom] = useState(rangeKey === "custom");
  const now = new Date();
  const from = custom ? new Date(custom.fromISO) : new Date(now.getTime() - 864e5);
  const to = custom ? new Date(custom.toISO) : now;

  return (
    <div className="glass-strong rounded-xl p-2.5">
      <div className="mb-2 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-xs font-medium text-slate-300">
          <CalendarRange size={14} /> Rango
        </span>
        <button
          onClick={onRefresh}
          className="btn-ghost px-2 py-1 text-xs"
          title="Actualizar ahora"
        >
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1">
        {PRESETS.map((k) => (
          <button
            key={k}
            onClick={() => {
              setShowCustom(false);
              onChange(k);
            }}
            className={`${
              rangeKey === k ? "btn-active" : "btn-ghost"
            } px-1 py-1.5 text-[11px]`}
          >
            {RANGE_LABELS[k]}
          </button>
        ))}
      </div>

      <button
        onClick={() => setShowCustom((s) => !s)}
        className={`${
          rangeKey === "custom" ? "btn-active" : "btn-ghost"
        } mt-1 w-full py-1.5 text-[11px]`}
      >
        Personalizado
      </button>

      {showCustom && (
        <div className="mt-2 space-y-2 border-t border-white/10 pt-2">
          <label className="block">
            <span className="stat-label">Desde</span>
            <input
              type="datetime-local"
              defaultValue={toLocalInput(from)}
              onChange={(e) =>
                onChange("custom", {
                  fromISO: fromLocalInput(e.target.value),
                  toISO: custom?.toISO ?? to.toISOString(),
                })
              }
              className="mt-0.5 w-full rounded-lg bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/10 focus:ring-live-cyan/40"
            />
          </label>
          <label className="block">
            <span className="stat-label">Hasta</span>
            <input
              type="datetime-local"
              defaultValue={toLocalInput(to)}
              onChange={(e) =>
                onChange("custom", {
                  fromISO: custom?.fromISO ?? from.toISOString(),
                  toISO: fromLocalInput(e.target.value),
                })
              }
              className="mt-0.5 w-full rounded-lg bg-black/30 px-2 py-1.5 text-xs text-slate-100 outline-none ring-1 ring-white/10 focus:ring-live-cyan/40"
            />
          </label>
        </div>
      )}
    </div>
  );
}
