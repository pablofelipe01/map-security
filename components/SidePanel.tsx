"use client";

import type { FleetItem, TrackStats, NodeRow } from "@/lib/types";
import {
  ESTADO_META,
  contarEstados,
  fmtEdad,
  fmtVel,
  ordenarFlota,
  SIN_SENAL_MIN,
} from "@/lib/fleet";
import { maquinaDe, estaRegistrado, flotaConfigurada } from "@/lib/tractores";
import { turnosDelDia, type Flota } from "@/lib/registro";
import { fmtDateTime } from "@/lib/geo";
import { machineSVG } from "@/lib/icons";
import { fmtCoords, fmtDist, fmtDuration, fmtTime } from "@/lib/geo";
import type { TractorEstado } from "@/lib/types";

/** Una fila del resumen de histórico. */
export interface HistoryRow {
  node: NodeRow;
  stats: TrackStats;
  puntos: number;
}

interface Props {
  open: boolean;
  onToggle: () => void;
  mode: "live" | "history";
  date: string;
  fleet: FleetItem[] | null;
  history: HistoryRow[];
  selectedId: string | null;
  onSelect: (nodeId: string) => void;
  onDeselect: () => void;
  onOpenMachine: (nodeId: string) => void;
  /** Abre el diálogo para exportar el recorrido de ese nodo como video. */
  onVideo: (nodeId: string) => void;
  /** Abre el diálogo de asignación del nodo (máquina y operador). */
  onAsignar: (nodeId: string) => void;
  /** Abre el maestro de máquinas y operadores. */
  onAdmin: () => void;
  /** Registro de flota, para listar los turnos del día. */
  flota: Flota;
  /**
   * Cambia cada vez que se guarda un registro. No se lee: está para que React
   * vuelva a pintar cuando `maquinaDe` empiece a devolver otro nombre, porque
   * el registro vive en un módulo y no en el estado del componente.
   */
  registroVersion: number;
  loading: boolean;
  onRefresh: () => void;
}

export default function SidePanel(p: Props) {
  return (
    <aside
      className={`absolute bottom-3.5 right-3.5 top-3.5 z-[1000] flex w-[332px] max-w-[calc(100vw-28px)] flex-col rounded-card border border-border bg-white/95 shadow-card backdrop-blur-md transition-transform ${
        p.open ? "" : "translate-x-[calc(100%+14px)]"
      }`}
    >
      <button
        onClick={p.onToggle}
        title="Mostrar / ocultar panel"
        className={`absolute top-3.5 h-11 w-[30px] border border-border bg-white/95 text-[15px] text-ink-2 ${
          p.open
            ? "-left-[30px] rounded-l-[10px] border-r-0"
            : "-left-[30px] rotate-180 rounded-r-[10px] border-l-0"
        }`}
      >
        ‹
      </button>

      <div className="flex-1 overflow-y-auto p-4">
        {p.mode === "history" ? (
          <HistoryPanel {...p} />
        ) : p.selectedId ? (
          <MachinePanel {...p} />
        ) : (
          <FleetPanel {...p} />
        )}
      </div>
    </aside>
  );
}

/* ============================ EN VIVO: flota ============================ */

const ORDEN_CONTADORES: TractorEstado[] = [
  "activa",
  "detenida",
  "offline",
  "sin_gps",
];

function FleetPanel({
  fleet,
  history,
  onSelect,
  onVideo,
  onAdmin,
  selectedId,
  loading,
  onRefresh,
}: Props) {
  const items = fleet ? ordenarFlota(fleet) : [];
  const conteo = contarEstados(items);

  return (
    <>
      <div className="mb-3 flex items-center justify-between">
        <span className="panel-title mb-0">Flota · hoy</span>
        <span className="flex items-center gap-2.5">
          <button
            onClick={onAdmin}
            className="back-link"
            title="Máquinas y operadores"
            aria-label="Máquinas y operadores"
          >
            Registro
          </button>
          <button
            onClick={onRefresh}
            className="back-link"
            title="Actualizar"
            aria-label="Actualizar"
          >
            {loading ? "…" : "↻"}
          </button>
        </span>
      </div>

      {/* Contadores por estado */}
      <div className="mb-3 grid grid-cols-4 gap-1.5">
        {ORDEN_CONTADORES.map((e) => {
          const m = ESTADO_META[e];
          const n = conteo[e];
          return (
            <div
              key={e}
              title={m.ayuda}
              className={`rounded-[10px] bg-surface-2 px-1.5 py-1.5 text-center ${
                n === 0 ? "opacity-40" : ""
              }`}
            >
              <div className={`font-mono text-base font-bold ${m.texto}`}>
                {n}
              </div>
              <div className="text-[9px] uppercase tracking-[1px] text-ink-3">
                {m.label}
              </div>
            </div>
          );
        })}
      </div>

      {items.map((i) => {
        const maq = maquinaDe(
          i.node.node_id,
          i.node.long_name,
          i.node.short_name
        );
        const sel = i.node.node_id === selectedId;
        return (
          <Fila
            key={i.node.node_id}
            seleccionada={sel}
            onClick={() => onSelect(i.node.node_id)}
            puntos={puntosDe(history, i.node.node_id)}
            onVideo={() => onVideo(i.node.node_id)}
          >
            <MiniIcon tipo={maq.tipo} color={maq.color} className="h-[34px] w-[34px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold">
                {maq.nombre}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-ink-2">
                <span className={`st-dot ${i.estado}`} />
                {ESTADO_META[i.estado].label} · {maq.codigo}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-xs font-semibold">
                {i.posicion ? fmtEdad(i.edadFixMin) : "—"}
              </span>
              <span className="block text-[9px] tracking-[1px] text-ink-3">
                ÚLT. FIX
              </span>
            </span>
          </Fila>
        );
      })}

      {items.length === 0 && (
        <p className="py-2 text-[12.5px] text-ink-3">
          {loading ? "Consultando la flota…" : "Sin máquinas registradas"}
        </p>
      )}

      {!flotaConfigurada() && items.length > 0 && <AvisoFlotaSinBautizar />}
    </>
  );
}

/* ==================== EN VIVO: máquina seleccionada ==================== */

function MachinePanel({
  fleet,
  selectedId,
  onDeselect,
  onOpenMachine,
  onVideo,
  onAsignar,
  flota,
  date,
  history,
}: Props) {
  const item = fleet?.find((f) => f.node.node_id === selectedId);
  if (!item) return null;
  const maq = maquinaDe(
    item.node.node_id,
    item.node.long_name,
    item.node.short_name
  );
  const meta = ESTADO_META[item.estado];
  // Las cifras del día vienen del mismo cálculo que alimenta el histórico, para
  // que "12,4 km hoy" diga lo mismo en los dos modos.
  const fila = history.find((h) => h.node.node_id === item.node.node_id);
  const hoy = fila?.stats;
  const hoyPuntos = fila?.puntos;

  return (
    <>
      <button className="back-link" onClick={onDeselect}>
        ‹ Flota
      </button>

      {/* La identidad es lo primero que se toca al abrir un nodo: el bloque
          entero abre el formulario, y si el nodo nunca se bautizó lo dice en
          vez de fingir que "Meshtastic 1d35" es el nombre de un tractor. */}
      <button
        type="button"
        onClick={() => onAsignar(item.node.node_id)}
        title="Asignar máquina y operador a este nodo"
        className="-mx-1.5 mb-1 mt-2.5 flex w-[calc(100%+12px)] items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition hover:bg-surface-2"
      >
        <MiniIcon tipo={maq.tipo} color={maq.color} className="h-[46px] w-[46px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-extrabold leading-tight">
            {maq.nombre}
          </div>
          <div className="font-mono text-[11px] tracking-[1px] text-ink-2">
            {maq.codigo} · {maq.tipo.toUpperCase()}
          </div>
        </div>
        <span className="shrink-0 text-[13px] text-ink-3">✎</span>
      </button>

      {!estaRegistrado(item.node.node_id) && (
        <button
          className="btn-ghost mb-1 border-accent text-accent"
          onClick={() => onAsignar(item.node.node_id)}
        >
          Asignar máquina y operador
        </button>
      )}

      <span
        className="mb-3.5 mt-2 inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-[11px] py-1 text-[10px] font-extrabold uppercase tracking-[1.5px]"
        style={{ color: meta.color, borderColor: meta.color }}
        title={meta.ayuda}
      >
        <span className={`st-dot ${item.estado}`} />
        {meta.label}
      </span>

      <div className="my-3.5 grid grid-cols-2 gap-2.5">
        <Tile label="Recorrido hoy" value={hoy ? fmtDist(hoy.totalDistanceM) : "—"} />
        <Tile
          label="En labor hoy"
          value={hoy ? fmtDuration(hoy.movingMinutes) : "—"}
        />
        <Tile label="Detenciones" value={hoy ? String(hoy.stops) : "—"} />
        <Tile label="Velocidad" value={fmtVel(item.velocidadKmh)} />
      </div>

      {/* El id del nodo va primero porque es el único dato de esta ficha que no
          cambia nunca: la máquina se renombra, el operador rota y el nodo hasta
          se pasa a otro tractor, pero "!86591d35" siempre es ese aparato. Es lo
          que sirve para buscarlo en la red o reportarlo a soporte. */}
      <div className="kv">
        <span className="text-ink-2">Nodo</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(item.node.node_id)}
          title="Copiar el código del nodo"
          className="text-right font-mono font-semibold underline decoration-dotted underline-offset-2"
        >
          {item.node.node_id}
        </button>
      </div>

      {/* Operador y labor salen del registro de flota, no de la máquina: se
          rotulan como tal para que nadie los lea como telemetría. */}
      <div className="kv">
        <span className="text-ink-2">Al mando</span>
        <button
          type="button"
          onClick={() => onAsignar(item.node.node_id)}
          title="Registrar el relevo"
          className="text-right font-semibold underline decoration-dotted underline-offset-2"
        >
          {maq.operador || "asignar"}
        </button>
      </div>
      <TurnosDelDia flota={flota} nodeId={item.node.node_id} dia={date} />
      {maq.labor && (
        <div className="kv">
          <span className="text-ink-2">Labor</span>
          <span className="text-right font-semibold">{maq.labor}</span>
        </div>
      )}
      {maq.aplicacion && (
        <div className="kv">
          <span className="text-ink-2">Aplicando</span>
          <span className="text-right font-semibold">{maq.aplicacion}</span>
        </div>
      )}
      <div className="kv">
        <span className="text-ink-2">Último fix GPS</span>
        <span className="text-right font-mono font-semibold">
          {item.posicion?.gps_time ? fmtTime(item.posicion.gps_time) : "—"}
          <span className="ml-1 font-sans text-[11px] font-normal text-ink-3">
            ({fmtEdad(item.edadFixMin)})
          </span>
        </span>
      </div>
      <div className="kv">
        <span className="text-ink-2">Coordenadas</span>
        {item.posicion ? (
          <button
            type="button"
            onClick={() =>
              navigator.clipboard?.writeText(
                `${item.posicion!.lat}, ${item.posicion!.lon}`
              )
            }
            title="Copiar coordenadas"
            className="text-right font-mono font-semibold underline decoration-dotted underline-offset-2"
          >
            {fmtCoords(item.posicion.lat, item.posicion.lon)}
          </button>
        ) : (
          <span className="text-right font-mono font-semibold">—</span>
        )}
      </div>
      <p className="mt-1 text-[10px] leading-tight text-ink-3">
        La máquina y el operador provienen del registro de flota, no del equipo.
      </p>

      {item.estado === "offline" && item.posicion && (
        <p className="mt-2.5 rounded-[10px] bg-[#f2f4f6] px-2.5 py-2 text-[11px] leading-tight text-ink-2">
          {item.fixConfirmado
            ? `Su último fix tiene más de ${SIN_SENAL_MIN} min: el punto del mapa es el último lugar conocido, no el actual.`
            : "Tiene coordenadas pero ningún fix GPS confirmado: la posición no es verificable."}
        </p>
      )}

      <button
        className="btn mt-3"
        onClick={() => onOpenMachine(item.node.node_id)}
      >
        Universo de la máquina →
      </button>

      <button
        className="btn-ghost mt-2 disabled:opacity-40"
        disabled={(hoyPuntos ?? 0) < 2}
        title={
          (hoyPuntos ?? 0) < 2
            ? "Hoy no tiene recorrido para grabar"
            : "Exportar el recorrido de hoy como video"
        }
        onClick={() => onVideo(item.node.node_id)}
      >
        ⏺ Descargar video del recorrido
      </button>
    </>
  );
}

/* =========================== HISTÓRICO =========================== */

function HistoryPanel({ history, date, selectedId, onSelect, onVideo }: Props) {
  const conDatos = history.filter((h) => h.puntos > 0);
  const totalM = conDatos.reduce((s, h) => s + h.stats.totalDistanceM, 0);
  const totalMin = conDatos.reduce((s, h) => s + h.stats.movingMinutes, 0);
  const paradas = conDatos.reduce((s, h) => s + h.stats.stops, 0);

  return (
    <>
      <div className="panel-title">Histórico · {date}</div>

      <div className="mb-3 grid grid-cols-2 gap-2.5">
        <Tile label="Total recorrido" value={fmtDist(totalM)} />
        <Tile label="Horas en labor" value={fmtDuration(totalMin)} />
        <Tile label="Detenciones" value={String(paradas)} />
        <Tile
          label="Máquinas"
          value={`${conDatos.length} / ${history.length}`}
        />
      </div>

      {history.map((h) => {
        const maq = maquinaDe(
          h.node.node_id,
          h.node.long_name,
          h.node.short_name
        );
        const sel = h.node.node_id === selectedId;
        const vacio = h.puntos === 0;
        return (
          <Fila
            key={h.node.node_id}
            seleccionada={sel}
            atenuada={vacio}
            onClick={() => onSelect(h.node.node_id)}
            puntos={h.puntos}
            onVideo={() => onVideo(h.node.node_id)}
          >
            <MiniIcon tipo={maq.tipo} color={maq.color} className="h-[34px] w-[34px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold">
                {maq.nombre}
              </span>
              <span className="block truncate text-[11px] text-ink-2">
                {vacio
                  ? "sin reportes ese día"
                  : `${maq.codigo} · ${fmtDuration(
                      h.stats.movingMinutes
                    )} en labor · ${h.stats.stops} detenciones`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-xs font-semibold">
                {vacio ? "—" : fmtDist(h.stats.totalDistanceM)}
              </span>
              <span className="block text-[9px] tracking-[1px] text-ink-3">
                RECORRIDO
              </span>
            </span>
          </Fila>
        );
      })}

      {history.length === 0 && (
        <p className="py-2 text-[12.5px] text-ink-3">Sin datos ese día</p>
      )}
    </>
  );
}

/**
 * Los relevos que tuvo hoy la máquina de ese nodo.
 *
 * Se listan todos y no sólo el vigente: si Juan manejó en la mañana y Pedro de
 * noche, el recorrido del día es obra de los dos, y mostrar sólo a uno sería
 * atribuirle mal el trabajo del otro. Con un solo turno no aporta nada y no se
 * dibuja.
 */
function TurnosDelDia({
  flota,
  nodeId,
  dia,
}: {
  flota: Flota;
  nodeId: string;
  dia: string;
}) {
  const asignacion = flota.asignaciones.find(
    (a) => a.node_id === nodeId && a.hasta == null
  );
  if (!asignacion) return null;

  const turnos = turnosDelDia(flota, asignacion.maquina_id, dia);
  if (turnos.length < 2) return null;

  return (
    <div className="kv items-start">
      <span className="text-ink-2">Turnos de hoy</span>
      <span className="text-right">
        {turnos.map((t) => (
          <span key={t.id} className="block">
            <span className="font-semibold">{t.operador?.nombre ?? "—"}</span>
            <span className="ml-1.5 font-mono text-[10px] text-ink-3">
              {fmtDateTime(t.desde)} → {t.hasta ? fmtDateTime(t.hasta) : "ahora"}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/* =========================== piezas =========================== */

/**
 * Una fila de máquina: el cuerpo selecciona, y el botón de la derecha exporta
 * el recorrido como video.
 *
 * Es un `div` con dos botones dentro y no un botón con otro adentro porque
 * anidar botones es HTML inválido: el navegador rompe el marcado y el botón
 * interior deja de recibir el clic.
 */
function Fila({
  seleccionada,
  atenuada,
  onClick,
  puntos,
  onVideo,
  children,
}: {
  seleccionada: boolean;
  atenuada?: boolean;
  onClick: () => void;
  /** Fixes del día: sin al menos dos no hay recorrido que grabar. */
  puntos: number;
  onVideo: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`flex w-full items-center rounded-xl border pr-1.5 transition ${
        seleccionada
          ? "border-accent bg-[#eaf2fb]"
          : "border-transparent hover:bg-surface-2"
      } ${atenuada ? "opacity-45" : ""}`}
    >
      <button
        onClick={onClick}
        className="flex min-w-0 flex-1 items-center gap-2.5 p-2.5 text-left"
      >
        {children}
      </button>
      <BotonVideo disabled={puntos < 2} onClick={onVideo} />
    </div>
  );
}

function BotonVideo({
  disabled,
  onClick,
}: {
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={
        disabled
          ? "Sin recorrido ese día"
          : "Descargar el recorrido como video"
      }
      aria-label="Descargar el recorrido como video"
      className="shrink-0 rounded-lg p-1.5 text-ink-3 transition hover:bg-white hover:text-accent disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-ink-3"
    >
      <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" aria-hidden="true">
        <rect
          x="2.5"
          y="6"
          width="13"
          height="12"
          rx="3"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        />
        <path
          d="M16.5 10.5 L21 8 v8 l-4.5-2.5 z"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}

/** Fixes que tiene un nodo en el día mostrado. */
function puntosDe(history: HistoryRow[], nodeId: string): number {
  return history.find((h) => h.node.node_id === nodeId)?.puntos ?? 0;
}

export function MiniIcon({
  tipo,
  color,
  className = "",
}: {
  tipo: Parameters<typeof machineSVG>[0];
  color: string;
  className?: string;
}) {
  return (
    <span
      className={`block shrink-0 [&>svg]:h-full [&>svg]:w-full ${className}`}
      dangerouslySetInnerHTML={{ __html: machineSVG(tipo, color) }}
    />
  );
}

export function Tile({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="tile">
      <div className="t-label">{label}</div>
      <div className="t-value">
        {value}
        {unit && <span className="t-unit">{unit}</span>}
      </div>
    </div>
  );
}

function AvisoFlotaSinBautizar() {
  return (
    <p className="mt-2 rounded-[10px] bg-[#fdf7ea] px-2.5 py-2 text-[10px] leading-tight text-st-detenida">
      Los nodos aún usan su nombre de fábrica. Haz clic en uno para decir en qué
      máquina va montado y quién la maneja.
    </p>
  );
}
