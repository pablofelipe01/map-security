"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import SelectorAcopios from "@/components/SelectorAcopios";
import MaquinaNodo from "@/components/MaquinaNodo";
import type { MaquinaMapa, ParadaMapa, RutaMapa } from "@/components/MapaPlan";
import { fetchAcopios, acopioMasCercano, type Acopio } from "@/lib/acopios";
import {
  agregarParada,
  fetchPlan,
  grafoVias,
  marcarParada,
  planearJornada,
  rutaPropuesta,
  rutasPorMaquina,
  acopiosRepetidos,
  type Parada,
} from "@/lib/planeacion";
import { fetchFleet, fetchNodes, fetchRedMesh } from "@/lib/queries";
import {
  fetchFlota,
  nodoDeMaquinaEn,
  operadorDeMaquinaEn,
  FLOTA_VACIA,
  type Flota,
  type MaquinaRow,
} from "@/lib/registro";
import { dayRange, todayLocal } from "@/lib/ranges";
import { fmtDist } from "@/lib/geo";
import { SUPABASE_READY } from "@/lib/supabase";
import { COLOR_DEFAULT } from "@/lib/tractores";
import type { SitioRed } from "@/lib/red";
import type { Grafo } from "@/lib/rutas";
import type { FleetItem } from "@/lib/types";

// MapLibre toca `window` al importarse: sólo en cliente.
const MapaPlan = dynamic(() => import("@/components/MapaPlan"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#bcd7ea]" />,
});

/**
 * Despacho: a dónde va cada máquina hoy.
 *
 * La torre (`app/page.tsx`) contesta qué pasó; esta pantalla decide qué va a
 * pasar. Son la misma finca, las mismas máquinas y el mismo mapa de fondo, pero
 * la pregunta es otra y por eso es otra ruta y no un tercer modo del topbar: el
 * coordinador que planea no está mirando estados de nodo, y quien vigila la
 * flota no quiere que un clic le reasigne un tractor.
 *
 * Lo que sí comparte es todo lo que ya estaba: el registro de flota
 * (`lib/registro.ts`), las posiciones (`lib/queries.ts`), la malla vial
 * (`lib/rutas.ts`) y los acopios del plano.
 */

/**
 * Cada cuánto se refresca.
 *
 * Igual que la torre: la fuente se actualiza cada 10 min, así que sondear más
 * rápido no trae nada nuevo. Sólo corre cuando se está mirando el día de hoy —
 * planear el jueves no necesita refrescar posiciones de ayer.
 */
const POLL_MS = 60_000;

export default function DespachoPage() {
  const [jornada, setJornada] = useState(todayLocal());

  const [flota, setFlota] = useState<Flota>(FLOTA_VACIA);
  const [acopios, setAcopios] = useState<Acopio[]>([]);
  const [plan, setPlan] = useState<Parada[]>([]);
  const [fleet, setFleet] = useState<FleetItem[]>([]);
  const [grafo, setGrafo] = useState<Grafo | null>(null);

  /**
   * Los sitios de la malla, que aquí sólo sirven para una cosa: saber qué
   * node_id es una antena y no un radio de tractor. Va por su lado y su error
   * no llega al banner, igual que en la torre — que las tablas de la malla no
   * existan no puede dejar el despacho sin máquinas. `null` = todavía no se
   * sabe, que no es lo mismo que "no hay antenas".
   */
  const [sitios, setSitios] = useState<SitioRed[] | null>(null);

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editando, setEditando] = useState<MaquinaRow | null>(null);
  const [encuadre, setEncuadre] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");

  /**
   * Diálogo de máquina y nodo. `null` = cerrado; `{ maquina: null }` = alta.
   *
   * El objeto envuelto y no un `MaquinaRow | null` suelto porque "cerrado" y
   * "abierto para crear una nueva" son estados distintos y los dos valen null.
   */
  const [ficha, setFicha] = useState<{ maquina: MaquinaRow | null } | null>(null);

  const esHoy = jornada === todayLocal();

  /**
   * Instante al que se resuelve la identidad de la flota.
   *
   * Para hoy es ahora; para una jornada pasada, su último momento. Sin esto, el
   * plan del 3 de marzo diría qué máquina lleva HOY ese nodo, que es justo el
   * error que el registro con vigencias existe para no cometer.
   */
  const instante = useMemo(() => {
    const fin = Date.parse(dayRange(jornada).toISO);
    return Math.min(Date.now(), fin);
  }, [jornada]);

  /* --------------------------- carga --------------------------- */

  const cargarPlan = useCallback(async () => {
    setPlan(await fetchPlan(jornada));
  }, [jornada]);

  const cargarTodo = useCallback(async () => {
    setError(null);
    try {
      const [f, a, nodes] = await Promise.all([
        fetchFlota(),
        fetchAcopios(),
        fetchNodes(),
      ]);
      setFlota(f);
      setAcopios(a);
      setFleet(await fetchFleet(nodes));
      await cargarPlan();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo cargar el despacho.");
    } finally {
      setCargando(false);
    }
  }, [cargarPlan]);

  useEffect(() => {
    if (!SUPABASE_READY) {
      setCargando(false);
      setError("Falta configurar Supabase en .env.local.");
      return;
    }
    void cargarTodo();
  }, [cargarTodo]);

  useEffect(() => {
    if (!esHoy) return;
    const id = setInterval(() => void cargarTodo(), POLL_MS);
    return () => clearInterval(id);
  }, [esHoy, cargarTodo]);

  // El grafo vial se arma una vez por sesión (cuesta ~200 ms) y lo comparten la
  // torre y esta pantalla; aquí sólo se pide.
  useEffect(() => {
    void grafoVias().then(setGrafo);
  }, []);

  // La malla se lee una vez: una antena no cambia de node_id en una jornada.
  useEffect(() => {
    if (!SUPABASE_READY) return;
    fetchRedMesh()
      .then(setSitios)
      .catch((e) => console.warn("[red] no se pudo leer la malla", e));
  }, []);

  /* --------------------------- derivados --------------------------- */

  /** Última posición conocida por node_id. */
  const posPorNodo = useMemo(
    () => new Map(fleet.map((f) => [f.node.node_id, f])),
    [fleet]
  );

  /** Las máquinas activas, con su nodo y su posición de hoy. */
  const maquinas = useMemo(() => {
    return flota.maquinas
      .filter((m) => m.activa)
      .map((m) => {
        const nodeId = nodoDeMaquinaEn(flota, m.id, instante);
        const item = nodeId ? posPorNodo.get(nodeId) ?? null : null;
        return {
          maquina: m,
          nodeId,
          item,
          posicion: item?.posicion ?? null,
          operador: operadorDeMaquinaEn(flota, m.id, instante)?.nombre ?? null,
        };
      })
      .sort((a, b) =>
        a.maquina.codigo.localeCompare(b.maquina.codigo, "es", { numeric: true })
      );
  }, [flota, instante, posPorNodo]);

  const rutas = useMemo(() => rutasPorMaquina(plan), [plan]);
  const rutaDe = useMemo(
    () => new Map(rutas.map((r) => [r.maquinaId, r])),
    [rutas]
  );
  const repetidos = useMemo(() => acopiosRepetidos(plan), [plan]);

  /**
   * Las máquinas que quedan al buscar.
   *
   * Busca por todo lo que el coordinador tiene en la cabeza cuando busca: el
   * código, el nombre, quién la maneja, el nodo que lleva y los acopios que ya
   * tiene en la ruta. Ese último es el que importa de verdad — "¿quién va al
   * B.9-P.2?" es la pregunta que hoy obliga a recorrer la lista entera a ojo.
   */
  const visibles = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    if (!q) return maquinas;
    return maquinas.filter((m) => {
      const paradas = rutaDe.get(m.maquina.id)?.paradas ?? [];
      return [
        m.maquina.codigo,
        m.maquina.nombre,
        m.operador,
        m.nodeId,
        ...paradas.map((p) => p.acopio_codigo),
      ].some((v) => v?.toLowerCase().includes(q));
    });
  }, [maquinas, busqueda, rutaDe]);

  /** La ruta propuesta de cada máquina, ya calculada sobre la malla vial. */
  const propuestas = useMemo(() => {
    if (!grafo) return new Map<string, ReturnType<typeof rutaPropuesta>>();
    const out = new Map<string, ReturnType<typeof rutaPropuesta>>();
    for (const m of maquinas) {
      const r = rutaDe.get(m.maquina.id);
      if (!r || r.paradas.length === 0) continue;
      out.set(
        m.maquina.id,
        rutaPropuesta(
          grafo,
          m.posicion ? { lat: m.posicion.lat, lon: m.posicion.lon } : null,
          r.paradas
        )
      );
    }
    return out;
  }, [grafo, maquinas, rutaDe]);

  /* --------------------------- capas del mapa --------------------------- */

  const capaRutas: RutaMapa[] = useMemo(
    () =>
      [...propuestas.entries()].flatMap(([maquinaId, p]) => {
        const color = rutaDe.get(maquinaId)?.color || COLOR_DEFAULT;
        // Un trayecto por rasgo y no la ruta entera en una línea: así el tramo
        // que no se pudo resolver por vías se puede puntear solo, en vez de
        // marcar toda la ruta como dudosa por culpa de uno.
        return p.trayectos.map((t) => ({
          maquinaId,
          color,
          latlngs: t.latlngs,
          aproximada: !t.porVia,
        }));
      }),
    [propuestas, rutaDe]
  );

  const capaParadas: ParadaMapa[] = useMemo(
    () =>
      rutas.flatMap((r) =>
        r.paradas.map((p) => ({
          lat: p.lat,
          lon: p.lon,
          orden: p.orden,
          codigo: p.acopio_codigo,
          color: r.color || COLOR_DEFAULT,
          completada: p.estado === "completada",
        }))
      ),
    [rutas]
  );

  const capaMaquinas: MaquinaMapa[] = useMemo(
    () =>
      maquinas
        .filter((m) => m.posicion)
        .map((m) => ({
          maquinaId: m.maquina.id,
          codigo: m.maquina.codigo,
          color: m.maquina.color || COLOR_DEFAULT,
          lat: m.posicion!.lat,
          lon: m.posicion!.lon,
          edadMin: m.item?.edadFixMin ?? null,
        })),
    [maquinas]
  );

  /* --------------------------- acciones --------------------------- */

  const guardarRuta = useCallback(
    async (maquinaId: string, acopioIds: string[]) => {
      await planearJornada(maquinaId, jornada, acopioIds);
      await cargarPlan();
      setEncuadre((n) => n + 1);
    },
    [jornada, cargarPlan]
  );

  const cambiarEstado = useCallback(
    async (p: Parada, estado: Parada["estado"]) => {
      setAviso(null);
      try {
        await marcarParada(p.id, estado);
        await cargarPlan();
      } catch (e) {
        setAviso(e instanceof Error ? e.message : "No se pudo cambiar el estado.");
      }
    },
    [cargarPlan]
  );

  /**
   * Clic en el mapa: lo agrega a la ruta de la máquina que se esté editando.
   *
   * Sólo cuando hay una máquina abierta en el diálogo — sin eso, un clic no
   * tiene a quién asignarle nada y lo único honesto es no hacer nada.
   */
  const clicEnMapa = useCallback(
    async (lat: number, lon: number) => {
      if (editando) return; // el diálogo ya tiene su propio selector
      const cerca = acopioMasCercano(acopios, lat, lon);
      setAviso(
        cerca
          ? `${cerca.acopio.codigo} · a ${fmtDist(cerca.distanciaM)} del clic. ` +
              `Ábrelo desde la ruta de una máquina para asignarlo.`
          : "Ahí no hay ningún acopio cerca."
      );
    },
    [acopios, editando]
  );

  /* --------------------------- pantalla --------------------------- */

  const faltanAcopios = !cargando && acopios.length === 0;
  const faltaFlota = !cargando && flota.maquinas.length === 0;

  return (
    <main className="flex h-[100dvh] flex-col">
      {/* ------------------------------ barra ------------------------------ */}
      <header className="z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5 shadow-card">
        <Link href="/" className="back-link shrink-0">
          ← Torre
        </Link>

        <div className="mr-auto min-w-0">
          <h1 className="card-h2 !mb-0.5">Despacho de recolección</h1>
          <p className="text-[11px] leading-tight text-ink-2">
            A qué acopios va cada máquina. El estado lo declaras tú: la app no
            puede saber que un tractor llegó.
          </p>
        </div>

        <label className="flex shrink-0 items-center gap-2">
          <span className="t-label">Jornada</span>
          <input
            type="date"
            value={jornada}
            onChange={(e) => setJornada(e.target.value)}
            className="field w-auto"
          />
        </label>

        <button
          type="button"
          className="btn-chip"
          onClick={() => setEncuadre((n) => n + 1)}
        >
          Encuadrar
        </button>
      </header>

      {aviso && (
        <div className="flex items-center gap-2 border-b border-border bg-surface-2 px-4 py-1.5 text-[11px] text-ink-2">
          <span className="flex-1">{aviso}</span>
          <button type="button" className="btn-chip" onClick={() => setAviso(null)}>
            Cerrar
          </button>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col-reverse md:flex-row">
        {/* ----------------------------- lista ----------------------------- */}
        <aside className="z-10 flex max-h-[52dvh] w-full shrink-0 flex-col border-t border-border bg-surface md:max-h-none md:h-full md:w-[360px] md:border-r md:border-t-0">
          {/* Fijo arriba: en una flota de veinte máquinas, un buscador que se va
              con el scroll obliga a subir hasta arriba para corregir lo que se
              acaba de escribir. */}
          <div className="shrink-0 border-b border-border p-3">
            <div className="flex items-center gap-2">
              <input
                className="field"
                value={busqueda}
                onChange={(e) => setBusqueda(e.target.value)}
                placeholder="Buscar máquina, operador, nodo o acopio…"
                autoComplete="off"
                aria-label="Buscar máquina"
              />
              <button
                type="button"
                className="btn-chip"
                title="Dar de alta una máquina y montarle un nodo"
                onClick={() => setFicha({ maquina: null })}
              >
                + Máquina
              </button>
            </div>

            {busqueda && (
              <p className="mt-1.5 flex items-center gap-2 text-[10px] text-ink-3">
                <span className="flex-1">
                  {visibles.length} de {maquinas.length}{" "}
                  {maquinas.length === 1 ? "máquina" : "máquinas"}
                </span>
                <button
                  type="button"
                  className="font-bold text-accent hover:underline"
                  onClick={() => setBusqueda("")}
                >
                  Limpiar
                </button>
              </p>
            )}
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {cargando && <p className="text-[12px] text-ink-3">Cargando…</p>}

          {error && (
            <p className="rounded-[10px] bg-[#fdecec] px-3 py-2 text-[11px] text-st-alerta">
              {error}
            </p>
          )}

          {faltaFlota && !error && (
            <p className="rounded-[10px] bg-bg px-3 py-3 text-[11px] leading-relaxed text-ink-2">
              No hay máquinas registradas. Se dan de alta desde la torre, en el
              administrador de flota.
            </p>
          )}

          {faltanAcopios && !error && (
            <p className="mt-2 rounded-[10px] bg-bg px-3 py-3 text-[11px] leading-relaxed text-ink-2">
              No hay acopios cargados. Corre <code>supabase/acopios.sql</code> y
              después <code>supabase/acopios-datos.sql</code> en el SQL Editor de
              Supabase.
            </p>
          )}

          {!cargando && maquinas.length > 0 && visibles.length === 0 && (
            <p className="rounded-[10px] bg-bg px-3 py-3 text-[11px] leading-relaxed text-ink-2">
              Ninguna máquina coincide con «{busqueda}». La búsqueda mira código,
              nombre, operador, nodo y los acopios que ya tiene en la ruta de esta
              jornada.
            </p>
          )}

          {visibles.map(({ maquina, nodeId, posicion, operador, item }) => {
            const ruta = rutaDe.get(maquina.id);
            const paradas = ruta?.paradas ?? [];
            const prop = propuestas.get(maquina.id);

            return (
              <section
                key={maquina.id}
                className="card mb-2 p-3"
                style={{ borderLeft: `3px solid ${maquina.color || COLOR_DEFAULT}` }}
              >
                {/* El codigo y el nombre en columna, el boton al lado: en una
                    sola linea "Kubota 108" se parte en dos y el renglon queda
                    de dos alturas distintas segun el largo del codigo. */}
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-mono text-[15px] font-bold leading-tight text-accent">
                      {maquina.codigo}
                    </div>
                    {maquina.nombre && (
                      <div className="truncate text-[11px] leading-tight text-ink-2">
                        {maquina.nombre}
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    className="btn-chip"
                    onClick={() => setEditando(maquina)}
                  >
                    {paradas.length ? "Editar ruta" : "Planear"}
                  </button>
                </div>

                <div className="mt-1.5 text-[10px] leading-tight text-ink-3">
                  {operador ? `${operador} al mando` : "Sin operador al mando"}
                  {" · "}
                  {/* El estado del nodo es también el botón para cambiarlo: es
                      donde la persona ya está mirando cuando se da cuenta de
                      que a esta máquina le falta radio. */}
                  <button
                    type="button"
                    className={`underline decoration-dotted underline-offset-2 hover:text-accent ${
                      nodeId ? "" : "text-st-detenida"
                    }`}
                    title={
                      nodeId
                        ? `Nodo ${nodeId}. Clic para cambiarlo o desmontarlo.`
                        : "Clic para montarle un nodo"
                    }
                    onClick={() => setFicha({ maquina })}
                  >
                    {!nodeId
                      ? "sin nodo: no se puede seguir en el mapa"
                      : posicion
                        ? `${nodeId} · hace ${
                            item?.edadFixMin == null
                              ? "—"
                              : Math.round(item.edadFixMin)
                          } min`
                        : `${nodeId} · sin posición reportada`}
                  </button>
                </div>

                {paradas.length === 0 ? (
                  <p className="mt-2 text-[11px] text-ink-3">Sin ruta para esta jornada.</p>
                ) : (
                  <>
                    <ol className="mt-2">
                      {paradas.map((p) => (
                        <li
                          key={p.id}
                          className="flex min-h-[32px] items-center gap-2 border-t border-border py-1.5 first:border-t-0"
                        >
                          <span
                            className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                            style={{
                              background: maquina.color || COLOR_DEFAULT,
                              opacity: p.estado === "completada" ? 0.45 : 1,
                            }}
                          >
                            {p.orden}
                          </span>

                          <span
                            className={`min-w-0 flex-1 truncate text-[11.5px] ${
                              p.estado === "completada" ? "text-ink-3 line-through" : ""
                            }`}
                          >
                            {p.acopio_codigo}
                            {repetidos.has(p.acopio_id) && (
                              <span
                                className="ml-1 text-st-detenida"
                                title="Otra máquina también va a este acopio hoy"
                              >
                                ⚠
                              </span>
                            )}
                          </span>

                          {p.estado === "planeada" && (
                            <button
                              type="button"
                              className="btn-chip text-[10px]"
                              onClick={() => void cambiarEstado(p, "en_curso")}
                            >
                              Despachar
                            </button>
                          )}
                          {p.estado === "en_curso" && (
                            <button
                              type="button"
                              className="btn-chip btn-chip-solid text-[10px]"
                              style={{ background: "var(--st-activa)" }}
                              onClick={() => void cambiarEstado(p, "completada")}
                            >
                              Completar
                            </button>
                          )}
                          {p.estado === "completada" && (
                            <span className="shrink-0 text-[10px] text-st-activa">✓</span>
                          )}
                        </li>
                      ))}
                    </ol>

                    {prop && (
                      <p className="mt-2 border-t border-border pt-2 text-[10px] leading-tight text-ink-3">
                        {fmtDist(prop.metrosTotal)} por el camino propuesto
                        {prop.sinVia > 0 && (
                          <>
                            {" · "}
                            <span className="text-st-detenida">
                              {prop.sinVia}{" "}
                              {prop.sinVia === 1 ? "tramo" : "tramos"} sin vía (línea
                              punteada en el mapa)
                            </span>
                          </>
                        )}
                        <br />
                        Es una propuesta por la malla vial, no un tiempo de llegada.
                      </p>
                    )}
                  </>
                )}
              </section>
            );
          })}
          </div>
        </aside>

        {/* ----------------------------- mapa ----------------------------- */}
        <div className="relative min-h-[45vh] flex-1">
          <MapaPlan
            rutas={capaRutas}
            paradas={capaParadas}
            maquinas={capaMaquinas}
            onClickMapa={(lat, lon) => void clicEnMapa(lat, lon)}
            encuadreToken={encuadre}
          />
        </div>
      </div>

      {editando && (
        <SelectorAcopios
          maquina={{
            id: editando.id,
            codigo: editando.codigo,
            nombre: editando.nombre,
            color: editando.color || COLOR_DEFAULT,
          }}
          jornada={jornada}
          acopios={acopios}
          seleccion={(rutaDe.get(editando.id)?.paradas ?? []).map((p) => p.acopio_id)}
          origen={(() => {
            const m = maquinas.find((x) => x.maquina.id === editando.id);
            return m?.posicion ? { lat: m.posicion.lat, lon: m.posicion.lon } : null;
          })()}
          onClose={() => setEditando(null)}
          onGuardar={(ids) => guardarRuta(editando.id, ids)}
        />
      )}

      {ficha && (
        <MaquinaNodo
          flota={flota}
          nodos={fleet.map((f) => f.node)}
          sitios={sitios}
          instante={instante}
          maquina={ficha.maquina}
          onClose={() => setFicha(null)}
          onChanged={cargarTodo}
        />
      )}
    </main>
  );
}
