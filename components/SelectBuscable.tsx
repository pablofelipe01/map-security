"use client";

import { useId, useMemo, useRef, useState } from "react";

export interface OpcionBuscable {
  valor: string;
  texto: string;
  /** Encabezado bajo el que se agrupa (como un `<optgroup>`). */
  grupo?: string;
  /** Se muestra aunque no coincida con lo escrito: "➕ Registrar uno nuevo"
   *  hace más falta justo cuando la búsqueda no encuentra nada. */
  siempre?: boolean;
}

/** Minúsculas y sin tildes: "Jehisón" y "jehison" son lo mismo al buscar. */
function plano(t: string): string {
  return t
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Un `<select>` en el que se puede escribir para filtrar.
 *
 * Con sesenta máquinas o treinta operadores, el desplegable nativo es bajar y
 * buscar con la vista. Acá se escribe un pedazo —del nombre, del código, en
 * cualquier orden: "jehi reyes" encuentra a "REYES CRUZ JEHISON"— y la lista
 * se achica mientras se escribe. Flechas y Enter eligen sin soltar el teclado.
 *
 * LA LISTA VA EN EL FLUJO, NO FLOTANDO. Vive dentro de diálogos con su propio
 * desplazamiento: una lista absoluta quedaba cortada por el borde del diálogo
 * o tapando el botón de guardar. En el flujo empuja lo de abajo y siempre se
 * ve entera.
 *
 * Sigue siendo una elección contra la lista, no texto libre: lo escrito sólo
 * filtra, y si se sale sin elegir vuelve a mostrar lo que estaba elegido.
 */
export default function SelectBuscable({
  valor,
  opciones,
  onChange,
  placeholder = "Escribe para buscar…",
  vacio = "— sin cambios —",
  disabled,
}: {
  valor: string;
  opciones: OpcionBuscable[];
  onChange: (valor: string) => void;
  placeholder?: string;
  /** Cómo se lee "nada elegido" (valor ""). */
  vacio?: string;
  disabled?: boolean;
}) {
  const idLista = useId();
  const input = useRef<HTMLInputElement>(null);
  const [abierto, setAbierto] = useState(false);
  const [q, setQ] = useState("");
  const [activo, setActivo] = useState(0);

  const elegida = opciones.find((o) => o.valor === valor) ?? null;

  const filtradas = useMemo(() => {
    const palabras = plano(q).split(/\s+/).filter(Boolean);
    if (palabras.length === 0) return opciones;
    return opciones.filter((o) => {
      if (o.siempre) return true;
      const t = plano(o.texto);
      return palabras.every((p) => t.includes(p));
    });
  }, [opciones, q]);

  const abrir = () => {
    if (disabled) return;
    setQ("");
    setActivo(0);
    setAbierto(true);
  };

  const elegir = (o: OpcionBuscable) => {
    onChange(o.valor);
    setAbierto(false);
    input.current?.blur();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!abierto) {
      if (e.key === "ArrowDown" || e.key === "Enter") {
        e.preventDefault();
        abrir();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActivo((i) => Math.min(i + 1, filtradas.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActivo((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtradas[activo];
      if (o) elegir(o);
    } else if (e.key === "Escape") {
      // Que el Escape cierre la lista y no el diálogo entero.
      e.stopPropagation();
      e.nativeEvent.stopImmediatePropagation();
      setAbierto(false);
    }
  };

  return (
    <div>
      <div className="relative">
        <input
          ref={input}
          className="field w-full pr-8"
          role="combobox"
          aria-expanded={abierto}
          aria-controls={idLista}
          aria-autocomplete="list"
          autoComplete="off"
          disabled={disabled}
          placeholder={abierto ? placeholder : vacio}
          value={abierto ? q : (elegida?.texto ?? "")}
          onFocus={abrir}
          onClick={() => !abierto && abrir()}
          onBlur={() => setAbierto(false)}
          onChange={(e) => {
            setQ(e.target.value);
            setActivo(0);
            setAbierto(true);
          }}
          onKeyDown={onKeyDown}
        />
        {/* Volver a "sin cambios" sin tener que buscar esa opción. */}
        {valor && !abierto && !disabled && (
          <button
            type="button"
            aria-label="Quitar selección"
            className="absolute right-1 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-[15px] text-ink-3 hover:bg-bg hover:text-ink"
            onClick={() => onChange("")}
          >
            ×
          </button>
        )}
      </div>

      {abierto && (
        <ul
          id={idLista}
          role="listbox"
          className="mt-1 max-h-[240px] overflow-y-auto rounded-xl border border-border bg-surface py-1 shadow-card"
          // Que el toque en la lista no le quite el foco al campo antes de
          // registrar la elección.
          onMouseDown={(e) => e.preventDefault()}
        >
          {filtradas.every((o) => o.siempre) && (
            <li className="px-3 py-2 text-[12px] text-ink-3">
              Nada coincide con “{q}”.
            </li>
          )}
          {filtradas.map((o, i) => {
            const encabezado =
              o.grupo && o.grupo !== filtradas[i - 1]?.grupo ? o.grupo : null;
            return (
              <li key={o.valor} role="presentation">
                {encabezado && (
                  <div className="px-3 pb-0.5 pt-2 text-[10px] font-bold uppercase tracking-wide text-ink-3">
                    {encabezado}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={o.valor === valor}
                  className={`cursor-pointer px-3 py-2 text-[12.5px] leading-tight ${
                    i === activo ? "bg-accent-2/15 text-ink" : "text-ink"
                  } ${o.valor === valor ? "font-bold" : ""}`}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => elegir(o)}
                >
                  {o.texto}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
