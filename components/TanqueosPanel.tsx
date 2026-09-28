"use client";

import { useEffect, useState } from "react";
import {
  conConsumo,
  fetchTanqueos,
  fmtGal,
  MEDIDOR_META,
  medidorDe,
  type MaquinaCombustible,
  type TanqueoConConsumo,
} from "@/lib/combustible";
import { fmtTime } from "@/lib/geo";
import { shiftDay } from "@/lib/ranges";
import { Tile } from "./SidePanel";

interface Props {
  maquina: MaquinaCombustible;
  /** Ventana de la ficha, días incluidos. */
  desde: string;
  hasta: string;
}

/**
 * Tanqueos de la máquina, leídos de la app de control de combustible.
 *
 * Se pide un tramo ANTES de la ventana: el consumo de un tanqueo se mide contra
 * el horómetro del tanqueo anterior, y sin ese margen el primero de la ventana
 * saldría siempre sin gal/h. Lo de antes de `desde` no se muestra ni se suma.
 */
export default function TanqueosPanel({ maquina, desde, hasta }: Props) {
  const [filas, setFilas] = useState<TanqueoConConsumo[] | null>(null);
  const [truncado, setTruncado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    setFilas(null);
    setError(null);
    fetchTanqueos(maquina.codigo, shiftDay(desde, -30), hasta)
      .then((r) => {
        if (!vivo) return;
        setFilas(
          conConsumo(r.tanqueos, maquina).filter(
            (t) => t.fecha >= desde
          )
        );
        setTruncado(r.truncado);
      })
      .catch((e) => vivo && setError(String((e as Error)?.message ?? e)));
    return () => {
      vivo = false;
    };
  }, [maquina, desde, hasta]);

  const medidor = medidorDe(maquina);
  const meta = MEDIDOR_META[medidor];
  const galones = filas?.reduce((s, t) => s + t.galones, 0) ?? 0;
  // Promedio ponderado por tramo, no promedio de los rendimientos: un tramo de
  // 1 h con un tanqueo de ajuste pesaría lo mismo que una jornada entera.
  const conTramo = filas?.filter((t) => t.rendimiento != null) ?? [];
  const tramos = conTramo.reduce((s, t) => s + (t.tramo ?? 0), 0);
  const galTramos = conTramo.reduce((s, t) => s + t.galones, 0);
  const promedio =
    tramos > 0 && galTramos > 0
      ? medidor === "odometro"
        ? tramos / galTramos
        : galTramos / tramos
      : null;
  const ultimo = filas?.[0];

  return (
    <div className="card mb-6 p-4">
      <h2 className="card-h2">
        Tanqueos · {desde} → {hasta}
      </h2>
      <div className="mb-3 text-[11.5px] text-ink-2">
        {maquina.descripcion ?? maquina.codigo}
        {maquina.capacidadGal != null &&
          ` · tanque de ${fmtGal(maquina.capacidadGal)} gal`}
        {maquina.centroCosto && ` · C.C. ${maquina.centroCosto}`}
      </div>

      {error && (
        <p className="rounded-card border border-st-alerta/40 bg-[#fdf0f0] px-3 py-2 text-xs text-st-alerta">
          {error}
        </p>
      )}
      {!filas && !error && <p className="text-[12.5px] text-ink-3">Cargando…</p>}

      {filas && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label="Galones" value={fmtGal(galones)} unit="gal" />
            <Tile label="Tanqueos" value={String(filas.length)} />
            <Tile
              label={medidor === "odometro" ? "Rendimiento" : "Consumo"}
              value={promedio != null ? fmtGal(promedio) : "—"}
              unit={promedio != null ? meta.rendimiento : undefined}
            />
            <Tile
              label="Último tanqueo"
              value={ultimo ? ultimo.fecha.slice(5) : "—"}
              unit={ultimo ? `${fmtGal(ultimo.galones)} gal` : undefined}
            />
          </div>

          {filas.length === 0 ? (
            <p className="text-xs text-ink-3">
              Sin tanqueos registrados en la ventana.
            </p>
          ) : (
            <div className="max-h-[360px] overflow-auto">
              <table className="w-full border-collapse text-[12.5px]">
                <thead>
                  <tr>
                    <Th>Día</Th>
                    <Th num>Gal</Th>
                    <Th num>{meta.label}</Th>
                    <Th num>{meta.rendimiento}</Th>
                    <Th>Operario</Th>
                  </tr>
                </thead>
                <tbody>
                  {filas.map((t) => (
                    <tr
                      key={t.id}
                      className={t.excedeTanque ? "bg-[#fdf0f0]" : ""}
                      title={t.observaciones ?? undefined}
                    >
                      <Td>
                        <span className="font-mono">
                          {t.fecha.slice(5)}
                          {t.registradoEn && (
                            <span className="text-ink-3">
                              {" "}
                              {fmtTime(t.registradoEn)}
                            </span>
                          )}
                        </span>
                      </Td>
                      <Td num>
                        <span className={t.excedeTanque ? "text-st-alerta" : ""}>
                          {fmtGal(t.galones)}
                          {t.excedeTanque && " ⚠"}
                        </span>
                      </Td>
                      <Td num>
                        {t.horometro != null ? (
                          fmtGal(t.horometro)
                        ) : (
                          <span className="text-ink-3">
                            {t.horometroTexto ?? "—"}
                          </span>
                        )}
                      </Td>
                      <Td num>
                        {t.rendimiento != null ? (
                          <span
                            title={`${fmtGal(t.tramo ?? 0)} ${meta.tramo} desde el tanqueo anterior`}
                          >
                            {fmtGal(t.rendimiento)}
                          </span>
                        ) : (
                          "—"
                        )}
                      </Td>
                      <Td>
                        <span className="text-[11.5px]">{t.operario ?? "—"}</span>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {truncado && (
            <p className="mt-2 text-[11px] text-st-detenida">
              La consulta alcanzó el tope de filas: los totales pueden estar cortos.
            </p>
          )}
          <p className="mt-3 text-[10px] leading-tight text-ink-3">
            Fuente: app de control de combustible. El {meta.rendimiento} se mide
            contra la lectura del tanqueo anterior y sólo cuando las dos son
            números; una lectura &quot;N/A&quot; o dañada deja ese tramo sin
            consumo.
            {medidor === "odometro" &&
              " En los camiones el campo que la app llama horómetro es el odómetro (km)."}{" "}
            En rojo, tanqueos mayores que la capacidad del tanque.
          </p>
        </>
      )}
    </div>
  );
}

function Th({ children, num }: { children: React.ReactNode; num?: boolean }) {
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
      className={`border-b border-border px-2 py-2 ${num ? "text-right font-mono" : ""}`}
    >
      {children}
    </td>
  );
}
