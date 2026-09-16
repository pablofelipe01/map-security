"use client";

import { COLORES_FLOTA } from "@/lib/tractores";

/**
 * Piezas de formulario compartidas por los diálogos de flota.
 *
 * Viven aparte porque el diálogo de asignación y el de administración piden lo
 * mismo (una máquina, una persona) desde dos sitios distintos, y tenerlo dos
 * veces garantizaba que se fueran pareciendo cada vez menos.
 */

export function Campo({
  label,
  ayuda,
  children,
}: {
  label: string;
  ayuda?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="mb-3 block">
      <span className="t-label mb-1 block">{label}</span>
      {children}
      {ayuda && (
        <span className="mt-1 block text-[10px] leading-tight text-ink-3">
          {ayuda}
        </span>
      )}
    </label>
  );
}

export function Aviso({ children }: { children: React.ReactNode }) {
  return (
    <p className="mt-2 rounded-[10px] bg-[#fdecec] px-2.5 py-2 text-[11px] leading-tight text-st-alerta">
      {children}
    </p>
  );
}

export function Seccion({
  titulo,
  children,
}: {
  titulo: string;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-3 border-t border-border pt-3 first:mt-0 first:border-t-0 first:pt-0">
      <div className="panel-title mb-2">{titulo}</div>
      {children}
    </section>
  );
}

export function SelectorColor({
  valor,
  onChange,
}: {
  valor: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COLORES_FLOTA.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onChange(c)}
          aria-label={`Color ${c}`}
          className={`h-7 w-7 rounded-full border-2 transition ${
            valor === c ? "scale-110 border-ink" : "border-border"
          }`}
          style={{ background: c }}
        />
      ))}
    </div>
  );
}

/** Marco común de los diálogos: fondo que cierra al clic y tarjeta centrada. */
export function Dialogo({
  ancho = 420,
  bloqueado,
  onClose,
  children,
}: {
  ancho?: number;
  /** Mientras se guarda, el clic afuera no cierra: perdería lo escrito. */
  bloqueado?: boolean;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      className="absolute inset-0 z-[1300] flex items-center justify-center bg-ink/15 p-4"
      onClick={() => {
        if (!bloqueado) onClose();
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: ancho }}
        className="card max-h-[calc(100vh-40px)] max-w-full overflow-y-auto p-4"
      >
        {children}
      </div>
    </div>
  );
}
