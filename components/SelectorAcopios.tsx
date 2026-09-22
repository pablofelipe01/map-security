"use client";

import { useMemo, useState } from "react";
import {
  agruparPorLote,
  buscarAcopios,
  lotesCercanos,
  type Acopio,
  type GrupoLote,
} from "@/lib/acopios";
import { descripcionMaquina } from "@/lib/registro";
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
 * EL CATÁLOGO SE OFRECE POR LOTE, NO POR PUNTO. El predio tiene 845 acopios y
 * un lote aporta varios, así que una lista de puntos muestra tres renglones
 * casi idénticos seguidos ("B.3-P.8 · 18", "· 17", "· 16") y obliga a leer el
 * mismo nombre tres veces para distinguir un número. Además no es la unidad en
 * la que se decide: nadie manda un tractor al punto 17, lo manda al B.3-P.8.
 * Por eso cada lote es un renglón con sus puntos como números al lado, y trae
 * un botón para meterlos todos de una.
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

/** Cuántos lotes vecinos se ofrecen antes de que alguien busque. */
const LOTES_CERCA = 6;

/** "2026-09-22" → "mar 22 sep". La ISO es para la base, no para leerla. */
function fechaCorta(jornada: string): string {
  const d = new Date(`${jornada}T12:00:00`);
  if (Number.isNaN(d.getTime())) return jornada;
  return d
    .toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })
    .replace(/\./g, "");
}

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
   * Sin búsqueda y con posición conocida: los lotes vecinos a la máquina. Sin
   * búsqueda y sin posición: todo, agrupado por lote — no hay criterio mejor
   * que el alfabético y esconder el catálogo sería peor.
   */
  const cerca = useMemo(() => {
    if (texto.trim() || !origen) return null;
    return lotesCercanos(acopios, origen, LOTES_CERCA);
  }, [acopios, origen, texto]);

  const grupos = useMemo(() => {
    if (cerca) return null;
    return agruparPorLote(buscarAcopios(acopios, texto));
  }, [acopios, texto, cerca]);

  /** Cuántos lotes hay en total, para que el tamaño del predio no sorprenda. */
  const totalLotes = useMemo(() => agruparPorLote(acopios).length, [acopios]);

  const agregar = (id: string) => {
    setRuta((r) => (r.includes(id) ? r : [...r, id]));
  };

  const quitar = (id: string) => setRuta((r) => r.filter((x) => x !== id));

  const agregarLote = (ids: string[]) =>
    setRuta((r) => [...r, ...ids.filter((id) => !r.includes(id))]);

  const quitarLote = (ids: string[]) =>
    setRuta((r) => r.filter((x) => !ids.includes(x)));

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

  /**
   * Un lote con sus puntos como números.
   *
   * El número es el rótulo del plano (`num`), que es lo único que distingue un
   * acopio de otro dentro del mismo lote; el código completo queda en el
   * `title` para quien lo necesite verificar. Cuando el plano no rotuló el
   * punto, el chip cae al código entero, que es feo pero no miente.
   */
  const Lote = ({ g, metros }: { g: GrupoLote; metros?: number }) => {
    const ids = g.acopios.map((a) => a.id);
    const dentro = ids.filter((id) => ruta.includes(id)).length;
    const total = ids.length;
    const completo = dentro === total;

    return (
      <div className="mb-1.5 rounded-[10px] border border-border p-2">
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-[12px] font-bold">
            {g.titulo}
          </span>

          {metros != null && (
            <span className="shrink-0 text-[10px] text-ink-3" title="En línea recta">
              ~{fmtDist(metros)}
            </span>
          )}

          <button
            type="button"
            className="btn-chip !min-h-0 py-1 text-[10px]"
            onClick={() => (completo ? quitarLote(ids) : agregarLote(ids))}
          >
            {completo
              ? "Quitar"
              : dentro > 0
                ? `+ los ${total - dentro} que faltan`
                : total === 1
                  ? "+ agregar"
                  : `+ los ${total}`}
          </button>
        </div>

        <div className="mt-1.5 flex flex-wrap gap-1">
          {g.acopios.map((a) => {
            const puesto = ruta.indexOf(a.id);
            return (
              <button
                key={a.id}
                type="button"
                title={a.codigo}
                aria-pressed={puesto >= 0}
                onClick={() => (puesto >= 0 ? quitar(a.id) : agregar(a.id))}
                className={`min-h-[32px] min-w-[36px] rounded-[8px] border px-2 text-[11px] font-bold leading-none transition ${
                  puesto >= 0
                    ? "border-transparent text-white"
                    : "border-border text-ink-2 hover:border-accent-2 hover:text-accent"
                }`}
                style={puesto >= 0 ? { background: maquina.color } : undefined}
              >
                {a.num?.trim() || a.codigo}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const detalle = descripcionMaquina(maquina.codigo, maquina.nombre);

  return (
    <Dialogo ancho={720} bloqueado={guardando} onClose={onClose}>
      <div className="mb-3">
        <div className="card-h2 !mb-1">Ruta de {maquina.codigo}</div>
        <div className="text-[11px] text-ink-2">
          {detalle && <>{detalle} · </>}jornada del {fechaCorta(jornada)}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {/* ------------------------- catálogo ------------------------- */}
        <section className="min-w-0">
          <div className="panel-title !mb-1">Acopios por lote</div>
          <p className="mb-2 text-[10px] leading-tight text-ink-3">
            {acopios.length} acopios en el predio, repartidos en {totalLotes} lotes.
            Toca un número para agregar ese punto.
          </p>

          <input
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            placeholder="Buscar: bloque, lote o número"
            className="field mb-2 w-full"
          />

          <div className="max-h-[46vh] overflow-y-auto pr-1">
            {cerca && (
              <>
                <div className="t-label mb-1">Lotes más cerca de la máquina</div>
                {cerca.map(({ grupo, metros }) => (
                  <Lote key={grupo.titulo} g={grupo} metros={metros} />
                ))}
                <p className="mt-2 px-1 text-[10px] leading-tight text-ink-3">
                  Distancia en línea recta desde la última posición confirmada de la
                  máquina. Busca arriba para llegar al resto del predio.
                </p>
              </>
            )}

            {grupos &&
              (grupos.length === 0 ? (
                <p className="px-2 py-4 text-[11px] text-ink-3">
                  Ningún acopio coincide con «{texto}».
                </p>
              ) : (
                grupos.map((g) => <Lote key={g.titulo} g={g} />)
              ))}
          </div>
        </section>

        {/* --------------------------- ruta --------------------------- */}
        <section className="min-w-0">
          <div className="panel-title !mb-2">
            Orden de la ruta{ruta.length > 0 && ` (${ruta.length})`}
          </div>

          {ruta.length === 0 ? (
            <p className="rounded-[10px] bg-bg px-3 py-6 text-center text-[11px] leading-relaxed text-ink-3">
              Sin paradas.
              <br />
              Toca los números de un lote a la izquierda; el orden en que los
              agregues es el orden de la ruta.
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
