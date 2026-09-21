"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import TopBar from "@/components/TopBar";
import SidePanel, { type HistoryRow } from "@/components/SidePanel";
import ReplayBar from "@/components/ReplayBar";
import MachineView from "@/components/MachineView";
import VideoModal, { type VideoJob } from "@/components/VideoModal";
import AsignacionModal from "@/components/AsignacionModal";
import FlotaAdmin from "@/components/FlotaAdmin";
import type { Trail, ReplayPos, CambioMapa } from "@/components/MapGL";
import {
  fetchNodes,
  fetchFleet,
  fetchTracksDay,
  fetchEstadiasDay,
  fetchRedMesh,
} from "@/lib/queries";
import type { SitioRed } from "@/lib/red";
import { estaDadoDeBaja } from "@/lib/bajas";
import { computeStats, enrichTrack, fmtTime } from "@/lib/geo";
import { unirTramos } from "@/lib/rutas";
import { partirPorMaquina, type PiezaRastro } from "@/lib/atribucion";
import { useRutasPorVia } from "@/lib/useRutas";
import { minuteOfDay, positionAt, ventanaConDatos } from "@/lib/replay";
import { dayRange, todayLocal } from "@/lib/ranges";
import { SUPABASE_READY } from "@/lib/supabase";
import { maquinaDe, setRegistroFlota } from "@/lib/tractores";
import { esPuesto, puestoDe } from "@/lib/puestos";
import {
  fetchFlota,
  registroEn,
  cronologiaDelDia,
  identidadDeNodoEn,
  FLOTA_VACIA,
  type Flota,
} from "@/lib/registro";
import type { Estadia, FleetItem, NodeRow, TrackPoint } from "@/lib/types";
import type { Map as MapLibreMap } from "maplibre-gl";

// MapLibre toca `window` al importarse: sólo en cliente.
const MapGL = dynamic(() => import("@/components/MapGL"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#bcd7ea]" />,
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
  /**
   * Sitios de la red mesh. Arranca vacío y sólo se llena con lo que responda
   * `v_mesh_health`: las coordenadas de las antenas no se escriben en el código
   * (ver lib/red.ts). Si la consulta falla, el mapa se queda sin antenas — es el
   * precio deliberado de no publicar dónde están.
   */
  const [sitios, setSitios] = useState<SitioRed[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>("live");
  const [date, setDate] = useState<string>(todayLocal());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  /**
   * En celular el panel se abre plegado. Mide 332 px y el teléfono tiene ~390:
   * abierto no deja ver el mapa, que es el producto — alguien parado al lado de
   * un lote quiere ver DÓNDE está la máquina, y la lista la pide después. En
   * escritorio sigue abierto como siempre, que es donde hay ancho para los dos.
   *
   * Se decide en un efecto y no en el `useState` de arriba a propósito: esta
   * página se prerenderiza, y leer `window` al construir el estado haría que el
   * servidor dijera "abierto" y el cliente "cerrado" — un error de hidratación.
   * Al correr después del montaje, el primer pintado coincide y el panel se
   * pliega enseguida.
   */
  useEffect(() => {
    if (window.matchMedia("(max-width: 767px)").matches) setPanelOpen(false);
  }, []);
  const [fitToken, setFitToken] = useState(0);

  // Instancia del mapa, para que el exportador de video pueda capturar su
  // canvas. Es un ref y no estado: cambiarlo no tiene que redibujar nada.
  const mapRef = useRef<MapLibreMap | null>(null);
  const [videoNodeId, setVideoNodeId] = useState<string | null>(null);

  // --- Registro de flota (máquinas, operadores y asignaciones) ---
  // `flota` son los datos crudos; `registroVersion` existe sólo para redibujar,
  // porque la identidad que usan mapa, panel y video se resuelve con
  // `maquinaDe`, que lee un módulo y no el estado de React.
  const [flota, setFlota] = useState<Flota>(FLOTA_VACIA);
  const [registroVersion, setRegistroVersion] = useState(0);
  const [asignacionNodeId, setAsignacionNodeId] = useState<string | null>(null);
  const [adminAbierto, setAdminAbierto] = useState(false);

  const [minute, setMinute] = useState(6 * 60);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(15);

  // Ruta: #/m/<node_id> abre el universo de esa máquina, y
  // #/m/<node_id>/<YYYY-MM-DD> lo abre anclado a ese día — que es como se entra
  // desde el histórico, para que la ficha hable de la fecha que se estaba
  // mirando y no de hoy. La fecha va en la URL para que el enlace se pueda
  // compartir y siga significando lo mismo.
  const [hashNode, setHashNode] = useState<string | null>(null);
  const [hashFecha, setHashFecha] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const m = location.hash.match(/^#\/m\/([^/]+)(?:\/(\d{4}-\d{2}-\d{2}))?$/);
      setHashNode(m ? decodeURIComponent(m[1]) : null);
      setHashFecha(m?.[2] ?? null);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  /** El día que se está mostrando: hoy en vivo, el elegido en histórico. */
  const shownDate = mode === "live" ? todayLocal() : date;

  // El registro se lee aparte del resto: que las tablas no existan todavía —o
  // que fallen— no puede dejar el mapa sin máquinas, así que no entra al
  // Promise.all de `load` ni propaga su error al banner.
  const recargarFlota = useCallback(async () => {
    if (!SUPABASE_READY) return;
    try {
      setFlota(await fetchFlota());
    } catch (e) {
      console.warn("[flota] no se pudo leer el registro", e);
    }
  }, []);

  useEffect(() => {
    recargarFlota();
  }, [recargarFlota]);

  // Igual que el registro de flota: la red va por su lado y su error no llega
  // al banner. Que las tablas de la malla no existan no puede dejar el mapa sin
  // máquinas. No hay lista de respaldo en el código: si la consulta falla, se
  // conserva lo último que sí respondió y nada más.
  const recargarRed = useCallback(async () => {
    if (!SUPABASE_READY) return;
    try {
      setSitios(await fetchRedMesh());
    } catch (e) {
      console.warn("[red] no se pudo leer el estado de la malla", e);
    }
  }, []);

  useEffect(() => {
    recargarRed();
  }, [recargarRed]);

  /**
   * Instante al que se resuelve la identidad de la flota.
   *
   * En vivo es ahora. En histórico es el final del día mostrado, que es lo que
   * hace que el recorrido del 3 de marzo salga con la máquina y el operador del
   * 3 de marzo y no con los de hoy — la razón entera por la que las
   * asignaciones guardan vigencia en vez de pisarse.
   */
  const instante = useMemo(() => {
    // Con un universo abierto manda la fecha de su URL: entrando por enlace
    // directo el modo todavía es "live", y sin esto la ficha del 3 de marzo
    // saldría con el operador de hoy.
    const dia = hashFecha ?? (mode === "live" ? null : date);
    if (!dia) return Date.now();
    return Math.min(Date.parse(dayRange(dia).toISO) - 1, Date.now());
    // `flota` entra como dependencia para recalcular tras cada relevo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, date, hashFecha, flota]);

  // Vuelca la identidad resuelta en el módulo que consultan `maquinaDe`, el
  // mapa y el grabador de video, y sube la versión para forzar el redibujo.
  useEffect(() => {
    setRegistroVersion(setRegistroFlota(registroEn(flota, instante)));
  }, [flota, instante]);

  // --- Carga ---
  const load = useCallback(
    async (opts?: { silent?: boolean; fit?: boolean }) => {
      if (!SUPABASE_READY) {
        setError("Falta configurar Supabase en .env.local");
        return;
      }
      if (!opts?.silent) setLoading(true);
      try {
        // Los nodos dados de baja se filtran aquí, en el único punto por el
        // que entran: así el panel, el mapa, los rastros y las estadías quedan
        // consistentes sin que cada uno tenga que acordarse de excluirlos.
        const ns = (await fetchNodes()).filter(
          (n) => !estaDadoDeBaja(n.node_id)
        );
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
  const redRef = useRef(recargarRed);
  redRef.current = recargarRed;
  useEffect(() => {
    // Durante la grabación de un video el sondeo se detiene: recargar a mitad
    // cambiaría los rastros que se están capturando.
    if (mode !== "live" || hashNode || videoNodeId) return;
    const id = setInterval(() => {
      loadRef.current({ silent: true });
      redRef.current();
    }, POLL_MS);
    return () => clearInterval(id);
  }, [mode, hashNode, videoNodeId]);

  // --- Derivados ---
  const trailsCrudos = useMemo<Trail[]>(
    () =>
      tracks
        // Un puesto fijo no tiene recorrido. Sus fixes se mueven unas decenas de
        // metros por ruido del GPS, y dibujarlos le inventaría a la portería un
        // rastro —y un kilometraje— que nadie caminó. Ver lib/puestos.ts.
        .filter((t) => t.points.length > 0 && !esPuesto(t.node.node_id))
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

  /**
   * El recorrido de cada nodo partido por máquina. Es lo que hace que el rastro
   * cambie de color en el punto donde el nodo se pasó de vehículo, en vez de
   * salir todo del color de la máquina que quedó al cierre del día.
   */
  const piezas = useMemo<Map<string, PiezaRastro[]>>(() => {
    const out = new Map<string, PiezaRastro[]>();
    for (const t of tracks) {
      if (t.points.length === 0) continue;
      out.set(
        t.node.node_id,
        partirPorMaquina(flota, t.node.node_id, t.points, rutas?.get(t.node.node_id))
      );
    }
    return out;
  }, [tracks, flota, rutas]);

  const trails = useMemo<Trail[]>(
    () =>
      trailsCrudos.map((t) => {
        const tramos = rutas?.get(t.nodeId);
        const p = piezas.get(t.nodeId);
        return {
          ...t,
          ...(tramos ? { ruta: unirTramos(tramos) } : {}),
          ...(p && p.length > 1 ? { piezas: p } : {}),
        };
      }),
    [trailsCrudos, rutas, piezas]
  );

  const rows = useMemo<HistoryRow[]>(
    () =>
      tracks.map(({ node, points }) => ({
        node,
        stats: computeStats(enrichTrack(points), estadias[node.node_id] ?? []),
        puntos: points.length,
        estadias: estadias[node.node_id] ?? [],
        piezas: piezas.get(node.node_id) ?? [],
      })),
    [tracks, estadias, piezas]
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
      // Los puestos fijos no se reproducen: se quedan clavados en su coordenada
      // declarada, que es lo que son. Siguen dibujándose para que la portería
      // sirva de referencia mientras se mira el recorrido de otra máquina.
      const puesto = puestoDe(t.node.node_id);
      if (puesto) {
        out.push({
          nodeId: t.node.node_id,
          lat: puesto.lat,
          lon: puesto.lon,
          rumbo: null,
          moviendo: false,
        });
        continue;
      }
      const pos = positionAt(t.points, minute, rutas?.get(t.node.node_id));
      if (!pos) continue;
      // La identidad se resuelve al minuto que se está reproduciendo: si a las
      // 11:40 el nodo se pasó de tractor, el ícono cambia ahí y no al final.
      const { maquina } = identidadDeNodoEn(
        flota,
        t.node.node_id,
        Date.parse(dayRange(shownDate).fromISO) + minute * 60_000
      );
      out.push({
        nodeId: t.node.node_id,
        ...pos,
        ...(maquina
          ? { tipo: maquina.tipo, color: maquina.color, codigo: maquina.codigo }
          : {}),
      });
    }
    return out;
  }, [mode, tracks, minute, rutas, flota, shownDate]);

  /**
   * Dónde estaba el nodo cuando se registró cada cambio de máquina u operador.
   *
   * Sólo del nodo seleccionado y sólo en histórico: son los puntos que contestan
   * "¿dónde se hizo el cambio?". La posición sale del mismo `positionAt` que
   * mueve el marcador del replay, así que el pin cae exactamente sobre el rastro
   * dibujado y no a un lado.
   */
  const cambios = useMemo<CambioMapa[]>(() => {
    if (mode !== "history" || !selectedId) return [];
    const pista = tracks.find((x) => x.node.node_id === selectedId);
    if (!pista) return [];

    const out: CambioMapa[] = [];
    for (const ev of cronologiaDelDia(flota, selectedId, shownDate)) {
      const pos = positionAt(
        pista.points,
        minuteOfDay(ev.t),
        rutas?.get(selectedId)
      );
      // `fuera` = la hora registrada cae antes del primer fix o después del
      // último. Ahí `positionAt` devuelve el extremo de la jornada, que NO es
      // dónde estaba el nodo a esa hora: sería inventar un sitio, así que no se
      // pone pin. La cronología del panel lo sigue listando.
      if (!pos || pos.fuera) continue;
      out.push({
        lat: pos.lat,
        lon: pos.lon,
        hora: fmtTime(ev.t),
        tipo: ev.tipo,
      });
    }
    return out;
  }, [mode, selectedId, tracks, flota, shownDate, rutas]);

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

  // Desde el histórico el universo se abre anclado al día mostrado; en vivo,
  // sin fecha, que equivale a hoy.
  const openMachine = useCallback(
    (nodeId: string) => {
      const base = `#/m/${encodeURIComponent(nodeId)}`;
      location.hash = mode === "history" ? `${base}/${date}` : base;
    },
    [mode, date]
  );

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
      <main className="h-dvh w-full overflow-hidden">
        <MachineView
          node={nodoAbierto}
          fecha={hashFecha ?? undefined}
          onBack={() => {
            location.hash = "";
          }}
        />
      </main>
    );
  }

  // El nodo cuyo formulario está abierto. Puede no estar en `nodes` si se
  // abrió justo mientras se recargaba: se arma uno mínimo para no cerrar el
  // formulario a mitad de escritura.
  const nodoEnAsignacion: NodeRow | null = asignacionNodeId
    ? nodes.find((n) => n.node_id === asignacionNodeId) ?? {
        node_id: asignacionNodeId,
        long_name: null,
        short_name: null,
        last_seen: null,
      }
    : null;

  const sinNadaQueMostrar =
    !loading &&
    !error &&
    trails.length === 0 &&
    !fleet?.some((f) => f.posicion);

  return (
    // `h-dvh` y no `h-screen`: en móvil `100vh` mide la pantalla CON la barra de
    // URL desplegada, así que el último tramo de la interfaz —la ReplayBar, que
    // va abajo— queda tapado hasta que el usuario hace scroll, y aquí no hay
    // scroll. `w-full` en vez de `w-screen` porque `100vw` incluye el ancho de
    // la barra de desplazamiento y provoca un desborde horizontal de pocos px.
    <main className="flex h-dvh w-full flex-col overflow-hidden">
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
          sitios={sitios}
          trails={trails}
          replay={replay}
          cambios={cambios}
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
          onAsignar={setAsignacionNodeId}
          onAdmin={() => setAdminAbierto(true)}
          flota={flota}
          instante={instante}
          registroVersion={registroVersion}
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

        {nodoEnAsignacion && (
          <AsignacionModal
            node={nodoEnAsignacion}
            flota={flota}
            instante={instante}
            onClose={() => setAsignacionNodeId(null)}
            onChanged={recargarFlota}
          />
        )}

        {adminAbierto && (
          <FlotaAdmin
            flota={flota}
            instante={instante}
            onClose={() => setAdminAbierto(false)}
            onChanged={recargarFlota}
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
