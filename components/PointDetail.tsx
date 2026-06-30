"use client";

import { AnimatePresence, motion } from "framer-motion";
import {
  X,
  MapPin,
  Clock,
  Navigation2,
  Satellite,
  Mountain,
  Gauge,
  BatteryMedium,
  Signal,
  Network,
  Pause,
} from "lucide-react";
import type { EnrichedPoint } from "@/lib/types";
import {
  fmtDateTime,
  compass,
  orDash,
  fmtDist,
} from "@/lib/geo";

interface Props {
  point: EnrichedPoint | null;
  onClose: () => void;
}

function Field({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: string;
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-white/[0.03] px-2.5 py-2">
      <span className={`text-slate-400 ${accent ?? ""}`}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="stat-label block">{label}</span>
        <span className="block truncate font-mono text-sm text-slate-100">
          {value}
        </span>
      </span>
    </div>
  );
}

export default function PointDetail({ point, onClose }: Props) {
  return (
    <AnimatePresence>
      {point && (
        <motion.div
          initial={{ opacity: 0, x: 24 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0, x: 24 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="glass-strong pointer-events-auto w-full max-w-sm rounded-2xl p-4 md:w-80"
        >
          <div className="mb-3 flex items-start justify-between">
            <div>
              <div className="flex items-center gap-2">
                <span
                  className={`chip ${
                    point.is_stationary
                      ? "bg-idle/20 text-idle"
                      : "bg-live/15 text-live"
                  }`}
                >
                  {point.is_stationary ? (
                    <>
                      <Pause size={12} /> Quieto
                    </>
                  ) : (
                    <>
                      <Navigation2 size={12} /> En movimiento
                    </>
                  )}
                </span>
                <span className="chip bg-white/5 text-slate-300">
                  #{point.index + 1}
                </span>
              </div>
              <h3 className="mt-1.5 flex items-center gap-1.5 text-sm font-semibold text-slate-100">
                <Clock size={14} className="text-slate-400" />
                {fmtDateTime(point.sample_local)}
              </h3>
            </div>
            <button onClick={onClose} className="btn-ghost p-1.5">
              <X size={16} />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <div className="col-span-2">
              <Field
                icon={<MapPin size={16} />}
                label="Coordenadas"
                value={`${point.lat.toFixed(5)}, ${point.lon.toFixed(5)}`}
                accent="text-live-cyan"
              />
            </div>
            <Field
              icon={<Navigation2 size={16} />}
              label="Rumbo"
              value={
                point.bearingDeg != null
                  ? `${Math.round(point.bearingDeg)}° ${compass(point.bearingDeg)}`
                  : "—"
              }
            />
            <Field
              icon={<Satellite size={16} />}
              label="Satélites"
              value={orDash(point.sats)}
            />
            <Field
              icon={<Mountain size={16} />}
              label="Altitud"
              value={orDash(point.alt_m, " m")}
            />
            <Field
              icon={<Gauge size={16} />}
              label="PDOP"
              value={orDash(point.pdop, "", 1)}
            />
            <Field
              icon={<Signal size={16} />}
              label="RSSI / SNR"
              value={`${orDash(point.rx_rssi)} / ${orDash(point.snr ?? point.rx_snr)}`}
            />
            <Field
              icon={<Network size={16} />}
              label="Hops"
              value={orDash(point.hops_away)}
            />
            <Field
              icon={<BatteryMedium size={16} />}
              label="Batería"
              value={orDash(point.battery_level, "%")}
            />
            <Field
              icon={<Gauge size={16} />}
              label="Vel. (no fiable)"
              value={orDash(point.ground_speed)}
            />
          </div>

          {point.dist_prev_fix_m != null && (
            <p className="mt-2.5 text-[11px] text-slate-400">
              {fmtDist(point.dist_prev_fix_m)} desde el fix anterior ·{" "}
              {orDash(point.min_since_prev_fix, " min", 0)}
            </p>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
