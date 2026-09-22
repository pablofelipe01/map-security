"use client";

import { useMemo } from "react";
import { resolverAcopio } from "@/lib/vagones";
import type { Acopio } from "@/lib/acopios";

/**
 * Las dos casillas del papel: BLOQUE y ACOPIO.
 *
 * SE ESCRIBE COMO EN LA HOJA, a propósito. El que despacha lleva años
 * anotando "334" y "68" en dos cuadritos, y el selector de acopios que ya
 * existe (`components/SelectorAcopios.tsx`) le pediría buscar "B.334-P.2 (R.)
 * · 68" en una lista de 845. Ese selector es para el coordinador que arma una
 * ruta mirando el mapa; éste es para el señor que tiene el radio en la oreja y
 * tres renglones atrasados. Dos campos de dos dígitos se llenan sin mirar.
 *
 * LO QUE AGREGA SOBRE EL PAPEL. En la hoja esos dos números no los comprueba
 * nadie: si el bloque no existe, el renglón queda apuntando a ninguna parte y
 * se descubre cuando el tractor llega y no hay nada. Acá se resuelven contra la
 * tabla mientras se escribe y el resultado se ve debajo — el código completo
 * del acopio si existe, o el aviso de que no. Es la única validación que el
 * papel no puede hacer y la razón de peso para pasar la hoja a la app.
 */

interface Props {
  bloque: string;
  num: string;
  acopios: Acopio[];
  onChange: (bloque: string, num: string) => void;
  /** El acopio que quedó resuelto, o null. Sube para que el padre lo guarde. */
  onResuelto: (acopio: Acopio | null) => void;
  /** Rótulo de la pareja de casillas ("Vagones llenos", "Ubicación"). */
  label: string;
  /** Sin esto, no llenar las casillas es un error; con esto, es lo normal. */
  opcional?: boolean;
  disabled?: boolean;
}

export default function CasillasAcopio({
  bloque,
  num,
  acopios,
  onChange,
  onResuelto,
  label,
  opcional,
  disabled,
}: Props) {
  const vacio = !bloque.trim() && !num.trim();

  /**
   * Los candidatos. Es una lista y no un acopio porque (bloque, num) identifica
   * un punto solo salvo en dos situaciones reales del plano: el `B.5 · 2` está
   * duplicado, y los 44 puntos sin bloque rotulado repiten números entre sí.
   * Elegir el primero por el usuario sería decidir por él justo cuando hay que
   * preguntarle.
   */
  const candidatos = useMemo(() => {
    if (vacio) return [];
    return resolverAcopio(acopios, bloque, num);
  }, [acopios, bloque, num, vacio]);

  const unico = candidatos.length === 1 ? candidatos[0] : null;

  // El padre se entera del resultado sin guardarlo dos veces: lo que se guarda
  // es el id del acopio, y las casillas son sólo cómo se escribió.
  const emitir = (b: string, n: string) => {
    onChange(b, n);
    const c = !b.trim() && !n.trim() ? [] : resolverAcopio(acopios, b, n);
    onResuelto(c.length === 1 ? c[0] : null);
  };

  return (
    <div>
      <span className="t-label mb-1 block">{label}</span>

      {/* En celular las dos casillas se reparten el ancho disponible (con tope,
          para que no queden dos campos gigantes para dos dígitos); en
          escritorio vuelven a medir lo que mide el dato. */}
      <div className="flex items-center gap-1.5">
        <Casilla
          valor={bloque}
          placeholder="Bloque"
          disabled={disabled}
          onChange={(v) => emitir(v, num)}
        />
        <span className="text-ink-3">·</span>
        <Casilla
          valor={num}
          placeholder="Acopio"
          disabled={disabled}
          onChange={(v) => emitir(bloque, v)}
        />
      </div>

      <div className="mt-1 min-h-[14px] text-[10px] leading-tight">
        {vacio ? (
          <span className="text-ink-3">
            {opcional ? "Sin ubicación de vagón" : "Escribe bloque y acopio"}
          </span>
        ) : unico ? (
          <span className="text-brand-green">{unico.codigo}</span>
        ) : candidatos.length === 0 ? (
          <span className="text-st-alerta">
            No hay un acopio {bloque.trim() ? `en el bloque ${bloque.trim()}` : "sin bloque"} con
            ese número.
          </span>
        ) : (
          <span className="text-st-detenida">
            Hay {candidatos.length} acopios así ({candidatos.map((c) => c.codigo).join(", ")}).
            Falta el lote para saber cuál.
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * Una casilla.
 *
 * `inputMode="numeric"` y no `type="number"`: los números de acopio incluyen
 * "8A" y "9A", así que el campo tiene que aceptar letras. Lo que se busca es
 * que el teclado del celular abra en números, no que el navegador valide.
 */
function Casilla({
  valor,
  placeholder,
  disabled,
  onChange,
}: {
  valor: string;
  placeholder: string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <input
      className="field mono min-w-0 flex-1 text-center md:max-w-[62px] md:flex-none"
      value={valor}
      placeholder={placeholder}
      inputMode="numeric"
      autoComplete="off"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}
