"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Shield, Box, Square, Loader2, MapPinOff, AlertTriangle } from "lucide-react";
import NodeSelector from "@/components/NodeSelector";
import TimeRangePicker from "@/components/TimeRangePicker";
import TrackPlayback from "@/components/TrackPlayback";
import PointDetail from "@/components/PointDetail";
import StatsHUD from "@/components/StatsHUD";
import { fetchNodes, fetchTrack, fetchLatest } from "@/lib/queries";
import { enrichTrack, computeStationaryStints, computeStats } from "@/lib/geo";
import { resolveRange, type RangeKey, type TimeRange } from "@/lib/ranges";
import { SUPABASE_READY } from "@/lib/supabase";
import type { NodeRow, EnrichedPoint, TrackPoint } from "@/lib/types";

// El mapa solo en cliente (usa window/google).
const MapView = dynamic(() => import("@/components/MapView"), {
  ssr: false,
  loading: () => (
    <div className="grid h-full w-full place-items-center bg-base-900">
      <Loader2 className="animate-spin text-live-cyan" />
    </div>
  ),
});

const POLL_MS = 45_000;

export default function Page() {
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [rangeKey, setRangeKey] = useState<RangeKey>("24h");
  const [custom, setCustom] = useState<TimeRange | null>(null);

  const [rawPoints, setRawPoints] = useState<TrackPoint[]>([]);
  const [latestRaw, setLatestRaw] = useState<TrackPoint | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<EnrichedPoint | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [flyToken, setFlyToken] = useState(0);

  const range = useMemo<TimeRange>(
    () => (rangeKey === "custom" && custom ? custom : resolveRange(rangeKey)),
    [rangeKey, custom]
  );

  // --- Cargar nodos al inicio ---
  useEffect(() => {
    if (!SUPABASE_READY) return;
    fetchNodes()
      .then((ns) => {
        setNodes(ns);
        if (ns[0]) setSelected((s) => s ?? ns[0].node_id);
      })
      .catch((e) => setError(String(e?.message ?? e)));
  }, []);

  // --- Cargar track + latest (con polling) ---
  const load = useCallback(
    async (opts?: { silent?: boolean; fly?: boolean }) => {
      if (!selected) return;
      if (!opts?.silent) setLoading(true);
      try {
        const [track, latest] = await Promise.all([
          fetchTrack(selected, range.fromISO, range.toISO),
          fetchLatest(selected),
        ]);
        setRawPoints(track);
        setLatestRaw(latest);
        setError(null);
        if (opts?.fly) setFlyToken((t) => t + 1);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [selected, range.fromISO, range.toISO]
  );

  // recarga al cambiar nodo/rango (con fly-to)
  useEffect(() => {
    setPlaybackIndex(null);
    setSelectedPoint(null);
    load({ fly: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, range.fromISO, range.toISO]);

  // polling silencioso
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    const id = setInterval(() => loadRef.current({ silent: true }), POLL_MS);
    return () => clearInterval(id);
  }, []);

  // --- Derivados ---
  const points = useMemo(() => enrichTrack(rawPoints), [rawPoints]);
  const stints = useMemo(() => computeStationaryStints(points), [points]);
  const stats = useMemo(() => computeStats(points), [points]);
  const latest = useMemo<EnrichedPoint | null>(() => {
    if (!latestRaw) return null;
    return enrichTrack([latestRaw])[0] ?? null;
  }, [latestRaw]);

  const handleRange = (key: RangeKey, c?: TimeRange) => {
    setRangeKey(key);
    if (c) setCustom(c);
  };

  const hasData = points.length > 0;

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* ===== Mapa de fondo ===== */}
      <div className="absolute inset-0">
        <MapView
          points={points}
          stints={stints}
          latest={latest}
          playbackIndex={playbackIndex}
          is3D={is3D}
          selectedId={selectedPoint?.id ?? null}
          onSelectPoint={setSelectedPoint}
          flyToken={flyToken}
        />
      </div>

      {/* viñeta para legibilidad de la UI */}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-base-900/70 via-transparent to-transparent" />

      {/* ===== Header ===== */}
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-4">
        <div className="pointer-events-auto flex items-center gap-2.5 glass rounded-xl px-3 py-2">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-live/15 text-live shadow-glow">
            <Shield size={17} />
          </span>
          <div className="leading-tight">
            <h1 className="text-sm font-bold tracking-tight text-slate-100">
              MAP&nbsp;SECURITY
            </h1>
            <p className="text-[10px] uppercase tracking-widest text-slate-400">
              Rastreo Mesh · Guaicaramo
            </p>
          </div>
        </div>

        <div className="pointer-events-auto flex items-center gap-2">
          {/* toggle 2D/3D */}
          <div className="glass flex rounded-xl p-1">
            <button
              onClick={() => setIs3D(false)}
              className={`${!is3D ? "btn-active" : "btn-ghost"} px-2.5 py-1 text-xs`}
            >
              <Square size={13} /> 2D
            </button>
            <button
              onClick={() => setIs3D(true)}
              className={`${is3D ? "btn-active" : "btn-ghost"} px-2.5 py-1 text-xs`}
            >
              <Box size={13} /> 3D
            </button>
          </div>
        </div>
      </header>

      {/* ===== Panel izquierdo (controles) ===== */}
      <div className="pointer-events-none absolute left-4 top-20 bottom-4 flex w-72 flex-col gap-3">
        <div className="pointer-events-auto">
          <NodeSelector nodes={nodes} selected={selected} onSelect={setSelected} />
        </div>
        <div className="pointer-events-auto">
          <TimeRangePicker
            rangeKey={rangeKey}
            custom={custom}
            onChange={handleRange}
            onRefresh={() => load({ fly: true })}
            loading={loading}
          />
        </div>
        <div className="pointer-events-auto">
          <StatsHUD stats={stats} latest={latest} />
        </div>
        <div className="flex-1" />
      </div>

      {/* ===== Panel derecho (detalle de punto) ===== */}
      <div className="pointer-events-none absolute right-4 top-20 flex justify-end">
        <PointDetail point={selectedPoint} onClose={() => setSelectedPoint(null)} />
      </div>

      {/* ===== Playback (abajo centro) ===== */}
      {hasData && (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 flex justify-center px-4">
          <div className="pointer-events-auto w-full max-w-2xl">
            <TrackPlayback
              points={points}
              index={playbackIndex}
              onIndexChange={setPlaybackIndex}
            />
          </div>
        </div>
      )}

      {/* ===== Estados ===== */}
      {!SUPABASE_READY && (
        <Banner
          tone="alert"
          icon={<AlertTriangle size={16} />}
          text="Falta configurar Supabase en .env.local"
        />
      )}
      {error && SUPABASE_READY && (
        <Banner tone="alert" icon={<AlertTriangle size={16} />} text={error} />
      )}
      {SUPABASE_READY && !loading && !hasData && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="glass-strong rounded-2xl px-6 py-5 text-center">
            <MapPinOff className="mx-auto mb-2 text-slate-500" />
            <p className="text-sm font-medium text-slate-200">
              Sin posiciones en este rango
            </p>
            <p className="text-xs text-slate-400">
              {latest
                ? "El nodo tiene fixes fuera del rango seleccionado. Prueba otro rango."
                : "Este nodo aún no reporta posición."}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

function Banner({
  tone,
  icon,
  text,
}: {
  tone: "alert" | "info";
  icon: React.ReactNode;
  text: string;
}) {
  return (
    <div className="pointer-events-none absolute inset-x-0 top-20 flex justify-center">
      <div
        className={`glass-strong flex items-center gap-2 rounded-xl px-3 py-2 text-xs ${
          tone === "alert" ? "text-alert" : "text-slate-200"
        }`}
      >
        {icon}
        <span className="max-w-md truncate">{text}</span>
      </div>
    </div>
  );
}
