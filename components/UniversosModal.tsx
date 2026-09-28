"use client";

import { useMemo, useState } from "react";
import type { FleetItem, NodeRow } from "@/lib/types";
import { ESTADO_META, fmtEdad } from "@/lib/fleet";
import {
  COLOR_DEFAULT,
  maquinaDe,
  TIPOS_MAQUINA,
  type Maquina,
  type TipoMaquina,
} from "@/lib/tractores";
import {
  emparejar,
  fmtGal,
  normCodigo,
  tipoDeDescripcion,
  type MaquinaCombustible,
} from "@/lib/combustible";
import { Dialogo } from "./Form";
import { MiniIcon } from "./SidePanel";

interface Props {
  mode: "live" | "history";
  /** Día al que se anclan los universos en histórico. */
  date: string;
  nodes: NodeRow[];
  /** Estado en vivo; null en histórico, donde no aplica. */
  fleet: FleetItem[] | null;
  /** Parque de la base de combustible. null = cargando o no respondió. */
  catalogo: MaquinaCombustible[] | null;
  catalogoError: string | null;
  onOpen: (nodeId: string) => void;
  /** Abre el universo de una máquina que sólo existe en Airtable. */
  onOpenCombustible: (codigo: string) => void;
  onClose: () => void;
}

type Fila =
  | {
      clase: "nodo";
      key: string;
      node: NodeRow;
      maq: Maquina;
      item: FleetItem | null;
      air: MaquinaCombustible | null;
    }
  | { clase: "air"; key: string; air: MaquinaCombustible; tipo: TipoMaquina };

/**
 * En el índice, `retro` agrupa toda la maquinaria amarilla que viene de
 * Airtable (excavadoras, bulldozer, cargadores), no sólo retroexcavadoras.
 */
const LABEL_GRUPO: Partial<Record<TipoMaquina, string>> = {
  retro: "Maquinaria amarilla",
};

/**
 * Índice de universos: entrada directa a la ficha de cualquier máquina.
 *
 * Junta dos fuentes. Los nodos de la torre (Supabase), que son lo que tiene
 * GPS; y el parque de la app de combustible (Airtable), que es el listado
 * completo de máquinas de la empresa. Se cruzan por código (`emparejar`): una
 * máquina con nodo sale UNA vez, con su estado en vivo y su descripción de
 * Airtable, y las que sólo están en Airtable salen como "sin nodo" y abren una
 * ficha de tanqueos.
 *
 * La lista de nodos sale de `nodes` y no de lo dibujado: una máquina sin señal
 * ni recorrido ese día —justo la que uno quiere revisar— no tiene marcador que
 * tocar.
 */
export default function UniversosModal({
  mode,
  date,
  nodes,
  fleet,
  catalogo,
  catalogoError,
  onOpen,
  onOpenCombustible,
  onClose,
}: Props) {
  const [q, setQ] = useState("");
  const [soloNodos, setSoloNodos] = useState(false);

  const { grupos, nNodos, nTotal } = useMemo(() => {
    const porNodo = new Map(fleet?.map((f) => [f.node.node_id, f]) ?? []);
    const cat = catalogo ?? [];

    const deNodos: Fila[] = nodes.map((n) => {
      const maq = maquinaDe(n.node_id, n.long_name, n.short_name);
      return {
        clase: "nodo",
        key: n.node_id,
        node: n,
        maq,
        item: porNodo.get(n.node_id) ?? null,
        // Una portería no se tanquea: no se le busca par.
        air: maq.tipo === "porteria" ? null : emparejar(maq.codigo, cat),
      };
    });
    const conNodo = new Set(
      deNodos.flatMap((f) =>
        f.clase === "nodo" && f.air ? [normCodigo(f.air.codigo)] : []
      )
    );
    const soloAir: Fila[] = cat
      .filter((m) => !conNodo.has(normCodigo(m.codigo)))
      .map((m) => ({
        clase: "air",
        key: `air:${m.codigo}`,
        air: m,
        tipo: tipoDeDescripcion(m.descripcion),
      }));

    const texto = q.trim().toLowerCase();
    const filas = [...deNodos, ...(soloNodos ? [] : soloAir)].filter((f) => {
      if (!texto) return true;
      const s =
        f.clase === "nodo"
          ? `${f.maq.codigo} ${f.maq.nombre} ${f.node.node_id} ${f.air?.codigo ?? ""} ${f.air?.descripcion ?? ""}`
          : `${f.air.codigo} ${f.air.descripcion ?? ""}`;
      return s.toLowerCase().includes(texto);
    });

    const tipoDe = (f: Fila) => (f.clase === "nodo" ? f.maq.tipo : f.tipo);
    const grupos = TIPOS_MAQUINA.map((t) => ({
      valor: t.valor,
      label: LABEL_GRUPO[t.valor] ?? t.label,
      // Con nodo primero: son las que tienen algo que ver ahora mismo.
      filas: filas
        .filter((f) => tipoDe(f) === t.valor)
        .sort((a, b) => {
          if (a.clase !== b.clase) return a.clase === "nodo" ? -1 : 1;
          if (a.clase === "nodo" && b.clase === "nodo")
            return a.maq.codigo.localeCompare(b.maq.codigo, "es");
          if (a.clase === "air" && b.clase === "air")
            return (a.air.item ?? 1e9) - (b.air.item ?? 1e9);
          return 0;
        }),
    })).filter((g) => g.filas.length > 0);

    return {
      grupos,
      nNodos: deNodos.length,
      nTotal: deNodos.length + soloAir.length,
    };
  }, [nodes, fleet, catalogo, q, soloNodos]);

  return (
    <Dialogo ancho={480} onClose={onClose}>
      <div className="mb-1 text-[15px] font-extrabold">Universos de máquinas</div>
      <p className="mb-3 text-[11.5px] text-ink-2">
        {mode === "history"
          ? `Se abren anclados al ${date}, el día que estás mirando.`
          : "Recorrido y tanqueos de cada máquina, hasta hoy."}
      </p>

      <div className="mb-2 grid grid-cols-2 gap-1.5 rounded-xl bg-surface-2 p-1">
        <Tab activa={!soloNodos} onClick={() => setSoloNodos(false)}>
          Todas ({nTotal})
        </Tab>
        <Tab activa={soloNodos} onClick={() => setSoloNodos(true)}>
          Con nodo ({nNodos})
        </Tab>
      </div>

      <input
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Buscar por código, nombre o modelo"
        className="mb-3 h-11 w-full rounded-[10px] border border-border bg-surface px-3 text-[13px] text-ink md:h-10"
      />

      {catalogoError && (
        <p className="mb-3 rounded-[10px] bg-[#fdf7ea] px-2.5 py-2 text-[11px] leading-tight text-st-detenida">
          No se pudo leer el parque de la app de combustible ({catalogoError}).
          Se muestran sólo las máquinas con nodo.
        </p>
      )}
      {!catalogo && !catalogoError && (
        <p className="mb-3 text-[11px] text-ink-3">Cargando el parque de Airtable…</p>
      )}

      {grupos.length === 0 && (
        <p className="py-6 text-center text-xs text-ink-2">
          {nodes.length === 0 && !catalogo
            ? "Todavía no se cargan las máquinas."
            : "Ninguna máquina coincide."}
        </p>
      )}

      {grupos.map((g) => (
        <section key={g.valor} className="mb-3">
          <div className="mb-1.5 text-[10.5px] font-bold uppercase tracking-[1.5px] text-ink-3">
            {g.label} · {g.filas.length}
          </div>
          <div className="grid gap-1.5">
            {g.filas.map((f) =>
              f.clase === "nodo" ? (
                <FilaNodo key={f.key} f={f} onClick={() => onOpen(f.node.node_id)} />
              ) : (
                <FilaAir
                  key={f.key}
                  air={f.air}
                  tipo={f.tipo}
                  onClick={() => onOpenCombustible(f.air.codigo)}
                />
              )
            )}
          </div>
        </section>
      ))}

      <button className="btn-ghost mt-1" onClick={onClose}>
        Cerrar
      </button>
    </Dialogo>
  );
}

function FilaNodo({
  f,
  onClick,
}: {
  f: Extract<Fila, { clase: "nodo" }>;
  onClick: () => void;
}) {
  const { maq, item, air } = f;
  return (
    <button
      onClick={onClick}
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
              {item.edadFixMin != null && ` · fix hace ${fmtEdad(item.edadFixMin)}`}
            </>
          )}
        </span>
        {air && (
          <span className="block truncate text-[10.5px] text-ink-3">
            {air.descripcion ?? air.codigo}
            {normCodigo(air.codigo) !== normCodigo(maq.codigo) && ` · ${air.codigo}`}
          </span>
        )}
      </span>
      {item && <span className={`st-dot ${item.estado}`} />}
      <span className="text-ink-3">→</span>
    </button>
  );
}

function FilaAir({
  air,
  tipo,
  onClick,
}: {
  air: MaquinaCombustible;
  tipo: TipoMaquina;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title="Sin nodo de rastreo: su universo muestra sólo tanqueos"
      className="flex min-h-11 items-center gap-2.5 rounded-[12px] border border-dashed border-border bg-surface-2 px-3 py-2 text-left transition hover:border-accent-2"
    >
      <MiniIcon tipo={tipo} color={COLOR_DEFAULT} className="h-7 w-7 opacity-50" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-ink">
          {air.codigo}
        </span>
        <span className="block truncate text-[11px] text-ink-2">
          {air.descripcion ?? "—"}
          {air.capacidadGal != null && ` · ${fmtGal(air.capacidadGal)} gal`}
        </span>
      </span>
      <span className="text-[10px] font-bold uppercase tracking-[1px] text-ink-3">
        sin nodo
      </span>
      <span className="text-ink-3">→</span>
    </button>
  );
}

function Tab({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`min-h-9 rounded-[10px] text-xs font-bold transition ${
        activa ? "bg-surface text-accent shadow-card" : "text-ink-2 hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
