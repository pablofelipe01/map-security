"use client";

import { useCallback, useEffect, useRef } from "react";
import {
  Map as MapLibreMap,
  type GeoJSONSource,
  type MapMouseEvent,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_CENTER } from "@/lib/geo";

/**
 * El mapa de la pantalla de despacho.
 *
 * NO es `components/MapGL.tsx` con props nuevas, y la diferencia es de fondo:
 * aquél dibuja lo que se midió —rastros, estadías, estados de nodo— y está
 * construido alrededor de esa idea. Éste dibuja lo que se decidió. Comparten la
 * imagen satelital, las vías y los acopios porque es el mismo predio, pero
 * encima va otra cosa: rutas propuestas y paradas numeradas, sin ningún estado
 * de telemetría.
 *
 * Meterlo en MapGL habría significado un tercer modo dentro de un archivo de
 * 1.400 líneas que ya sostiene el vivo, el histórico y el replay, y cada capa
 * nueva tendría que preguntarse en cuál de los tres está.
 *
 * Lo que sí se comparte de verdad es la fuente: el mismo GeoJSON de vías y el
 * mismo de acopios, por URL. Dos archivos distintos serían dos mapas que un día
 * discrepan.
 */

/** Los mismos archivos que pinta la torre. Ver `components/MapGL.tsx`. */
const VIAS_URL = "/vias-guaicaramo.geojson";
const ACOPIOS_URL = "/acopios-guaicaramo.geojson";

const SRC_VIAS = "vias";
const SRC_ACOPIOS = "acopios";
const SRC_RUTAS = "plan-rutas";
const SRC_PARADAS = "plan-paradas";
const SRC_MAQUINAS = "plan-maquinas";

/** La única familia con glifos servidos en `public/fonts`. */
const FUENTE = ["Open Sans Semibold"];

const FC_VACIA = { type: "FeatureCollection" as const, features: [] };

/** Verde apagado de los acopios en la torre: el mismo, para no reeducar el ojo. */
const ACOPIOS_COLOR = "#bcd983";

export interface ParadaMapa {
  lat: number;
  lon: number;
  orden: number;
  codigo: string;
  color: string;
  /** Atenúa las que ya se cerraron: lo pendiente es lo que hay que mirar. */
  completada: boolean;
}

export interface RutaMapa {
  maquinaId: string;
  color: string;
  /** Polilínea completa de la ruta propuesta, [lat, lon]. */
  latlngs: [number, number][];
  /**
   * true = algún tramo no se pudo resolver por la malla vial y va en recta.
   * Se dibuja punteada: una recta de tres kilómetros sobre el cultivo no es una
   * ruta, es la falta de una, y el mapa no debe hacerla pasar por una.
   */
  aproximada: boolean;
}

export interface MaquinaMapa {
  maquinaId: string;
  codigo: string;
  color: string;
  lat: number;
  lon: number;
  /** Minutos desde el último fix. Se rotula para no fingir que es "ahora". */
  edadMin: number | null;
}

interface Props {
  rutas: RutaMapa[];
  paradas: ParadaMapa[];
  maquinas: MaquinaMapa[];
  /** Clic sobre el mapa: la pantalla lo traduce al acopio más cercano. */
  onClickMapa?: (lat: number, lon: number) => void;
  /** Cambia para pedir que encuadre lo que hay dibujado. */
  encuadreToken?: number;
}

/** Puntos sueltos a FeatureCollection: lo que sobre de cada item va a properties. */
function fcPuntos<T extends { lat: number; lon: number }>(items: T[]) {
  return {
    type: "FeatureCollection" as const,
    features: items.map(({ lat, lon, ...props }) => ({
      type: "Feature" as const,
      geometry: { type: "Point" as const, coordinates: [lon, lat] },
      properties: props as Record<string, unknown>,
    })),
  };
}

export default function MapaPlan({
  rutas,
  paradas,
  maquinas,
  onClickMapa,
  encuadreToken = 0,
}: Props) {
  const divRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const listoRef = useRef(false);
  // Los datos pueden llegar antes de que el estilo termine de cargar. Mismo
  // patrón que MapGL: se encola y se ejecuta en el `load`.
  const colaRef = useRef<(() => void)[]>([]);
  // Handler fresco sin recrear el mapa.
  const clickRef = useRef(onClickMapa);
  clickRef.current = onClickMapa;

  const cuandoListo = useCallback((fn: () => void) => {
    if (listoRef.current) fn();
    else colaRef.current.push(fn);
  }, []);

  /* --------------------------- crear una vez --------------------------- */
  useEffect(() => {
    if (mapRef.current || !divRef.current) return;

    const map = new MapLibreMap({
      container: divRef.current,
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
            // La imagen de Esri sobre Guaicaramo llega hasta z18; declarar el
            // techo real hace que MapLibre estire la de z18 en vez de pedir
            // teselas que no existen (ver MapGL).
            maxzoom: 18,
            attribution: "Imagery © Esri",
          },
          [SRC_VIAS]: { type: "geojson", data: VIAS_URL },
          [SRC_ACOPIOS]: { type: "geojson", data: ACOPIOS_URL },
          [SRC_RUTAS]: { type: "geojson", data: FC_VACIA },
          [SRC_PARADAS]: { type: "geojson", data: FC_VACIA },
          [SRC_MAQUINAS]: { type: "geojson", data: FC_VACIA },
        },
        layers: [
          { id: "esri", type: "raster", source: "esri" },

          // Las vías van tenues: aquí son el contexto por el que se propone
          // pasar, no el protagonista. En la torre pesan más porque allá son la
          // evidencia de por dónde fue la máquina.
          {
            id: "vias",
            type: "line",
            source: SRC_VIAS,
            filter: ["!=", ["get", "TIPO"], "Proyectada"],
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#fde68a",
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 0.6, 16, 2.4],
              "line-opacity": 0.45,
            },
          },

          // Todos los acopios del predio, como referencia de dónde se puede
          // mandar. Los que están en el plan se repintan encima.
          {
            id: "acopios",
            type: "circle",
            source: SRC_ACOPIOS,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 1.6, 16, 4],
              "circle-color": ACOPIOS_COLOR,
              "circle-opacity": 0.75,
              "circle-stroke-width": 0.6,
              "circle-stroke-color": "#1a1a33",
            },
          },

          // --- el plan ---
          // Filete oscuro debajo de la ruta: sin él, una línea de color claro se
          // pierde sobre los caminos claros de la propia imagen satelital.
          {
            id: "rutas-borde",
            type: "line",
            source: SRC_RUTAS,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": "#1a1a33",
              "line-opacity": 0.5,
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 4, 16, 9],
            },
          },
          {
            id: "rutas",
            type: "line",
            source: SRC_RUTAS,
            layout: { "line-cap": "round", "line-join": "round" },
            paint: {
              "line-color": ["get", "color"],
              "line-width": ["interpolate", ["linear"], ["zoom"], 11, 2, 16, 5],
              // Punteada cuando el tramo no se resolvió por vías. El patrón va
              // en unidades de ancho de línea, así que se lee igual a toda escala.
              "line-dasharray": [
                "case",
                ["get", "aproximada"],
                ["literal", [1.5, 1.2]],
                ["literal", [1, 0]],
              ],
            },
          },

          // Paradas: círculo con el número de orden adentro. El número es la
          // única forma de leer la secuencia en el mapa — sin él, una ruta que
          // se cruza consigo misma no se puede seguir.
          {
            id: "paradas",
            type: "circle",
            source: SRC_PARADAS,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 7, 16, 13],
              "circle-color": ["get", "color"],
              "circle-opacity": ["case", ["get", "completada"], 0.45, 1],
              "circle-stroke-width": 2,
              "circle-stroke-color": "#ffffff",
            },
          },
          {
            id: "paradas-orden",
            type: "symbol",
            source: SRC_PARADAS,
            layout: {
              "text-field": ["to-string", ["get", "orden"]],
              "text-font": FUENTE,
              "text-size": ["interpolate", ["linear"], ["zoom"], 11, 9, 16, 14],
              "text-allow-overlap": true,
            },
            paint: { "text-color": "#ffffff" },
          },
          // El código del acopio sólo cuando ya se está mirando de cerca: a
          // escala de predio, 40 rótulos tapan el mapa.
          {
            id: "paradas-codigo",
            type: "symbol",
            source: SRC_PARADAS,
            minzoom: 14,
            layout: {
              "text-field": ["get", "codigo"],
              "text-font": FUENTE,
              "text-size": 11,
              "text-offset": [0, 1.3],
              "text-anchor": "top",
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#1a1a33",
              "text-halo-width": 1.4,
            },
          },

          // Dónde está hoy cada máquina. Cuadrado para que no se confunda con
          // una parada, que es redonda: uno es un hecho medido y la otra una
          // decisión.
          {
            id: "maquinas",
            type: "circle",
            source: SRC_MAQUINAS,
            paint: {
              "circle-radius": ["interpolate", ["linear"], ["zoom"], 11, 5, 16, 9],
              "circle-color": ["get", "color"],
              "circle-stroke-width": 2.5,
              "circle-stroke-color": "#1a1a33",
            },
          },
          {
            id: "maquinas-etiq",
            type: "symbol",
            source: SRC_MAQUINAS,
            layout: {
              "text-field": ["get", "etiqueta"],
              "text-font": FUENTE,
              "text-size": 11,
              "text-offset": [0, -1.4],
              "text-anchor": "bottom",
              "text-allow-overlap": true,
            },
            paint: {
              "text-color": "#ffffff",
              "text-halo-color": "#1a1a33",
              "text-halo-width": 1.6,
            },
          },
        ],
      },
      center: [DEFAULT_CENTER.lng, DEFAULT_CENTER.lat],
      zoom: 12,
      attributionControl: { compact: true },
    });

    map.on("load", () => {
      listoRef.current = true;
      for (const fn of colaRef.current) fn();
      colaRef.current = [];
    });

    map.on("click", (e: MapMouseEvent) => {
      clickRef.current?.(e.lngLat.lat, e.lngLat.lng);
    });
    // El cursor avisa que el mapa es accionable: sin esto nadie descubre que se
    // puede señalar un acopio con el clic.
    map.getCanvas().style.cursor = "crosshair";

    mapRef.current = map;

    return () => {
      map.remove();
      mapRef.current = null;
      listoRef.current = false;
    };
  }, []);

  /* ------------------------------ datos ------------------------------ */

  useEffect(() => {
    cuandoListo(() => {
      const src = mapRef.current?.getSource(SRC_RUTAS) as GeoJSONSource | undefined;
      if (src) {
        src.setData({
          type: "FeatureCollection",
          features: rutas
            .filter((r) => r.latlngs.length >= 2)
            .map((r) => ({
              type: "Feature" as const,
              geometry: {
                type: "LineString" as const,
                coordinates: r.latlngs.map(([lat, lon]) => [lon, lat]),
              },
              properties: { color: r.color, aproximada: r.aproximada },
            })),
        });
      }
    });
  }, [rutas, cuandoListo]);

  useEffect(() => {
    cuandoListo(() => {
      const src = mapRef.current?.getSource(SRC_PARADAS) as GeoJSONSource | undefined;
      src?.setData(fcPuntos(paradas));
    });
  }, [paradas, cuandoListo]);

  useEffect(() => {
    cuandoListo(() => {
      const src = mapRef.current?.getSource(SRC_MAQUINAS) as GeoJSONSource | undefined;
      if (src) {
        src.setData(
          fcPuntos(
            maquinas.map((m) => ({
              lat: m.lat,
              lon: m.lon,
              color: m.color,
              // La edad va pegada al código a propósito: el punto es la última
              // posición CONFIRMADA, no dónde está la máquina ahora, y ése es el
              // mismo compromiso que sostiene la torre.
              etiqueta:
                m.edadMin == null
                  ? m.codigo
                  : `${m.codigo} · hace ${Math.round(m.edadMin)} min`,
            }))
          )
        );
      }
    });
  }, [maquinas, cuandoListo]);

  /* ----------------------------- encuadre ----------------------------- */

  useEffect(() => {
    if (encuadreToken === 0) return;
    cuandoListo(() => {
      const map = mapRef.current;
      if (!map) return;

      const pts: [number, number][] = [
        ...paradas.map((p) => [p.lon, p.lat] as [number, number]),
        ...maquinas.map((m) => [m.lon, m.lat] as [number, number]),
      ];
      if (pts.length === 0) return;

      let [oeste, sur] = pts[0];
      let [este, norte] = pts[0];
      for (const [x, y] of pts) {
        oeste = Math.min(oeste, x);
        este = Math.max(este, x);
        sur = Math.min(sur, y);
        norte = Math.max(norte, y);
      }

      map.fitBounds(
        [
          [oeste, sur],
          [este, norte],
        ],
        { padding: 60, maxZoom: 16, duration: 600 }
      );
    });
    // `paradas` y `maquinas` quedan fuera a propósito: el encuadre se pide con
    // el token, no cada vez que cambia un dato. Encuadrar solo cada minuto le
    // movería el mapa al coordinador mientras trabaja.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encuadreToken, cuandoListo]);

  return <div ref={divRef} className="absolute inset-0" />;
}
