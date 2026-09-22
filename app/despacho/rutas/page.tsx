"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import SelectorAcopios from "@/components/SelectorAcopios";
import MaquinaNodo from "@/components/MaquinaNodo";
import type { MaquinaMapa, ParadaMapa, RutaMapa } from "@/components/MapaPlan";
import { fetchAcopios, acopioMasCercano, type Acopio } from "@/lib/acopios";
import {
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
import { fmtEdad } from "@/lib/fleet";
import {
  descripcionMaquina,
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
import type { FleetItem, TrackPoint } from "@/lib/types";

// MapLibre toca `window` al importarse: sólo en cliente.
const MapaPlan = dynamic(() => import("@/components/MapaPlan"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#bcd7ea]" />,
});

/**
 * Rutas del día: a dónde va cada máquina hoy.
 *
 * La torre (`app/page.tsx`) contesta qué pasó; esta pantalla decide qué va a
 * pasar. Son la misma finca, las mismas máquinas y el mismo mapa de fondo, pero
 * la pregunta es otra y por eso es otra ruta y no un tercer modo del topbar: el
 * coordinador que planea no está mirando estados de nodo, y quien vigila la
 * flota no quiere que un clic le reasigne un tractor.
 *
 * VIVE BAJO `/despacho/rutas` Y NO EN `/despacho`, que es la planilla de
 * vagones. No es un descenso de categoría: es que esta pantalla se abre una vez
 * a las 5 a.m. y la planilla se usa todo el día, así que la URL corta le toca a
 * la que más se escribe.
 *
 * Lo que sí comparte es todo lo que ya estaba: el registro de flota
 * (`lib/registro.ts`), las posiciones (`lib/queries.ts`), la malla vial
 * (`lib/rutas.ts`) y los acopios del plano.
 *
 * LA LISTA VA AGRUPADA POR LO QUE FALTA HACER, no por código de máquina. Con
 * siete tarjetas idénticas que dicen "sin ruta" no hay forma de ver de un
 * vistazo cuánto trabajo queda; con un encabezado que dice "Falta planear (7)"
 * sí, y de paso esa frase deja de repetirse siete veces.
 */

/**
 * Cada cuánto se refresca.
 *
 * Igual que la torre: la fuente se actualiza cada 10 min, así que sondear más
 * rápido no trae nada nuevo. Sólo corre cuando se está mirando el día de hoy —
 * planear el jueves no necesita refrescar posiciones de ayer.
 */
const POLL_MS = 60_000;

/** Una máquina activa, ya cruzada con su nodo, su posición y su operador. */
interface Vista {
  maquina: MaquinaRow;
  nodeId: string | null;
  item: FleetItem | null;
  posicion: TrackPoint | null;
  operador: string | null;
}

/** En qué parte de la jornada está una máquina. Manda el orden de la lista. */
type Etapa = "falta" | "ruta" | "listas";

const ETAPAS: { clave: Etapa; titulo: string; vacio: string }[] = [
  {
    clave: "falta",
    titulo: "Falta planear",
    vacio: "Todas las máquinas tienen ruta.",
  },
  { clave: "ruta", titulo: "En ruta", vacio: "" },
  { clave: "listas", titulo: "Listas", vacio: "" },
];

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
  const maquinas = useMemo<Vista[]>(() => {
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
   * Cómo va la jornada, en números, sobre TODA la flota y no sobre lo filtrado.
   *
   * Es lo primero que se mira al abrir la pantalla y contesta la única pregunta
   * que la lista, tarjeta por tarjeta, no contesta: ¿ya quedó planeado el día?
   */
  const resumen = useMemo(() => {
    const vivas = plan.filter((p) => p.estado !== "cancelada");
    return {
      conRuta: maquinas.filter(
        (m) => (rutaDe.get(m.maquina.id)?.paradas.length ?? 0) > 0
      ).length,
      total: maquinas.length,
      paradas: vivas.length,
      hechas: vivas.filter((p) => p.estado === "completada").length,
    };
  }, [maquinas, rutaDe, plan]);

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

  /**
   * La lista, partida en las tres etapas de la jornada.
   *
   * "Listas" al final a propósito: una máquina que ya recogió todo no pide nada
   * y no tiene por qué competir por el arriba de la pantalla con las que sí.
   */
  const porEtapa = useMemo(() => {
    const cajas: Record<Etapa, Vista[]> = { falta: [], ruta: [], listas: [] };
    for (const m of visibles) {
      const paradas = rutaDe.get(m.maquina.id)?.paradas ?? [];
      if (paradas.length === 0) cajas.falta.push(m);
      else if (paradas.every((p) => p.estado === "completada")) cajas.listas.push(m);
      else cajas.ruta.push(m);
    }
    return cajas;
  }, [visibles, rutaDe]);

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
   * Clic en el mapa: dice qué acopio es ese punto.
   *
   * Nada más. El clic NO asigna, porque no hay ninguna máquina a la que
   * asignarle; y cuando no hay ningún acopio cerca tampoco avisa, que era lo
   * que convertía cualquier toque al mapa en un regaño ("ahí no hay ningún
   * acopio cerca") sobre algo que nadie había pedido.
   */
  const clicEnMapa = useCallback(
    (lat: number, lon: number) => {
      if (editando) return; // el diálogo ya tiene su propio selector
      const cerca = acopioMasCercano(acopios, lat, lon);
      setAviso(
        cerca ? `${cerca.acopio.codigo} · a ${fmtDist(cerca.distanciaM)} del clic` : null
      );
    },
    [acopios, editando]
  );

  /* --------------------------- pantalla --------------------------- */

  const faltanAcopios = !cargando && acopios.length === 0;
  const faltaFlota = !cargando && flota.maquinas.length === 0;
  const hayFlota = !cargando && !error && maquinas.length > 0;

  return (
    <main className="flex h-[100dvh] flex-col">
      {/* ------------------------------ barra ------------------------------ */}
      <header className="z-10 flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border bg-surface px-4 py-2.5 shadow-card">
        <Link href="/" className="back-link shrink-0">
          ← Torre
        </Link>

        <Link href="/despacho" className="back-link shrink-0">
          ← Planilla
        </Link>

        <h1 className="card-h2 mr-auto !mb-0">Rutas del día</h1>

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

      {/* ----------------------------- resumen -----------------------------
          Cómo va el día en un renglón. Antes había que contar tarjetas para
          saberlo, y con la lista filtrada ni contando salía. */}
      {hayFlota && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-surface-2 px-4 py-1.5 text-[11px] text-ink-2">
          <span>
            <strong className="font-mono text-[13px] text-accent">
              {resumen.conRuta}
            </strong>{" "}
            de {resumen.total} {resumen.total === 1 ? "máquina" : "máquinas"} con
            ruta
          </span>

          {resumen.paradas > 0 && (
            <span className="flex items-center gap-2">
              <span className="h-1.5 w-16 overflow-hidden rounded-full bg-border">
                <span
                  className="block h-full rounded-full bg-st-activa transition-[width]"
                  style={{
                    width: `${Math.round((resumen.hechas / resumen.paradas) * 100)}%`,
                  }}
                />
              </span>
              {resumen.hechas} de {resumen.paradas} paradas recogidas
            </span>
          )}
        </div>
      )}

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
                placeholder="Buscar máquina, operador o acopio…"
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

            {ETAPAS.map(({ clave, titulo, vacio }) => {
              const items = porEtapa[clave];

              // Un grupo vacío no ocupa espacio, con una excepción: que "Falta
              // planear" esté vacío porque el día ya quedó planeado. Eso sí es
              // noticia, y es la única forma de saberlo sin contar tarjetas.
              if (items.length === 0) {
                if (clave !== "falta" || !hayFlota || busqueda) return null;
                return (
                  <p
                    key={clave}
                    className="mb-3 rounded-[10px] bg-surface-2 px-3 py-2 text-[11px] font-bold text-st-activa"
                  >
                    ✓ {vacio}
                  </p>
                );
              }

              return (
                <section key={clave} className="mb-4 last:mb-0">
                  <div className="panel-title sticky top-0 z-[1] !mb-2 bg-surface py-1">
                    {titulo} ({items.length})
                  </div>

                  {items.map((v) => (
                    <TarjetaMaquina
                      key={v.maquina.id}
                      v={v}
                      paradas={rutaDe.get(v.maquina.id)?.paradas ?? []}
                      propuesta={propuestas.get(v.maquina.id)}
                      repetidos={repetidos}
                      onPlanear={() => setEditando(v.maquina)}
                      onNodo={() => setFicha({ maquina: v.maquina })}
                      onEstado={cambiarEstado}
                    />
                  ))}
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
            onClickMapa={clicEnMapa}
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

/* ============================== tarjeta ============================== */

interface TarjetaProps {
  v: Vista;
  paradas: Parada[];
  propuesta: ReturnType<typeof rutaPropuesta> | undefined;
  repetidos: Map<string, Parada[]>;
  onPlanear: () => void;
  onNodo: () => void;
  onEstado: (p: Parada, estado: Parada["estado"]) => void;
}

/**
 * Una máquina en la lista de despacho.
 *
 * Dos renglones antes de la ruta: qué máquina es, y quién la lleva con qué tan
 * fresca es su posición. El node_id vive en el `title`: sirve cuando alguien va
 * a buscar el radio en la bodega, y estorba las otras cien veces que se mira
 * esta lista para otra cosa.
 */
function TarjetaMaquina({
  v,
  paradas,
  propuesta,
  repetidos,
  onPlanear,
  onNodo,
  onEstado,
}: TarjetaProps) {
  const { maquina, nodeId, item, posicion, operador } = v;
  const color = maquina.color || COLOR_DEFAULT;
  const detalle = descripcionMaquina(maquina.codigo, maquina.nombre);
  const hechas = paradas.filter((p) => p.estado === "completada").length;

  return (
    <section className="card mb-2 p-3" style={{ borderLeft: `3px solid ${color}` }}>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate font-mono text-[15px] font-bold leading-tight text-accent">
            {maquina.codigo}
          </div>
          {detalle && (
            <div className="truncate text-[11px] leading-tight text-ink-2">
              {detalle}
            </div>
          )}
        </div>

        {/* Con ruta armada, cambiarla es un retoque y va de chip. Sin ruta,
            planear es LA acción de esta pantalla y va abajo, ancha. */}
        {paradas.length > 0 && (
          <button type="button" className="btn-chip" onClick={onPlanear}>
            Editar ruta
          </button>
        )}
      </div>

      <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] leading-tight text-ink-3">
        <span className="min-w-0 truncate">{operador ?? "Sin operador"}</span>
        <span aria-hidden>·</span>
        {/* El estado del nodo es también el botón para cambiarlo: es donde la
            persona ya está mirando cuando se da cuenta de que a esta máquina le
            falta radio. */}
        <button
          type="button"
          className={`flex shrink-0 items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-accent ${
            nodeId ? "" : "font-bold text-st-detenida"
          }`}
          title={
            nodeId
              ? `Nodo ${nodeId}. Clic para cambiarlo o desmontarlo.`
              : "Sin nodo no se puede seguir en el mapa. Clic para montarle uno."
          }
          onClick={onNodo}
        >
          {!nodeId ? (
            "Sin nodo"
          ) : posicion ? (
            <>
              <span className={`st-dot ${item?.estado ?? "offline"}`} />
              hace {fmtEdad(item?.edadFixMin ?? null)}
            </>
          ) : (
            <>
              <span className="st-dot offline" />
              sin señal
            </>
          )}
        </button>
      </div>

      {paradas.length === 0 ? (
        <button
          type="button"
          className="btn-chip btn-chip-solid mt-2.5 w-full"
          onClick={onPlanear}
        >
          Planear ruta
        </button>
      ) : (
        <>
          <p className="mt-2 border-t border-border pt-2 text-[10px] font-bold uppercase tracking-[1px] text-ink-3">
            {hechas} de {paradas.length}{" "}
            {paradas.length === 1 ? "parada recogida" : "paradas recogidas"}
          </p>

          <ol>
            {paradas.map((p) => (
              <li
                key={p.id}
                className="flex min-h-[32px] items-center gap-2 border-t border-border py-1.5"
              >
                <span
                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
                  style={{
                    background: color,
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

                {/* El estado lo declara una persona: la app no puede saber que
                    el tractor llegó (ver lib/planeacion.ts). Eso se dice aquí,
                    en el botón que lo declara, y no en un párrafo del
                    encabezado que se lee una vez y nunca más. */}
                {p.estado === "planeada" && (
                  <button
                    type="button"
                    className="btn-chip text-[10px]"
                    title="Marcar que la máquina salió hacia este acopio"
                    onClick={() => onEstado(p, "en_curso")}
                  >
                    Despachar
                  </button>
                )}
                {p.estado === "en_curso" && (
                  <button
                    type="button"
                    className="btn-chip btn-chip-solid text-[10px]"
                    style={{ background: "var(--st-activa)" }}
                    title="Marcar que ya se recogió: la app no lo puede saber sola"
                    onClick={() => onEstado(p, "completada")}
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

          {propuesta && (
            <p
              className="mt-2 border-t border-border pt-2 text-[10px] leading-tight text-ink-3"
              title="Camino sugerido sobre la malla vial. No es un tiempo de llegada."
            >
              {fmtDist(propuesta.metrosTotal)} por el camino propuesto
              {propuesta.sinVia > 0 && (
                <>
                  {" · "}
                  <span className="text-st-detenida">
                    {propuesta.sinVia} {propuesta.sinVia === 1 ? "tramo" : "tramos"}{" "}
                    sin vía
                  </span>
                </>
              )}
            </p>
          )}
        </>
      )}
    </section>
  );
}
