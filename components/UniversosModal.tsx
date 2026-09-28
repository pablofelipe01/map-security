"use client";

import { useMemo, useState } from "react";
import type { FleetItem, NodeRow } from "@/lib/types";
import { ESTADO_META, fmtEdad } from "@/lib/fleet";
import { maquinaDe, TIPOS_MAQUINA } from "@/lib/tractores";
import { Dialogo } from "./Form";
import { MiniIcon } from "./SidePanel";

interface Props {
  mode: "live" | "history";
  /** Día al que se anclan los universos en histórico. */
  date: string;
  nodes: NodeRow[];
  /** Estado en vivo; null en histórico, donde no aplica. */
  fleet: FleetItem[] | null;
  onOpen: (nodeId: string) => void;
  onClose: () => void;
}

/**
 * Índice de universos: entrada directa a la ficha de cualquier máquina.
 *
 * Sin esto, al universo sólo se llegaba seleccionando la máquina en el mapa o en
 * el panel, y una máquina sin señal ni recorrido ese día —justo la que uno
 * quiere revisar— no tiene marcador que tocar. Por eso la lista sale de `nodes`
 * y no de lo que está dibujado.
 *
 * Se agrupa por tipo porque así se piensa la flota en campo ("los camiones",
 * "los tractores"), en el orden de `TIPOS_MAQUINA`.
 */
export default function UniversosModal({
  mode,
  date,
  nodes,
  fleet,
  onOpen,
  onClose,
}: Props) {
  const [q, setQ] = useState("");

  const grupos = useMemo(() => {
    const porNodo = new Map(fleet?.map((f) => [f.node.node_id, f]) ?? []);
    const texto = q.trim().toLowerCase();
    const filas = nodes
      .map((n) => ({
        node: n,
        maq: maquinaDe(n.node_id, n.long_name, n.short_name),
        item: porNodo.get(n.node_id) ?? null,
      }))
      .filter(
        ({ maq, node }) =>
          !texto ||
          `${maq.codigo} ${maq.nombre} ${node.node_id}`
            .toLowerCase()
            .includes(texto)
      );

    return TIPOS_MAQUINA.map((t) => ({
      ...t,
      filas: filas
        .filter((f) => f.maq.tipo === t.valor)
        .sort((a, b) => a.maq.codigo.localeCompare(b.maq.codigo, "es")),
    })).filter((g) => g.filas.length > 0);
  }, [nodes, fleet, q]);

  return (
    <Dialogo ancho={460} onClose={onClose}>
      <div className="mb-1 text-[15px] font-extrabold">Universos de máquinas</div>
      <p className="mb-3 text-[11.5px] text-ink-2">
        {mode === "history"
          ? `Se abren anclados al ${date}, el día que estás mirando.`
          : "Ficha de 14 días de cada máquina, hasta hoy."}
      </p>

      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por código o nombre"
        className="mb-3 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink md:h-10"
      />

      {grupos.length === 0 && (
        <p className="py-6 text-center text-xs text-ink-2">
          {nodes.length === 0
            ? "Todavía no se cargan los nodos."
            : "Ninguna máquina coincide."}
        </p>
      )}

      {grupos.map((g) => (
        <section key={g.valor} className="mb-3">
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[1.5px] text-ink-3">
            {g.label} · {g.filas.length}
          </div>
          <div className="grid gap-1.5">
            {g.filas.map(({ node, maq, item }) => (
              <button
                key={node.node_id}
                onClick={() => onOpen(node.node_id)}
                className="flex min-h-11 items-center gap-2.5 rounded-[12px] border border-border bg-surface px-3 py-2 text-left transition hover:border-accent-2"
              >
                <MiniIcon tipo={maq.tipo} color={maq.color} className="h-7 w-7" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-ink">
                    {maq.nombre}
                  </span>
                  <span className="block truncate text-[11px] text-ink-2">
                    {maq.codigo}
                    {item && (
                      <>
                        {" · "}
                        <span className={ESTADO_META[item.estado].texto}>
                          {ESTADO_META[item.estado].label}
                        </span>
                        {item.edadFixMin != null &&
                          ` · fix hace ${fmtEdad(item.edadFixMin)}`}
                      </>
                    )}
                  </span>
                </span>
                {item && <span className={`st-dot ${item.estado}`} />}
                <span className="text-ink-3">→</span>
              </button>
            ))}
          </div>
        </section>
      ))}

      <button className="btn-ghost mt-1" onClick={onClose}>
        Cerrar
      </button>
    </Dialogo>
  );
}
