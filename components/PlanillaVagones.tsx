"use client";

import { useMemo, useState } from "react";
import CasillasAcopio from "./CasillasAcopio";
import { Aviso, Campo, Dialogo } from "./Form";
import {
  TIPOS_FRUTO,
  casillasDe,
  letraFruto,
  nombreFruto,
  resumirPlanilla,
  type TipoFruto,
  type Viaje,
  type ViajeCambios,
  type ViajeNuevo,
} from "@/lib/vagones";
import { fmtTime } from "@/lib/geo";
import { bogotaISO } from "@/lib/ranges";
import type { Acopio } from "@/lib/acopios";
import type { OperadorRow } from "@/lib/registro";

/**
 * La hoja de Logística y Transporte, renglón por renglón.
 *
 * SE PARECE AL PAPEL A PROPÓSITO. Las mismas ocho columnas, en el mismo orden,
 * con los mismos nombres. No es nostalgia: el que la llena tiene el modelo
 * mental de la hoja metido en la mano, y una pantalla que reordene o renombre
 * las casillas le cobra atención que en ese momento no tiene. Lo que cambia es
 * lo que el papel no puede hacer —comprobar que el acopio exista, poner la hora
 * sola, no repetir el "No."— y eso pasa sin que nadie lo pida.
 *
 * EL RENGLÓN NUEVO VA ARRIBA Y SIEMPRE ABIERTO. El gesto del día no es
 * "consultar la planilla", es "acaba de entrar un reporte": si registrar cuesta
 * un clic en un botón que abre un diálogo, el que despacha vuelve al papel. La
 * consulta es lo secundario y va debajo.
 *
 * EN CELULAR LA HOJA NO ES UNA TABLA. Son nueve columnas: en un teléfono de 390
 * px eso es o letra de 6 px o desplazamiento horizontal, y las dos hacen que
 * leer un renglón cueste más que releerlo en el papel. Debajo de `md` cada
 * renglón es una tarjeta con los mismos datos puestos en vertical; de `md` para
 * arriba vuelve la tabla, que es donde de verdad sirve —comparar treinta
 * renglones de un vistazo—. Es el mismo criterio de toda la app: móvil primero
 * y `md:` para restaurar el escritorio (ver README, "Uso en celular").
 *
 * LO QUE ESTA PANTALLA NO HACE. No asigna máquina ni propone ruta — eso es la
 * planeación (`app/despacho/rutas/page.tsx`), que arma la jornada de cada
 * tractor. Acá se registra lo que entró y lo que salió. Las dos hojas hablan de
 * los mismos acopios y por eso van a poder cruzarse, pero mezclarlas obligaría a
 * que el que anota un reporte a las 6 a.m. ya sepa qué máquina lo va a atender,
 * que es justo lo que todavía no sabe.
 */

interface Props {
  jornada: string;
  viajes: Viaje[];
  acopios: Acopio[];
  operadores: OperadorRow[];
  /** true mientras se recarga la hoja tras escribir. */
  ocupado?: boolean;
  onRegistrar: (v: ViajeNuevo) => Promise<void>;
  onCorregir: (id: string, cambios: ViajeCambios) => Promise<void>;
  onSalida: (id: string) => Promise<void>;
}

export default function PlanillaVagones({
  jornada,
  viajes,
  acopios,
  operadores,
  ocupado,
  onRegistrar,
  onCorregir,
  onSalida,
}: Props) {
  const [editando, setEditando] = useState<Viaje | null>(null);
  const resumen = useMemo(() => resumirPlanilla(viajes), [viajes]);

  const vacio = viajes.length === 0;

  return (
    <div className="mx-auto w-full max-w-[1600px] px-3 pb-[max(2.5rem,env(safe-area-inset-bottom))]">
      {/* EN PANTALLA ANCHA, FORMULARIO A LA IZQUIERDA Y HOJA A LA DERECHA. Apilados,
          en un monitor el formulario deja media pantalla vacía y la hoja queda
          debajo del pliegue. Lado a lado se anota sin perder de vista lo que ya
          está. Sólo desde `xl`: por debajo la tabla no cabe al lado del
          formulario y aparecería el desplazamiento horizontal.

          En celular y tablet el orden es resumen → formulario → hoja; en `xl`
          el formulario ocupa las dos filas de la izquierda. */}
      <div className="xl:grid xl:grid-cols-[400px_minmax(0,1fr)] xl:grid-rows-[auto_1fr] xl:gap-x-4">
        <div className="xl:col-start-2 xl:row-start-1">
          {/* ------------------------- resumen del día -------------------------
          LOS CUATRO EN UNA FILA, también en celular. En dos por dos ocupaban
          cuatro renglones de alto y empujaban el formulario fuera de la
          pantalla — y el gesto del día no es mirar el resumen, es anotar un
          reporte. Apretados en una tira siguen siendo legibles y el formulario
          queda arriba del pliegue, que es lo que importa.

          No se esconde ninguno: "sin salir" es el número por el que alguien
          abre esta pantalla, y los otros tres son el contexto que lo hace
          significar algo. */}
          <div className="mb-3 grid grid-cols-4 gap-1.5 sm:gap-2">
            <Tile label="Renglones" valor={resumen.total} />
            <Tile
              label="Sin salir"
              valor={resumen.pendientes}
              alerta={resumen.pendientes > 0}
            />
            <Tile label="Híbrido" valor={resumen.hibrido} />
            <Tile label="Comercial" valor={resumen.comercial} />
          </div>

          {resumen.sinConductor > 0 && (
            <p className="mb-3 rounded-[10px] bg-[#fdf4e3] px-3 py-2 text-[11px] leading-tight text-st-detenida">
              {resumen.sinConductor === 1
                ? "Hay 1 renglón que ya salió sin conductor anotado."
                : `Hay ${resumen.sinConductor} renglones que ya salieron sin conductor anotado.`}{" "}
              Se puede completar después: toca el renglón.
            </p>
          )}
        </div>

        {/* Pegado bajo la cabecera en `xl`, con su propio desplazamiento si la
          ventana es baja: el botón de registrar no puede quedar fuera de
          alcance mientras se lee la hoja. */}
        <div className="mb-3 xl:sticky xl:top-[72px] xl:col-start-1 xl:row-span-2 xl:row-start-1 xl:mb-0 xl:max-h-[calc(100dvh-88px)] xl:self-start xl:overflow-y-auto">
          <FilaNueva
            jornada={jornada}
            acopios={acopios}
            operadores={operadores}
            ocupado={ocupado}
            onRegistrar={onRegistrar}
          />
        </div>

        <div className="min-w-0 xl:col-start-2 xl:row-start-2">
          {vacio && (
            <p className="card px-3 py-8 text-center text-[12px] text-ink-3">
              Todavía no hay renglones en esta jornada.
            </p>
          )}

          {/* ---------------------- la hoja en celular ---------------------- */}
          {!vacio && (
            <ul className="flex flex-col gap-2 md:hidden">
              {viajes.map((v) => (
                <Tarjeta
                  key={v.id}
                  viaje={v}
                  ocupado={ocupado}
                  onAbrir={() => setEditando(v)}
                  onSalida={() => onSalida(v.id)}
                />
              ))}
            </ul>
          )}

          {/* --------------------- la hoja en escritorio --------------------- */}
          {!vacio && (
            <div className="card hidden overflow-x-auto md:block">
              <table className="w-full min-w-[820px] border-collapse text-[12px]">
                <thead>
                  <tr className="border-b border-border">
                    <Th ancho={38}>No.</Th>
                    <Th ancho={34} titulo="Híbrido o Comercial">
                      Fruto
                    </Th>
                    <Th ancho={60}>Reporte</Th>
                    <Th ancho={150}>Vagones llenos</Th>
                    <Th ancho={86}>Salida</Th>
                    <Th ancho={150}>Ubicación de vagones</Th>
                    <Th ancho={60}># Vagón</Th>
                    <Th ancho={120}>Conductor</Th>
                    <Th>Observaciones</Th>
                  </tr>
                </thead>

                <tbody>
                  {viajes.map((v) => (
                    <Fila
                      key={v.id}
                      viaje={v}
                      ocupado={ocupado}
                      onAbrir={() => setEditando(v)}
                      onSalida={() => onSalida(v.id)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {editando && (
        <DialogoViaje
          viaje={editando}
          jornada={jornada}
          acopios={acopios}
          operadores={operadores}
          onClose={() => setEditando(null)}
          onGuardar={async (cambios) => {
            await onCorregir(editando.id, cambios);
            setEditando(null);
          }}
        />
      )}
    </div>
  );
}

/* ====================== lo que comparten las dos ====================== */

/**
 * Lo que la tabla y la tarjeta necesitan del viaje, derivado una sola vez.
 *
 * Las dos presentaciones son distintas de verdad —una compara renglones, la
 * otra lee uno— así que comparten los datos y no el marcado. Duplicar este
 * cálculo sería la forma de que un día la tarjeta y la fila dijeran cosas
 * distintas del mismo viaje.
 */
function datosFila(v: Viaje) {
  const [origenB, origenN] = casillasDe({
    bloque: v.origen_bloque,
    num: v.origen_num,
  });
  const [destinoB, destinoN] = casillasDe({
    bloque: v.destino_bloque,
    num: v.destino_num,
  });
  return { origenB, origenN, destinoB, destinoN, pendiente: !v.salida_en };
}

/** La H o la C en su redondel. */
function Fruto({ tipo }: { tipo: TipoFruto }) {
  return (
    <span
      title={nombreFruto(tipo)}
      className="mono inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border text-[10px] font-bold text-ink-2"
    >
      {letraFruto(tipo)}
    </span>
  );
}

/**
 * Un sitio: los dos números grandes como en el papel y el código completo
 * pequeño debajo.
 *
 * Los dos números son con lo que la gente habla por radio ("el 334, acopio
 * 68"); el código con lote es lo que permite encontrarlo en el mapa. Ninguno
 * de los dos sobra, pero sólo uno de ellos manda el tamaño de letra.
 */
function Sitio({
  bloque,
  num,
  codigo,
}: {
  bloque: string;
  num: string;
  codigo: string | null;
}) {
  return (
    <div className="leading-tight">
      <span className="mono text-[12.5px] font-bold text-ink">
        {bloque || "—"} · {num || "—"}
      </span>
      {codigo && <span className="block text-[10px] text-ink-3">{codigo}</span>}
    </div>
  );
}

function Tile({
  label,
  valor,
  alerta,
}: {
  label: string;
  valor: number;
  alerta?: boolean;
}) {
  return (
    // `tile` trae `p-3`; en celular se aprieta a `p-2` para que los cuatro
    // quepan en una fila de 390 px sin partir el rótulo. El número baja de 22 a
    // 18 px por lo mismo, y vuelve a su tamaño en cuanto hay ancho.
    <div className="tile min-w-0 p-2 sm:p-3">
      <div className="t-label truncate" title={label}>
        {label}
      </div>
      <div
        className={`t-value text-[18px] sm:text-[22px] ${
          alerta ? "text-st-detenida" : ""
        }`}
      >
        {valor}
      </div>
    </div>
  );
}

/* ======================= la hoja en celular ======================= */

/**
 * Un renglón como tarjeta.
 *
 * QUÉ SE VE SIN ABRIR NADA: el número, el fruto, las dos horas y los dos
 * sitios. Es lo que alguien necesita para contestar "¿ya salió el del 334?"
 * parado en el patio. El conductor y las observaciones van abajo y sólo cuando
 * existen — una tarjeta con cuatro renglones que dicen "—" es ruido que empuja
 * fuera de pantalla la tarjeta siguiente.
 *
 * EL BOTÓN DE SALIDA VA FUERA DEL ÁREA QUE ABRE LA CORRECCIÓN, separado por una
 * línea. No es sólo HTML válido —un botón no puede vivir dentro de otro—: es
 * que con el dedo, un botón encima de una zona tocable se acierta mal, y
 * equivocarse acá abre un diálogo cuando lo que se quería era despachar.
 */
function Tarjeta({
  viaje,
  ocupado,
  onAbrir,
  onSalida,
}: {
  viaje: Viaje;
  ocupado?: boolean;
  onAbrir: () => void;
  onSalida: () => void;
}) {
  const { origenB, origenN, destinoB, destinoN, pendiente } = datosFila(viaje);

  return (
    <li className="card overflow-hidden">
      <button
        type="button"
        onClick={onAbrir}
        className="block w-full p-3 text-left active:bg-surface-2"
      >
        <div className="mb-2 flex items-center gap-2">
          <span className="mono text-[13px] font-bold text-ink-3">
            {viaje.consecutivo}
          </span>
          <Fruto tipo={viaje.tipo_fruto} />

          <span className="mono ml-auto text-[12px] text-ink-2">
            {fmtTime(viaje.reportado_en)}
            {viaje.salida_en ? (
              <>
                {" → "}
                <strong className="text-ink">{fmtTime(viaje.salida_en)}</strong>
              </>
            ) : (
              <span className="ml-1 text-st-detenida">· sin salir</span>
            )}
          </span>
        </div>

        <Dato label="Llenos">
          <Sitio bloque={origenB} num={origenN} codigo={viaje.origen_codigo} />
        </Dato>

        {viaje.destino_acopio_id && (
          <Dato label="Ubicar">
            <Sitio
              bloque={destinoB}
              num={destinoN}
              codigo={viaje.destino_codigo}
            />
            {viaje.vagon && (
              <span className="mono mt-0.5 block text-[11px] text-ink-2">
                Vagón {viaje.vagon}
              </span>
            )}
          </Dato>
        )}

        <Dato label="Conductor">
          {viaje.operador_nombre ? (
            <span className="text-[12.5px] text-ink">
              {viaje.operador_nombre}
            </span>
          ) : (
            <span
              className={`text-[12.5px] ${
                viaje.salida_en ? "text-st-detenida" : "text-ink-3"
              }`}
            >
              Sin asignar
            </span>
          )}
        </Dato>

        {viaje.observaciones && (
          <Dato label="Obs.">
            <span className="text-[12px] text-ink-2">
              {viaje.observaciones}
            </span>
          </Dato>
        )}
      </button>

      {pendiente && (
        <div className="border-t border-border p-2">
          <button
            type="button"
            disabled={ocupado}
            onClick={onSalida}
            className="btn-chip btn-chip-solid w-full"
          >
            Marcar salida
          </button>
        </div>
      )}
    </li>
  );
}

/** Rótulo a la izquierda y dato a la derecha, con los rótulos alineados. */
function Dato({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex gap-2 py-[3px]">
      <span className="t-label w-[62px] shrink-0 pt-[3px]">{label}</span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

/* ====================== la hoja en escritorio ====================== */

function Th({
  children,
  ancho,
  titulo,
}: {
  children: React.ReactNode;
  ancho?: number;
  titulo?: string;
}) {
  return (
    <th
      style={ancho ? { width: ancho } : undefined}
      title={titulo}
      className="t-label px-2 py-2 text-left align-bottom"
    >
      {children}
    </th>
  );
}

/**
 * Un renglón de la tabla.
 *
 * LA COLUMNA DE SALIDA VACÍA ES EL PENDIENTE, y por eso ahí va el botón en vez
 * de una raya: el que despacha está viendo salir un tractor y lo que quiere es
 * un clic, no abrir un formulario a ponerle la hora. Todo lo demás se corrige
 * tocando el renglón.
 */
function Fila({
  viaje,
  ocupado,
  onAbrir,
  onSalida,
}: {
  viaje: Viaje;
  ocupado?: boolean;
  onAbrir: () => void;
  onSalida: () => void;
}) {
  const { origenB, origenN, destinoB, destinoN, pendiente } = datosFila(viaje);

  return (
    <tr
      onClick={onAbrir}
      className={`cursor-pointer border-b border-border last:border-b-0 hover:bg-surface-2 ${
        pendiente ? "" : "text-ink-2"
      }`}
    >
      <td className="mono px-2 py-1.5 text-ink-3">{viaje.consecutivo}</td>

      <td className="px-2 py-1.5">
        <Fruto tipo={viaje.tipo_fruto} />
      </td>

      <td className="mono px-2 py-1.5">{fmtTime(viaje.reportado_en)}</td>

      <td className="px-2 py-1.5">
        <Sitio bloque={origenB} num={origenN} codigo={viaje.origen_codigo} />
      </td>

      <td className="px-2 py-1.5">
        {viaje.salida_en ? (
          <span className="mono">{fmtTime(viaje.salida_en)}</span>
        ) : (
          <button
            type="button"
            disabled={ocupado}
            onClick={(e) => {
              e.stopPropagation();
              onSalida();
            }}
            className="btn-chip"
          >
            Marcar salida
          </button>
        )}
      </td>

      <td className="px-2 py-1.5">
        {viaje.destino_acopio_id ? (
          <Sitio
            bloque={destinoB}
            num={destinoN}
            codigo={viaje.destino_codigo}
          />
        ) : (
          <span className="text-ink-3">—</span>
        )}
      </td>

      <td className="mono px-2 py-1.5">{viaje.vagon ?? "—"}</td>

      <td className="px-2 py-1.5">
        {viaje.operador_nombre ?? (
          <span className={viaje.salida_en ? "text-st-detenida" : "text-ink-3"}>
            Sin asignar
          </span>
        )}
      </td>

      <td className="px-2 py-1.5 text-ink-2">{viaje.observaciones ?? ""}</td>
    </tr>
  );
}

/* =========================== renglón nuevo =========================== */

/** El estado del formulario. Las casillas se guardan como se escriben y el
 *  acopio resuelto aparte: son dos cosas distintas y confundirlas obliga a
 *  reconstruir el texto desde el id cada vez que alguien corrige un dígito. */
interface Borrador {
  tipo_fruto: TipoFruto;
  origenB: string;
  origenN: string;
  origen: Acopio | null;
  destinoB: string;
  destinoN: string;
  destino: Acopio | null;
  vagon: string;
  operador_id: string;
  observaciones: string;
}

const BORRADOR_VACIO: Borrador = {
  tipo_fruto: "comercial",
  origenB: "",
  origenN: "",
  origen: null,
  destinoB: "",
  destinoN: "",
  destino: null,
  vagon: "",
  operador_id: "",
  observaciones: "",
};

/**
 * El formulario de reporte nuevo.
 *
 * LA HORA NO SE PIDE. En el papel hay que escribirla porque la hoja no sabe qué
 * hora es; acá el reporte se registra cuando entra y la base lo sella. Pedirla
 * sería agregar un campo para que la persona escriba mal lo que el sistema ya
 * sabe bien. Si hay que pasar un renglón viejo, se corrige después — el diálogo
 * de edición sí deja cambiarla.
 *
 * TAMPOCO SE PIDE EL CONDUCTOR COMO OBLIGATORIO, porque casi nunca se sabe
 * todavía: el reporte entra por radio y la asignación pasa minutos después. Un
 * campo obligatorio ahí es la forma más rápida de que alguien escriba
 * cualquiera con tal de guardar.
 *
 * ES UN FORMULARIO VERTICAL DE LOS DE SIEMPRE: una pregunta por renglón, el
 * rótulo encima en letra que se lee sin acercarse y los opcionales marcados
 * como tales. La fila que envolvía en escritorio se parecía más a la hoja, pero
 * obligaba a buscar con la vista dónde seguía; de arriba abajo no hay que
 * buscar nada. Tiene tope de ancho porque un campo de 1200 px para dos dígitos
 * se lee peor, no mejor.
 */
function FilaNueva({
  jornada,
  acopios,
  operadores,
  ocupado,
  onRegistrar,
}: {
  jornada: string;
  acopios: Acopio[];
  operadores: OperadorRow[];
  ocupado?: boolean;
  onRegistrar: (v: ViajeNuevo) => Promise<void>;
}) {
  const [b, setB] = useState<Borrador>(BORRADOR_VACIO);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const puso = (cambios: Partial<Borrador>) =>
    setB((x) => ({ ...x, ...cambios }));

  // Un número de vagón sin destino es un dato a medias: la base lo rechaza y
  // decirlo acá evita el viaje a la red para enterarse.
  const vagonHuerfano = b.vagon.trim() !== "" && !b.destino;
  const listo = !!b.origen && !vagonHuerfano && !guardando && !ocupado;

  const registrar = async () => {
    if (!b.origen) return;
    setGuardando(true);
    setError(null);
    try {
      await onRegistrar({
        jornada,
        tipo_fruto: b.tipo_fruto,
        origen_acopio_id: b.origen.id,
        destino_acopio_id: b.destino?.id ?? null,
        vagon: b.vagon,
        operador_id: b.operador_id || null,
        observaciones: b.observaciones,
      });
      // El tipo de fruto se conserva: los reportes llegan en rachas del mismo
      // lote y volver a marcarlo en cada renglón es el clic que sobra.
      setB({ ...BORRADOR_VACIO, tipo_fruto: b.tipo_fruto });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form
      className="card w-full max-w-[560px] p-4 xl:max-w-none"
      onSubmit={(e) => {
        e.preventDefault();
        if (listo) registrar();
      }}
    >
      <h2 className="mb-4 text-[15px] font-extrabold text-ink">
        Reporte nuevo
      </h2>

      <div className="flex flex-col gap-4">
        <Pregunta label="Fruto" grupo>
          {/* Los dos chips se reparten el ancho: con el dedo, dos botones
              grandes lado a lado se aciertan sin mirar. */}
          <div className="grid grid-cols-2 gap-2">
            {TIPOS_FRUTO.map((t) => (
              <button
                key={t.valor}
                type="button"
                onClick={() => puso({ tipo_fruto: t.valor })}
                aria-pressed={b.tipo_fruto === t.valor}
                className={`btn-chip min-h-[40px] text-[13px] ${
                  b.tipo_fruto === t.valor ? "btn-chip-solid" : ""
                }`}
              >
                {t.letra} · {t.label}
              </button>
            ))}
          </div>
        </Pregunta>

        <CasillasAcopio
          label="Vagones llenos"
          amplio
          bloque={b.origenB}
          num={b.origenN}
          acopios={acopios}
          disabled={guardando}
          onChange={(bl, n) => puso({ origenB: bl, origenN: n })}
          onResuelto={(a) => puso({ origen: a })}
        />

        <CasillasAcopio
          label="Ubicación de vagones"
          amplio
          bloque={b.destinoB}
          num={b.destinoN}
          acopios={acopios}
          opcional
          disabled={guardando}
          onChange={(bl, n) => puso({ destinoB: bl, destinoN: n })}
          onResuelto={(a) => puso({ destino: a })}
        />

        <Pregunta
          label="# Vagón"
          opcional
          ayuda={
            vagonHuerfano ? (
              <span className="text-st-alerta">
                Falta la ubicación de vagones de arriba.
              </span>
            ) : (
              "Sólo si hay ubicación de vagones."
            )
          }
        >
          <input
            className="field mono max-w-[160px]"
            value={b.vagon}
            inputMode="numeric"
            autoComplete="off"
            disabled={guardando}
            onChange={(e) => puso({ vagon: e.target.value })}
          />
        </Pregunta>

        <Pregunta
          label="Conductor"
          opcional
          ayuda="Se puede dejar para después."
        >
          <SelectOperador
            valor={b.operador_id}
            operadores={operadores}
            disabled={guardando}
            onChange={(v) => puso({ operador_id: v })}
          />
        </Pregunta>

        <Pregunta label="Observaciones" opcional>
          <textarea
            className="field w-full"
            rows={2}
            value={b.observaciones}
            disabled={guardando}
            onChange={(e) => puso({ observaciones: e.target.value })}
          />
        </Pregunta>
      </div>

      {error && <Aviso>{error}</Aviso>}

      <button type="submit" className="btn mt-5" disabled={!listo}>
        {guardando ? "Registrando…" : "Registrar renglón"}
      </button>
    </form>
  );
}

/**
 * Una pregunta del formulario: rótulo arriba, campo, ayuda debajo.
 *
 * No es `Campo` (de `./Form`) porque ése usa el rótulo de 9 px en mayúsculas de
 * los diálogos, y este formulario se llena de pie, a veces con el radio en la
 * mano: el rótulo tiene que leerse de un vistazo.
 */
function Pregunta({
  label,
  opcional,
  ayuda,
  grupo,
  children,
}: {
  label: string;
  opcional?: boolean;
  ayuda?: React.ReactNode;
  /** Varios botones en vez de un campo: un `<label>` alrededor mandaría el
   *  toque del rótulo al primero de ellos. */
  grupo?: boolean;
  children: React.ReactNode;
}) {
  const Caja = grupo ? "div" : "label";
  return (
    <Caja className="block">
      <span className="mb-1.5 block text-[13px] font-bold text-ink">
        {label}
        {opcional && (
          <span className="ml-1.5 font-normal text-ink-3">(opcional)</span>
        )}
      </span>
      {children}
      {ayuda && (
        <span className="mt-1 block text-[11.5px] leading-tight text-ink-3">
          {ayuda}
        </span>
      )}
    </Caja>
  );
}

/**
 * El desplegable de conductores.
 *
 * Contra el maestro de `operadores` que ya lleva el registro de flota, no
 * texto libre: en el papel "Edgar" y "edgar" son dos personas distintas para
 * cualquier conteo. Sólo los activos — mandar a alguien que ya no trabaja acá
 * no es un caso que valga la pena poder registrar por descuido.
 */
function SelectOperador({
  valor,
  operadores,
  disabled,
  onChange,
}: {
  valor: string;
  operadores: OperadorRow[];
  disabled?: boolean;
  onChange: (v: string) => void;
}) {
  const activos = useMemo(
    () =>
      operadores
        .filter((o) => o.activo)
        .sort((a, b) => a.nombre.localeCompare(b.nombre, "es")),
    [operadores],
  );

  return (
    <select
      className="field"
      value={valor}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">Sin asignar</option>
      {activos.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nombre}
        </option>
      ))}
    </select>
  );
}

/* ========================== corregir un renglón ========================== */

/**
 * Corregir.
 *
 * Acá sí se puede tocar todo lo que el formulario de arriba no pregunta —las
 * horas incluidas— porque éste es el momento en que alguien está arreglando un
 * renglón, no anotando uno. Lo único que la base rechaza es cambiarle el día o
 * el número: son la identidad del renglón (ver `viajes_sellar`).
 */
function DialogoViaje({
  viaje,
  jornada,
  acopios,
  operadores,
  onClose,
  onGuardar,
}: {
  viaje: Viaje;
  jornada: string;
  acopios: Acopio[];
  operadores: OperadorRow[];
  onClose: () => void;
  onGuardar: (cambios: ViajeCambios) => Promise<void>;
}) {
  const [o0b, o0n] = casillasDe({
    bloque: viaje.origen_bloque,
    num: viaje.origen_num,
  });
  const [d0b, d0n] = casillasDe({
    bloque: viaje.destino_bloque,
    num: viaje.destino_num,
  });

  const [tipo, setTipo] = useState<TipoFruto>(viaje.tipo_fruto);
  const [origenB, setOrigenB] = useState(o0b);
  const [origenN, setOrigenN] = useState(o0n);
  const [origen, setOrigen] = useState<Acopio | null>(
    acopios.find((a) => a.id === viaje.origen_acopio_id) ?? null,
  );
  const [destinoB, setDestinoB] = useState(d0b);
  const [destinoN, setDestinoN] = useState(d0n);
  const [destino, setDestino] = useState<Acopio | null>(
    acopios.find((a) => a.id === viaje.destino_acopio_id) ?? null,
  );
  const [vagon, setVagon] = useState(viaje.vagon ?? "");
  const [operador, setOperador] = useState(viaje.operador_id ?? "");
  const [obs, setObs] = useState(viaje.observaciones ?? "");
  const [reporte, setReporte] = useState(hhmm(viaje.reportado_en));
  const [salida, setSalida] = useState(hhmm(viaje.salida_en));

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const vagonHuerfano = vagon.trim() !== "" && !destino;
  const horaMala = reporte.trim() !== "" && !bogotaISO(jornada, reporte);
  const salidaMala = salida.trim() !== "" && !bogotaISO(jornada, salida);

  const guardar = async () => {
    if (!origen) return;
    setGuardando(true);
    setError(null);
    try {
      const cambios: ViajeCambios = {
        tipo_fruto: tipo,
        origen_acopio_id: origen.id,
        destino_acopio_id: destino?.id ?? null,
        vagon,
        operador_id: operador || null,
        observaciones: obs,
        // Vacío = borrar la salida (el renglón vuelve a estar pendiente), que es
        // cómo se deshace un clic equivocado en "Marcar salida".
        salida_en: salida.trim() ? bogotaISO(jornada, salida) : null,
      };
      // La hora del reporte sólo viaja si de verdad cambió: es `not null` en la
      // base y mandar un null la rompería por nada.
      const r = bogotaISO(jornada, reporte);
      if (r) cambios.reportado_en = r;

      await onGuardar(cambios);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setGuardando(false);
    }
  };

  return (
    <Dialogo ancho={460} bloqueado={guardando} onClose={onClose}>
      <div className="panel-title mb-0">
        Renglón {viaje.consecutivo} · {jornada}
      </div>
      <p className="mb-3 text-[10px] leading-tight text-ink-3">
        El número y el día no se cambian. Si el renglón quedó en la jornada
        equivocada, se anota acá y se registra de nuevo donde va.
      </p>

      <Campo label="Fruto">
        <div className="flex gap-1">
          {TIPOS_FRUTO.map((t) => (
            <button
              key={t.valor}
              type="button"
              onClick={() => setTipo(t.valor)}
              className={`btn-chip flex-1 sm:flex-none ${
                tipo === t.valor ? "btn-chip-solid" : ""
              }`}
            >
              {t.letra} · {t.label}
            </button>
          ))}
        </div>
      </Campo>

      <div className="mb-3 grid grid-cols-2 gap-3">
        <Campo label="Hora reporte">
          <input
            type="time"
            className="field mono"
            value={reporte}
            disabled={guardando}
            onChange={(e) => setReporte(e.target.value)}
          />
        </Campo>
        <Campo label="Hora de salida" ayuda="Vacía = todavía no sale.">
          <input
            type="time"
            className="field mono"
            value={salida}
            disabled={guardando}
            onChange={(e) => setSalida(e.target.value)}
          />
        </Campo>
      </div>

      <div className="mb-3">
        <CasillasAcopio
          label="Vagones llenos"
          bloque={origenB}
          num={origenN}
          acopios={acopios}
          disabled={guardando}
          onChange={(b, n) => {
            setOrigenB(b);
            setOrigenN(n);
          }}
          onResuelto={setOrigen}
        />
      </div>

      <div className="mb-3">
        <CasillasAcopio
          label="Ubicación de vagones"
          bloque={destinoB}
          num={destinoN}
          acopios={acopios}
          opcional
          disabled={guardando}
          onChange={(b, n) => {
            setDestinoB(b);
            setDestinoN(n);
          }}
          onResuelto={setDestino}
        />
      </div>

      <Campo
        label="# Vagón a ubicar"
        ayuda={vagonHuerfano ? undefined : "Sólo si hay dónde ubicarlo."}
      >
        <input
          className="field mono w-[120px]"
          value={vagon}
          inputMode="numeric"
          disabled={guardando}
          onChange={(e) => setVagon(e.target.value)}
        />
      </Campo>
      {vagonHuerfano && (
        <Aviso>
          Hay un número de vagón pero no dónde ubicarlo. Llena la ubicación o
          borra el número.
        </Aviso>
      )}

      <Campo label="Conductor">
        <SelectOperador
          valor={operador}
          operadores={operadores}
          disabled={guardando}
          onChange={setOperador}
        />
      </Campo>

      <Campo label="Observaciones">
        <textarea
          className="field w-full"
          rows={2}
          value={obs}
          disabled={guardando}
          onChange={(e) => setObs(e.target.value)}
        />
      </Campo>

      {(horaMala || salidaMala) && (
        <Aviso>Revisa las horas: no se entienden.</Aviso>
      )}
      {error && <Aviso>{error}</Aviso>}

      {/* En celular el par de botones se reparte el ancho; guardar va a la
          derecha, que es donde cae el pulgar. */}
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          className="btn-ghost"
          onClick={onClose}
          disabled={guardando}
        >
          Cancelar
        </button>
        <button
          type="button"
          className="btn"
          disabled={
            guardando || !origen || vagonHuerfano || horaMala || salidaMala
          }
          onClick={guardar}
        >
          {guardando ? "Guardando…" : "Guardar"}
        </button>
      </div>
    </Dialogo>
  );
}

/**
 * ISO → "HH:mm" en Bogotá, o "" si no hay hora. Lo que come `<input type=time>`.
 *
 * El "24:00" no es paranoia: con `hour12: false` varias versiones de ICU
 * escriben la medianoche como 24:00 en vez de 00:00, y un `<input type=time>`
 * con ese valor se muestra vacío. En campo la medianoche cae dentro de la
 * jornada (ver `dayRange`), así que es una hora que de verdad aparece.
 */
function hhmm(iso: string | null): string {
  if (!iso) return "";
  const t = fmtTime(iso);
  if (t === "—") return "";
  return t.startsWith("24:") ? `00:${t.slice(3)}` : t;
}
