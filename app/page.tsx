"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import TopBar from "@/components/TopBar";
import SidePanel, { type HistoryRow } from "@/components/SidePanel";
import ReplayBar from "@/components/ReplayBar";
import MachineView from "@/components/MachineView";
import VideoModal, { type VideoJob } from "@/components/VideoModal";
import type { Trail, ReplayPos } from "@/components/MapGL";
import {
  fetchNodes,
  fetchFleet,
  fetchTracksDay,
  fetchEstadiasDay,
} from "@/lib/queries";
import { computeStats, enrichTrack } from "@/lib/geo";
import { unirTramos } from "@/lib/rutas";
import { useRutasPorVia } from "@/lib/useRutas";
import { positionAt, ventanaConDatos } from "@/lib/replay";
import { todayLocal } from "@/lib/ranges";
import { SUPABASE_READY } from "@/lib/supabase";
import { maquinaDe } from "@/lib/tractores";
import type { Estadia, FleetItem, NodeRow, TrackPoint } from "@/lib/types";
import type { Map as MapLibreMap } from "maplibre-gl";

// MapLibre toca `window` al importarse: sólo en cliente.
const MapGL = dynamic(() => import("@/components/MapGL"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#dfe7ee]" />,
});

/**
 * Cada cuánto vuelve a consultar la app.
 *
 * La fuente se actualiza cada 10 min (CADENCIA_POLLER_MIN en lib/fleet.ts), así
 * que sondear más rápido no traería posiciones nuevas: sólo gastaría cuota de
 * Supabase. Se usa un minuto —bastante por debajo de la cadencia— para que la
 * app enganche el barrido nuevo a los pocos segundos de existir, sin encuestar
 * en vano.
 */
const POLL_MS = 60_000;

type Mode = "live" | "history";

export default function Page() {
  const [nodes, setNodes] = useState<NodeRow[]>([]);
  const [fleet, setFleet] = useState<FleetItem[] | null>(null);
  const [tracks, setTracks] = useState<
    { node: NodeRow; points: TrackPoint[] }[]
  >([]);
  const [estadias, setEstadias] = useState<Record<string, Estadia[]>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("live");
  const [date, setDate] = useState<string>(todayLocal());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [fitToken, setFitToken] = useState(0);

  // Instancia del mapa, para que el exportador de video pueda capturar su
  // canvas. Es un ref y no estado: cambiarlo no tiene que redibujar nada.
  const mapRef = useRef<MapLibreMap | null>(null);
  const [videoNodeId, setVideoNodeId] = useState<string | null>(null);

  const [minute, setMinute] = useState(6 * 60);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(15);

  // Ruta: #/m/<node_id> abre el universo de esa máquina.
  const [hashNode, setHashNode] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const m = location.hash.match(/^#\/m\/(.+)$/);
      setHashNode(m ? decodeURIComponent(m[1]) : null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  /** El día que se está mostrando: hoy en vivo, el elegido en histórico. */
  const shownDate = mode === "live" ? todayLocal() : date;

  // --- Carga ---
  const load = useCallback(
    async (opts?: { silent?: boolean; fit?: boolean }) => {
      if (!SUPABASE_READY) {
        setError("Falta configurar Supabase en .env.local");
        return;
      }
      if (!opts?.silent) setLoading(true);
      try {
        const ns = await fetchNodes();
        setNodes(ns);

        const dia = mode === "live" ? todayLocal() : date;
        const [tr, est, fl] = await Promise.all([
          fetchTracksDay(ns, dia),
          fetchEstadiasDay(ns, dia),
          // El estado de la flota es sólo del ahora: en histórico no aplica, y
          // pedirlo sería afirmar que el punto de ayer es la posición actual.
          mode === "live" ? fetchFleet(ns) : Promise.resolve(null),
        ]);
        setTracks(tr);
        setEstadias(est);
        setFleet(fl);
        setError(null);
        if (opts?.fit) setFitToken((t) => t + 1);
      } catch (e) {
        setError(String((e as Error)?.message ?? e));
      } finally {
        setLoading(false);
      }
    },
    [mode, date]
  );

  // Recarga al cambiar de modo o de día, con reencuadre.
  useEffect(() => {
    setPlaying(false);
    load({ fit: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, date]);

  // Sondeo silencioso (sólo en vivo y sólo mientras se ve el mapa).
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    // Durante la grabación de un video el sondeo se detiene: recargar a mitad
    // cambiaría los rastros que se están capturando.
    if (mode !== "live" || hashNode || videoNodeId) return;
    const id = setInterval(() => loadRef.current({ silent: true }), POLL_MS);
    return () => clearInterval(id);
  }, [mode, hashNode, videoNodeId]);

  // --- Derivados ---
  const rows = useMemo<HistoryRow[]>(
    () =>
      tracks.map(({ node, points }) => ({
        node,
        stats: computeStats(enrichTrack(points), estadias[node.node_id] ?? []),
        puntos: points.length,
      })),
    [tracks, estadias]
  );

  const trailsCrudos = useMemo<Trail[]>(
    () =>
      tracks
        .filter((t) => t.points.length > 0)
        .map(({ node, points }) => ({
          nodeId: node.node_id,
          color: maquinaDe(node.node_id, node.long_name, node.short_name).color,
          latlngs: points.map((p) => [p.lat, p.lon] as [number, number]),
          desde: points[0].gps_time ?? points[0].sample_local,
          hasta:
            points[points.length - 1].gps_time ??
            points[points.length - 1].sample_local,
        })),
    [tracks]
  );

  /**
   * El mismo recorrido, reconstruido por las vías del predio (ver lib/rutas.ts).
   * Llega null en el primer render y el mapa dibuja las rectas mientras tanto:
   * el ruteo mejora el dibujo, no condiciona que haya dibujo.
   */
  const rutas = useRutasPorVia(trailsCrudos);

  const trails = useMemo<Trail[]>(
    () =>
      trailsCrudos.map((t) => {
        const tramos = rutas?.get(t.nodeId);
        return tramos ? { ...t, ruta: unirTramos(tramos) } : t;
      }),
    [trailsCrudos, rutas]
  );

  const ventana = useMemo(
    () => (mode === "history" ? ventanaConDatos(tracks) : null),
    [mode, tracks]
  );

  // Al entrar al histórico el slider salta al primer fix del día, en vez de
  // quedarse en horas de madrugada donde no hay nada que ver.
  useEffect(() => {
    if (ventana) setMinute(ventana.desde);
  }, [ventana]);

  const replay = useMemo<ReplayPos[] | null>(() => {
    if (mode !== "history") return null;
    const out: ReplayPos[] = [];
    for (const t of tracks) {
      const pos = positionAt(t.points, minute, rutas?.get(t.node.node_id));
      if (pos) out.push({ nodeId: t.node.node_id, ...pos });
    }
    return out;
  }, [mode, tracks, minute, rutas]);

  /**
   * Lo que hay que pasarle al grabador para el nodo elegido. Se arma del mismo
   * `trails` que está dibujado en el mapa —con su ruta por vías si ya se
   * calculó—, de modo que el video no pueda mostrar un recorrido distinto del
   * que se ve en pantalla.
   */
  const videoJob = useMemo<VideoJob | null>(() => {
    if (!videoNodeId) return null;
    const t = trails.find((x) => x.nodeId === videoNodeId);
    const pista = tracks.find((x) => x.node.node_id === videoNodeId);
    if (!t || !pista || t.latlngs.length < 2) return null;
    const maq = maquinaDe(
      videoNodeId,
      pista.node.long_name,
      pista.node.short_name
    );
    return {
      nodeId: videoNodeId,
      nombre: maq.nombre,
      codigo: maq.codigo,
      color: maq.color,
      tipo: maq.tipo,
      fecha: shownDate,
      points: pista.points,
      tramos: rutas?.get(videoNodeId) ?? null,
      ruta: t.ruta ?? t.latlngs,
      metros:
        rows.find((r) => r.node.node_id === videoNodeId)?.stats
          .totalDistanceM ?? 0,
    };
  }, [videoNodeId, trails, tracks, rutas, rows, shownDate]);

  const latidoPoller = useMemo<string | null>(() => {
    const t = (fleet ?? [])
      .map((i) => i.latidoPoller)
      .filter((v): v is string => !!v)
      .sort();
    return t[t.length - 1] ?? null;
  }, [fleet]);

  const openMachine = useCallback((nodeId: string) => {
    location.hash = `#/m/${encodeURIComponent(nodeId)}`;
  }, []);

  const selectMachine = useCallback((nodeId: string) => {
    setSelectedId(nodeId);
    setPanelOpen(true);
    setFitToken((t) => t + 1);
  }, []);

  const deselect = useCallback(() => {
    setSelectedId(null);
    setFitToken((t) => t + 1);
  }, []);

  // --- Universo de máquina ---
  // Si se entra por URL directa, `nodes` puede estar vacío todavía: se arma un
  // NodeRow mínimo con el id de la ruta para no quedarse en blanco.
  const nodoAbierto = hashNode
    ? nodes.find((n) => n.node_id === hashNode) ?? {
        node_id: hashNode,
        long_name: null,
        short_name: null,
        last_seen: null,
      }
    : null;

  if (nodoAbierto) {
    return (
      <main className="h-screen w-screen overflow-hidden">
        <MachineView
          node={nodoAbierto}
          onBack={() => {
            location.hash = "";
          }}
        />
      </main>
    );
  }

  const sinNadaQueMostrar =
    !loading &&
    !error &&
    trails.length === 0 &&
    !fleet?.some((f) => f.posicion);

  return (
    <main className="flex h-screen w-screen flex-col overflow-hidden">
      <TopBar
        mode={mode}
        onMode={setMode}
        date={date}
        onDate={setDate}
        fleet={fleet}
        selectedId={selectedId}
        onSelect={selectMachine}
        latidoPoller={latidoPoller}
      />

      <div className="relative flex-1">
        <MapGL
          mode={mode}
          fleet={fleet}
          trails={trails}
          replay={replay}
          selectedId={selectedId}
          onSelect={selectMachine}
          onOpenMachine={openMachine}
          fitToken={fitToken}
          onMap={(m) => {
            mapRef.current = m;
          }}
        />

        <SidePanel
          open={panelOpen}
          onToggle={() => setPanelOpen((o) => !o)}
          mode={mode}
          date={shownDate}
          fleet={fleet}
          history={rows}
          selectedId={selectedId}
          onSelect={selectMachine}
          onDeselect={deselect}
          onOpenMachine={openMachine}
          onVideo={setVideoNodeId}
          loading={loading}
          onRefresh={() => load({ fit: true })}
        />

        {mode === "history" && (
          <ReplayBar
            minute={minute}
            onMinute={setMinute}
            playing={playing}
            onPlaying={setPlaying}
            speed={speed}
            onSpeed={setSpeed}
            ventana={ventana}
            panelOpen={panelOpen}
          />
        )}

        {videoJob && (
          <VideoModal
            job={videoJob}
            map={mapRef.current}
            onClose={() => setVideoNodeId(null)}
          />
        )}

        {error && (
          <div className="pointer-events-none absolute left-1/2 top-3.5 z-[1100] -translate-x-1/2 rounded-card border border-st-alerta/40 bg-white px-3 py-2 text-xs font-semibold text-st-alerta shadow-card">
            {error}
          </div>
        )}

        {sinNadaQueMostrar && (
          <div className="pointer-events-none absolute inset-0 z-[900] grid place-items-center">
            <div className="card px-6 py-5 text-center">
              <p className="text-sm font-bold">
                {mode === "live"
                  ? "Ninguna máquina reporta posición"
                  : "Sin recorridos ese día"}
              </p>
              <p className="mt-1 text-xs text-ink-2">
                {mode === "live"
                  ? "Los nodos están en la red pero ninguno ha entregado coordenadas."
                  : "Ninguno de los nodos registró fixes GPS en la fecha seleccionada."}
              </p>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
