"use client";

import { useState } from "react";
import { ChevronDown, Radio, Check, Layers } from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";
import type { NodeRow } from "@/lib/types";
import { fmtAgo } from "@/lib/geo";

/** Valor de `selected` que activa la vista de flota completa. */
export const ALL_NODES = "__all__";

interface Props {
  nodes: NodeRow[];
  selected: string | null;
  onSelect: (nodeId: string) => void;
}

export default function NodeSelector({ nodes, selected, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const isAll = selected === ALL_NODES;
  const current = nodes.find((n) => n.node_id === selected);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="glass-strong flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:border-live-cyan/40"
      >
        <span className="grid h-9 w-9 place-items-center rounded-lg bg-live-cyan/15 text-live-cyan">
          {isAll ? <Layers size={18} /> : <Radio size={18} />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-slate-100">
            {isAll
              ? "Todos los nodos"
              : current?.long_name ?? current?.node_id ?? "Selecciona un nodo"}
          </span>
          <span className="block truncate font-mono text-[11px] text-slate-400">
            {isAll
              ? `${nodes.length} en el mapa`
              : current
              ? current.node_id
              : `${nodes.length} disponibles`}
          </span>
        </span>
        <ChevronDown
          size={16}
          className={`text-slate-400 transition ${open ? "rotate-180" : ""}`}
        />
      </button>

      <AnimatePresence>
        {open && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
            <motion.ul
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15 }}
              className="glass-strong absolute z-20 mt-2 max-h-72 w-full overflow-auto rounded-xl p-1.5"
            >
              {nodes.length === 0 && (
                <li className="px-3 py-2 text-sm text-slate-400">Sin nodos</li>
              )}

              {nodes.length > 0 && (
                <li>
                  <button
                    onClick={() => {
                      onSelect(ALL_NODES);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                      isAll ? "bg-live-cyan/15" : "hover:bg-white/5"
                    }`}
                  >
                    <Layers size={15} className="shrink-0 text-live-cyan" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-slate-100">
                        Todos los nodos
                      </span>
                      <span className="block font-mono text-[11px] text-slate-400">
                        última posición de cada uno
                      </span>
                    </span>
                    {isAll && <Check size={15} className="text-live-cyan" />}
                  </button>
                  <div className="my-1 border-t border-white/10" />
                </li>
              )}

              {nodes.map((n) => {
                const active = n.node_id === selected;
                return (
                  <li key={n.node_id}>
                    <button
                      onClick={() => {
                        onSelect(n.node_id);
                        setOpen(false);
                      }}
                      className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition ${
                        active ? "bg-live-cyan/15" : "hover:bg-white/5"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm text-slate-100">
                          {n.long_name ?? n.node_id}
                        </span>
                        <span className="block font-mono text-[11px] text-slate-400">
                          {n.node_id} · visto {fmtAgo(n.last_seen)}
                        </span>
                      </span>
                      {active && <Check size={15} className="text-live-cyan" />}
                    </button>
                  </li>
                );
              })}
            </motion.ul>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
