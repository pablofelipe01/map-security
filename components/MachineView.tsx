"use client";

import { useEffect, useState } from "react";
import type { NodeRow, TrackStats, TrackPoint } from "@/lib/types";
import { fetchDailySeries, fetchEstadias, fetchFleet } from "@/lib/queries";
import { enrichTrack, computeStats, fmtDist, fmtDuration, fmtTime } from "@/lib/geo";
import { ESTADO_META, fmtEdad, SIN_SENAL_MIN } from "@/lib/fleet";
import { maquinaDe } from "@/lib/tractores";
import { puestoDe } from "@/lib/puestos";
import { dayRange, shiftDay, todayLocal } from "@/lib/ranges";
import BarChart from "./BarChart";
import PorteriaPanel from "./PorteriaPanel";
import { MiniIcon, Tile } from "./SidePanel";
import type { FleetItem } from "@/lib/types";

interface Props {
  node: NodeRow;
  /**
   * Día en el que se cierra la ventana de la ficha. Sin él es hoy; viniendo del
   * histórico es el día que se estaba mirando, para que el universo hable de
   * esa fecha y no del presente.
   */
  fecha?: string;
  onBack: () => void;
}

interface Dia {
  date: string;
  stats: TrackStats;
  puntos: number;
  primero: string | null;
  ultimo: string | null;
}

const DIAS = 14;

/**
 * "Universo de la máquina": la ficha completa de un tractor.
 *
 * Respecto al patrón faltan tres bloques —horómetro, combustible y
 * mantenimiento— porque ninguno tiene fuente: la base sólo guarda posiciones.
 * Se omiten en vez de mostrarlos en cero, que es lo que haría creer que la
 * máquina no ha consumido ni se ha reparado nunca.
 */
export default function MachineView({ node, fecha, onBack }: Props) {
  // Ventana anclada al día pedido. "Hoy" es el caso normal; cualquier otro día
  // convierte la ficha en una foto del pasado, y el estado en vivo deja de
  // aplicar: decir "activa" sobre una fecha de marzo sería mentir.
  const hasta = fecha ?? todayLocal();
  const esHoy = hasta === todayLocal();
  const desde = shiftDay(hasta, -(DIAS - 1));
  const [dias, setDias] = useState<Dia[] | null>(null);
  const [item, setItem] = useState<FleetItem | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maq = maquinaDe(node.node_id, node.long_name, node.short_name);
  const puesto = puestoDe(node.node_id);

  useEffect(() => {
    let vivo = true;
    setDias(null);
    setItem(null);
    setError(null);
    (async () => {
      try {
        const [series, flota] = await Promise.all([
          fetchDailySeries(node.node_id, DIAS, hasta),
          esHoy ? fetchFleet([node]) : Promise.resolve([]),
        ]);

        // Las detenciones las calcula el backend (v_node_estadias); se piden
        // para toda la ventana y se reparten por día.
        const { fromISO } = dayRange(series[0]?.date ?? "");
        const { toISO } = dayRange(series[series.length - 1]?.date ?? "");
        const estadias = await fetchEstadias(node.node_id, fromISO, toISO).catch(
          () => []
        );

        const out: Dia[] = series.map(({ date, points }) => {
          const r = dayRange(date);
          const delDia = estadias.filter(
            (e) => e.desde < r.toISO && e.hasta > r.fromISO
          );
          return {
            date,
            stats: computeStats(enrichTrack(points), delDia),
            puntos: points.length,
            primero: horaDe(points[0]),
            ultimo: horaDe(points[points.length - 1]),
          };
        });

        if (!vivo) return;
        setDias(out);
        setItem(flota[0] ?? null);
      } catch (e) {
        if (vivo) setError(String((e as Error)?.message ?? e));
      }
    })();
    return () => {
      vivo = false;
    };
  }, [node, hasta, esHoy]);

  const totalM = dias?.reduce((s, d) => s + d.stats.totalDistanceM, 0) ?? 0;
  const totalLabor = dias?.reduce((s, d) => s + d.stats.movingMinutes, 0) ?? 0;
  const totalParadas = dias?.reduce((s, d) => s + d.stats.stops, 0) ?? 0;
  const conReporte = dias?.filter((d) => d.puntos > 0).length ?? 0;
  const meta = item ? ESTADO_META[item.estado] : null;

  return (
    <section className="h-full overflow-y-auto px-4 py-5 md:px-8">
      <button className="back-link" onClick={onBack}>
        ‹ Volver al mapa
      </button>

      {/* Encabezado */}
      <div className="my-4 flex flex-wrap items-center gap-4">
        <MiniIcon tipo={maq.tipo} color={maq.color} className="h-[72px] w-[72px]" />
        <div>
          <h1 className="text-[26px] font-extrabold leading-tight">
            {maq.nombre}
          </h1>
          <div className="font-mono text-xs tracking-[1px] text-ink-2">
            {maq.codigo} · {maq.tipo.toUpperCase()} · {node.node_id}
          </div>
          {!esHoy && (
            <span
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border-[1.5px] border-border px-[11px] py-1 text-[10px] font-extrabold uppercase tracking-[1.5px] text-ink-2"
              title="Ventana cerrada en la fecha que se estaba mirando en el histórico"
            >
              Histórico · {hasta}
            </span>
          )}
          {meta && item && (
            <span
              className="mt-2 inline-flex items-center gap-1.5 rounded-full border-[1.5px] px-[11px] py-1 text-[10px] font-extrabold uppercase tracking-[1.5px]"
              style={{ color: meta.color, borderColor: meta.color }}
              title={meta.ayuda}
            >
              <span className={`st-dot ${item.estado}`} />
              {meta.label}
            </span>
          )}
        </div>
        <div className="ml-auto text-right text-[12.5px] leading-[1.7] text-ink-2">
          Operador · <b className="text-ink">{maq.operador || "—"}</b>
          <br />
          Labor · <b className="text-ink">{maq.labor || "—"}</b>
          <br />
          {maq.aplicacion && (
            <>
              Aplicando · <b className="text-ink">{maq.aplicacion}</b>
              <br />
            </>
          )}
          {esHoy ? (
            <>
              Último fix ·{" "}
              <b className="font-mono text-ink">
                {item?.posicion?.gps_time
                  ? fmtTime(item.posicion.gps_time)
                  : "—"}
              </b>{" "}
              <span className="text-ink-3">
                ({fmtEdad(item?.edadFixMin ?? null)})
              </span>
            </>
          ) : (
            <>
              Ventana ·{" "}
              <b className="font-mono text-ink">
                {desde} → {hasta}
              </b>
            </>
          )}
        </div>
      </div>

      {/* Un puesto fijo no es una máquina, así que lo primero de su ficha no son
          kilómetros: es lo que sí pasa en él. Control 1 es la portería de
          entrada y sus ingresos los registra otra app, en Airtable; se leen por
          `nodo_origen` (ver lib/porteria.ts). */}
      {puesto && (
        <PorteriaPanel
          nodeId={node.node_id}
          desde={desde}
          hasta={hasta}
          nombre={puesto.nombre}
        />
      )}

      {/* Los kilómetros y las detenciones de más abajo son ruido del GPS, no
          trabajo. Se muestran igual porque sirven para ver si el nodo sigue
          reportando, pero dichos por lo que son. */}
      {puesto && (
        <p className="mb-4 rounded-card border border-border bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
          Este nodo es un puesto fijo ({puesto.nombre}), no una máquina. En el
          mapa se dibuja en su coordenada declarada. Los kilómetros y las
          detenciones de esta ficha son la dispersión de su propio GPS —±20-30 m
          entre fixes—, no un recorrido.
        </p>
      )}

      {/* La identidad (máquina, operador, labor) la resuelve el registro de
          flota al instante que fijó la pantalla anterior, no al día de cada
          barra: en una ventana de 14 días pudo haber relevos, y esta ficha
          muestra uno solo. Se dice para que no se lea como "quien manejó todos
          estos días". */}
      {!esHoy && (
        <p className="mb-4 rounded-card border border-border bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
          Ficha del histórico: las cifras son de los {DIAS} días que terminan el{" "}
          <b className="font-mono">{hasta}</b>. No se muestra el estado actual de
          la máquina —activa, detenida u offline es un dato del ahora, no de esa
          fecha—. El operador y la labor son los vigentes en el día mostrado.
        </p>
      )}

      {error && (
        <p className="mb-4 rounded-card border border-st-alerta/40 bg-[#fdf0f0] px-3 py-2 text-xs text-st-alerta">
          {error}
        </p>
      )}

      {/* Totales de la ventana */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          label={esHoy ? `Recorrido ${DIAS} días` : `Recorrido a ${hasta}`}
          value={fmtDist(totalM)}
        />
        <Tile label="Horas en labor" value={fmtDuration(totalLabor)} />
        <Tile label="Detenciones" value={String(totalParadas)} />
        <Tile
          label="Días con reporte"
          value={dias ? `${conReporte} / ${DIAS}` : "—"}
        />
        <Tile
          label="Fixes registrados"
          value={dias ? String(dias.reduce((s, d) => s + d.puntos, 0)) : "—"}
        />
      </div>

      {!dias && !error && <p className="text-[12.5px] text-ink-3">Cargando…</p>}

      {dias && (
        <div className="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
          <div className="space-y-5">
            <div className="card p-4">
              <h2 className="card-h2">
                Recorrido diario · {DIAS} días{esHoy ? "" : ` hasta ${hasta}`}{" "}
                (km)
              </h2>
              <BarChart
                bars={dias.map((d) => ({
                  date: d.date,
                  value: d.stats.totalDistanceM / 1000,
                }))}
                color="#0154ac"
                unit="km"
                digits={2}
              />
            </div>

            {/* El patrón pone combustible en esta segunda gráfica. Sin esa
                fuente, el equivalente medible es el tiempo en labor. */}
            <div className="card p-4">
              <h2 className="card-h2">
                Horas en labor · {DIAS} días{esHoy ? "" : ` hasta ${hasta}`} (h)
              </h2>
              <BarChart
                bars={dias.map((d) => ({
                  date: d.date,
                  value: d.stats.movingMinutes / 60,
                }))}
                color="#00b602"
                unit="h"
              />
            </div>
          </div>

          <div className="card p-4">
            <h2 className="card-h2">Jornadas</h2>
            <div className="max-h-[420px] overflow-y-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <Th>Día</Th>
                    <Th num>km</Th>
                    <Th num>Labor</Th>
                    <Th num>Det.</Th>
                    <Th>Jornada</Th>
                  </tr>
                </thead>
                <tbody>
                  {[...dias].reverse().map((d) => (
                    <tr
                      key={d.date}
                      // El día por el que se entró va marcado: es el que se
                      // estaba mirando en el mapa, y sin marcarlo la tabla son
                      // catorce filas iguales.
                      className={`${d.puntos === 0 ? "opacity-45" : ""} ${
                        d.date === hasta && !esHoy ? "bg-[#ecf1f4]" : ""
                      }`}>
                      <Td>
                        <span className="font-mono">{d.date.slice(5)}</span>
                      </Td>
                      <Td num>
                        {d.puntos
                          ? (d.stats.totalDistanceM / 1000).toFixed(2)
                          : "—"}
                      </Td>
                      <Td num>
                        {d.puntos ? fmtDuration(d.stats.movingMinutes) : "—"}
                      </Td>
                      <Td num>{d.puntos ? d.stats.stops : "—"}</Td>
                      <Td>
                        {d.puntos ? (
                          <span className="font-mono text-[11px]">
                            {fmtTime(d.primero)}–{fmtTime(d.ultimo)}
                          </span>
                        ) : (
                          <span className="text-ink-3">sin reportes</span>
                        )}
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-[10px] leading-tight text-ink-3">
              &quot;Jornada&quot; es del primer al último fix GPS del día, no el
              turno del operador: la máquina no reporta encendido ni apagado.
              Horómetro, combustible y mantenimiento no aparecen porque no
              existen en la base — requieren tablas propias.
            </p>
          </div>
        </div>
      )}

      {item?.estado === "offline" && (
        <p className="mt-5 rounded-card border border-border bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
          Esta máquina no reporta desde hace {fmtEdad(item.edadFixMin)} (umbral:{" "}
          {SIN_SENAL_MIN} min). Las cifras de arriba son históricas; su posición
          actual es desconocida.
        </p>
      )}
    </section>
  );
}

function horaDe(p: TrackPoint | undefined): string | null {
  if (!p) return null;
  return p.gps_time ?? p.sample_local;
}

function Th({
  children,
  num,
}: {
  children: React.ReactNode;
  num?: boolean;
}) {
  return (
    <th
      className={`border-b border-border px-2 py-1.5 text-[10px] uppercase tracking-[1.2px] text-ink-3 ${
        num ? "text-right" : "text-left"
      }`}
    >
      {children}
    </th>
  );
}

function Td({ children, num }: { children: React.ReactNode; num?: boolean }) {
  return (
    <td
      className={`border-b border-border px-2 py-2 ${
        num ? "text-right font-mono" : ""
      }`}
    >
      {children}
    </td>
  );
}
