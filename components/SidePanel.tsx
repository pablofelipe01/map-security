"use client";

import type { Estadia, FleetItem, TrackStats, NodeRow } from "@/lib/types";
import {
  ESTADO_META,
  contarEstados,
  fmtEdad,
  fmtVel,
  ordenarFlota,
  SIN_SENAL_MIN,
} from "@/lib/fleet";
import { maquinaDe, estaRegistrado, flotaConfigurada } from "@/lib/tractores";
import { esPuesto, puestoDe } from "@/lib/puestos";
import { dispositivoDe } from "@/lib/dispositivos";
import type { PiezaRastro } from "@/lib/atribucion";
import {
  maquinaDeNodoEn,
  cronologiaDelDia,
  inicioDelDia,
  turnosDelDia,
  type EventoDia,
  type Flota,
} from "@/lib/registro";
import { fmtDateTime } from "@/lib/geo";
import { machineSVG } from "@/lib/icons";
import { fmtCoords, fmtDist, fmtDuration, fmtTime } from "@/lib/geo";
import type { TractorEstado } from "@/lib/types";

/** Una fila del resumen de histórico. */
export interface HistoryRow {
  node: NodeRow;
  stats: TrackStats;
  puntos: number;
  /**
   * Detenciones medidas del nodo ese día. Se usan para contrastar la hora
   * REGISTRADA de un cambio contra lo que hacía el aparato a esa hora: un
   * cambio de máquina ocurre con el nodo quieto, así que si la hora cae dentro
   * de una detención, el registro es verosímil.
   */
  estadias: Estadia[];
  /**
   * El recorrido partido por máquina. Con más de una pieza, las cifras de
   * arriba (que son del día entero) dejan de pertenecerle a una sola máquina y
   * hay que desglosarlas. Ver lib/atribucion.ts.
   */
  piezas: PiezaRastro[];
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
   * Instante al que está resuelta la identidad de la flota: ahora en vivo, el
   * cierre del día mostrado en histórico. Se usa para saber qué máquina llevaba
   * ese nodo esa fecha, que no tiene por qué ser la de hoy.
   */
  instante: number;
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
      // `bottom` respeta la barra de gestos de iOS/Android: sin el inset, el
      // último renglón del panel queda debajo de la franja del sistema y no se
      // puede ni leer ni tocar.
      className={`absolute bottom-[max(0.875rem,env(safe-area-inset-bottom))] right-3.5 top-3.5 z-[1000] flex w-[332px] max-w-[calc(100vw-28px)] flex-col rounded-card border border-border bg-white/95 shadow-card backdrop-blur-md transition-transform ${
        p.open ? "" : "translate-x-[calc(100%+14px)]"
      }`}
    >
      <button
        onClick={p.onToggle}
        title="Mostrar / ocultar panel"
        // 44 px de ancho en táctil y no 30: en celular este tirador es la única
        // forma de traer el panel de vuelta —arranca plegado— así que fallar el
        // toque deja al usuario sin forma visible de abrirlo.
        //
        // Y baja a 112 px en móvil porque al ensancharlo se montó encima de los
        // controles de zoom de MapLibre, que en táctil también crecieron a 44 px
        // y ocupan la esquina superior derecha hasta ~100 px. En escritorio
        // siguen siendo de 30 y no se tocan, así que ahí vuelve a `top-3.5`.
        className={`absolute top-28 h-11 w-11 border border-border bg-white/95 text-[15px] text-ink-2 md:top-3.5 md:w-[30px] ${
          p.open
            ? "-left-11 rounded-l-[10px] border-r-0 md:-left-[30px]"
            : "-left-11 rotate-180 rounded-r-[10px] border-l-0 md:-left-[30px]"
        }`}
      >
        ‹
      </button>

      <div className="flex-1 overflow-y-auto p-4">
        {p.mode === "history" ? (
          // La ficha sólo reemplaza a la lista si el día mostrado tiene esa
          // máquina: una selección heredada del modo en vivo no puede dejar el
          // panel en blanco.
          p.history.some((h) => h.node.node_id === p.selectedId) ? (
            <HistoryMachinePanel {...p} />
          ) : (
            <HistoryPanel {...p} />
          )
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
            // Un puesto fijo no tiene recorrido: se le apaga el botón de video
            // pasándole cero fixes, que es lo que significa para ese botón.
            puntos={esPuesto(i.node.node_id) ? 0 : puntosDe(history, i.node.node_id)}
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
  instante,
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
  // Un puesto fijo (portería) es un nodo instalado en un sitio, no una máquina:
  // no tiene recorrido, ni operador al mando, ni video que grabar. La ficha se
  // recorta a lo que sí existe, en vez de mostrar ceros que se leen como una
  // jornada sin trabajo. Ver lib/puestos.ts.
  const puesto = puestoDe(item.node.node_id);
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
        disabled={!!puesto}
        title={
          puesto
            ? "Puesto fijo: su nombre y su coordenada están en la configuración (lib/puestos.ts)"
            : "Asignar máquina y operador a este nodo"
        }
        className="-mx-1.5 mb-1 mt-2.5 flex w-[calc(100%+12px)] items-center gap-3 rounded-xl px-1.5 py-1.5 text-left transition enabled:hover:bg-surface-2"
      >
        <MiniIcon tipo={maq.tipo} color={maq.color} className="h-[46px] w-[46px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-extrabold leading-tight">
            {maq.nombre}
          </div>
          <div className="font-mono text-[11px] tracking-[1px] text-ink-2">
            {maq.codigo} · {puesto ? "PUESTO FIJO" : maq.tipo.toUpperCase()}
          </div>
        </div>
        {!puesto && <span className="shrink-0 text-[13px] text-ink-3">✎</span>}
      </button>

      <DispositivoChip nodeId={item.node.node_id} />

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

      {!puesto && (
        <div className="my-3.5 grid grid-cols-2 gap-2.5">
          <Tile
            label="Recorrido hoy"
            value={hoy ? fmtDist(hoy.totalDistanceM) : "—"}
          />
          <Tile
            label="En labor hoy"
            value={hoy ? fmtDuration(hoy.movingMinutes) : "—"}
          />
          <Tile label="Detenciones" value={hoy ? String(hoy.stops) : "—"} />
          <Tile label="Velocidad" value={fmtVel(item.velocidadKmh)} />
        </div>
      )}

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
          rotulan como tal para que nadie los lea como telemetría. Un puesto fijo
          no está en ese registro —no hay máquina a la que subirse— así que estas
          filas se omiten en vez de ofrecer una asignación que no aplica. */}
      {!puesto && (
        <>
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
          <TurnosDelDia
            flota={flota}
            nodeId={item.node.node_id}
            dia={date}
            instante={instante}
          />
        </>
      )}
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
        <span className="text-ink-2">
          {puesto ? "Coordenadas del puesto" : "Coordenadas"}
        </span>
        {puesto ? (
          <button
            type="button"
            onClick={() =>
              navigator.clipboard?.writeText(`${puesto.lat}, ${puesto.lon}`)
            }
            title="Copiar coordenadas"
            className="text-right font-mono font-semibold underline decoration-dotted underline-offset-2"
          >
            {fmtCoords(puesto.lat, puesto.lon)}
          </button>
        ) : item.posicion ? (
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
        {puesto
          ? "Puesto fijo: el marcador va en la coordenada declarada en la configuración, no en el último fix del nodo. El estado y la hora sí son del nodo."
          : "La máquina y el operador provienen del registro de flota, no del equipo."}
      </p>

      {item.estado === "offline" && item.posicion && (
        <p className="mt-2.5 rounded-[10px] bg-[#ecf1f4] px-2.5 py-2 text-[11px] leading-tight text-ink-2">
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

      {!puesto && (
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
      )}
    </>
  );
}

/* =========================== HISTÓRICO =========================== */

function HistoryPanel({ history, date, selectedId, onSelect, onVideo }: Props) {
  const conDatos = history.filter(
    (h) => h.puntos > 0 && !esPuesto(h.node.node_id)
  );
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
        // Los metros de un puesto fijo son dispersión del GPS, no recorrido: la
        // fila lo dice en vez de sumarlos como si hubiera trabajado.
        const puesto = esPuesto(h.node.node_id);
        return (
          <Fila
            key={h.node.node_id}
            seleccionada={sel}
            atenuada={vacio}
            onClick={() => onSelect(h.node.node_id)}
            puntos={puesto ? 0 : h.puntos}
            onVideo={() => onVideo(h.node.node_id)}
          >
            <MiniIcon tipo={maq.tipo} color={maq.color} className="h-[34px] w-[34px]" />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-bold">
                {maq.nombre}
              </span>
              <span className="block truncate text-[11px] text-ink-2">
                {puesto
                  ? `${maq.codigo} · puesto fijo`
                  : vacio
                    ? "sin reportes ese día"
                    : `${maq.codigo} · ${fmtDuration(
                        h.stats.movingMinutes
                      )} en labor · ${h.stats.stops} detenciones`}
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block font-mono text-xs font-semibold">
                {puesto || vacio ? "—" : fmtDist(h.stats.totalDistanceM)}
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

/* ================= HISTÓRICO: máquina seleccionada ================= */

/**
 * La ficha del día para la máquina elegida en el histórico.
 *
 * Es el equivalente de `MachinePanel` para una fecha pasada, con una diferencia
 * de fondo: aquí no hay estado en vivo ni último fix "de hace 3 min". Todo lo
 * que se muestra es lo que dejó ese día —recorrido, labor, detenciones y la
 * jornada del primer al último fix—, y desde aquí se entra al universo de la
 * máquina anclado a esa misma fecha.
 */
function HistoryMachinePanel({
  history,
  date,
  selectedId,
  onDeselect,
  onOpenMachine,
  onVideo,
  flota,
  instante,
}: Props) {
  const fila = history.find((h) => h.node.node_id === selectedId);
  if (!fila) return null;

  const maq = maquinaDe(
    fila.node.node_id,
    fila.node.long_name,
    fila.node.short_name
  );
  const puesto = puestoDe(fila.node.node_id);
  const st = fila.stats;
  const vacio = fila.puntos === 0;

  return (
    <>
      <button className="back-link" onClick={onDeselect}>
        ‹ Histórico · {date}
      </button>

      <div className="-mx-1.5 mb-1 mt-2.5 flex w-[calc(100%+12px)] items-center gap-3 px-1.5 py-1.5">
        <MiniIcon tipo={maq.tipo} color={maq.color} className="h-[46px] w-[46px]" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-extrabold leading-tight">
            {maq.nombre}
          </div>
          <div className="font-mono text-[11px] tracking-[1px] text-ink-2">
            {maq.codigo} · {puesto ? "PUESTO FIJO" : maq.tipo.toUpperCase()}
          </div>
        </div>
      </div>

      <DispositivoChip nodeId={fila.node.node_id} />

      {/* La identidad se resuelve al día mostrado, no a hoy: se rotula para que
          quede claro que "Juan" es quien manejaba esa fecha. */}
      <span className="mb-3.5 mt-2 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-border px-[11px] py-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-ink-2">
        Jornada del {date}
      </span>

      {puesto ? (
        <p className="mb-3 rounded-[10px] bg-[#ecf1f4] px-2.5 py-2 text-[11px] leading-tight text-ink-2">
          Puesto fijo ({puesto.nombre}): no recorre. Sus metros serían dispersión
          del GPS, así que no se suman ni se dibuja recorrido.
        </p>
      ) : vacio ? (
        <p className="mb-3 rounded-[10px] bg-[#ecf1f4] px-2.5 py-2 text-[11px] leading-tight text-ink-2">
          Este nodo no registró ningún fix GPS el {date}. No es que no trabajara:
          es que no reportó.
        </p>
      ) : (
        <div className="my-3.5 grid grid-cols-2 gap-2.5">
          <Tile label="Recorrido" value={fmtDist(st.totalDistanceM)} />
          <Tile label="En labor" value={fmtDuration(st.movingMinutes)} />
          <Tile label="Detenciones" value={String(st.stops)} />
          <Tile label="Fixes" value={String(fila.puntos)} />
        </div>
      )}

      <div className="kv">
        <span className="text-ink-2">Nodo</span>
        <button
          type="button"
          onClick={() => navigator.clipboard?.writeText(fila.node.node_id)}
          title="Copiar el código del nodo"
          className="text-right font-mono font-semibold underline decoration-dotted underline-offset-2"
        >
          {fila.node.node_id}
        </button>
      </div>

      {!puesto && (
        <>
          <div className="kv">
            <span className="text-ink-2">Al mando ese día</span>
            <span className="text-right font-semibold">
              {maq.operador || "—"}
            </span>
          </div>
          <CronologiaDelDia
            flota={flota}
            nodeId={fila.node.node_id}
            dia={date}
            instante={instante}
            estadias={fila.estadias}
          />
          <RepartoPorMaquina piezas={fila.piezas} total={st.totalDistanceM} />
        </>
      )}
      {maq.labor && (
        <div className="kv">
          <span className="text-ink-2">Labor</span>
          <span className="text-right font-semibold">{maq.labor}</span>
        </div>
      )}
      {!vacio && (
        <div className="kv">
          <span className="text-ink-2">Jornada</span>
          <span className="text-right font-mono font-semibold">
            {fmtTime(st.startTime)}–{fmtTime(st.endTime)}
          </span>
        </div>
      )}
      <p className="mt-1 text-[10px] leading-tight text-ink-3">
        &quot;Jornada&quot; es del primer al último fix GPS del día, no el turno
        del operador. La máquina y el operador son los vigentes ese día, según el
        registro de flota.
      </p>

      <button
        className="btn mt-3"
        onClick={() => onOpenMachine(fila.node.node_id)}
      >
        Universo de la máquina →
      </button>

      {!puesto && (
        <button
          className="btn-ghost mt-2 disabled:opacity-40"
          disabled={fila.puntos < 2}
          title={
            fila.puntos < 2
              ? "Ese día no tiene recorrido para grabar"
              : "Exportar el recorrido de ese día como video"
          }
          onClick={() => onVideo(fila.node.node_id)}
        >
          ⏺ Descargar video del recorrido
        </button>
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
/**
 * Qué pasó y a qué hora: los cambios de máquina y de operador del nodo ese día.
 *
 * Existe porque el histórico resuelve la identidad a UN instante —el final del
 * día—, y con eso un nodo que se pasó de tractor a media jornada aparece como si
 * hubiera sido el segundo tractor todo el día. El recorrido de la mañana queda
 * atribuido a la máquina y al operador equivocados.
 *
 * Cuando no hubo ningún cambio cae al listado de turnos de siempre, que es más
 * corto y dice lo mismo.
 */
function CronologiaDelDia({
  flota,
  nodeId,
  dia,
  instante,
  estadias,
}: {
  flota: Flota;
  nodeId: string;
  dia: string;
  instante: number;
  estadias: Estadia[];
}) {
  const eventos = cronologiaDelDia(flota, nodeId, dia);
  if (eventos.length === 0) {
    return (
      <TurnosDelDia
        flota={flota}
        nodeId={nodeId}
        dia={dia}
        instante={instante}
        etiqueta="Turnos del día"
        siempre
      />
    );
  }

  const inicio = inicioDelDia(flota, nodeId, dia);

  return (
    <div className="mt-2.5">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[1.2px] text-ink-3">
        Cronología del día
      </div>

      <div className="border-l-2 border-border pl-2.5 text-[11px] leading-snug">
        <div className="pb-2">
          <span className="font-mono text-[10px] text-ink-3">arranca</span>{" "}
          <span className="font-semibold">
            {inicio.maquina?.codigo ?? "sin máquina"}
          </span>
          {inicio.operador && (
            <span className="text-ink-2"> · {inicio.operador.nombre}</span>
          )}
        </div>

        {eventos.map((ev, i) => {
          const parada = detencionEn(estadias, ev.t);
          return (
            <div key={`${ev.t}-${i}`} className="pb-2">
              <span className="font-mono text-[10px] font-semibold text-ink">
                {fmtTime(ev.t)}
              </span>{" "}
              <span>{describir(ev)}</span>
              <span
                className={`ml-1 block text-[10px] ${
                  parada ? "text-ink-3" : "text-st-detenida"
                }`}
              >
                {parada
                  ? `coincide con una detención de ${fmtDuration(parada.minutos)}`
                  : "el nodo no estaba detenido a esa hora"}
              </span>
            </div>
          );
        })}
      </div>

      {/* El matiz que hace utilizable todo lo de arriba: estas horas son las que
          alguien digitó, no las que midió el aparato. La línea de contraste de
          cada evento es lo único que las corrobora. */}
      <p className="mt-1 text-[10px] leading-tight text-ink-3">
        Las horas son las del registro, no las del movimiento físico: si el
        relevo se diligenció tarde, esta es la hora en que se diligenció. Que
        coincida con una detención del nodo es lo que la respalda.
      </p>
    </div>
  );
}

/**
 * Cuánto recorrió cada máquina, cuando el nodo cambió de vehículo ese día.
 *
 * Sin esto, las cifras de arriba —que son del día completo— se leen como si
 * fueran de una sola máquina: la que quedó montada al cierre. Un tractor que
 * trabajó toda la mañana desaparecería del reporte.
 *
 * Con una sola máquina no se dibuja: no hay nada que repartir.
 */
function RepartoPorMaquina({
  piezas,
  total,
}: {
  piezas: PiezaRastro[];
  total: number;
}) {
  if (piezas.length < 2) return null;

  return (
    <div className="mt-2.5">
      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[1.2px] text-ink-3">
        Recorrido por máquina
      </div>
      {piezas.map((p, i) => (
        <div key={i} className="kv">
          <span className="flex min-w-0 items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ background: p.color }}
            />
            <span className="truncate text-ink-2">
              {p.codigo}
              {p.operador && (
                <span className="text-ink-3"> · {p.operador}</span>
              )}
            </span>
          </span>
          <span className="text-right font-mono font-semibold">
            {fmtDist(p.metros)}
          </span>
        </div>
      ))}
      {/* Los pedazos no suman exactamente el total del día: el tramo que cruza
          el cambio se le cuenta a la máquina nueva, y entre dos fixes no hay
          forma de repartirlo mejor. Se dice, en vez de maquillar la cifra. */}
      <p className="mt-1 text-[10px] leading-tight text-ink-3">
        Suma {fmtDist(piezas.reduce((a, p) => a + p.metros, 0))} contra{" "}
        {fmtDist(total)} del día: el tramo entre el último fix de una máquina y
        el primero de la otra se le atribuye a la nueva.
      </p>
    </div>
  );
}

/** La detención que contiene ese instante, si el nodo estaba quieto ahí. */
function detencionEn(estadias: Estadia[], iso: string): Estadia | null {
  const t = Date.parse(iso);
  return (
    estadias.find((e) => Date.parse(e.desde) <= t && t <= Date.parse(e.hasta)) ??
    null
  );
}

/** El evento en una línea, en los términos en que se habla en campo. */
function describir(ev: EventoDia): React.ReactNode {
  const maq = ev.maquina?.codigo ?? "—";
  const previa = ev.maquinaPrevia?.codigo ?? "—";

  if (ev.tipo === "cambio_maquina") {
    return (
      <>
        pasa de <b>{previa}</b> a <b>{maq}</b>
      </>
    );
  }
  if (ev.tipo === "monta") {
    return (
      <>
        se monta en <b>{maq}</b>
      </>
    );
  }
  if (ev.tipo === "desmonta") {
    return (
      <>
        se desmonta de <b>{previa}</b>
      </>
    );
  }
  return (
    <>
      releva {ev.operadorPrevio ? `a ${ev.operadorPrevio.nombre} ` : ""}
      <b>{ev.operador?.nombre ?? "—"}</b>
    </>
  );
}

function TurnosDelDia({
  flota,
  nodeId,
  dia,
  instante,
  etiqueta = "Turnos de hoy",
  siempre = false,
}: {
  flota: Flota;
  nodeId: string;
  dia: string;
  instante: number;
  etiqueta?: string;
  /** true = listar también el turno único (en histórico sí aporta: dice quién). */
  siempre?: boolean;
}) {
  // La máquina se resuelve al instante mostrado y no por la asignación abierta:
  // el nodo pudo haberse pasado de tractor después de la fecha que se mira.
  const maquina = maquinaDeNodoEn(flota, nodeId, instante);
  if (!maquina) return null;

  const turnos = turnosDelDia(flota, maquina.id, dia);
  if (turnos.length < (siempre ? 1 : 2)) return null;

  return (
    <div className="kv items-start">
      <span className="text-ink-2">{etiqueta}</span>
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
          ? "border-accent bg-[#ecf1f4]"
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
      className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-ink-3 transition hover:bg-white hover:text-accent disabled:opacity-25 disabled:hover:bg-transparent disabled:hover:text-ink-3 md:h-auto md:w-auto md:p-1.5"
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

/**
 * Chapita del aparato del nodo (ver `lib/dispositivos.ts`).
 *
 * Va pegada a la identidad y no en la lista de datos porque no es un dato del
 * día: responde "con qué se está viendo esta máquina", que es lo que explica
 * por qué este nodo reporta distinto a los demás. En un nodo corriente no se
 * dibuja nada — decir "radio Meshtastic" en los otros cinco sería ruido.
 */
function DispositivoChip({ nodeId }: { nodeId: string }) {
  const disp = dispositivoDe(nodeId);
  if (!disp) return null;
  return (
    <span
      className="mb-1 mt-1 inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-white"
      style={{ backgroundColor: disp.color }}
      title={disp.nota ?? "Aparato declarado en la configuración"}
    >
      {disp.etiqueta}
    </span>
  );
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
