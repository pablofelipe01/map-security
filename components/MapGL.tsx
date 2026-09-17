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
import { maquinaDe, type TipoMaquina } from "@/lib/tractores";
import { puestoDe } from "@/lib/puestos";
import { antenaHTML, markerHTML } from "@/lib/icons";
import {
  COLOR_RED,
  enlacesDeclarados,
  fmtDistKm,
  metaDe,
  type SitioRed,
} from "@/lib/red";
import {
  CAPA_EXTREMOS,
  CAPA_RASTROS,
  CAPA_RED,
  CAPA_RED_ETIQ,
  CAPA_CAMBIOS,
  CAPA_CAMBIOS_HORA,
} from "@/lib/capas";
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
  /**
   * El rastro partido por máquina, cuando el nodo cambió de vehículo ese día.
   * Cada pieza se dibuja con el color de SU máquina; sin esto el día entero
   * saldría del color de la máquina que quedó al cierre. Ver lib/atribucion.ts.
   */
  piezas?: { color: string; latlngs: [number, number][]; ruta: [number, number][] | null }[];
  desde: string | null;
  hasta: string | null;
}

/**
 * Un cambio de máquina u operador, ubicado donde estaba el nodo cuando se
 * registró. Ver `cronologiaDelDia` en lib/registro.ts.
 */
export interface CambioMapa {
  lat: number;
  lon: number;
  /** Hora local, ya formateada: es lo que se dibuja junto al pin. */
  hora: string;
  tipo: "monta" | "cambio_maquina" | "desmonta" | "relevo";
}

/** Posición de una máquina en un instante del replay. */
export interface ReplayPos {
  nodeId: string;
  lat: number;
  lon: number;
  rumbo: number | null;
  moviendo: boolean;
  /**
   * true = a esa hora la máquina estaba fuera de su jornada: el marcador está
   * esperando en su primer fix o quedó en el último. Se dibuja atenuado, porque
   * no afirma dónde estaba en ese minuto (nadie lo sabe), sólo que la máquina
   * trabajó ese día.
   */
  fuera?: boolean;
  /**
   * Identidad vigente en ESE minuto, no al cierre del día. Es lo que hace que
   * el ícono del replay cambie de máquina en el momento en que el nodo se pasó
   * de vehículo, en vez de recorrer toda la jornada disfrazado del último.
   */
  tipo?: TipoMaquina;
  color?: string;
  codigo?: string;
}

interface Props {
  mode: "live" | "history";
  fleet: FleetItem[] | null;
  /** Sitios de la red mesh con su estado (`v_mesh_health`). */
  sitios: SitioRed[];
  trails: Trail[];
  replay: ReplayPos[] | null;
  /** Dónde se registraron los cambios de máquina/operador del nodo elegido. */
  cambios: CambioMapa[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onOpenMachine: (nodeId: string) => void;
  fitToken: number;
  /**
   * Entrega la instancia del mapa (y `null` al desmontarla) para que el
   * grabador de video pueda dibujar sobre ella y capturar su canvas. Es la
   * única fisura en el encapsulamiento del mapa, y existe porque el video tiene
   * que mostrar exactamente lo mismo que la pantalla: ver lib/video.ts.
   */
  onMap?: (map: MapLibreMap | null) => void;
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

// Los ids de estas dos capas los comparte el grabador de video, que las apaga
// mientras graba: viven en lib/capas.ts para que no puedan divergir.
const SRC_TRAILS = CAPA_RASTROS;
const SRC_ENDS = CAPA_EXTREMOS;
const SRC_VIAS = "vias";
const SRC_CAMBIOS = CAPA_CAMBIOS;

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
 * Enlaces de la red mesh. Como las vías, va declarado dentro del estilo inicial:
 * son postes instalados, no dependen de que Supabase responda ni de qué día se
 * esté mirando, así que la capa tiene que existir siempre.
 */
const SRC_RED = CAPA_RED;

/**
 * Una sola familia auto-hospedada en `public/fonts` (77 KB, rango 0-255). No se
 * usa un servidor de glifos público para no meterle al mapa una dependencia de
 * red que puede caerse. Los rótulos son ASCII ("B.10", "P.9"), así que ese rango
 * alcanza: un texto con acentos pediría un rango que no existe y no se dibujaría.
 */
const FUENTE = ["Open Sans Semibold"];

const FC_VACIA = { type: "FeatureCollection" as const, features: [] };

/**
 * Los enlaces declarados como GeoJSON: una línea del gateway a cada repetidor,
 * teñida del estado del repetidor. El color es lo que hace legible el mapa de un
 * vistazo: un tramo rojo dice a la vez qué sitio se cayó y por dónde llegaba.
 */
function redGeoJSON(sitios: SitioRed[]) {
  return {
    type: "FeatureCollection" as const,
    features: enlacesDeclarados(sitios).map((e) => ({
      type: "Feature" as const,
      properties: {
        sitio: e.hasta.site_name,
        color: metaDe(e.hasta.estado).color,
        // Con coma decimal porque es lo que se lee en el mapa en español. El
        // rango de glifos cargado es ASCII, así que "1,83 km" se dibuja; un
        // texto con acentos no.
        km: fmtDistKm(e.hasta.dist_gateway_m),
      },
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [e.desde.lon as number, e.desde.lat as number],
          [e.hasta.lon as number, e.hasta.lat as number],
        ],
      },
    })),
  };
}

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
  sitios,
  trails,
  replay,
  cambios,
  selectedId,
  onSelect,
  onOpenMachine,
  fitToken,
  onMap,
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
  const redRef = useRef<Map<string, Marker>>(new Map());
  // Handlers frescos sin recrear el mapa.
  const cbRef = useRef({ onSelect, onOpenMachine, onMap });
  cbRef.current = { onSelect, onOpenMachine, onMap };

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
          [SRC_RED]: { type: "geojson", data: FC_VACIA },
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
          // Enlaces de la mesh. Punteados a propósito: es la topología
          // declarada (radial desde la torre), no la medida — ver lib/red.ts.
          {
            id: SRC_RED,
            type: "line",
            source: SRC_RED,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": [
                "interpolate",
                ["linear"],
                ["zoom"],
                9,
                1,
                13,
                1.8,
                16,
                2.6,
              ],
              "line-opacity": 0.5,
              "line-dasharray": [3, 2],
            },
          },
          {
            id: CAPA_RED_ETIQ,
            type: "symbol",
            source: SRC_RED,
            minzoom: 11,
            layout: {
              "text-field": ["get", "km"],
              "text-font": FUENTE,
              "text-size": 10,
              "symbol-placement": "line-center",
              "text-padding": 6,
            },
            paint: {
              "text-color": COLOR_RED,
              "text-halo-color": "#0b1120",
              "text-halo-width": 1.6,
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
      // Sin `preserveDrawingBuffer` el buffer de WebGL se limpia apenas el
      // navegador compone el cuadro, y `drawImage` sobre el canvas del mapa
      // devuelve negro: el exportador de video (lib/video.ts) produciría un
      // archivo en negro. Cuesta algo de memoria y de rendimiento en el peor
      // caso, a cambio de que el mapa se pueda capturar.
      canvasContextAttributes: { preserveDrawingBuffer: true },
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

      // Cambios de máquina/operador del nodo seleccionado. Van sobre el rastro
      // —se añaden después— porque son la anotación que lo explica: el rastro
      // dice por dónde anduvo, el pin dice en qué punto dejó de ser esa máquina.
      map.addSource(SRC_CAMBIOS, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: SRC_CAMBIOS,
        type: "circle",
        source: SRC_CAMBIOS,
        paint: {
          "circle-radius": 6,
          "circle-color": "#ffffff",
          "circle-stroke-width": 3,
          // El relevo de operador y el cambio de máquina se distinguen por
          // color: son dos hechos distintos y a veces ocurren en el mismo sitio.
          "circle-stroke-color": [
            "match",
            ["get", "tipo"],
            "relevo",
            "#7b4fd0",
            "#eb6834",
          ],
        },
      });
      map.addLayer({
        id: CAPA_CAMBIOS_HORA,
        type: "symbol",
        source: SRC_CAMBIOS,
        layout: {
          "text-field": ["get", "hora"],
          "text-font": FUENTE,
          "text-size": 11,
          "text-offset": [0, -1.3],
          "text-allow-overlap": true,
        },
        paint: {
          "text-color": "#ffffff",
          "text-halo-color": "#0b1120",
          "text-halo-width": 1.8,
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
    cbRef.current.onMap?.(map);

    // El contenedor arranca con alto 0 mientras Next monta el layout, y además
    // cambia al abrir o cerrar el panel lateral. Un ResizeObserver es la única
    // forma robusta de mantener el canvas a la medida real.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(divRef.current);

    return () => {
      ro.disconnect();
      pendingRef.current = [];
      cbRef.current.onMap?.(null);
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
      redRef.current.clear();
    };
  }, []);

  // --- Antenas de la red mesh ---
  // Se pintan en los dos modos: son infraestructura instalada, no dependen del
  // día que se esté mirando. El estado sale de `v_mesh_health`, así que el
  // marcador cambia de color solo cuando el gateway sondea.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const pintar = () => {
      const src = map.getSource(SRC_RED) as GeoJSONSource | undefined;
      src?.setData(redGeoJSON(sitios));
    };
    whenReady(pintar);

    const vistos = new Set<string>();
    for (const s of sitios) {
      // Sin coordenada no hay nada que dibujar. Sale igual en la base con
      // estado "sin_datos", que es donde se ve que le falta el pin.
      if (s.lat == null || s.lon == null) continue;
      vistos.add(s.site_id);

      let mk = redRef.current.get(s.site_id);
      if (!mk) {
        const el = document.createElement("div");
        el.className = "antena-marker";
        mk = new Marker({ element: el, anchor: "center" })
          .setLngLat([s.lon, s.lat])
          .addTo(map);
        redRef.current.set(s.site_id, mk);
      } else {
        mk.setLngLat([s.lon, s.lat]);
      }

      const el = mk.getElement();
      el.innerHTML = antenaHTML({
        rol: s.role,
        color: COLOR_RED,
        sitio: s.site_name,
        estado: s.estado,
      });
      el.title = tituloSitio(s);
    }

    redRef.current.forEach((mk, id) => {
      if (!vistos.has(id)) {
        mk.remove();
        redRef.current.delete(id);
      }
    });
  }, [sitios, whenReady]);

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
        // Una feature por pieza cuando el nodo cambió de máquina, y una sola
        // para el día cuando no. Todas llevan el mismo `nodeId`, así que el
        // clic y el resalte del seleccionado siguen funcionando igual.
        features: trails.flatMap((t) => {
          const piezas =
            t.piezas && t.piezas.length > 1
              ? t.piezas
              : [{ color: t.color, latlngs: t.latlngs, ruta: t.ruta ?? null }];

          return piezas
            .filter((p) => (p.ruta ?? p.latlngs).length >= 2)
            .map((p) => ({
              type: "Feature" as const,
              properties: { nodeId: t.nodeId, color: p.color },
              geometry: {
                type: "LineString" as const,
                // GeoJSON va en [lon, lat]; los datos vienen en [lat, lon].
                coordinates: (p.ruta ?? p.latlngs).map(([la, lo]) => [lo, la]),
              },
            }));
        }),
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

  // --- Pines de cambio de máquina / operador ---
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const pintar = () => {
      const src = map.getSource(SRC_CAMBIOS) as GeoJSONSource | undefined;
      src?.setData({
        type: "FeatureCollection",
        features: cambios.map((c) => ({
          type: "Feature" as const,
          properties: { hora: c.hora, tipo: c.tipo },
          geometry: { type: "Point" as const, coordinates: [c.lon, c.lat] },
        })),
      });
    };
    whenReady(pintar);
  }, [cambios, whenReady]);

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
      const id = item.node.node_id;
      // Un puesto fijo se dibuja en su coordenada declarada (lib/puestos.ts) y
      // no en su último fix: el nodo no se mueve, pero su GPS sí lo hace por
      // ruido, y una portería que baila sobre el lote no informa nada. Por lo
      // mismo se dibuja aunque el nodo no haya entregado coordenadas nunca:
      // dónde está no depende de que reporte.
      const puesto = puestoDe(id);
      // Sin coordenadas no hay nada honesto que dibujar: la máquina existe pero
      // su ubicación no. Aparece en el panel FLOTA como "Sin GPS", no aquí.
      if (!puesto && !item.posicion) continue;
      vistos.add(id);

      const maq = maquinaDe(id, item.node.long_name, item.node.short_name);
      const html = markerHTML({
        tipo: maq.tipo,
        color: maq.color,
        codigo: maq.codigo,
        estado: item.estado,
        rumbo: puesto ? null : item.rumbo,
      });
      const lngLat: [number, number] = puesto
        ? [puesto.lon, puesto.lat]
        : [item.posicion!.lon, item.posicion!.lat];

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
      // La identidad viene resuelta AL MINUTO que se está reproduciendo; sólo
      // si no llega se cae al registro vigente, que es el del cierre del día.
      const maq = maquinaDe(pos.nodeId);
      const color =
        pos.color ?? trails.find((t) => t.nodeId === pos.nodeId)?.color ?? maq.color;
      const html = markerHTML({
        tipo: pos.tipo ?? maq.tipo,
        color,
        codigo: pos.codigo ?? maq.codigo,
        estado: pos.moviendo ? "activa" : "detenida",
        rumbo: pos.rumbo,
      });

      let mk = replayRef.current.get(pos.nodeId);
      if (!mk) {
        const el = document.createElement("div");
        el.className = "machine-marker replay-marker";
        // El marcador del replay se toca igual que el de en vivo: clic
        // selecciona y doble clic abre el universo. Sin esto, en histórico la
        // máquina se ve en el mapa pero sólo se puede elegir desde la lista.
        attachClicks(el, pos.nodeId, cbRef);
        mk = new Marker({ element: el, anchor: "center" })
          .setLngLat([pos.lon, pos.lat])
          .addTo(map);
        replayRef.current.set(pos.nodeId, mk);
      } else {
        mk.setLngLat([pos.lon, pos.lat]);
      }
      const elMk = mk.getElement();
      elMk.innerHTML = html;
      // Fuera de jornada el marcador se atenúa: sigue ubicando a la máquina en
      // el mapa sin afirmar que a esa hora estaba ahí.
      elMk.classList.toggle("fuera-jornada", !!pos.fuera);
      elMk.title = `${maq.nombre} · ${maq.codigo}
${
        pos.fuera
          ? "Fuera de su jornada a esta hora"
          : pos.moviendo
            ? "En movimiento"
            : "Detenida"
      }`;
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
      if (item) empujar(item);
    } else {
      trails.forEach((t) => t.latlngs.forEach(([la, lo]) => push(lo, la)));
      fleet?.forEach(empujar);
    }

    // El encuadre tiene que apuntar a donde está dibujado el marcador, que para
    // un puesto fijo es su coordenada declarada y no la del último fix.
    function empujar(f: FleetItem) {
      const puesto = puestoDe(f.node.node_id);
      if (puesto) push(puesto.lon, puesto.lat);
      else if (f.posicion) push(f.posicion.lon, f.posicion.lat);
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

/**
 * Tooltip de una antena: lo que hace falta para decidir si hay que ir al sitio.
 *
 * Incluye la ruta medida del último sondeo porque es el dato que no se puede
 * deducir del mapa: "!9ea29bc4 --> !ffffffff --> !49b54350" dice que ese sitio
 * no llega directo a la torre aunque la línea punteada lo sugiera.
 */
function tituloSitio(s: SitioRed): string {
  const meta = metaDe(s.estado);
  return [
    `${s.site_name}${s.node_id ? ` · ${s.node_id}` : ""}`,
    s.role === "gateway"
      ? "Gateway (backhaul Starlink)"
      : `Repetidor · ${fmtDistKm(s.dist_gateway_m)} del gateway`,
    `Enlace: ${meta.label} — ${meta.ayuda}`,
    s.min_sin_senal != null ? `Última señal: hace ${s.min_sin_senal} min` : "",
    s.rtt_ms != null ? `Respuesta: ${(s.rtt_ms / 1000).toFixed(1)} s` : "",
    s.route_text ? `Ruta medida: ${s.route_text}` : "",
    s.fallos_consecutivos > 0
      ? `Sondeos fallidos seguidos: ${s.fallos_consecutivos}`
      : "",
    s.notes ? `⚠ ${s.notes}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}
