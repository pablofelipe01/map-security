"use client";

import { useMemo, useState } from "react";
import {
  agruparPorLote,
  buscarAcopios,
  type Acopio,
} from "@/lib/acopios";
import { acopiosCercanos } from "@/lib/planeacion";
import { fmtDist } from "@/lib/geo";
import { Aviso, Dialogo } from "./Form";

/**
 * Armar la ruta del día de una máquina: qué acopios y en qué orden.
 *
 * Son dos listas y no una: a la izquierda el catálogo del que se escoge, a la
 * derecha la ruta que se va armando. Un solo listado con casillas alcanzaría
 * para decir CUÁLES, pero no para decir en qué orden, y el orden es la mitad de
 * la decisión — es lo que convierte cuatro acopios sueltos en un recorrido.
 *
 * El catálogo tiene 845 puntos, así que nunca se muestra entero de entrada: se
 * abre con los que están cerca de la máquina, que es de donde sale la respuesta
 * casi siempre, y el buscador está para lo demás.
 */

interface Props {
  maquina: { id: string; codigo: string; nombre: string; color: string };
  jornada: string;
  acopios: Acopio[];
  /** Ruta actual, en orden. */
  seleccion: string[];
  /** Última posición conocida de la máquina, para ordenar por cercanía. */
  origen: { lat: number; lon: number } | null;
  onClose: () => void;
  onGuardar: (acopioIds: string[]) => Promise<void>;
}

/** Cuántos acopios cercanos se ofrecen antes de que alguien busque. */
const CERCANOS = 12;

export default function SelectorAcopios({
  maquina,
  jornada,
  acopios,
  seleccion,
  origen,
  onClose,
  onGuardar,
}: Props) {
  const [ruta, setRuta] = useState<string[]>(seleccion);
  const [texto, setTexto] = useState("");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const porId = useMemo(
    () => new Map(acopios.map((a) => [a.id, a])),
    [acopios]
  );

  /**
   * Qué se ofrece en el catálogo.
   *
   * Sin búsqueda y con posición conocida: los más cercanos a la máquina. Sin
   * búsqueda y sin posición: todo, agrupado por lote — no hay criterio mejor
   * que el alfabético y esconder el catálogo sería peor.
   */
  const sugeridos = useMemo(() => {
    if (texto.trim()) return null;
    if (!origen) return null;
    return acopiosCercanos(acopios, origen, CERCANOS);
  }, [acopios, origen, texto]);

  const grupos = useMemo(() => {
    if (sugeridos) return null;
    return agruparPorLote(buscarAcopios(acopios, texto));
  }, [acopios, texto, sugeridos]);

  const agregar = (id: string) => {
    setRuta((r) => (r.includes(id) ? r : [...r, id]));
  };

  const quitar = (id: string) => setRuta((r) => r.filter((x) => x !== id));

  const mover = (i: number, d: -1 | 1) => {
    setRuta((r) => {
      const j = i + d;
      if (j < 0 || j >= r.length) return r;
      const copia = [...r];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia;
    });
  };

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      await onGuardar(ruta);
      onClose();
    } catch (e) {
      // Los mensajes de la base vienen ya redactados en español para que los
      // lea una persona (ver `supabase/acopios.sql`); se muestran tal cual.
      setError(e instanceof Error ? e.message : "No se pudo guardar la ruta.");
      setGuardando(false);
    }
  };

  const Fila = ({ a, extra }: { a: Acopio; extra?: string }) => {
    const puesto = ruta.indexOf(a.id);
    return (
      <button
        type="button"
        onClick={() => (puesto >= 0 ? quitar(a.id) : agregar(a.id))}
        className={`flex w-full items-center gap-2 rounded-[10px] px-2 py-1.5 text-left text-[12px] transition hover:bg-bg ${
          puesto >= 0 ? "bg-bg" : ""
        }`}
      >
        <span
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
            puesto >= 0 ? "text-white" : "border border-border text-ink-3"
          }`}
          style={puesto >= 0 ? { background: maquina.color } : undefined}
        >
          {puesto >= 0 ? puesto + 1 : "+"}
        </span>
        <span className="min-w-0 flex-1 truncate">{a.codigo}</span>
        {extra && <span className="shrink-0 text-[10px] text-ink-3">{extra}</span>}
      </button>
    );
  };

  return (
    <Dialogo ancho={720} bloqueado={guardando} onClose={onClose}>
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <div className="card-h2">Ruta de {maquina.codigo}</div>
          <div className="text-[11px] text-ink-2">
            {maquina.nombre} · jornada del {jornada}
          </div>
        </div>
        <span className="text-[11px] text-ink-3">
          {ruta.length} {ruta.length === 1 ? "parada" : "paradas"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ------------------------- catálogo ------------------------- */}
        <section className="min-w-0">
          <div className="panel-title mb-2">Acopios</div>
          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar: bloque, lote o número"
            className="field mb-2 w-full"
          />

          <div className="max-h-[46vh] overflow-y-auto pr-1">
            {sugeridos && (
              <>
                <div className="t-label mb-1">Más cerca de la máquina</div>
                {sugeridos.map(({ acopio, metros }) => (
                  <Fila
                    key={acopio.id}
                    a={acopio}
                    // En línea recta, no por vías: es una cota inferior y sirve
                    // para ordenar, no para prometer un recorrido.
                    extra={`~${fmtDist(metros)}`}
                  />
                ))}
                <p className="mt-2 px-2 text-[10px] leading-tight text-ink-3">
                  Distancia en línea recta desde la última posición confirmada.
                  Busca arriba para ver el resto del predio.
                </p>
              </>
            )}

            {grupos &&
              (grupos.length === 0 ? (
                <p className="px-2 py-4 text-[11px] text-ink-3">
                  Ningún acopio coincide con «{texto}».
                </p>
              ) : (
                grupos.map((g) => (
                  <div key={g.titulo} className="mb-2">
                    <div className="t-label sticky top-0 mb-1 bg-surface py-0.5">
                      {g.titulo}
                    </div>
                    {g.acopios.map((a) => (
                      <Fila key={a.id} a={a} extra={a.num ?? undefined} />
                    ))}
                  </div>
                ))
              ))}
          </div>
        </section>

        {/* --------------------------- ruta --------------------------- */}
        <section className="min-w-0">
          <div className="panel-title mb-2">Orden de la ruta</div>

          {ruta.length === 0 ? (
            <p className="rounded-[10px] bg-bg px-3 py-6 text-center text-[11px] leading-relaxed text-ink-3">
              Sin paradas.
              <br />
              Escoge acopios de la izquierda; el orden en que los agregues es el
              orden de la ruta.
            </p>
          ) : (
            <ol className="max-h-[46vh] overflow-y-auto pr-1">
              {ruta.map((id, i) => {
                const a = porId.get(id);
                return (
                  <li
                    key={id}
                    className="mb-1 flex items-center gap-2 rounded-[10px] border border-border px-2 py-1.5"
                  >
                    <span
                      className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                      style={{ background: maquina.color }}
                    >
                      {i + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px]">
                      {/* Un acopio que salió del plano queda inactivo y no está
                          en la lista, pero puede seguir en una ruta guardada.
                          Se muestra como desconocido en vez de desaparecer. */}
                      {a?.codigo ?? "Acopio fuera del plano"}
                    </span>
                    <button
                      type="button"
                      onClick={() => mover(i, -1)}
                      disabled={i === 0}
                      aria-label="Subir"
                      className="btn-chip h-7 w-7 !min-h-0 !px-0 text-[11px] disabled:opacity-25"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => mover(i, 1)}
                      disabled={i === ruta.length - 1}
                      aria-label="Bajar"
                      className="btn-chip h-7 w-7 !min-h-0 !px-0 text-[11px] disabled:opacity-25"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => quitar(id)}
                      aria-label="Quitar"
                      className="btn-chip h-7 w-7 !min-h-0 !px-0 text-[11px] text-st-alerta"
                    >
                      ×
                    </button>
                  </li>
                );
              })}
            </ol>
          )}

          {seleccion.length > 0 && ruta.length === 0 && (
            <Aviso>
              Guardar así cancela las {seleccion.length} paradas que tenía la
              máquina. Las que ya se despacharon o se completaron no se pueden
              quitar replaneando: la base las va a rechazar.
            </Aviso>
          )}
        </section>
      </div>

      {error && <Aviso>{error}</Aviso>}

      <div className="mt-4 flex justify-end gap-2 border-t border-border pt-3">
        <button
          type="button"
          className="btn-ghost w-auto px-5"
          onClick={onClose}
          disabled={guardando}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn w-auto px-6 disabled:opacity-50"
          onClick={guardar}
          disabled={guardando}
        >
          {guardando ? "Guardando…" : "Guardar ruta"}
        </button>
      </div>
    </Dialogo>
  );
}
