"use client";

import { useState } from "react";
import type { CapaFija, CapasVisibles } from "@/lib/capas";

/**
 * Interruptores de las capas fijas del predio: parcelas, vías, líneas de palma
 * y acopios.
 *
 * Arranca plegado, en celular y en escritorio: es un botón de 44 px hasta que
 * alguien quiere apagar algo. Las capas se prenden y apagan al instante —sin
 * botón de aplicar— porque lo que se está decidiendo se ve en el mapa mientras
 * se toca.
 *
 * La muestra de color de cada renglón es la misma del mapa: es la leyenda, y
 * así no hace falta una segunda caja que explique qué es cada trazo.
 */

interface Props {
  capas: CapasVisibles;
  onCambio: (capas: CapasVisibles) => void;
}

const RENGLONES: { id: CapaFija; nombre: string; nota?: string }[] = [
  { id: "parcelas", nombre: "Bloques y parcelas", nota: "Un color por bloque" },
  { id: "vias", nombre: "Vías" },
  {
    id: "palmas",
    nombre: "Líneas de palma",
    // Los bloques con censo en Excel (ver scripts/xlsx-palmas-a-geojson.py).
    // Se nombran porque en el resto del predio la capa no dibuja nada, y sin
    // saberlo parece que no funciona.
    nota: "Sólo bloques 6, 7, 19 y 231",
  },
  { id: "acopios", nombre: "Acopios" },
];

export default function CapasMapa({ capas, onCambio }: Props) {
  const [abierto, setAbierto] = useState(false);
  const apagadas = RENGLONES.filter((r) => !capas[r.id]).length;

  if (!abierto) {
    return (
      <button
        type="button"
        onClick={() => setAbierto(true)}
        aria-label="Capas del mapa"
        aria-expanded={false}
        title="Capas del mapa"
        className="card relative grid h-11 w-11 place-items-center text-ink-2 shadow-card transition hover:text-accent"
      >
        <IconoCapas />
        {/* Aviso de que hay algo apagado: sin él, alguien que apagó las vías
            ayer abre el mapa hoy y cree que se perdieron. */}
        {apagadas > 0 && (
          <span className="absolute -right-1 -top-1 grid h-4 min-w-4 place-items-center rounded-full bg-accent px-1 text-[9px] font-bold leading-none text-white">
            {apagadas}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="card w-[min(240px,100%)] p-2 shadow-card">
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="t-label">Capas</span>
        <button
          type="button"
          onClick={() => setAbierto(false)}
          aria-label="Cerrar capas"
          aria-expanded={true}
          className="btn-chip"
        >
          ✕
        </button>
      </div>

      <ul>
        {RENGLONES.map((r) => (
          <li key={r.id}>
            <label className="flex min-h-[40px] cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1 hover:bg-bg">
              <input
                type="checkbox"
                className="h-4 w-4 shrink-0 accent-accent"
                checked={capas[r.id]}
                onChange={(e) =>
                  onCambio({ ...capas, [r.id]: e.target.checked })
                }
              />
              <Muestra capa={r.id} />
              <span className="min-w-0 leading-tight">
                <span className="block text-[12.5px] font-bold text-ink">
                  {r.nombre}
                </span>
                {r.nota && (
                  <span className="block text-[10.5px] text-ink-3">
                    {r.nota}
                  </span>
                )}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * La muestra copia el trazo del mapa (components/MapGL.tsx): si cambia un
 * color allá, se cambia aquí.
 */
function Muestra({ capa }: { capa: CapaFija }) {
  const caja = "h-4 w-6 shrink-0 rounded-[4px] bg-ink";
  if (capa === "parcelas") {
    return (
      <span className={`${caja} grid grid-cols-2 overflow-hidden`} aria-hidden="true">
        <span className="bg-[#60a5fa]/70" />
        <span className="bg-[#f472b6]/70" />
      </span>
    );
  }
  if (capa === "vias") {
    return (
      <svg className={caja} viewBox="0 0 24 16" aria-hidden="true">
        <path d="M2 12 C 8 12, 12 4, 22 4" stroke="#fbbf24" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      </svg>
    );
  }
  if (capa === "palmas") {
    return (
      <svg className={caja} viewBox="0 0 24 16" aria-hidden="true">
        {[4, 8, 12].map((y) => (
          <path key={y} d={`M3 ${y}H21`} stroke="#d9f99d" strokeWidth="1.2" strokeLinecap="round" />
        ))}
      </svg>
    );
  }
  return (
    <svg className={caja} viewBox="0 0 24 16" aria-hidden="true">
      <circle cx="12" cy="8" r="4" fill="#bcd983" fillOpacity="0.35" stroke="#bcd983" strokeWidth="1.4" />
    </svg>
  );
}

/** Tres hojas apiladas: el ícono de capas de cualquier visor de mapas. */
function IconoCapas() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
      <path d="M9 2 16 6 9 10 2 6Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M2 9.5 9 13.5 16 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M2 12.5 9 16.5 16 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
