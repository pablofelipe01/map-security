import type {
  GeoJSONSource,
  Map as MapLibreMap,
  VisibilitySpecification,
} from "maplibre-gl";
import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import {
  CAPA_EXTREMOS,
  CAPA_RASTROS,
  CAPA_RED,
  CAPA_RED_ETIQ,
  CAPA_CAMBIOS,
  CAPA_CAMBIOS_HORA,
  CAPA_VIDEO_AVANCE,
  CAPA_VIDEO_RUTA,
  SRC_VIDEO_AVANCE,
  SRC_VIDEO_RUTA,
} from "./capas";
import { MOVIMIENTO_M } from "./fleet";
import { haversineM } from "./geo";
import { machineSVG } from "./icons";
import { minuteOfDay, positionAt, ventanaConDatos } from "./replay";
import type { Tramo } from "./rutas";
import type { TipoMaquina } from "./tractores";
import type { TrackPoint } from "./types";

/**
 * Exportar el recorrido de un nodo como video.
 *
 * QUÉ ES Y QUÉ NO ES. El video se graba del mapa que está en pantalla: se
 * recorre la jornada del nodo minuto a minuto con la misma función que alimenta
 * el replay (`positionAt`), se pinta el avance sobre el mapa y se captura cada
 * cuadro. Por lo tanto hereda exactamente las mismas limitaciones que la barra
 * de replay: entre fix y fix la posición es interpolada, y con huecos largos la
 * máquina se queda quieta. El HUD lo dice dentro del propio video, porque un
 * archivo se comparte suelto y entonces ya no hay app alrededor que lo advierta.
 *
 * POR QUÉ SE CAPTURA EL CANVAS. La alternativa sería armar el video cuadro a
 * cuadro fuera del mapa, pero eso obligaría a redibujar por nuestra cuenta las
 * teselas satelitales, las vías y los rótulos: sería un segundo renderizador que
 * se iría desincronizando del real. Capturando el canvas, el video muestra
 * literalmente lo que la app muestra.
 *
 * POR QUÉ MP4 Y NO WEBM. El video se comparte y se ve en teléfonos, y iOS no
 * reproduce WebM: en un iPhone el archivo sencillamente no abre. Así que la
 * salida es H.264 dentro de MP4, que reproducen iPhone, Android, WhatsApp,
 * PowerPoint y QuickTime sin convertir nada. Ver `crearSalida`.
 */

/** Cuadros por segundo del video. */
export const FPS = 30;

/** Duraciones ofrecidas, en segundos. */
export const DURACIONES = [10, 15, 25] as const;
export const DURACION_DEFECTO = 15;

/** Cuadros que se sostienen al final, con el recorrido completo a la vista. */
const CUADROS_COLA = Math.round(FPS * 0.9);

/**
 * Ancho máximo del video (px).
 *
 * 1920 es a la vez el techo de lo que aporta en pantalla y un formato que todo
 * iPhone decodifica por hardware sin despeinarse. Subirlo engordaría el archivo
 * y arriesgaría que un teléfono viejo lo reprodujera a tirones.
 */
const ANCHO_MAX = 1920;

/**
 * Bits por píxel y por cuadro.
 *
 * La imagen satelital es ruido de alta frecuencia —hojas, sombras, texturas de
 * lote— y con la cámara en movimiento un bitrate de videollamada la convierte en
 * bloques. 0.15 bpp deja 1080p30 en ~9 Mb/s: pesado para un correo, correcto
 * para lo que el video es, que es mirar por dónde pasó la máquina.
 */
const BPP = 0.15;
const BITRATE_MAX = 16_000_000;

/** Cada cuántos segundos va un cuadro clave (permite saltar en la línea de tiempo). */
const SEG_CLAVE = 2;

/** Cuánto se le da al codificador para demostrar que funciona, antes de descartarlo. */
const PRUEBA_MS = 4000;

/** Zoom de la cámara cuando sigue a la máquina. */
const ZOOM_SEGUIMIENTO = 15.5;

/**
 * Perfiles de H.264 a intentar, del más compatible al más exigente.
 *
 * Baseline lo reproduce cualquier iPhone, incluso viejo: se pide primero y sólo
 * se baja a Main o High si el codificador de esta máquina no ofrece Baseline
 * (algunos codificadores por hardware sólo exponen High). Los tres se
 * reproducen en iOS moderno; el orden busca el más seguro, no el mejor.
 */
const CODECS_H264 = [
  "avc1.42002A", // Baseline 4.2
  "avc1.4D002A", // Main 4.2
  "avc1.640028", // High 4.0
];

/**
 * Tipos MIME del respaldo por `MediaRecorder`, del mejor al peor.
 *
 * Chrome y Edge recientes graban MP4 directamente; lo que viene después es
 * WebM, que NO abre en iPhone y por eso se marca como tal en la UI en vez de
 * entregarse como si nada.
 */
const MIMES_GRABADOR = [
  "video/mp4;codecs=avc1.42002A",
  "video/mp4;codecs=avc1",
  "video/mp4",
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
];

export type Formato = "mp4" | "webm";

export interface SoporteVideo {
  ok: boolean;
  formato?: Formato;
  /** true si el archivo se reproduce en iPhone (es decir, si es MP4). */
  iphone: boolean;
  /** Explicación para mostrar en pantalla cuando no se puede grabar. */
  motivo?: string;
}

/**
 * Qué puede producir este navegador, sin grabar nada.
 *
 * Es una comprobación optimista para pintar la UI: si hay WebCodecs se anuncia
 * MP4, aunque el perfil concreto de H.264 sólo se confirma al empezar a grabar
 * (`isConfigSupported` es asíncrono). Si ahí fallara, `crearSalida` baja al
 * respaldo, y el resultado dice con qué formato salió de verdad.
 */
export function soporteVideo(): SoporteVideo {
  if (typeof window === "undefined")
    return { ok: false, iphone: false, motivo: "Sin navegador" };

  if (typeof VideoEncoder !== "undefined")
    return { ok: true, formato: "mp4", iphone: true };

  if (typeof MediaRecorder === "undefined")
    return {
      ok: false,
      iphone: false,
      motivo: "Este navegador no puede grabar video.",
    };

  const mime = MIMES_GRABADOR.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime)
    return {
      ok: false,
      iphone: false,
      motivo: "Este navegador no puede codificar video. Usa Chrome o Edge.",
    };

  const esMp4 = mime.startsWith("video/mp4");
  return { ok: true, formato: esMp4 ? "mp4" : "webm", iphone: esMp4 };
}

export interface OpcionesVideo {
  /** Duración objetivo del video, en segundos. */
  segundos: number;
  /** true = la cámara persigue a la máquina; false = encuadra todo el recorrido. */
  seguir: boolean;
}

export interface TrabajoVideo {
  map: MapLibreMap;
  /** Puntos del día para ese nodo, en orden cronológico. */
  points: TrackPoint[];
  /** Tramos ruteados por la malla vial, si ya se calcularon. */
  tramos?: Tramo[] | null;
  /** Recorrido completo a dibujar de fondo, como [lat, lon]. */
  ruta: [number, number][];
  nombre: string;
  codigo: string;
  color: string;
  tipo: TipoMaquina;
  /** Día que se está grabando ("YYYY-MM-DD"). */
  fecha: string;
  opciones: OpcionesVideo;
  /** Avance de 0 a 1. */
  onProgreso?: (p: number) => void;
  /** Se consulta en cada cuadro: si devuelve true, la grabación se aborta. */
  cancelado?: () => boolean;
}

/** Error con el que se distingue una cancelación de una falla real. */
export class VideoCancelado extends Error {
  constructor() {
    super("Grabación cancelada");
    this.name = "VideoCancelado";
  }
}

export interface ResultadoVideo {
  blob: Blob;
  archivo: string;
  /** Formato con el que salió de verdad, que manda sobre lo que anunció la UI. */
  formato: Formato;
  /** true si el archivo se reproduce en iPhone. */
  iphone: boolean;
}

/**
 * Graba el recorrido y devuelve el archivo listo para descargar.
 *
 * Deja el mapa como lo encontró —cámara, capas y marcadores— incluso si falla o
 * se cancela: todo el desmontaje vive en el `finally`.
 */
export async function grabarRutaVideo(t: TrabajoVideo): Promise<ResultadoVideo> {
  const ventana = ventanaConDatos([{ points: t.points }]);
  if (!ventana || t.ruta.length < 2)
    throw new Error("Este nodo no tiene recorrido para ese día.");

  const { map } = t;
  const lienzoMapa = map.getCanvas();
  const { lienzo, ctx } = crearLienzo(lienzoMapa);
  // De píxeles CSS (los que devuelve `map.project`) a píxeles del video.
  const escala = lienzo.width / Math.max(1, lienzoMapa.clientWidth);

  const icono = await cargarIcono(t.tipo, t.color);
  const acumulado = distanciasAcumuladas(t.points);

  // Estado del mapa que hay que devolver como estaba.
  const camara = {
    center: map.getCenter(),
    zoom: map.getZoom(),
    bearing: map.getBearing(),
    pitch: map.getPitch(),
  };
  const visibles = new Map<string, VisibilitySpecification | undefined>();
  const contenedor = map.getContainer();

  let salida: Salida | null = null;

  try {
    // Los rastros de las demás máquinas estorban: el video es de un nodo, y la
    // línea de otro tractor sobre el mismo lote se lee como si fuera del que se
    // está mostrando. Los enlaces de la mesh se apagan por lo mismo: cruzan el
    // predio de lado a lado y en el video se leerían como parte del recorrido.
    for (const capa of [
      CAPA_RASTROS,
      CAPA_EXTREMOS,
      CAPA_RED,
      CAPA_RED_ETIQ,
      CAPA_CAMBIOS,
      CAPA_CAMBIOS_HORA,
    ]) {
      if (!map.getLayer(capa)) continue;
      visibles.set(
        capa,
        map.getLayoutProperty(capa, "visibility") as
          | VisibilitySpecification
          | undefined
      );
      map.setLayoutProperty(capa, "visibility", "none");
    }
    // Los marcadores son HTML sobre el canvas: no entran en la captura, así que
    // dejarlos visibles sólo confundiría a quien mira la pantalla mientras graba.
    contenedor.classList.add("grabando");

    montarCapas(map, t);

    const coords = t.ruta.map(([la, lo]) => [lo, la] as [number, number]);
    encuadrar(map, coords, t.opciones.seguir);
    await esperarIdle(map, 6000);

    salida = await crearSalida(lienzo);

    const total = Math.max(2, Math.round(t.opciones.segundos * FPS));
    const inicio = performance.now();
    const msCuadro = 1000 / FPS;
    const avance: [number, number][] = [];
    const fuenteAvance = map.getSource(SRC_VIDEO_AVANCE) as
      | GeoJSONSource
      | undefined;

    for (let i = 0; i < total + CUADROS_COLA; i++) {
      if (t.cancelado?.()) throw new VideoCancelado();

      // Los cuadros de cola repiten el último minuto: el recorrido completo
      // queda a la vista un instante antes de que el archivo corte.
      const f = Math.min(1, i / (total - 1));
      const minuto = ventana.desde + (ventana.hasta - ventana.desde) * f;
      const pos = positionAt(t.points, minuto, t.tramos);

      if (pos) {
        const ultimo = avance[avance.length - 1];
        if (!ultimo || ultimo[0] !== pos.lon || ultimo[1] !== pos.lat)
          avance.push([pos.lon, pos.lat]);
        fuenteAvance?.setData(lineaDe(avance));
        if (t.opciones.seguir) map.jumpTo({ center: [pos.lon, pos.lat] });
      }

      await esperarRender(map);
      // Siguiendo a la máquina hacen falta teselas nuevas todo el tiempo. Con
      // WebCodecs se le puede dar al mapa tiempo de traerlas, porque el reloj
      // del video lo ponemos nosotros y tardar más sólo alarga la exportación.
      // Con `MediaRecorder` el reloj es el de pared: esperar ahí saldría como
      // cámara lenta, así que allí se prefiere una tesela a medio cargar.
      if (t.opciones.seguir && !salida.tiempoReal) await esperarIdle(map, 250);

      ctx.drawImage(lienzoMapa, 0, 0, lienzo.width, lienzo.height);
      dibujarMaquina(ctx, map, pos, icono, t.color, escala);
      dibujarHUD(ctx, {
        ancho: lienzo.width,
        alto: lienzo.height,
        k: escala,
        nombre: t.nombre,
        codigo: t.codigo,
        color: t.color,
        fecha: t.fecha,
        minuto,
        metros: metrosEn(acumulado, minuto),
        progreso: f,
      });

      await salida.cuadro(i);
      t.onProgreso?.(i / (total + CUADROS_COLA));
      if (salida.tiempoReal) await esperarHasta(inicio + (i + 1) * msCuadro);
    }

    const blob = await salida.cerrar();
    const formato = salida.formato;
    salida = null;
    return {
      blob,
      formato,
      iphone: formato === "mp4",
      archivo: nombreArchivo(t.codigo, t.fecha, formato),
    };
  } finally {
    salida?.abortar();
    desmontarCapas(map);
    visibles.forEach((v, capa) => {
      if (map.getLayer(capa))
        map.setLayoutProperty(capa, "visibility", v ?? "visible");
    });
    contenedor.classList.remove("grabando");
    map.jumpTo(camara);
  }
}

/** Dispara la descarga del archivo generado. */
export function descargar(blob: Blob, archivo: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = archivo;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // El objeto se libera tarde a propósito: revocarlo de inmediato cancela la
  // descarga en algunos navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/* ========================= codificación ========================= */

/**
 * A dónde van los cuadros ya dibujados.
 *
 * Hay dos implementaciones porque hay dos caminos hasta un MP4, y la diferencia
 * que importa entre ellas no es el formato sino el reloj: con WebCodecs las
 * marcas de tiempo las ponemos nosotros, y con `MediaRecorder` las pone el reloj
 * de pared. De ahí `tiempoReal`, que el bucle de captura consulta para decidir
 * si tiene que ir al ritmo del video o puede ir a su aire.
 */
interface Salida {
  formato: Formato;
  /** true = el codificador cronometra por reloj de pared (MediaRecorder). */
  tiempoReal: boolean;
  /** Entrega el cuadro `i`, ya dibujado en el lienzo. */
  cuadro(i: number): Promise<void> | void;
  cerrar(): Promise<Blob>;
  /** Suelta los recursos sin producir archivo (cancelación o error). */
  abortar(): void;
}

/**
 * Elige el mejor camino disponible hacia un archivo reproducible en iPhone.
 *
 * 1. WebCodecs + muxer MP4: H.264 de verdad, con el bitrate y los cuadros clave
 *    bajo nuestro control y sin depender del reloj de pared.
 * 2. `MediaRecorder` en MP4: lo que traen Chrome y Edge recientes.
 * 3. `MediaRecorder` en WebM: último recurso. NO abre en iPhone, y el resultado
 *    lo declara para que la UI lo advierta en vez de entregar un archivo que el
 *    destinatario no va a poder ver.
 */
async function crearSalida(lienzo: HTMLCanvasElement): Promise<Salida> {
  const porWebCodecs = await salidaWebCodecs(lienzo);
  if (porWebCodecs) return porWebCodecs;

  const porGrabador = salidaGrabador(lienzo);
  if (porGrabador) return porGrabador;

  throw new Error("Este navegador no puede codificar video. Usa Chrome o Edge.");
}

/** Codificación H.264 propia, empaquetada en MP4. Devuelve null si no se puede. */
async function salidaWebCodecs(
  lienzo: HTMLCanvasElement
): Promise<Salida | null> {
  if (typeof VideoEncoder === "undefined") return null;

  const ancho = lienzo.width;
  const alto = lienzo.height;
  const bitrate = Math.min(BITRATE_MAX, Math.round(ancho * alto * FPS * BPP));

  let config: VideoEncoderConfig | null = null;
  for (const codec of CODECS_H264) {
    const intento: VideoEncoderConfig = {
      codec,
      width: ancho,
      height: alto,
      bitrate,
      framerate: FPS,
      // El muxer espera las muestras en formato AVCC (con prefijo de longitud),
      // que es lo que va dentro de un MP4; `annexb` produciría un archivo que
      // ningún reproductor abre.
      avc: { format: "avc" },
      latencyMode: "quality",
    };
    try {
      const { supported } = await VideoEncoder.isConfigSupported(intento);
      if (!supported) continue;
      // `isConfigSupported` responde por la plataforma, no por el codificador
      // que de verdad se va a instanciar: se lo ha visto decir que sí y después
      // tragarse los cuadros sin devolver nada (pasa cuando el codificador por
      // hardware no está disponible de verdad). Un cuadro de prueba distingue
      // el "sí" real del teórico, y así se puede caer al respaldo ANTES de
      // grabar en vez de colgarse a la mitad.
      if (!(await codificadorUtilizable(intento, lienzo))) continue;
      config = intento;
      break;
    } catch {
      // Perfil rechazado de plano: se prueba el siguiente.
    }
  }
  if (!config) return null;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: "avc", width: ancho, height: alto, frameRate: FPS },
    // Deja la tabla de índices al principio del archivo. Es lo que permite que
    // un iPhone o WhatsApp empiecen a reproducir sin descargarlo entero, y que
    // QuickTime no lo declare corrupto.
    fastStart: "in-memory",
  });

  let fallo: Error | null = null;
  const enc = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => {
      fallo = e as Error;
    },
  });
  enc.configure(config);

  const dur = Math.round(1_000_000 / FPS);
  const cadaClave = FPS * SEG_CLAVE;

  return {
    formato: "mp4",
    tiempoReal: false,
    async cuadro(i) {
      if (fallo) throw fallo;
      // El codificador puede ir más lento que el dibujo: encolar sin mirar
      // dispararía la memoria en un video largo.
      while (enc.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 4));
      const frame = new VideoFrame(lienzo, {
        timestamp: i * dur,
        duration: dur,
      });
      try {
        enc.encode(frame, { keyFrame: i % cadaClave === 0 });
      } finally {
        frame.close();
      }
    },
    async cerrar() {
      await enc.flush();
      if (fallo) throw fallo;
      muxer.finalize();
      enc.close();
      return new Blob([target.buffer], { type: "video/mp4" });
    },
    abortar() {
      try {
        if (enc.state !== "closed") enc.close();
      } catch {
        // Cerrar un codificador ya caído no es un problema que reportar.
      }
    },
  };
}

/** Codifica un cuadro suelto para comprobar que el codificador entrega datos. */
async function codificadorUtilizable(
  config: VideoEncoderConfig,
  lienzo: HTMLCanvasElement
): Promise<boolean> {
  let cuadros = 0;
  let malo = false;
  let enc: VideoEncoder | null = null;
  try {
    enc = new VideoEncoder({
      output: () => {
        cuadros++;
      },
      error: () => {
        malo = true;
      },
    });
    enc.configure(config);
    const frame = new VideoFrame(lienzo, { timestamp: 0, duration: 1 });
    try {
      enc.encode(frame, { keyFrame: true });
    } finally {
      frame.close();
    }
    // El `catch` vacío es necesario: al cerrar el codificador tras el tope, el
    // `flush` que quedó colgando rechaza, y sin esto sería un error no atendido.
    const vaciado = enc.flush().catch(() => {});
    await Promise.race([vaciado, demora(PRUEBA_MS)]);
    return cuadros > 0 && !malo;
  } catch {
    return false;
  } finally {
    try {
      if (enc && enc.state !== "closed") enc.close();
    } catch {
      // Cerrar un codificador ya caído no es un problema que reportar.
    }
  }
}

function demora(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms));
}

/** Respaldo por `MediaRecorder`, en MP4 si el navegador lo ofrece. */
function salidaGrabador(lienzo: HTMLCanvasElement): Salida | null {
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof lienzo.captureStream !== "function") return null;
  const mime = MIMES_GRABADOR.find((m) => MediaRecorder.isTypeSupported(m));
  if (!mime) return null;

  const formato: Formato = mime.startsWith("video/mp4") ? "mp4" : "webm";
  const flujo = lienzo.captureStream(FPS);
  const trozos: Blob[] = [];
  const rec = new MediaRecorder(flujo, {
    mimeType: mime,
    videoBitsPerSecond: Math.min(
      BITRATE_MAX,
      Math.round(lienzo.width * lienzo.height * FPS * BPP)
    ),
  });
  rec.ondataavailable = (e) => {
    if (e.data.size > 0) trozos.push(e.data);
  };
  const terminado = new Promise<void>((res) => {
    rec.onstop = () => res();
  });
  rec.start();

  const soltar = () => flujo.getTracks().forEach((p) => p.stop());

  return {
    formato,
    tiempoReal: true,
    // `captureStream` toma los cuadros del canvas por su cuenta: aquí no hay
    // nada que entregar, sólo hay que respetar el ritmo, y de eso se encarga el
    // bucle mirando `tiempoReal`.
    cuadro() {},
    async cerrar() {
      rec.stop();
      await terminado;
      soltar();
      return new Blob(trozos, { type: mime });
    },
    abortar() {
      if (rec.state !== "inactive") rec.stop();
      soltar();
    },
  };
}

/* ========================= mapa ========================= */

function montarCapas(map: MapLibreMap, t: TrabajoVideo) {
  const coords = t.ruta.map(([la, lo]) => [lo, la] as [number, number]);

  map.addSource(SRC_VIDEO_RUTA, { type: "geojson", data: lineaDe(coords) });
  map.addSource(SRC_VIDEO_AVANCE, { type: "geojson", data: lineaDe([]) });

  // El recorrido completo, tenue: da el contexto de a dónde va la máquina sin
  // competir con lo ya recorrido, que es lo que el video cuenta.
  map.addLayer({
    id: CAPA_VIDEO_RUTA,
    type: "line",
    source: SRC_VIDEO_RUTA,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#ffffff",
      "line-width": 2.5,
      "line-opacity": 0.28,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: CAPA_VIDEO_AVANCE,
    type: "line",
    source: SRC_VIDEO_AVANCE,
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": t.color,
      "line-width": 4.5,
      "line-opacity": 0.95,
    },
  });
}

function desmontarCapas(map: MapLibreMap) {
  for (const capa of [CAPA_VIDEO_AVANCE, CAPA_VIDEO_RUTA])
    if (map.getLayer(capa)) map.removeLayer(capa);
  for (const src of [SRC_VIDEO_AVANCE, SRC_VIDEO_RUTA])
    if (map.getSource(src)) map.removeSource(src);
}

function lineaDe(coords: [number, number][]) {
  return {
    type: "FeatureCollection" as const,
    features:
      coords.length >= 2
        ? [
            {
              type: "Feature" as const,
              properties: {},
              geometry: { type: "LineString" as const, coordinates: coords },
            },
          ]
        : [],
  };
}

function encuadrar(
  map: MapLibreMap,
  coords: [number, number][],
  seguir: boolean
) {
  if (seguir) {
    map.jumpTo({
      center: coords[0],
      zoom: ZOOM_SEGUIMIENTO,
      bearing: 0,
      pitch: 0,
    });
    return;
  }

  let oe = coords[0][0];
  let ee = coords[0][0];
  let ss = coords[0][1];
  let nn = coords[0][1];
  for (const [lo, la] of coords) {
    oe = Math.min(oe, lo);
    ee = Math.max(ee, lo);
    ss = Math.min(ss, la);
    nn = Math.max(nn, la);
  }

  // Toda la jornada en el mismo sitio: `fitBounds` sobre un punto haría un zoom
  // absurdo, igual que en el encuadre del mapa.
  if (oe === ee && ss === nn) {
    map.jumpTo({ center: coords[0], zoom: 16, bearing: 0, pitch: 0 });
    return;
  }
  map.jumpTo({ bearing: 0, pitch: 0 });
  // El relleno inferior deja libre la banda donde va el HUD.
  map.fitBounds(
    [
      [oe, ss],
      [ee, nn],
    ],
    {
      padding: { top: 70, right: 70, bottom: 150, left: 70 },
      maxZoom: 17,
      duration: 0,
    }
  );
}

/** Un cuadro nuevo dibujado en el canvas del mapa. */
function esperarRender(map: MapLibreMap): Promise<void> {
  return new Promise((res) => {
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(t);
      // Si ganó el tope, el `once` sigue registrado: quitarlo evita acumular un
      // oyente muerto por cada cuadro de la grabación.
      map.off("render", fin);
      res();
    };
    // Tope por si el mapa no vuelve a pintar: se prefiere repetir el cuadro
    // anterior a dejar la grabación colgada.
    const t = setTimeout(fin, 500);
    map.once("render", fin);
    map.triggerRepaint();
  });
}

/** Mapa quieto y con todo cargado, o se sigue de largo al vencer `maxMs`. */
function esperarIdle(map: MapLibreMap, maxMs: number): Promise<void> {
  return new Promise((res) => {
    let hecho = false;
    const fin = () => {
      if (hecho) return;
      hecho = true;
      clearTimeout(t);
      map.off("idle", fin);
      res();
    };
    const t = setTimeout(fin, maxMs);
    map.on("idle", fin);
    map.triggerRepaint();
  });
}

function esperarHasta(ms: number): Promise<void> {
  const falta = ms - performance.now();
  if (falta <= 0) return Promise.resolve();
  return new Promise((res) => setTimeout(res, falta));
}

/* ========================= dibujo ========================= */

function crearLienzo(mapa: HTMLCanvasElement) {
  const factor = Math.min(1, ANCHO_MAX / Math.max(1, mapa.width));
  const lienzo = document.createElement("canvas");
  // H.264 codifica en bloques sobre croma 4:2:0: con un lado impar hay
  // codificadores que fallan y reproductores que muestran una franja verde.
  lienzo.width = Math.max(2, Math.round((mapa.width * factor) / 2) * 2);
  lienzo.height = Math.max(2, Math.round((mapa.height * factor) / 2) * 2);
  const ctx = lienzo.getContext("2d");
  if (!ctx) throw new Error("No se pudo preparar el lienzo del video.");
  return { lienzo, ctx };
}

/**
 * El ícono de la máquina, como imagen dibujable.
 *
 * Es el mismo SVG del marcador del mapa (`machineSVG`), sólo que el marcador
 * vive en el DOM y el DOM no entra en la captura del canvas: hay que redibujarlo
 * a mano. Se reutiliza la misma función para que el tractor del video y el del
 * mapa no se vayan pareciendo cada vez menos.
 */
function cargarIcono(
  tipo: TipoMaquina,
  color: string
): Promise<HTMLImageElement | null> {
  const svg = machineSVG(tipo, color).replace(
    "<svg ",
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" '
  );
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  return new Promise((res) => {
    const img = new Image();
    img.onload = () => res(img);
    // Sin ícono el video sigue siendo válido: queda el disco de color.
    img.onerror = () => res(null);
    img.src = url;
  });
}

function dibujarMaquina(
  ctx: CanvasRenderingContext2D,
  map: MapLibreMap,
  pos: { lat: number; lon: number; rumbo: number | null } | null,
  icono: HTMLImageElement | null,
  color: string,
  k: number
) {
  if (!pos) return;
  const p = map.project([pos.lon, pos.lat]);
  const x = p.x * k;
  const y = p.y * k;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.45)";
  ctx.shadowBlur = 8 * k;
  ctx.beginPath();
  ctx.arc(x, y, 24 * k, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(255,255,255,.22)";
  ctx.fill();
  ctx.lineWidth = 2.5 * k;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.restore();

  if (icono) {
    const lado = 40 * k;
    ctx.save();
    ctx.translate(x, y);
    // Mismo criterio que el marcador del mapa: mirando al este el ícono se
    // espeja, para que se lea de un vistazo para dónde iba.
    if (pos.rumbo != null && pos.rumbo > 180) ctx.scale(-1, 1);
    ctx.drawImage(icono, -lado / 2, -lado / 2, lado, lado);
    ctx.restore();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, 7 * k, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  }
}

interface DatosHUD {
  ancho: number;
  alto: number;
  k: number;
  nombre: string;
  codigo: string;
  color: string;
  fecha: string;
  minuto: number;
  metros: number;
  progreso: number;
}

function dibujarHUD(ctx: CanvasRenderingContext2D, d: DatosHUD) {
  const { k } = d;
  const sans = (px: number, peso = 400) =>
    `${peso} ${px * k}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const mono = (px: number, peso = 700) =>
    `${peso} ${px * k}px ui-monospace, Menlo, Consolas, monospace`;

  // --- Tarjeta inferior izquierda ---
  const m = 16 * k;
  const alto = 92 * k;
  const ancho = Math.min(360 * k, d.ancho - 2 * m);
  const x = m;
  const y = d.alto - m - alto - 8 * k;

  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,.35)";
  ctx.shadowBlur = 12 * k;
  rectRedondo(ctx, x, y, ancho, alto, 12 * k);
  ctx.fillStyle = "rgba(255,255,255,.94)";
  ctx.fill();
  ctx.restore();

  // Franja del color de la máquina: identifica de un vistazo de quién es el
  // video, que es lo primero que se pregunta quien lo recibe suelto.
  ctx.save();
  rectRedondo(ctx, x, y, ancho, alto, 12 * k);
  ctx.clip();
  ctx.fillStyle = d.color;
  ctx.fillRect(x, y, 5 * k, alto);
  ctx.restore();

  const px = x + 18 * k;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = "#171717";
  ctx.font = sans(17, 800);
  ctx.fillText(recortar(ctx, d.nombre, ancho - 34 * k), px, y + 26 * k);

  ctx.fillStyle = "#55636f";
  ctx.font = sans(11, 600);
  ctx.fillText(`${d.codigo} · ${d.fecha}`, px, y + 43 * k);

  // Reloj en formato de 12 horas: quien recibe el video suelto necesita
  // distinguir la mañana de la tarde sin hacer la cuenta mental.
  const { hora, sufijo } = hora12(d.minuto);
  ctx.fillStyle = "#0a55a5";
  ctx.font = mono(26, 800);
  ctx.fillText(hora, px, y + 76 * k);
  const anchoHora = ctx.measureText(hora).width;
  ctx.font = sans(12, 800);
  ctx.fillText(sufijo, px + anchoHora + 6 * k, y + 76 * k);

  const cx = px + 128 * k;
  ctx.fillStyle = "#8a99a8";
  ctx.font = sans(9, 700);
  ctx.fillText("RECORRIDO", cx, y + 60 * k);
  ctx.fillStyle = "#171717";
  ctx.font = mono(15, 700);
  ctx.fillText(distancia(d.metros), cx, y + 76 * k);

  // --- Sello de la app ---
  ctx.fillStyle = "rgba(255,255,255,.85)";
  ctx.font = sans(11, 800);
  ctx.fillText("SIRIUS · FLEET", m + 2 * k, m + 14 * k);

  // --- Nota de honestidad ---
  // El archivo se comparte suelto, sin la app alrededor: la advertencia del
  // replay tiene que viajar dentro de la imagen o se pierde.
  ctx.fillStyle = "rgba(255,255,255,.8)";
  ctx.font = sans(10, 600);
  ctx.fillText(
    "Un fix cada ~10 min · el movimiento entre puntos es interpolado",
    m + 2 * k,
    d.alto - 14 * k
  );

  // --- Barra de avance ---
  const by = d.alto - 4 * k;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.fillRect(0, by, d.ancho, 4 * k);
  ctx.fillStyle = d.color;
  ctx.fillRect(0, by, d.ancho * d.progreso, 4 * k);
}

function rectRedondo(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") ctx.roundRect(x, y, w, h, r);
  else ctx.rect(x, y, w, h);
}

function recortar(ctx: CanvasRenderingContext2D, txt: string, max: number) {
  if (ctx.measureText(txt).width <= max) return txt;
  let s = txt;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

/* ========================= cifras ========================= */

/** Hora del día en formato 12 h, con el sufijo aparte para dibujarlo menor. */
function hora12(minuto: number): { hora: string; sufijo: string } {
  const h24 = Math.floor(minuto / 60) % 24;
  const m = Math.floor(minuto % 60);
  const h = h24 % 12 === 0 ? 12 : h24 % 12;
  return {
    hora: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
    sufijo: h24 < 12 ? "AM" : "PM",
  };
}

function distancia(m: number): string {
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(2)} km`;
}

/**
 * Distancia acumulada del recorrido, fix a fix, con su minuto del día.
 *
 * Aplica el mismo umbral que el resto de la app (`MOVIMIENTO_M`): por debajo de
 * él la diferencia entre dos fixes es ruido del GPS con la máquina parada, y
 * sumarla haría que el contador del video creciera con el tractor quieto.
 */
function distanciasAcumuladas(points: TrackPoint[]) {
  const minutos: number[] = [];
  const metros: number[] = [];
  let acum = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const prev = points[i - 1];
    if (prev) {
      const tramo = p.dist_prev_fix_m ?? haversineM(prev, p);
      if (tramo >= MOVIMIENTO_M) acum += tramo;
    }
    minutos.push(minuteOfDay(p.gps_time ?? p.sample_local));
    metros.push(acum);
  }
  return { minutos, metros };
}

function metrosEn(
  acum: { minutos: number[]; metros: number[] },
  minuto: number
): number {
  const { minutos, metros } = acum;
  if (minutos.length === 0) return 0;
  if (minuto <= minutos[0]) return 0;
  for (let i = 1; i < minutos.length; i++) {
    if (minutos[i] < minuto) continue;
    const span = minutos[i] - minutos[i - 1];
    const f = span > 0 ? (minuto - minutos[i - 1]) / span : 1;
    return metros[i - 1] + (metros[i] - metros[i - 1]) * f;
  }
  return metros[metros.length - 1];
}

function nombreArchivo(codigo: string, fecha: string, formato: Formato): string {
  const limpio = codigo.replace(/[^\w-]+/g, "-").replace(/^-+|-+$/g, "");
  return `recorrido-${limpio || "nodo"}-${fecha}.${formato}`;
}
