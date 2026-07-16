"use client";

import { useEffect, useMemo, useRef } from "react";
import { APIProvider, Map, useMap } from "@vis.gl/react-google-maps";
import type { EnrichedPoint, Estadia, NodeLatest } from "@/lib/types";
import {
  DEFAULT_CENTER,
  fmtTime,
  fmtDuration,
  compass,
  fmtAgo,
  haversineM,
} from "@/lib/geo";

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
// Map ID: solo se usa si es un mapa VECTOR válido del mismo proyecto que la key.
// Para el satélite/híbrido raster NO hace falta (y un Map ID inválido deja el
// mapa base en negro). Por eso solo lo pasamos cuando además se pide modo vector.
const RAW_MAP_ID = process.env.NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID || undefined;
const USE_VECTOR_MAP_ID = process.env.NEXT_PUBLIC_USE_VECTOR_MAP === "true";
const MAP_ID = USE_VECTOR_MAP_ID ? RAW_MAP_ID : undefined;

// Umbral para considerar un tramo como "hueco sin reporte" (min).
const GAP_MINUTES = 35;

// Un nodo se considera "en vivo" si reportó hace menos de esto (min).
const LIVE_MINUTES = 15;

// Radio para juntar nodos en un mismo marcador (m). Por debajo de esto la
// diferencia es indistinguible en el mapa y cae dentro del error del GPS.
const CLUSTER_M = 30;

interface MapViewProps {
  points: EnrichedPoint[];
  estadias: Estadia[];
  latest: EnrichedPoint | null;
  /** Si no es null, el mapa dibuja la flota completa y omite el rastro. */
  overview: NodeLatest[] | null;
  playbackIndex: number | null; // null = sin playback (muestra todo)
  is3D: boolean;
  selectedId: number | null;
  onSelectPoint: (p: EnrichedPoint | null) => void;
  flyToken: number; // cambia para forzar fly-to al recorrido
}

/**
 * Agrupa nodos que están prácticamente en el mismo sitio.
 *
 * Varios nodos juntos es real (comparten caseta, o reportan la posición del
 * gateway) y sin agrupar sus marcadores y etiquetas quedan encimados e
 * ilegibles. Se agrupa por distancia y no por coordenada exacta porque en la
 * práctica difieren en los últimos decimales sin estar en sitios distintos.
 * Un marcador con la lista adentro es honesto: no inventa desplazamientos que
 * serían posiciones falsas.
 */
function groupByPosition(
  overview: NodeLatest[]
): { lat: number; lon: number; items: NodeLatest[] }[] {
  const groups: { lat: number; lon: number; items: NodeLatest[] }[] = [];
  for (const o of overview) {
    if (!o.latest) continue; // nodo sin posición: no se puede dibujar
    const { lat, lon } = o.latest;
    const near = groups.find((g) => haversineM({ lat: g.lat, lon: g.lon }, { lat, lon }) <= CLUSTER_M);
    if (near) near.items.push(o);
    else groups.push({ lat, lon, items: [o] });
  }
  return groups;
}

/** Minutos desde un ISO, o null si no hay fecha. */
function minutesSince(iso: string | null): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return (Date.now() - t) / 60000;
}

/** Interpola color dim→brillante según recencia (0..1). */
function recencyColor(f: number): string {
  // de cian apagado (viejo) a verde-lima brillante (reciente)
  const from = { r: 14, g: 116, b: 144 }; // cyan-800
  const to = { r: 57, g: 255, b: 20 }; // lime
  const r = Math.round(from.r + (to.r - from.r) * f);
  const g = Math.round(from.g + (to.g - from.g) * f);
  const b = Math.round(from.b + (to.b - from.b) * f);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

/** Componente interno que dibuja todo imperativamente sobre el mapa. */
function Overlays({
  points,
  estadias,
  latest,
  overview,
  playbackIndex,
  selectedId,
  onSelectPoint,
  flyToken,
}: Omit<MapViewProps, "is3D">) {
  const map = useMap();
  const overlaysRef = useRef<google.maps.MVCObject[]>([]);
  const infoRef = useRef<google.maps.InfoWindow | null>(null);
  const playbackMarkerRef = useRef<google.maps.Marker | null>(null);

  const visibleCount =
    playbackIndex == null ? points.length : Math.min(playbackIndex + 1, points.length);

  // --- Dibuja polyline, flechas, paradas y marcador vivo ---
  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    // limpia overlays previos
    overlaysRef.current.forEach((o) => (o as google.maps.Marker).setMap?.(null));
    overlaysRef.current = [];
    if (!infoRef.current) infoRef.current = new google.maps.InfoWindow();

    // --- Modo "Todos los nodos": un marcador por posición, sin rastro ---
    if (overview) {
      groupByPosition(overview).forEach((g) => {
        const solo = g.items.length === 1;
        // El grupo está "en vivo" si al menos uno de sus nodos reportó reciente.
        const mins = g.items.map((o) => minutesSince(o.latest!.sample_local));
        const freshest = Math.min(...mins.map((m) => m ?? Infinity));
        const live = freshest <= LIVE_MINUTES;
        const color = live ? "#39ff14" : "#f59e0b";

        const halo = new google.maps.Marker({
          position: { lat: g.lat, lng: g.lon },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 16,
            fillColor: color,
            fillOpacity: 0.16,
            strokeColor: color,
            strokeOpacity: 0.5,
            strokeWeight: 1,
          },
          zIndex: 9,
          map,
        });
        const core = new google.maps.Marker({
          position: { lat: g.lat, lng: g.lon },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 7,
            fillColor: color,
            fillOpacity: 1,
            strokeColor: "#05070a",
            strokeWeight: 2,
            // Baja el texto para que el círculo no lo tape (se escala con `scale`).
            labelOrigin: new google.maps.Point(0, 3.4),
          },
          zIndex: 10,
          label: {
            text: solo
              ? g.items[0].node.short_name ?? g.items[0].node.node_id
              : `${g.items.length} nodos`,
            color: "#e2e8f0",
            fontSize: "11px",
            fontWeight: "600",
          },
          map,
          title: solo
            ? `${g.items[0].node.long_name ?? g.items[0].node.node_id}`
            : `${g.items.length} nodos en esta posición`,
        });

        const open = () => {
          const filas = g.items
            .map((o) => {
              const m = minutesSince(o.latest!.sample_local);
              const dot = (m ?? Infinity) <= LIVE_MINUTES ? "#16a34a" : "#b45309";
              return `<div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                        <span style="width:7px;height:7px;border-radius:50%;background:${dot}"></span>
                        <b>${o.node.long_name ?? o.node.node_id}</b>
                        <span style="color:#64748b">${fmtAgo(o.latest!.sample_local)}</span>
                      </div>`;
            })
            .join("");
          infoRef.current?.setContent(
            `<div style="font:13px ui-sans-serif;color:#0c1018;min-width:200px">
               <div style="font-weight:700">${
                 solo ? "Nodo" : `${g.items.length} nodos aquí`
               }</div>
               ${filas}
             </div>`
          );
          infoRef.current?.setPosition({ lat: g.lat, lng: g.lon });
          infoRef.current?.open(map);
        };
        core.addListener("click", open);
        halo.addListener("click", open);
        overlaysRef.current.push(halo, core);
      });
      return;
    }

    if (points.length === 0) return;

    const total = points.length;

    // 1) Segmentos de la polyline (gradiente por recencia + gaps punteados)
    for (let i = 1; i < total; i++) {
      const a = points[i - 1];
      const b = points[i];
      const f = i / (total - 1 || 1);
      const isGap = (b.min_since_prev_fix ?? 0) > GAP_MINUTES;

      const seg = new google.maps.Polyline({
        path: [
          { lat: a.lat, lng: a.lon },
          { lat: b.lat, lng: b.lon },
        ],
        geodesic: true,
        strokeColor: isGap ? "#64748b" : recencyColor(f),
        strokeOpacity: isGap ? 0 : 0.85,
        strokeWeight: 4,
        zIndex: 5,
        icons: isGap
          ? [
              {
                icon: {
                  path: "M 0,-1 0,1",
                  strokeOpacity: 0.7,
                  strokeColor: "#94a3b8",
                  scale: 3,
                },
                offset: "0",
                repeat: "12px",
              },
            ]
          : undefined,
        map,
      });
      overlaysRef.current.push(seg);
    }

    // 2) Flechas de rumbo en puntos en movimiento
    points.forEach((p, i) => {
      if (p.is_stationary) return;
      if (p.bearingDeg == null) return;
      const f = i / (total - 1 || 1);
      const arrow = new google.maps.Marker({
        position: { lat: p.lat, lng: p.lon },
        icon: {
          path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 3.4,
          rotation: p.bearingDeg,
          fillColor: recencyColor(f),
          fillOpacity: 1,
          strokeColor: "#05070a",
          strokeWeight: 1,
        },
        zIndex: 6,
        map,
        title: `${fmtTime(p.sample_local)} · rumbo ${compass(p.bearingDeg)}`,
      });
      arrow.addListener("click", () => onSelectPoint(p));
      overlaysRef.current.push(arrow);
    });

    // 3) Estadías "estuvo aquí" (ámbar) — pines calculados por el backend
    estadias.forEach((e) => {
      const ring = new google.maps.Marker({
        position: { lat: e.lat, lng: e.lon },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 13,
          fillColor: "#f59e0b",
          fillOpacity: 0.18,
          strokeColor: "#f59e0b",
          strokeOpacity: 0.5,
          strokeWeight: 1,
        },
        zIndex: 7,
        map,
      });
      const dot = new google.maps.Marker({
        position: { lat: e.lat, lng: e.lon },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 6,
          fillColor: "#f59e0b",
          fillOpacity: 1,
          strokeColor: "#1a1206",
          strokeWeight: 1.5,
        },
        zIndex: 8,
        label: {
          text: fmtDuration(e.minutos),
          color: "#fde68a",
          fontSize: "11px",
          fontWeight: "600",
        },
        map,
        title: `Estadía · ${fmtDuration(e.minutos)}`,
      });
      const open = () => {
        infoRef.current?.setContent(
          `<div style="font:13px ui-sans-serif;color:#0c1018;min-width:170px">
             <div style="font-weight:700;color:#b45309">📍 Estuvo aquí</div>
             <div>Permanencia: <b>${fmtDuration(e.minutos)}</b></div>
             <div>Desde ${fmtTime(e.desde)} a ${fmtTime(e.hasta)}</div>
             <div style="color:#64748b">${e.n_fixes} fixes</div>
           </div>`
        );
        infoRef.current?.setPosition({ lat: e.lat, lng: e.lon });
        infoRef.current?.open(map);
        onSelectPoint(null);
      };
      dot.addListener("click", open);
      ring.addListener("click", open);
      overlaysRef.current.push(ring, dot);
    });

    // 4) Marcador "en vivo" (última posición) — verde brillante con anillo
    if (latest) {
      const halo = new google.maps.Marker({
        position: { lat: latest.lat, lng: latest.lon },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 16,
          fillColor: "#39ff14",
          fillOpacity: 0.16,
          strokeColor: "#39ff14",
          strokeOpacity: 0.5,
          strokeWeight: 1,
        },
        zIndex: 9,
        map,
      });
      const core = new google.maps.Marker({
        position: { lat: latest.lat, lng: latest.lon },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#39ff14",
          fillOpacity: 1,
          strokeColor: "#05070a",
          strokeWeight: 2,
        },
        zIndex: 10,
        map,
        title: `EN VIVO · ${fmtTime(latest.sample_local)}`,
      });
      core.addListener("click", () => onSelectPoint(latest));
      overlaysRef.current.push(halo, core);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, points, estadias, latest, overview]);

  // --- Al cambiar entre flota y nodo, cierra el popup del modo anterior ---
  // (no basta con limpiar overlays: el InfoWindow es independiente y quedaría
  // colgado hablando de nodos que ya no se están mostrando)
  const wasOverview = useRef<boolean | null>(null);
  useEffect(() => {
    const isOverview = overview != null;
    if (wasOverview.current !== null && wasOverview.current !== isOverview) {
      infoRef.current?.close();
    }
    wasOverview.current = isOverview;
  }, [overview]);

  // --- Marcador de playback (se mueve sin redibujar todo) ---
  useEffect(() => {
    if (!map || typeof google === "undefined") return;
    if (playbackIndex == null || points.length === 0) {
      playbackMarkerRef.current?.setMap(null);
      playbackMarkerRef.current = null;
      return;
    }
    const p = points[Math.min(playbackIndex, points.length - 1)];
    if (!p) return;
    if (!playbackMarkerRef.current) {
      playbackMarkerRef.current = new google.maps.Marker({
        zIndex: 999,
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 9,
          fillColor: "#22d3ee",
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 2,
        },
        map,
      });
    }
    playbackMarkerRef.current.setPosition({ lat: p.lat, lng: p.lon });
  }, [map, playbackIndex, points]);

  // --- Resaltar punto seleccionado abriendo InfoWindow ---
  useEffect(() => {
    if (!map || selectedId == null || !infoRef.current) return;
    const p = points.find((x) => x.id === selectedId);
    if (!p) return;
    map.panTo({ lat: p.lat, lng: p.lon });
  }, [map, selectedId, points]);

  // --- Fly-to: encuadra el recorrido cuando cambia el token ---
  useEffect(() => {
    if (!map || typeof google === "undefined") return;

    // En modo "Todos" encuadra la flota; si todos comparten posición, fitBounds
    // sobre un solo punto haría un zoom absurdo, así que centramos con zoom fijo.
    if (overview) {
      const pos = overview.filter((o) => o.latest);
      if (pos.length === 0) {
        map.setCenter(DEFAULT_CENTER);
        map.setZoom(13);
        return;
      }
      const bounds = new google.maps.LatLngBounds();
      pos.forEach((o) => bounds.extend({ lat: o.latest!.lat, lng: o.latest!.lon }));
      if (bounds.getNorthEast().equals(bounds.getSouthWest())) {
        map.setCenter(bounds.getCenter());
        map.setZoom(17);
      } else {
        map.fitBounds(bounds, 90);
      }
      return;
    }

    if (points.length === 0 && estadias.length === 0 && !latest) {
      map.setCenter(DEFAULT_CENTER);
      map.setZoom(13);
      return;
    }
    const bounds = new google.maps.LatLngBounds();
    points.forEach((p) => bounds.extend({ lat: p.lat, lng: p.lon }));
    estadias.forEach((e) => bounds.extend({ lat: e.lat, lng: e.lon }));
    if (latest) bounds.extend({ lat: latest.lat, lng: latest.lon });
    map.fitBounds(bounds, 90);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, flyToken]);

  // limpieza al desmontar
  useEffect(() => {
    return () => {
      overlaysRef.current.forEach((o) => (o as google.maps.Marker).setMap?.(null));
      playbackMarkerRef.current?.setMap(null);
      infoRef.current?.close();
    };
  }, []);

  return null;
}

export default function MapView(props: MapViewProps) {
  const { is3D } = props;

  const center = useMemo(() => {
    if (props.latest) return { lat: props.latest.lat, lng: props.latest.lon };
    if (props.points[0])
      return { lat: props.points[0].lat, lng: props.points[0].lon };
    return DEFAULT_CENTER;
  }, [props.latest, props.points]);

  if (!API_KEY) {
    return (
      <div className="flex h-full w-full items-center justify-center bg-base-900 p-8 text-center">
        <div className="glass max-w-md rounded-2xl p-8">
          <h2 className="mb-2 text-lg font-semibold text-amber-300">
            Falta la API key de Google Maps
          </h2>
          <p className="text-sm text-slate-300">
            Agrega{" "}
            <code className="rounded bg-black/40 px-1.5 py-0.5 text-live-cyan">
              NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
            </code>{" "}
            en <code className="text-live-cyan">.env.local</code> y reinicia{" "}
            <code className="text-live-cyan">npm run dev</code>.
          </p>
          <p className="mt-3 text-xs text-slate-400">
            Habilita en Google Cloud: <b>Maps JavaScript API</b> (+ <b>Map Tiles
            API</b> para el 3D) y billing.
          </p>
        </div>
      </div>
    );
  }

  return (
    <APIProvider apiKey={API_KEY} libraries={["marker", "geometry"]}>
      <Map
        className="h-full w-full"
        defaultCenter={center}
        defaultZoom={13}
        mapId={MAP_ID}
        mapTypeId="hybrid"
        tilt={is3D ? 55 : 0}
        heading={is3D ? 40 : 0}
        gestureHandling="greedy"
        disableDefaultUI
        zoomControl
        clickableIcons={false}
        backgroundColor="#05070a"
        styles={MAP_DARK_LABELS}
        onClick={() => props.onSelectPoint(null)}
      >
        <Overlays {...props} />
      </Map>
    </APIProvider>
  );
}

// Estilos suaves para que las etiquetas no compitan con el satélite.
const MAP_DARK_LABELS: google.maps.MapTypeStyle[] = [
  { featureType: "all", elementType: "labels.text.fill", stylers: [{ color: "#cbd5e1" }] },
  {
    featureType: "all",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#05070a" }, { weight: 2 }],
  },
  { featureType: "poi", elementType: "labels", stylers: [{ visibility: "off" }] },
  { featureType: "transit", elementType: "labels", stylers: [{ visibility: "off" }] },
];
