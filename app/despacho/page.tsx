"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import PlanillaVagones from "@/components/PlanillaVagones";
import { fetchAcopios, AcopiosNoInstalados, type Acopio } from "@/lib/acopios";
import {
  crearOperador,
  fetchFlota,
  FLOTA_VACIA,
  type Flota,
} from "@/lib/registro";
import {
  corregirViaje,
  fetchPlanilla,
  marcarSalida,
  registrarViaje,
  type Viaje,
  type ViajeCambios,
  type ViajeNuevo,
} from "@/lib/vagones";
import { shiftDay, todayLocal } from "@/lib/ranges";
import { SUPABASE_READY } from "@/lib/supabase";

/**
 * Despacho: la planilla de vagones de Logística y Transporte.
 *
 * ES LA CARA DEL DESPACHO, y la planeación de rutas quedó un nivel adentro
 * (`/despacho/rutas`). El orden lo manda el uso: la planilla es la única
 * pantalla que alguien tiene abierta todo el día —cada reporte que entra por
 * radio es un renglón— mientras que la ruta de los tractores se arma temprano y
 * no se vuelve a mirar. Quien escribe "despacho" en el navegador está yendo a
 * anotar un reporte nueve de cada diez veces.
 *
 * Las dos siguen siendo pantallas distintas y no pestañas de una sola: la
 * planeación necesita el mapa a pantalla completa y ésta no necesita mapa
 * ninguno. Comparten los acopios y la jornada, no el gesto.
 *
 * NO HAY MAPA ACÁ, y es a propósito. La hoja se llena de oído: entra el reporte
 * por radio y se anota. Lo único que hace falta ver es si el acopio existe, y
 * eso se contesta con el código que aparece bajo las casillas. El día que haga
 * falta ubicarlos, el mapa de `/despacho/rutas` ya sabe pintar acopios.
 *
 * SIN POLL. La planeación refresca cada minuto porque mira posiciones de nodos
 * que cambian solas; acá el único que escribe es quien está mirando la
 * pantalla. Recargar debajo de sus manos le movería el renglón que está
 * corrigiendo para no traerle nada nuevo.
 */

export default function DespachoPage() {
  const [jornada, setJornada] = useState(todayLocal());

  const [viajes, setViajes] = useState<Viaje[]>([]);
  const [acopios, setAcopios] = useState<Acopio[]>([]);
  const [flota, setFlota] = useState<Flota>(FLOTA_VACIA);

  const [cargando, setCargando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /* --------------------------- carga --------------------------- */

  const cargarHoja = useCallback(async () => {
    setViajes(await fetchPlanilla(jornada));
  }, [jornada]);

  const cargarTodo = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      // Los catálogos van con la hoja en la primera carga: los tres se piden a
      // la vez porque ninguno depende del otro y esperar en fila triplica lo
      // que la pantalla tarda en ser usable.
      const [ac, fl, hoja] = await Promise.all([
        fetchAcopios(),
        fetchFlota(),
        fetchPlanilla(jornada),
      ]);
      setAcopios(ac);
      setFlota(fl);
      setViajes(hoja);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo cargar la planilla.",
      );
    } finally {
      setCargando(false);
    }
  }, [jornada]);

  useEffect(() => {
    if (!SUPABASE_READY) {
      setCargando(false);
      setError("Falta configurar Supabase en .env.local.");
      return;
    }
    void cargarTodo();
  }, [cargarTodo]);

  /* --------------------------- escritura --------------------------- */

  /**
   * Después de escribir se relee la hoja entera y no se parcha el estado local.
   *
   * El consecutivo lo asigna la base con un lock por jornada (ver
   * `viajes_numerar`), así que el renglón que acaba de nacer puede no ser el
   * último si alguien más registró al mismo tiempo. Releer cuesta una consulta
   * de treinta filas y es la diferencia entre ver la hoja y ver la hoja que uno
   * cree que hay.
   */
  const tras = useCallback(
    async (accion: () => Promise<unknown>) => {
      setOcupado(true);
      setError(null);
      try {
        await accion();
        await cargarHoja();
      } finally {
        setOcupado(false);
      }
    },
    [cargarHoja],
  );

  // Los errores de estas tres suben al formulario que las llamó, que es donde
  // la persona está mirando: un banner arriba de la pantalla, con el diálogo
  // abierto encima, no lo ve nadie.
  const onRegistrar = useCallback(
    (v: ViajeNuevo) => tras(() => registrarViaje(v)),
    [tras],
  );

  const onCorregir = useCallback(
    (id: string, cambios: ViajeCambios) =>
      tras(() => corregirViaje(id, cambios)),
    [tras],
  );

  /** El clic de "Marcar salida" no tiene formulario donde mostrar un error. */
  const onSalida = useCallback(
    async (id: string) => {
      try {
        await tras(() => marcarSalida(id));
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "No se pudo marcar la salida.",
        );
      }
    },
    [tras],
  );

  /**
   * Alta de un conductor desde la planilla.
   *
   * Se agrega a la lista en memoria en vez de releer toda la flota: el renglón
   * que se está guardando necesita verlo ya —si el renglón falla, al reintentar
   * su nombre tiene que calzar exacto y no volver a crearse— y la flota entera
   * son tres consultas para enterarse de una fila que ya se tiene en la mano.
   */
  const onCrearOperador = useCallback(
    async (nombre: string, documento: string) => {
      const o = await crearOperador({ nombre, documento });
      setFlota((f) => ({ ...f, operadores: [...f.operadores, o] }));
      return o;
    },
    []
  );

  /* --------------------------- pantalla --------------------------- */

  const faltanAcopios = !cargando && !error && acopios.length === 0;
  const faltanOperadores = !cargando && !error && flota.operadores.length === 0;

  return (
    // LA PÁGINA SE DESPLAZA SOLA. El `body` está fijo a la pantalla con
    // `overflow: hidden` (ver globals.css) porque la torre y la planeación son
    // mapas a pantalla completa; con `min-h` esta hoja crecía por debajo del
    // borde y no había cómo llegar al botón de registrar. `h-dvh` +
    // `overflow-y-auto` la vuelve su propio contenedor de desplazamiento.
    <main className="h-dvh overflow-y-auto overscroll-contain bg-bg">
      {/* La barra se arma en dos renglones en celular y en uno en escritorio.
          Amontonar los enlaces, el título y el selector de día en una sola
          línea de 390 px los parte donde caiga, y el resultado es una cabecera
          de cuatro renglones que se come media pantalla antes del primer dato.
          Acá el primer renglón es "dónde estoy y a dónde puedo ir" y el
          segundo, entero, es el día — que es el único control de la barra. */}
      {/* Pegada arriba mientras se baja: el día es el contexto de todo lo que
          hay debajo, y perderlo de vista en el renglón 20 es anotar en la
          jornada equivocada. */}
      <header className="sticky top-0 z-20 border-b border-border bg-surface px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))] shadow-card md:px-4 md:pb-2.5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link href="/" className="back-link shrink-0">
            ← Torre
          </Link>
          <Link href="/despacho/rutas" className="back-link shrink-0">
            Rutas del día
          </Link>

          <h1 className="card-h2 !mb-0 md:mr-auto">Planilla de vagones</h1>

          <div className="mt-1 flex w-full items-center gap-1 md:mt-0 md:w-auto">
            <button
              type="button"
              className="btn-chip"
              onClick={() => setJornada((d) => shiftDay(d, -1))}
              aria-label="Día anterior"
            >
              ←
            </button>
            {/* Crece hasta llenar el renglón en celular: un `<input type=date>`
                angosto esconde el año y obliga a apuntar a un campo de 20 px. */}
            <input
              type="date"
              value={jornada}
              onChange={(e) => setJornada(e.target.value)}
              className="field flex-1 md:w-auto md:flex-none"
            />
            <button
              type="button"
              className="btn-chip"
              onClick={() => setJornada((d) => shiftDay(d, 1))}
              aria-label="Día siguiente"
            >
              →
            </button>
          </div>
        </div>
      </header>

      <div className="pt-3">
        {error && (
          <div className="mx-auto mb-3 w-full max-w-[1600px] px-3">
            <p className="rounded-[10px] bg-[#fdecec] px-3 py-2 text-[12px] leading-tight text-st-alerta">
              {error}
            </p>
          </div>
        )}

        {/* Las tablas que faltan se avisan aparte del error de carga: no es un
            fallo, es que el esquema todavía no se corrió. Mismo trato que le da
            el despacho a los acopios. */}
        {(faltanAcopios || faltanOperadores) && (
          <div className="mx-auto mb-3 w-full max-w-[1600px] px-3">
            <p className="rounded-[10px] bg-[#fdf4e3] px-3 py-2 text-[12px] leading-tight text-st-detenida">
              {faltanAcopios && (
                <>
                  Faltan los acopios: corre <code>supabase/acopios.sql</code> y{" "}
                  <code>supabase/acopios-datos.sql</code>. Sin ellos no se puede
                  escribir un renglón.{" "}
                </>
              )}
              {faltanOperadores && (
                <>
                  No hay operadores en el registro de flota todavía: cada
                  conductor se va agregando la primera vez que se escribe, con
                  su cédula.
                </>
              )}
            </p>
          </div>
        )}

        {cargando ? (
          <p className="px-4 py-10 text-center text-[12px] text-ink-3">
            Cargando la planilla…
          </p>
        ) : (
          <PlanillaVagones
            jornada={jornada}
            viajes={viajes}
            acopios={acopios}
            operadores={flota.operadores}
            ocupado={ocupado}
            onRegistrar={onRegistrar}
            onCorregir={onCorregir}
            onSalida={onSalida}
            onCrearOperador={onCrearOperador}
          />
        )}
      </div>
    </main>
  );
}
