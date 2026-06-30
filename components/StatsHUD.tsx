"use client";

import {
  Route,
  Pause,
  Footprints,
  Clock,
  BatteryMedium,
  Activity,
} from "lucide-react";
import type { TrackStats, EnrichedPoint } from "@/lib/types";
import {
  fmtDist,
  fmtDuration,
  fmtTime,
  fmtAgo,
  orDash,
} from "@/lib/geo";

interface Props {
  stats: TrackStats;
  latest: EnrichedPoint | null;
}

function Stat({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-xl bg-white/[0.03] p-2.5">
      <div className="mb-1 flex items-center gap-1.5">
        <span className={accent ?? "text-slate-400"}>{icon}</span>
        <span className="stat-label">{label}</span>
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

export default function StatsHUD({ stats, latest }: Props) {
  const totalMin = stats.movingMinutes + stats.stationaryMinutes;
  const movePct = totalMin ? Math.round((stats.movingMinutes / totalMin) * 100) : 0;

  const battLow = latest?.battery_level != null && latest.battery_level < 20;

  return (
    <div className="glass-strong rounded-2xl p-3">
      <div className="mb-2.5 flex items-center justify-between px-0.5">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-200">
          <Activity size={14} className="text-live" /> Resumen del recorrido
        </span>
        {latest && (
          <span className="chip bg-live/15 text-live">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-live" />
            {fmtAgo(latest.sample_local)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <Stat
          icon={<Route size={14} />}
          label="Distancia"
          value={fmtDist(stats.totalDistanceM)}
          accent="text-live-cyan"
        />
        <Stat
          icon={<Pause size={14} />}
          label="Paradas"
          value={String(stats.stops)}
          accent="text-idle"
        />
        <Stat
          icon={<Footprints size={14} />}
          label="En movimiento"
          value={fmtDuration(stats.movingMinutes)}
          sub={`${movePct}% del tiempo`}
        />
        <Stat
          icon={<Pause size={14} />}
          label="Quieto"
          value={fmtDuration(stats.stationaryMinutes)}
          sub={`${100 - movePct}% del tiempo`}
          accent="text-idle"
        />
        <Stat
          icon={<Clock size={14} />}
          label="Inicio → Fin"
          value={`${fmtTime(stats.startTime)} – ${fmtTime(stats.endTime)}`}
        />
        <Stat
          icon={<BatteryMedium size={14} />}
          label="Batería"
          value={orDash(stats.batteryLevel, "%")}
          accent={battLow ? "text-alert" : "text-slate-400"}
        />
      </div>

      {/* barra movimiento vs quieto */}
      {totalMin > 0 && (
        <div className="mt-2.5">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-white/5">
            <div
              className="bg-live-cyan"
              style={{ width: `${movePct}%` }}
              title={`Movimiento ${movePct}%`}
            />
            <div
              className="bg-idle"
              style={{ width: `${100 - movePct}%` }}
              title={`Quieto ${100 - movePct}%`}
            />
          </div>
        </div>
      )}
    </div>
  );
}
