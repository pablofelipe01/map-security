"use client";

import { useEffect, useMemo, useState } from "react";
import BarChart from "./BarChart";
import { Tile } from "./SidePanel";
import { fmtTime, fmtDateTime } from "@/lib/geo";
import { bogotaDay, shiftDay } from "@/lib/ranges";
import {
  fetchPorteria,
  resumirPorteria,
  type Porteria,
  type RegistroPorteria,
} from "@/lib/porteria";

interface Props {
  /** Nodo del puesto: es el `nodo_origen` con el que Airtable sella cada fila. */
  nodeId: string;
  /** Ventana de días de Bogotá, ambos incluidos (la misma de la ficha). */
  desde: string;
  hasta: string;
  /** Nombre del puesto, para que los textos hablen de "la portería tal". */
  nombre: string;
}

type Filtro = "todos" | "entradas" | "salidas" | "negados";

/**
 * Los ingresos registrados en una portería.
 *
 * Es el bloque que contesta lo que un puesto fijo sí tiene para contar. Un
 * tractor reporta kilómetros; una portería no se mueve, y sus cifras de
 * recorrido son el ruido de su propio GPS (ver lib/puestos.ts). Lo que pasa en
 * ella lo registra la app de control de acceso, y es esto: quién entró, a qué
 * hora, en qué placa y con qué autorización.
 *
 * El dato viene de Airtable por `/api/porteria`, no de Supabase: son dos
 * sistemas distintos que sólo se tocan en el `node_id`.
 */
export default function PorteriaPanel({ nodeId, desde, hasta, nombre }: Props) {
  const [data, setData] = useState<Porteria | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("todos");

  useEffect(() => {
    let vivo = true;
    setData(null);
    setError(null);
    fetchPorteria(nodeId, desde, hasta)
      .then((d) => {
        if (vivo) setData(d);
      })
      .catch((e: Error) => {
        if (vivo) setError(e.message);
      });
    return () => {
      vivo = false;
    };
  }, [nodeId, desde, hasta]);

  const registros = useMemo(() => data?.registros ?? [], [data]);
  const resumen = useMemo(() => resumirPorteria(registros), [registros]);

  /**
   * Entradas por día. Se arma la lista de días de la ventana y se cuenta sobre
   * ella, no sobre los días que tuvieron movimiento: un día sin ingresos es un
   * dato —la portería estuvo cerrada o nadie llegó—, y comprimirlo haría que el
   * eje mintiera igual que en las gráficas de la flota.
   */
  const barras = useMemo(() => {
    const dias: string[] = [];
    for (let d = desde; d <= hasta; d = shiftDay(d, 1)) dias.push(d);
    const cuenta = new Map(dias.map((d) => [d, 0]));
    for (const r of registros) {
      if (r.tipo === "SALIDA" || r.tipo === "SALIDA_SIN_ENTRADA") continue;
      const dia = bogotaDay(r.t);
      const previo = cuenta.get(dia);
      if (previo !== undefined) cuenta.set(dia, previo + 1);
    }
    return dias.map((date) => ({ date, value: cuenta.get(date) ?? 0 }));
  }, [registros, desde, hasta]);

  const visibles = useMemo(
    () => registros.filter((r) => pasaFiltro(r, filtro)),
    [registros, filtro]
  );

  return (
    <section className="mb-6">
      <div className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[15px] font-extrabold">
          Ingresos registrados en {nombre}
        </h2>
        <span className="text-[11px] text-ink-3">
          {desde} → {hasta} · fuente: app de control de acceso
        </span>
      </div>

      {error && (
        <p className="mb-4 rounded-card border border-st-alerta/40 bg-[#fdf0f0] px-3 py-2 text-xs text-st-alerta">
          No se pudieron leer los registros de portería: {error}
        </p>
      )}

      {!data && !error && (
        <p className="text-[12.5px] text-ink-3">Cargando registros…</p>
      )}

      {data && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Tile label="Entradas" value={String(resumen.entradas)} />
            <Tile label="Salidas" value={String(resumen.salidas)} />
            <Tile label="Vehículos" value={String(resumen.vehiculos)} />
            <Tile label="Peatones" value={String(resumen.peatones)} />
            <Tile label="Negados" value={String(resumen.negados)} />
          </div>

          {data.truncado && (
            <p className="mb-4 rounded-card border border-border bg-surface-2 px-3 py-2.5 text-xs text-ink-2">
              La ventana tiene más registros de los que se traen de una vez: lo
              de abajo es una parte, no el total del periodo.
            </p>
          )}

          <div className="grid items-start gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div className="card p-4">
              <h3 className="card-h2">Entradas por día</h3>
              <BarChart
                bars={barras}
                color="#0154ac"
                unit="ingresos"
                digits={0}
              />
              <p className="mt-3 text-[10px] leading-tight text-ink-3">
                Cuenta eventos de entrada, no personas distintas: un vehículo
                que entra y sale dos veces en el día son dos entradas. Las
                salidas no suman aquí.
              </p>
            </div>

            <div className="card p-4">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="card-h2 mb-0">Movimientos</h3>
                <div className="flex gap-1">
                  {FILTROS.map(([k, label]) => (
                    <button
                      key={k}
                      onClick={() => setFiltro(k)}
                      className={`rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-[1px] transition-colors ${
                        filtro === k
                          ? "border-[#0154ac] bg-[#0154ac] text-white"
                          : "border-border text-ink-2 hover:bg-surface-2"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {visibles.length === 0 ? (
                <p className="py-4 text-[12.5px] text-ink-3">
                  Sin registros en este filtro.
                </p>
              ) : (
                <div className="max-h-[420px] overflow-y-auto">
                  <table className="w-full border-collapse text-[12.5px]">
                    <thead>
                      <tr>
                        <Th>Cuándo</Th>
                        <Th>Quién</Th>
                        <Th>Evento</Th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibles.map((r) => (
                        <Fila key={r.id} r={r} />
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <p className="mt-3 text-[10px] leading-tight text-ink-3">
                {visibles.length} de {registros.length} registros de la ventana.
                Vienen de Airtable, no de la malla: la portería puede registrar
                un ingreso aunque su nodo esté sin señal.
              </p>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

const FILTROS: [Filtro, string][] = [
  ["todos", "Todos"],
  ["entradas", "Entradas"],
  ["salidas", "Salidas"],
  ["negados", "Negados"],
];

function Fila({ r }: { r: RegistroPorteria }) {
  const salida = r.tipo === "SALIDA" || r.tipo === "SALIDA_SIN_ENTRADA";
  const negado = r.estado === "NEGADO";

  return (
    <tr className={negado ? "bg-[#fdf0f0]" : ""}>
      <Td>
        <div className="font-mono text-[11px]">{fmtDateTime(r.t)}</div>
        {/* Entrada y salida en la misma fila: es la estadía del visitante, y
            saber que sigue adentro es media pregunta de una portería. */}
        {r.entrada && r.salida && (
          <div className="text-[10px] text-ink-3">
            {fmtTime(r.entrada)} → {fmtTime(r.salida)}
          </div>
        )}
        {r.entrada && !r.salida && !salida && (
          <div className="text-[10px] text-ink-3">sin salida registrada</div>
        )}
      </Td>
      <Td>
        <div className="font-semibold">{r.nombre ?? "—"}</div>
        <div className="text-[10px] text-ink-3">
          {[r.placa, r.cedula].filter(Boolean).join(" · ") || "—"}
        </div>
        {r.motivo && (
          <div className="mt-0.5 text-[10px] text-ink-2" title={r.motivo}>
            {r.motivo.split("\n")[0]}
          </div>
        )}
      </Td>
      <Td>
        <span
          className="inline-flex rounded-full border px-2 py-0.5 text-[9.5px] font-extrabold uppercase tracking-[1px]"
          style={
            negado
              ? { color: "#c0392b", borderColor: "#c0392b" }
              : salida
                ? { color: "#6b7a86", borderColor: "#c9d4dc" }
                : { color: "#00860a", borderColor: "#00860a" }
          }
        >
          {salida ? "Salida" : "Entrada"}
        </span>
        <div className="mt-1 text-[10px] text-ink-3">
          {r.categoria === "PEATON"
            ? "A pie"
            : r.categoria === "VEHICULO"
              ? "Vehículo"
              : (r.categoria ?? "—")}
        </div>
        {/* Quién autorizó es lo que convierte el registro en trazabilidad: sin
            eso la fila dice que alguien entró, pero no bajo la firma de quién. */}
        {(r.autorizadoPor || r.supervisor) && (
          <div className="text-[10px] text-ink-3">
            {r.autorizadoPor ?? r.supervisor}
          </div>
        )}
        {r.estado && r.estado !== "APROBADO" && (
          <div className="text-[10px] font-semibold text-st-alerta">
            {r.estado.replace(/_/g, " ").toLowerCase()}
          </div>
        )}
      </Td>
    </tr>
  );
}

function pasaFiltro(r: RegistroPorteria, f: Filtro): boolean {
  const salida = r.tipo === "SALIDA" || r.tipo === "SALIDA_SIN_ENTRADA";
  if (f === "entradas") return !salida;
  if (f === "salidas") return salida;
  if (f === "negados") return r.estado === "NEGADO";
  return true;
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="border-b border-border px-2 py-1.5 text-left text-[10px] uppercase tracking-[1.2px] text-ink-3">
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="border-b border-border px-2 py-2 align-top">{children}</td>
  );
}
