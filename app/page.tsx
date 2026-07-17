"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Shield,
  Box,
  Square,
  Loader2,
  MapPinOff,
  AlertTriangle,
  Menu,
  X,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import NodeSelector, { ALL_NODES } from "@/components/NodeSelector";
import TimeRangePicker from "@/components/TimeRangePicker";
import TrackPlayback from "@/components/TrackPlayback";
import PointDetail from "@/components/PointDetail";
import StatsHUD from "@/components/StatsHUD";
import {
  fetchNodes,
  fetchTrack,
  fetchLatest,
  fetchEstadias,
  fetchOverview,
} from "@/lib/queries";
import { enrichTrack, computeStats, fmtAgo } from "@/lib/geo";
import { resolveRange, type RangeKey, type TimeRange } from "@/lib/ranges";
import { SUPABASE_READY } from "@/lib/supabase";
import type {
  NodeRow,
  EnrichedPoint,
  TrackPoint,
  Estadia,
  NodeLatest,
} from "@/lib/types";

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
  const [estadias, setEstadias] = useState<Estadia[]>([]);
  const [latestRaw, setLatestRaw] = useState<TrackPoint | null>(null);
  const [overview, setOverview] = useState<NodeLatest[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [playbackIndex, setPlaybackIndex] = useState<number | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<EnrichedPoint | null>(null);
  const [is3D, setIs3D] = useState(false);
  const [flyToken, setFlyToken] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false); // panel de controles en móvil
  // Nodos ocultos en la vista de flota (por node_id). Persisten aunque cambie
  // la lista: un id que ya no existe simplemente no filtra nada.
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const range = useMemo<TimeRange>(
    () => (rangeKey === "custom" && custom ? custom : resolveRange(rangeKey)),
    [rangeKey, custom]
  );

  const isAll = selected === ALL_NODES;

  // Lo que realmente se dibuja/encuadra en el mapa: la flota sin los ocultos.
  // El panel FLOTA sí sigue mostrando todos (para poder volver a activarlos).
  const visibleOverview = useMemo(
    () => overview?.filter((o) => !hidden.has(o.node.node_id)) ?? null,
    [overview, hidden]
  );

  const toggleHidden = useCallback((nodeId: string) => {
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(nodeId) ? next.delete(nodeId) : next.add(nodeId);
      return next;
    });
    setFlyToken((t) => t + 1); // reencuadra a los nodos que quedan visibles
  }, []);

  const showAllNodes = useCallback(() => {
    setHidden(new Set());
    setFlyToken((t) => t + 1);
  }, []);

  /**
   * Refresca la lista de nodos. Se llama al montar y en cada tick del polling:
   * un nodo dado de alta después de abrir la pestaña no aparecería nunca si esto
   * corriera solo una vez, y el `last_seen` del selector se iría quedando viejo.
   */
  const loadNodes = useCallback(async () => {
    const ns = await fetchNodes();
    setNodes(ns);
    if (ns[0]) setSelected((s) => s ?? ns[0].node_id);
    return ns;
  }, []);

  // --- Cargar nodos al inicio ---
  useEffect(() => {
    if (!SUPABASE_READY) return;
    loadNodes().catch((e) => setError(String(e?.message ?? e)));
  }, [loadNodes]);

  // --- Cargar track + latest (con polling) ---
  const load = useCallback(
    async (opts?: { silent?: boolean; fly?: boolean }) => {
      if (!selected) return;
      if (!opts?.silent) setLoading(true);
      try {
        if (isAll) {
          // Vista de flota: última posición de cada nodo, sin rastro ni rango.
          setOverview(await fetchOverview(nodes));
          setRawPoints([]);
          setEstadias([]);
          setLatestRaw(null);
        } else {
          const [track, estad, latest] = await Promise.all([
            fetchTrack(selected, range.fromISO, range.toISO),
            fetchEstadias(selected, range.fromISO, range.toISO),
            fetchLatest(selected),
          ]);
          setOverview(null);
          setRawPoints(track);
          setEstadias(estad);
          setLatestRaw(latest);
        }
        setError(null);
        if (opts?.fly) setFlyToken((t) => t + 1);
      } catch (e: any) {
        setError(String(e?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [selected, isAll, nodes, range.fromISO, range.toISO]
  );

  // recarga al cambiar nodo/rango (con fly-to)
  useEffect(() => {
    setPlaybackIndex(null);
    setSelectedPoint(null);
    load({ fly: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, range.fromISO, range.toISO]);

  // polling silencioso (datos + lista de nodos, para ver altas nuevas sin recargar)
  const loadRef = useRef(load);
  loadRef.current = load;
  const loadNodesRef = useRef(loadNodes);
  loadNodesRef.current = loadNodes;
  useEffect(() => {
    const id = setInterval(() => {
      loadNodesRef.current().catch(() => {}); // un fallo aquí no debe romper el track
      loadRef.current({ silent: true });
    }, POLL_MS);
    return () => clearInterval(id);
  }, []);

  // --- Derivados ---
  const points = useMemo(() => enrichTrack(rawPoints), [rawPoints]);
  const stats = useMemo(
    () => computeStats(points, estadias),
    [points, estadias]
  );
  const latest = useMemo<EnrichedPoint | null>(() => {
    if (!latestRaw) return null;
    return enrichTrack([latestRaw])[0] ?? null;
  }, [latestRaw]);

  const handleRange = (key: RangeKey, c?: TimeRange) => {
    setRangeKey(key);
    if (c) setCustom(c);
  };

  const hasData = isAll
    ? (overview?.some((o) => o.latest) ?? false)
    : points.length > 0 || estadias.length > 0;

  return (
    <main className="relative h-screen w-screen overflow-hidden">
      {/* ===== Mapa de fondo ===== */}
      <div className="absolute inset-0">
        <MapView
          points={points}
          estadias={estadias}
          latest={latest}
          overview={visibleOverview}
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
      <header className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between p-3 md:p-4">
        <div className="pointer-events-auto flex items-center gap-2">
          {/* toggle del panel (solo móvil) */}
          <button
            onClick={() => setPanelOpen((o) => !o)}
            className="glass grid h-11 w-11 place-items-center rounded-xl text-slate-200 md:hidden"
            aria-label={panelOpen ? "Cerrar controles" : "Abrir controles"}
          >
            {panelOpen ? <X size={19} /> : <Menu size={19} />}
          </button>

          <div className="flex items-center gap-2.5 glass rounded-xl px-3 py-2">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-live/15 text-live shadow-glow">
              <Shield size={17} />
            </span>
            <div className="leading-tight">
              <h1 className="text-sm font-bold tracking-tight text-slate-100">
                MAP&nbsp;SECURITY
              </h1>
              <p className="hidden text-[10px] uppercase tracking-widest text-slate-400 sm:block">
                Rastreo Mesh · Guaicaramo
              </p>
            </div>
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
      <div
        className={`${
          panelOpen ? "flex" : "hidden"
        } md:flex pointer-events-none absolute inset-x-3 top-[4.75rem] bottom-[7.5rem] flex-col gap-3 overflow-y-auto md:inset-x-auto md:left-4 md:top-20 md:bottom-4 md:w-72 md:overflow-visible`}
      >
        <div className="pointer-events-auto">
          <NodeSelector
            nodes={nodes}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setPanelOpen(false); // en móvil, vuelve al mapa tras elegir
            }}
          />
        </div>
        {/* El rango y las stats de recorrido solo aplican a un nodo concreto:
            en la vista de flota se muestra el resumen de nodos en su lugar. */}
        {isAll ? (
          <div className="pointer-events-auto">
            <FleetHUD
              overview={overview}
              loading={loading}
              onRefresh={() => load({ fly: true })}
              hidden={hidden}
              onToggle={toggleHidden}
              onShowAll={showAllNodes}
            />
          </div>
        ) : (
          <>
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
          </>
        )}
        <div className="hidden flex-1 md:block" />
      </div>

      {/* ===== Panel derecho (detalle de punto) ===== */}
      <div className="pointer-events-none absolute inset-x-3 top-[4.75rem] flex justify-end md:inset-x-auto md:right-4 md:top-20">
        <PointDetail point={selectedPoint} onClose={() => setSelectedPoint(null)} />
      </div>

      {/* ===== Playback (abajo centro) ===== */}
      {points.length > 0 && (
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
              {isAll ? "Ningún nodo reporta posición" : "Sin posiciones en este rango"}
            </p>
            <p className="text-xs text-slate-400">
              {isAll
                ? "Los nodos están dados de alta pero aún no tienen un fix."
                : latest
                ? "El nodo tiene fixes fuera del rango seleccionado. Prueba otro rango."
                : "Este nodo aún no reporta posición."}
            </p>
          </div>
        </div>
      )}
    </main>
  );
}

/** Un nodo cuenta como "en vivo" si reportó hace menos de esto (min). */
const LIVE_MINUTES = 15;

/** Resumen de la flota: cuántos nodos hay, cuáles están vivos y dónde. */
function FleetHUD({
  overview,
  loading,
  onRefresh,
  hidden,
  onToggle,
  onShowAll,
}: {
  overview: NodeLatest[] | null;
  loading: boolean;
  onRefresh: () => void;
  hidden: Set<string>;
  onToggle: (nodeId: string) => void;
  onShowAll: () => void;
}) {
  const items = overview ?? [];
  const live = items.filter((o) => {
    if (!o.latest) return false;
    const m = (Date.now() - new Date(o.latest.sample_local).getTime()) / 60000;
    return m <= LIVE_MINUTES;
  }).length;
  const hiddenCount = items.filter((o) => hidden.has(o.node.node_id)).length;
  const visibleCount = items.length - hiddenCount;

  return (
    <div className="glass-strong rounded-xl p-3">
      <div className="mb-2.5 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-300">
          Flota
        </span>
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-slate-400">
            <b className="text-live">{live}</b> / {items.length} en vivo
          </span>
          <button
            onClick={onRefresh}
            className="btn-ghost rounded-lg p-1.5"
            aria-label="Actualizar"
          >
            <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Estado del filtro: cuántos se ven y atajo para volver a mostrarlos */}
      {hiddenCount > 0 && (
        <div className="mb-2 flex items-center justify-between rounded-lg bg-white/[0.03] px-2 py-1.5">
          <span className="text-[11px] text-slate-400">
            Viendo <b className="text-slate-200">{visibleCount}</b> de{" "}
            {items.length}
          </span>
          <button
            onClick={onShowAll}
            className="text-[11px] font-medium text-live-cyan hover:underline"
          >
            Mostrar todos
          </button>
        </div>
      )}

      <ul className="space-y-1">
        {items.map((o) => {
          const mins = o.latest
            ? (Date.now() - new Date(o.latest.sample_local).getTime()) / 60000
            : null;
          const isLive = mins != null && mins <= LIVE_MINUTES;
          const isHidden = hidden.has(o.node.node_id);
          return (
            <li key={o.node.node_id}>
              <button
                onClick={() => onToggle(o.node.node_id)}
                title={isHidden ? "Mostrar en el mapa" : "Ocultar del mapa"}
                className={`flex w-full items-center gap-2 rounded-lg px-1.5 py-1 text-left transition hover:bg-white/5 ${
                  isHidden ? "opacity-40" : ""
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                    isLive ? "bg-live" : o.latest ? "bg-amber-500" : "bg-slate-600"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate text-xs text-slate-200">
                  {o.node.long_name ?? o.node.node_id}
                </span>
                <span className="shrink-0 font-mono text-[10px] text-slate-400">
                  {o.latest ? fmtAgo(o.latest.sample_local) : "sin posición"}
                </span>
                {isHidden ? (
                  <EyeOff size={13} className="shrink-0 text-slate-500" />
                ) : (
                  <Eye size={13} className="shrink-0 text-live-cyan" />
                )}
              </button>
            </li>
          );
        })}
        {items.length === 0 && (
          <li className="px-1.5 py-1 text-xs text-slate-400">Cargando nodos…</li>
        )}
      </ul>
    </div>
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
