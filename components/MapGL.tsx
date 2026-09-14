"use client";

import { useCallback, useEffect, useRef } from "react";
// MapLibre 6 es ESM puro y NO tiene export default: hay que nombrar cada clase.
// `Map` se renombra porque colisiona con el `Map` de JavaScript que se usa
// abajo para llevar el registro de marcadores.
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  ScaleControl,
  LngLatBounds,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapLayerMouseEvent,
  setWorkerUrl,
} from "maplibre-gl";
import type { FleetItem } from "@/lib/types";
import { ESTADO_META } from "@/lib/fleet";
import { maquinaDe } from "@/lib/tractores";
import { markerHTML } from "@/lib/icons";
import { DEFAULT_CENTER, fmtTime } from "@/lib/geo";

/** Un rastro dibujable: los puntos de una máquina en el período visible. */
export interface Trail {
  nodeId: string;
  color: string;
  /** Ordenados de más antiguo a más reciente, como [lat, lon]. */
  latlngs: [number, number][];
  /**
   * El mismo recorrido reconstruido por la malla vial (ver lib/rutas.ts), si
   * alcanzó a calcularse. Es lo que se dibuja cuando existe; `latlngs` sigue
   * siendo la verdad medida y es lo que marca los extremos y el encuadre.
   */
  ruta?: [number, number][] | null;
  desde: string | null;
  hasta: string | null;
}

/** Posición de una máquina en un instante del replay. */
export interface ReplayPos {
  nodeId: string;
  lat: number;
  lon: number;
  rumbo: number | null;
  moviendo: boolean;
}

interface Props {
  mode: "live" | "history";
  fleet: FleetItem[] | null;
  trails: Trail[];
  replay: ReplayPos[] | null;
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onOpenMachine: (nodeId: string) => void;
  fitToken: number;
}

/**
 * MapLibre resuelve su worker contra `import.meta.url`, y Turbopack no emite ese
 * archivo hermano: el navegador termina pidiendo una URL que responde el HTML de
 * 404 y el worker nunca arranca. Sin worker no se procesa ninguna fuente GeoJSON
 * —las vías y los rastros quedan invisibles sin un solo error visible en el
 * mapa—, así que se sirve desde `public/` (lo copia
 * scripts/copiar-worker-maplibre.mjs).
 */
setWorkerUrl("/maplibre-gl-worker.mjs");

const SRC_TRAILS = "trails";
const SRC_ENDS = "trail-ends";
const SRC_VIAS = "vias";

/**
 * Vías de Guaicaramo. Se declaran dentro del estilo inicial (y no en el `load`)
 * para que la capa exista siempre: es el fondo contra el que se lee por dónde
 * va un tractor, así que no tiene interruptor ni depende de los datos de flota.
 * El GeoJSON se genera desde el KMZ de topografía con
 * `scripts/kmz-a-geojson.mjs`; ver README.
 */
const VIAS_URL = "/vias-guaicaramo.geojson";

/**
 * Rótulos de bloque y parcela, derivados del mismo KMZ (ver el script). Van en
 * su propia fuente porque son puntos, no líneas, y porque se prenden a zooms
 * distintos: el bloque orienta desde lejos, la parcela sólo tiene sentido
 * cuando ya estás mirando el lote.
 */
const SRC_ETIQ = "vias-etiquetas";
const ETIQ_URL = "/vias-guaicaramo-etiquetas.geojson";

/**
 * Una sola familia auto-hospedada en `public/fonts` (77 KB, rango 0-255). No se
 * usa un servidor de glifos público para no meterle al mapa una dependencia de
 * red que puede caerse. Los rótulos son ASCII ("B.10", "P.9"), así que ese rango
 * alcanza: un texto con acentos pediría un rango que no existe y no se dibujaría.
 */
const FUENTE = ["Open Sans Semibold"];

/** Color por tipo de vía; las proyectadas se pintan en su propia capa. */
const VIAS_COLOR: ExpressionSpecification = [
  "match",
  ["get", "TIPO"],
  "Pavimentada",
  "#ffffff",
  "Ruta",
  "#ffffff",
  // Balastrada y sus variantes: el caso normal en el predio.
  "#fbbf24",
];

/**
 * Ancho en px. Es una capa de fondo: tiene que dejar leer por dónde va el
 * tractor sin taparle la imagen satelital ni competir con los rastros, que son
 * el dato que se mira. De ahí el trazo fino y la opacidad baja.
 */
const VIAS_ANCHO: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  9,
  1.1,
  12,
  1.7,
  14,
  2.6,
  17,
  5,
];

/** El filete va siempre ~2 px más ancho que la vía, nunca más. */
const VIAS_BORDE_ANCHO: ExpressionSpecification = [
  "interpolate",
  ["linear"],
  ["zoom"],
  9,
  2.4,
  12,
  3.3,
  14,
  4.6,
  17,
  8,
];

/**
 * Mapa satélite con MapLibre GL JS + imágenes de Esri World Imagery.
 *
 * Se reemplazó Leaflet por dos razones concretas:
 *
 *  1. Leaflet pinta cada tesela como un `<img>` en el DOM, y su hoja de estilos
 *     1.9.x aplica `mix-blend-mode: plus-lighter` a esas imágenes. Junto con el
 *     preflight de Tailwind eso producía teselas lavadas, costuras visibles y
 *     parpadeo al hacer zoom. MapLibre dibuja todo en un canvas WebGL, así que
 *     ninguna regla de CSS de la app puede interferir con el mapa.
 *  2. El zoom es continuo en vez de por pasos, que es lo que se necesita para
 *     seguir un rastro de labor sin perder el contexto del lote.
 *
 * Se mantiene la fuente de teselas de Esri: no pide API key ni facturación, así
 * que la app no puede quedarse en blanco porque venció una tarjeta.
 */
export default function MapGL({
  mode,
  fleet,
  trails,
  replay,
  selectedId,
  onSelect,
  onOpenMachine,
  fitToken,
}: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  // Los datos pueden llegar antes de que el mapa termine de cargar su estilo.
  // MapLibre tipa sus eventos de forma cerrada (no acepta nombres propios), así
  // que en vez de un evento personalizado se encola el trabajo y se ejecuta en
  // el `load`. La última tarea encolada gana, que es lo correcto: dibuja el
  // estado más reciente.
  const pendingRef = useRef<(() => void)[]>([]);
  const markerRef = useRef<Map<string, Marker>>(new Map());
  const replayRef = useRef<Map<string, Marker>>(new Map());
  // Handlers frescos sin recrear el mapa.
  const cbRef = useRef({ onSelect, onOpenMachine });
  cbRef.current = { onSelect, onOpenMachine };

  /** Ejecuta ahora si el mapa ya cargó; si no, lo deja para el `load`. */
  const whenReady = useCallback((fn: () => void) => {
    if (readyRef.current) fn();
    else pendingRef.current.push(fn);
  }, []);

  // --- Crear el mapa una sola vez ---
  useEffect(() => {
    if (mapRef.current || !divRef.current) return;

    const map = new MapLibreMap({
      container: divRef.current,
      // Estilo mínimo declarado a mano: una sola capa ráster. No se carga un
      // style.json remoto porque sería otra dependencia de red que puede fallar.
      style: {
        version: 8,
        glyphs: "/fonts/{fontstack}/{range}.pbf",
        sources: {
          esri: {
            type: "raster",
            tiles: [
              "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
            ],
            tileSize: 256,
            // La imagen de Esri sobre Guaicaramo llega hasta z18: de z19 en
            // adelante el servidor responde 200 con el mosaico "Map data not yet
            // available". Declarando el techo real, MapLibre estira la tesela de
            // z18 al acercarse más —se ve borroso, pero se ve— en vez de pedir
            // teselas que no existen. Las vías y los marcadores siguen nítidos
            // porque son vectores.
            maxzoom: 18,
            attribution: "Imagery © Esri",
          },
          [SRC_VIAS]: { type: "geojson", data: VIAS_URL },
          [SRC_ETIQ]: { type: "geojson", data: ETIQ_URL },
        },
        layers: [
          { id: "esri", type: "raster", source: "esri" },
          // Filete oscuro debajo de la vía: sin él las líneas claras se pierden
          // sobre los caminos claros de la propia imagen satelital.
          {
            id: "vias-borde",
            type: "line",
            source: SRC_VIAS,
            filter: ["!=", ["get", "TIPO"], "Proyectada"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#0b1120",
              "line-opacity": 0.45,
              "line-width": VIAS_BORDE_ANCHO,
            },
          },
          {
            id: SRC_VIAS,
            type: "line",
            source: SRC_VIAS,
            filter: ["!=", ["get", "TIPO"], "Proyectada"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": VIAS_COLOR,
              "line-width": VIAS_ANCHO,
              "line-opacity": 0.62,
            },
          },
          // Las vías proyectadas (todavía no construidas) van en una capa
          // aparte: `line-dasharray` no admite expresiones por dato, así que la
          // única forma de puntearlas es separarlas con un filtro.
          {
            id: "vias-proyectadas",
            type: "line",
            source: SRC_VIAS,
            filter: ["==", ["get", "TIPO"], "Proyectada"],
            layout: { "line-cap": "butt", "line-join": "round" },
            paint: {
              "line-color": "#9ca3af",
              "line-width": VIAS_ANCHO,
              "line-opacity": 0.5,
              "line-dasharray": [2, 2],
            },
          },
          // Rótulo de bloque: orienta en la vista de predio y se apaga al
          // acercarse, cuando ya manda la parcela.
          {
            id: "etiq-bloque",
            type: "symbol",
            source: SRC_ETIQ,
            filter: ["==", ["get", "clase"], "bloque"],
            minzoom: 12,
            maxzoom: 16,
            layout: {
              "text-field": ["get", "texto"],
              "text-font": FUENTE,
              "text-size": ["interpolate", ["linear"], ["zoom"], 12, 12, 15, 17],
              "text-letter-spacing": 0.08,
              // El rótulo de bloque no se sacrifica al declutter: son 48 en todo
              // el predio y sin ellos no hay forma de ubicarse.
              "text-allow-overlap": true,
              "text-ignore-placement": true,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#0b1120",
              "text-halo-width": 1.6,
              "text-opacity": 0.85,
            },
          },
          // Rótulo de parcela: sólo de cerca. Son 494, a menos zoom serían una
          // mancha de texto sobre el lote.
          {
            id: "etiq-parcela",
            type: "symbol",
            source: SRC_ETIQ,
            filter: ["==", ["get", "clase"], "parcela"],
            minzoom: 15,
            layout: {
              // El número de parcela se repite entre bloques (hay un P.10 en el
              // B.4 y otro en el B.5), así que "P.10" a secas es ambiguo. De
              // lejos se muestra corto para orientar, y desde z16 —cuando ya se
              // está trabajando sobre el lote— el código completo, que es el
              // nombre con el que la parcela existe en topografía.
              "text-field": [
                "step",
                ["zoom"],
                ["get", "texto"],
                16,
                ["get", "cod_bp"],
              ],
              "text-font": FUENTE,
              "text-size": ["interpolate", ["linear"], ["zoom"], 15, 10, 18, 14],
              // Acá sí se deja que MapLibre descarte los que chocan: es
              // preferible perder un rótulo a no poder leer ninguno.
              "text-padding": 4,
            },
            paint: {
              "text-color": "#fde68a",
              "text-halo-color": "#0b1120",
              "text-halo-width": 1.4,
              "text-opacity": 0.9,
            },
          },
        ],
      },
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: 12,
      // Tope de acercamiento: un nivel por encima del techo de la imagen (estirón
      // de 2x) todavía se lee; a partir de ahí la tesela es una mancha verde sin
      // información y acercarse más sólo engaña.
      maxZoom: 19,
      attributionControl: { compact: true },
      // El doble clic abre la ficha de la máquina, no hace zoom.
      doubleClickZoom: false,
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      map.addSource(SRC_TRAILS, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: SRC_TRAILS,
        type: "line",
        source: SRC_TRAILS,
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": 3,
          "line-opacity": 0.65,
        },
      });

      map.addSource(SRC_ENDS, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: SRC_ENDS,
        type: "circle",
        source: SRC_ENDS,
        paint: {
          "circle-radius": 5,
          // Inicio: relleno del color de la máquina con borde blanco.
          // Fin: relleno blanco con borde del color. Igual que en el patrón.
          "circle-color": [
            "case",
            ["==", ["get", "kind"], "start"],
            ["get", "color"],
            "#ffffff",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": [
            "case",
            ["==", ["get", "kind"], "start"],
            "#ffffff",
            ["get", "color"],
          ],
        },
      });

      // Clic en un rastro = seleccionar esa máquina.
      map.on("click", SRC_TRAILS, (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.nodeId;
        if (typeof id === "string") cbRef.current.onSelect(id);
      });
      map.on("mouseenter", SRC_TRAILS, () => {
        map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", SRC_TRAILS, () => {
        map.getCanvas().style.cursor = "";
      });

      readyRef.current = true;
      // Pinta lo que llegó antes de que el estilo estuviera listo.
      const pendientes = pendingRef.current;
      pendingRef.current = [];
      pendientes.forEach((fn) => fn());
    });

    mapRef.current = map;

    // El contenedor arranca con alto 0 mientras Next monta el layout, y además
    // cambia al abrir o cerrar el panel lateral. Un ResizeObserver es la única
    // forma robusta de mantener el canvas a la medida real.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(divRef.current);

    return () => {
      ro.disconnect();
      pendingRef.current = [];
      map.remove();
      mapRef.current = null;
      readyRef.current = false;
      // `map.remove()` arranca del DOM los elementos de todos los marcadores,
      // pero los objetos Marker siguen vivos en estos registros. Si no se
      // vacían, el efecto que los pinta encuentra el id ya registrado, toma la
      // rama de "actualizar posición" y jamás los vuelve a añadir al mapa
      // nuevo: la flota desaparece del mapa aunque siga en el panel. Pasa en
      // cada remontaje —StrictMode hace uno en desarrollo, y un Fast Refresh
      // otro—, así que el registro tiene que morir junto con su mapa.
      markerRef.current.clear();
      replayRef.current.clear();
    };
  }, []);

  // --- Rastros y extremos ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const pintar = () => {
      const src = map.getSource(SRC_TRAILS) as GeoJSONSource | undefined;
      const ends = map.getSource(SRC_ENDS) as GeoJSONSource | undefined;
      if (!src || !ends) return;

      src.setData({
        type: "FeatureCollection",
        features: trails
          .filter((t) => t.latlngs.length >= 2)
          .map((t) => ({
            type: "Feature" as const,
            properties: { nodeId: t.nodeId, color: t.color },
            geometry: {
              type: "LineString" as const,
              // GeoJSON va en [lon, lat]; los datos vienen en [lat, lon].
              coordinates: (t.ruta ?? t.latlngs).map(([la, lo]) => [lo, la]),
            },
          })),
      });

      // Los extremos sólo aportan en histórico: "¿a qué hora arrancó y paró?".
      ends.setData({
        type: "FeatureCollection",
        features:
          mode !== "history"
            ? []
            : trails.flatMap((t) => {
                if (t.latlngs.length < 2) return [];
                const a = t.latlngs[0];
                const b = t.latlngs[t.latlngs.length - 1];
                return [
                  punto(a, t, "start", fmtTime(t.desde)),
                  punto(b, t, "end", fmtTime(t.hasta)),
                ];
              }),
      });
    };

    whenReady(pintar);
  }, [trails, mode, whenReady]);

  // --- Resalte del seleccionado ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const aplicar = () => {
      if (!map.getLayer(SRC_TRAILS)) return;
      const esSel = ["==", ["get", "nodeId"], selectedId ?? ""] as unknown;
      map.setPaintProperty(SRC_TRAILS, "line-width", [
        "case",
        esSel,
        4.5,
        3,
      ] as never);
      map.setPaintProperty(SRC_TRAILS, "line-opacity", [
        "case",
        esSel,
        0.95,
        selectedId ? 0.25 : 0.65,
      ] as never);
    };
    whenReady(aplicar);
  }, [selectedId, whenReady]);

  // --- Marcadores de la flota (sólo en vivo) ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (mode !== "live" || !fleet) {
      markerRef.current.forEach((m) => m.remove());
      markerRef.current.clear();
      return;
    }

    const vistos = new Set<string>();
    for (const item of fleet) {
      // Sin coordenadas no hay nada honesto que dibujar: la máquina existe pero
      // su ubicación no. Aparece en el panel FLOTA como "Sin GPS", no aquí.
      if (!item.posicion) continue;
      const id = item.node.node_id;
      vistos.add(id);

      const maq = maquinaDe(id, item.node.long_name, item.node.short_name);
      const html = markerHTML({
        tipo: maq.tipo,
        color: maq.color,
        codigo: maq.codigo,
        estado: item.estado,
        rumbo: item.rumbo,
      });
      const lngLat: [number, number] = [item.posicion.lon, item.posicion.lat];

      let mk = markerRef.current.get(id);
      if (!mk) {
        const el = document.createElement("div");
        el.className = "machine-marker";
        attachClicks(el, id, cbRef);
        mk = new Marker({ element: el, anchor: "center" })
          .setLngLat(lngLat)
          .addTo(map);
        markerRef.current.set(id, mk);
      } else {
        mk.setLngLat(lngLat);
      }
      const el = mk.getElement();
      el.innerHTML = html;
      el.title = `${maq.nombre} · ${maq.codigo}\n${
        ESTADO_META[item.estado].label
      }`;
    }

    markerRef.current.forEach((mk, id) => {
      if (!vistos.has(id)) {
        mk.remove();
        markerRef.current.delete(id);
      }
    });
  }, [fleet, mode]);

  // --- Marcadores del replay ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (!replay) {
      replayRef.current.forEach((m) => m.remove());
      replayRef.current.clear();
      return;
    }

    const vistos = new Set<string>();
    for (const pos of replay) {
      vistos.add(pos.nodeId);
      const maq = maquinaDe(pos.nodeId);
      const color =
        trails.find((t) => t.nodeId === pos.nodeId)?.color ?? maq.color;
      const html = markerHTML({
        tipo: maq.tipo,
        color,
        codigo: maq.codigo,
        estado: pos.moviendo ? "activa" : "detenida",
        rumbo: pos.rumbo,
      });

      let mk = replayRef.current.get(pos.nodeId);
      if (!mk) {
        const el = document.createElement("div");
        el.className = "machine-marker replay-marker";
        mk = new Marker({ element: el, anchor: "center" })
          .setLngLat([pos.lon, pos.lat])
          .addTo(map);
        replayRef.current.set(pos.nodeId, mk);
      } else {
        mk.setLngLat([pos.lon, pos.lat]);
      }
      mk.getElement().innerHTML = html;
    }

    replayRef.current.forEach((mk, id) => {
      if (!vistos.has(id)) {
        mk.remove();
        replayRef.current.delete(id);
      }
    });
    // `trails` sólo aporta el color; no debe redibujar el replay al cambiar.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replay]);

  // --- Reencuadre ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const pts: [number, number][] = [];
    const push = (lon: number, lat: number) => pts.push([lon, lat]);

    if (selectedId) {
      trails
        .find((x) => x.nodeId === selectedId)
        ?.latlngs.forEach(([la, lo]) => push(lo, la));
      const item = fleet?.find((f) => f.node.node_id === selectedId);
      if (item?.posicion) push(item.posicion.lon, item.posicion.lat);
    } else {
      trails.forEach((t) => t.latlngs.forEach(([la, lo]) => push(lo, la)));
      fleet?.forEach((f) => {
        if (f.posicion) push(f.posicion.lon, f.posicion.lat);
      });
    }

    const encuadrar = () => {
      if (pts.length === 0) {
        map.jumpTo({ center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat], zoom: 12 });
        return;
      }
      const b = new LngLatBounds(pts[0], pts[0]);
      pts.forEach((p) => b.extend(p));
      // Toda la flota en el mismo sitio: fitBounds sobre un punto haría un zoom
      // absurdo, así que se centra con un zoom fijo y legible.
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      if (ne.lat === sw.lat && ne.lng === sw.lng) {
        map.easeTo({ center: b.getCenter(), zoom: 16, duration: 600 });
      } else {
        map.fitBounds(b, { padding: 80, maxZoom: 17, duration: 600 });
      }
    };

    whenReady(encuadrar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitToken]);

  return <div ref={divRef} className="absolute inset-0" />;
}

/** Punto de inicio o fin de un rastro, como feature de GeoJSON. */
function punto(
  [lat, lon]: [number, number],
  t: Trail,
  kind: "start" | "end",
  hora: string
) {
  return {
    type: "Feature" as const,
    properties: { nodeId: t.nodeId, color: t.color, kind, hora },
    geometry: { type: "Point" as const, coordinates: [lon, lat] },
  };
}

/**
 * Clic = seleccionar; doble clic = abrir el universo de la máquina.
 *
 * El clic sencillo espera 260 ms para no robarle el doble clic. Es el mismo
 * compromiso del patrón SiriusFleet.
 */
function attachClicks(
  el: HTMLElement,
  id: string,
  cbRef: React.MutableRefObject<{
    onSelect: (id: string) => void;
    onOpenMachine: (id: string) => void;
  }>
) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  el.addEventListener("click", (e) => {
    e.stopPropagation();
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      cbRef.current.onSelect(id);
    }, 260);
  });
  el.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    if (timer) clearTimeout(timer);
    timer = null;
    cbRef.current.onOpenMachine(id);
  });
}
