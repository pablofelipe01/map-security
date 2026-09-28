"use client";

import { useEffect, useMemo, useState } from "react";
import type { CapaFija, CapasVisibles } from "@/lib/capas";
import {
  bloqueDe,
  cajaDe,
  indicePalmas,
  normalizarBusqueda,
  type BloquePalmas,
  type Caja,
  type SeleccionPalmas,
} from "@/lib/palmas";

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
  /** Bloques/parcelas de palma elegidos ("9", "9-4"). */
  palmas: SeleccionPalmas;
  onPalmas: (sel: SeleccionPalmas) => void;
  /** Llevar el mapa a una caja (al elegir un bloque o parcela). */
  onEncuadrar: (caja: Caja) => void;
}

const RENGLONES: { id: CapaFija; nombre: string; nota?: string }[] = [
  { id: "parcelas", nombre: "Bloques y parcelas", nota: "Un color por bloque" },
  { id: "vias", nombre: "Vías" },
  // La nota de las palmas depende de lo elegido: la arma `notaPalmas`.
  { id: "palmas", nombre: "Líneas de palma" },
  { id: "acopios", nombre: "Acopios" },
];

export default function CapasMapa({
  capas,
  onCambio,
  palmas,
  onPalmas,
  onEncuadrar,
}: Props) {
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
    <div
      className={`card p-2 shadow-card ${
        capas.palmas ? "w-[min(300px,100%)]" : "w-[min(240px,100%)]"
      }`}
    >
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
                {(r.id === "palmas" ? notaPalmas(palmas) : r.nota) && (
                  <span className="block text-[10.5px] text-ink-3">
                    {r.id === "palmas" ? notaPalmas(palmas) : r.nota}
                  </span>
                )}
              </span>
            </label>
            {r.id === "palmas" && capas.palmas && (
              <SelectorPalmas
                seleccion={palmas}
                onCambio={onPalmas}
                onEncuadrar={onEncuadrar}
              />
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

function notaPalmas(sel: SeleccionPalmas): string {
  if (!sel.length) return "Elige qué bloque o parcela cargar";
  return sel.length === 1 ? rotulo(sel[0]) : `${sel.length} elegidos`;
}

/** "9" → "Bloque 9"; "9-4" → "B.9 · P.4", como el rótulo del plano. */
function rotulo(clave: string): string {
  const [b, p] = clave.split("-");
  return p ? `B.${b} · P.${p}` : `Bloque ${b}`;
}

/**
 * Qué bloques y parcelas de palma se cargan.
 *
 * La capa no se carga entera (lib/palmas.ts): se elige acá. Un buscador arriba
 * porque con el censo completo serán decenas de bloques y cientos de parcelas,
 * y lo que se sabe al abrir esto es un número ("el 9", "la 9-4"). Se aceptan
 * los rótulos del plano tal cual ("B.9-P.4"). Enter elige el primer resultado.
 *
 * Elegir lleva el mapa hasta allá: si el bloque queda fuera de la vista, la
 * capa se cargaría sin que nada cambie en pantalla y parecería que no hizo nada.
 */
function SelectorPalmas({
  seleccion,
  onCambio,
  onEncuadrar,
}: {
  seleccion: SeleccionPalmas;
  onCambio: (sel: SeleccionPalmas) => void;
  onEncuadrar: (caja: Caja) => void;
}) {
  const [idx, setIdx] = useState<BloquePalmas[] | null>(null);
  const [q, setQ] = useState("");
  const [abiertos, setAbiertos] = useState<Set<string>>(new Set());

  useEffect(() => {
    let vivo = true;
    void indicePalmas().then((b) => {
      if (vivo) setIdx(b);
    });
    return () => {
      vivo = false;
    };
  }, []);

  const consulta = normalizarBusqueda(q);

  /** Bloques que pasan el filtro, y de cada uno las parcelas a mostrar. */
  const resultados = useMemo(() => {
    if (!idx) return [];
    const [qb, qp] = consulta.split("-");
    return (
      idx
        .filter((b) => !qb || b.bloque.startsWith(qb))
        .map((b) => ({
          b,
          parcelas:
            qp !== undefined && b.bloque === qb
              ? b.parcelas.filter((p) => p.parcela.split("-")[1].startsWith(qp))
              : b.parcelas,
        }))
        .filter((r) => r.parcelas.length)
        // El bloque escrito exacto va primero: con "1", el 1 antes que el 19.
        .sort((x, y) => Number(y.b.bloque === qb) - Number(x.b.bloque === qb))
    );
  }, [idx, consulta]);

  const elegir = (clave: string) => {
    let sel: SeleccionPalmas;
    if (seleccion.includes(clave)) {
      sel = seleccion.filter((k) => k !== clave);
    } else if (clave.includes("-")) {
      const b = bloqueDe(clave);
      if (seleccion.includes(b)) {
        // Desmarcar una parcela de un bloque elegido entero: quedan las demás.
        const resto =
          idx?.find((x) => x.bloque === b)?.parcelas.map((p) => p.parcela) ?? [];
        sel = [...seleccion.filter((k) => k !== b), ...resto.filter((p) => p !== clave)];
      } else {
        sel = [...seleccion, clave];
      }
    } else {
      // El bloque entero reemplaza a sus parcelas sueltas.
      sel = [...seleccion.filter((k) => bloqueDe(k) !== clave), clave];
    }
    onCambio(sel);
    const agrega = sel.length >= seleccion.length && !seleccion.includes(clave);
    if (agrega && idx) {
      const caja = cajaDe(idx, [clave]);
      if (caja) onEncuadrar(caja);
    }
  };

  const marcado = (parcela: string) =>
    seleccion.includes(parcela) || seleccion.includes(bloqueDe(parcela));

  const alternar = (b: string) =>
    setAbiertos((s) => {
      const n = new Set(s);
      if (n.has(b)) n.delete(b);
      else n.add(b);
      return n;
    });

  return (
    <div className="mb-1 ml-1 mt-0.5 border-l-2 border-border pl-2">
      <input
        type="search"
        className="field w-full text-[12.5px]"
        placeholder="Buscar bloque o parcela · ej. 9 o 9-4"
        aria-label="Buscar bloque o parcela"
        value={q}
        autoComplete="off"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key !== "Enter" || !resultados[0]) return;
          e.preventDefault();
          const { b, parcelas } = resultados[0];
          elegir(consulta.includes("-") && parcelas[0] ? parcelas[0].parcela : b.bloque);
        }}
      />

      {seleccion.length > 0 && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {seleccion.map((k) => (
            <span
              key={k}
              className="inline-flex items-center gap-1 rounded-full bg-bg px-2 py-0.5 text-[11px] font-bold text-ink"
            >
              <button
                type="button"
                className="hover:text-accent"
                title="Ir allá"
                onClick={() => {
                  const caja = idx && cajaDe(idx, [k]);
                  if (caja) onEncuadrar(caja);
                }}
              >
                {rotulo(k)}
              </button>
              <button
                type="button"
                aria-label={`Quitar ${rotulo(k)}`}
                className="text-ink-3 hover:text-accent"
                onClick={() => onCambio(seleccion.filter((x) => x !== k))}
              >
                ✕
              </button>
            </span>
          ))}
          {seleccion.length > 1 && (
            <button
              type="button"
              className="text-[11px] text-ink-3 underline hover:text-accent"
              onClick={() => onCambio([])}
            >
              Quitar todo
            </button>
          )}
        </div>
      )}

      <ul className="mt-1.5 max-h-[240px] overflow-y-auto pr-1">
        {idx === null && <li className="py-1 text-[11px] text-ink-3">Cargando bloques…</li>}
        {idx !== null && resultados.length === 0 && (
          <li className="py-1 text-[11px] text-ink-3">
            {idx.length ? "Ningún bloque con censo coincide." : "No hay censo de palmas cargado."}
          </li>
        )}
        {resultados.map(({ b, parcelas }) => {
          // Con la búsqueda puesta en una parcela, el bloque se muestra abierto.
          const abierto = abiertos.has(b.bloque) || consulta.includes("-");
          return (
            <li key={b.bloque}>
              <div className="flex min-h-[36px] items-center gap-2 rounded-lg px-1 hover:bg-bg">
                <input
                  type="checkbox"
                  className="h-4 w-4 shrink-0 accent-accent"
                  checked={seleccion.includes(b.bloque)}
                  onChange={() => elegir(b.bloque)}
                  aria-label={`Bloque ${b.bloque} entero`}
                />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
                  aria-expanded={abierto}
                  onClick={() => alternar(b.bloque)}
                >
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[12.5px] font-bold text-ink">
                      Bloque {b.bloque}
                    </span>
                    <span className="block text-[10.5px] text-ink-3">
                      {b.parcelas.length} parcelas · {b.lineas.toLocaleString("es-CO")} líneas
                    </span>
                  </span>
                  <span className="text-ink-3" aria-hidden="true">
                    {abierto ? "▾" : "▸"}
                  </span>
                </button>
              </div>
              {abierto && (
                <ul className="mb-1 ml-5">
                  {parcelas.map((p) => (
                    <li key={p.parcela}>
                      <label className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded-lg px-1 hover:bg-bg">
                        <input
                          type="checkbox"
                          className="h-4 w-4 shrink-0 accent-accent"
                          checked={marcado(p.parcela)}
                          onChange={() => elegir(p.parcela)}
                        />
                        <span className="text-[12px] text-ink">
                          P.{p.parcela.split("-")[1]}
                          <span className="ml-1.5 text-[10.5px] text-ink-3">
                            {p.lineas} líneas
                            {p.palmas ? ` · ${p.palmas.toLocaleString("es-CO")} palmas` : ""}
                          </span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
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
