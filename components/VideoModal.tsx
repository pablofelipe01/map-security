"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import type { Tramo } from "@/lib/rutas";
import type { TipoMaquina } from "@/lib/tractores";
import type { TrackPoint } from "@/lib/types";
import { fmtDist } from "@/lib/geo";
import {
  DURACIONES,
  DURACION_DEFECTO,
  descargar,
  grabarRutaVideo,
  soporteVideo,
  VideoCancelado,
  type ResultadoVideo,
} from "@/lib/video";
import { MiniIcon } from "./SidePanel";

/** Todo lo que hay que saber para grabar el recorrido de un nodo. */
export interface VideoJob {
  nodeId: string;
  nombre: string;
  codigo: string;
  color: string;
  tipo: TipoMaquina;
  /** Día que se va a grabar ("YYYY-MM-DD"). */
  fecha: string;
  points: TrackPoint[];
  tramos?: Tramo[] | null;
  /** Recorrido a dibujar de fondo, como [lat, lon]. */
  ruta: [number, number][];
  /** Metros recorridos en la jornada, para anticiparlo en el diálogo. */
  metros: number;
}

interface Props {
  job: VideoJob;
  map: MapLibreMap | null;
  onClose: () => void;
}

type Estado = "config" | "grabando" | "listo" | "error";

/**
 * Diálogo para exportar el recorrido de un nodo como video.
 *
 * La grabación se hace sobre el mapa que está detrás (ver lib/video.ts), así que
 * el diálogo deja el mapa a la vista y se limita a una tarjeta: mientras se
 * graba, lo que se ve en pantalla es lo que va a quedar en el archivo, y eso es
 * la mejor barra de progreso que hay.
 */
export default function VideoModal({ job, map, onClose }: Props) {
  const [estado, setEstado] = useState<Estado>("config");
  const [segundos, setSegundos] = useState<number>(DURACION_DEFECTO);
  const [seguir, setSeguir] = useState(false);
  const [progreso, setProgreso] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [hecho, setHecho] = useState<ResultadoVideo | null>(null);
  const cancelarRef = useRef(false);

  const soporte = soporteVideo();
  const grabando = estado === "grabando";

  // Esc cierra; si está grabando, cancela.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      if (grabando) cancelarRef.current = true;
      else onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [grabando, onClose]);

  // Si el diálogo se desmonta a mitad de la grabación, el bucle tiene que
  // enterarse: si no, seguiría moviendo el mapa después de cerrado.
  useEffect(() => () => {
    cancelarRef.current = true;
  }, []);

  const grabar = async () => {
    if (!map) {
      setError("El mapa todavía no está listo.");
      setEstado("error");
      return;
    }
    cancelarRef.current = false;
    setProgreso(0);
    setError(null);
    setEstado("grabando");
    try {
      const r = await grabarRutaVideo({
        map,
        points: job.points,
        tramos: job.tramos,
        ruta: job.ruta,
        nombre: job.nombre,
        codigo: job.codigo,
        color: job.color,
        tipo: job.tipo,
        fecha: job.fecha,
        opciones: { segundos, seguir },
        onProgreso: setProgreso,
        cancelado: () => cancelarRef.current,
      });
      descargar(r.blob, r.archivo);
      setHecho(r);
      setEstado("listo");
    } catch (e) {
      if (e instanceof VideoCancelado) {
        setEstado("config");
        return;
      }
      setError(String((e as Error)?.message ?? e));
      setEstado("error");
    }
  };

  return (
    <div
      className="absolute inset-0 z-[1200] flex items-center justify-center bg-ink/15 p-4"
      onClick={() => {
        if (!grabando) onClose();
      }}
    >
      <div
        className="card w-[400px] max-w-full p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <span className="panel-title mb-0">Video del recorrido</span>
          <button
            className="back-link"
            onClick={() => (grabando ? (cancelarRef.current = true) : onClose())}
            title={grabando ? "Cancelar" : "Cerrar"}
          >
            {grabando ? "Cancelar" : "✕"}
          </button>
        </div>

        <div className="mb-3.5 flex items-center gap-3">
          <MiniIcon
            tipo={job.tipo}
            color={job.color}
            className="h-[42px] w-[42px]"
          />
          <div className="min-w-0">
            <div className="truncate text-[15px] font-extrabold leading-tight">
              {job.nombre}
            </div>
            <div className="font-mono text-[11px] tracking-[1px] text-ink-2">
              {job.codigo} · {job.fecha} · {job.points.length} fixes ·{" "}
              {fmtDist(job.metros)}
            </div>
          </div>
        </div>

        {!soporte.ok ? (
          <p className="rounded-[10px] bg-[#fdf0f0] px-2.5 py-2 text-[11px] leading-tight text-st-alerta">
            {soporte.motivo}
          </p>
        ) : estado === "listo" && hecho ? (
          <>
            <p className="rounded-[10px] bg-surface-2 px-2.5 py-2 text-[12px] leading-tight text-ink-2">
              Video descargado como{" "}
              <code className="font-mono text-ink">{hecho.archivo}</code>.{" "}
              {hecho.iphone
                ? "Es un MP4 (H.264): se reproduce en iPhone, Android, WhatsApp y PowerPoint sin convertir nada."
                : "Salió en WebM porque este navegador no pudo codificar H.264, y ese formato no abre en iPhone."}
            </p>
            <button className="btn mt-3" onClick={onClose}>
              Listo
            </button>
            <button className="btn-ghost mt-2" onClick={() => setEstado("config")}>
              Grabar otro
            </button>
          </>
        ) : (
          <>
            <Grupo titulo="Duración">
              {DURACIONES.map((s) => (
                <Opcion
                  key={s}
                  activo={segundos === s}
                  disabled={grabando}
                  onClick={() => setSegundos(s)}
                >
                  {s} s
                </Opcion>
              ))}
            </Grupo>

            <Grupo titulo="Cámara">
              <Opcion
                activo={!seguir}
                disabled={grabando}
                onClick={() => setSeguir(false)}
              >
                Todo el recorrido
              </Opcion>
              <Opcion
                activo={seguir}
                disabled={grabando}
                onClick={() => setSeguir(true)}
              >
                Seguir la máquina
              </Opcion>
            </Grupo>

            {!soporte.iphone && (
              <p className="mt-3 rounded-[10px] bg-[#fdf7ea] px-2.5 py-2 text-[11px] leading-tight text-st-detenida">
                Este navegador sólo puede producir WebM, que <b>no abre en
                iPhone</b>. Para un archivo que se vea en iOS, graba desde Chrome
                o Edge actualizados.
              </p>
            )}

            {grabando ? (
              <>
                <div className="mt-3.5 h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full bg-accent transition-[width]"
                    style={{ width: `${Math.round(progreso * 100)}%` }}
                  />
                </div>
                <p className="mt-2 text-[11px] leading-tight text-ink-2">
                  Grabando… {Math.round(progreso * 100)}%. No cambies de pestaña
                  ni muevas el mapa: se está capturando lo que se ve.
                </p>
              </>
            ) : (
              <button className="btn mt-3.5" onClick={grabar}>
                Grabar y descargar
              </button>
            )}

            {error && (
              <p className="mt-2.5 rounded-[10px] bg-[#fdf0f0] px-2.5 py-2 text-[11px] leading-tight text-st-alerta">
                {error}
              </p>
            )}

            {/* Las mismas advertencias del replay: el video no mide más que él. */}
            <p className="mt-2.5 text-[10px] leading-tight text-ink-3">
              Salida {soporte.formato === "mp4" ? "MP4 · H.264" : "WebM"} de{" "}
              {segundos} s. Se graba del mapa en pantalla, así que la exportación
              tarda un rato parecido. Entre fix y fix la posición es interpolada,
              igual que en el replay, y eso queda escrito dentro del video.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function Grupo({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mt-3">
      <div className="t-label mb-1.5">{titulo}</div>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}

function Opcion({
  activo,
  disabled,
  onClick,
  children,
}: {
  activo: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`flex-1 rounded-[10px] border px-2 py-1.5 text-[12px] font-bold transition disabled:opacity-40 ${
        activo
          ? "border-accent bg-[#eaf2fb] text-accent"
          : "border-border bg-surface text-ink-2 hover:border-accent-2"
      }`}
    >
      {children}
    </button>
  );
}
