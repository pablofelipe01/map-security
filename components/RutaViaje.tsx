"use client";

import { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Dialogo } from "./Form";
import type { ParadaMapa, RutaMapa } from "./MapaPlan";
import { fmtDuration, fmtTime } from "@/lib/geo";
import {
  MOTIVO_SIN_RUTA,
  PARAMETROS_POR_DEFECTO,
  fmtKm,
  regresoEstimado,
  type ParametrosVuelta,
  type ResultadoRuta,
} from "@/lib/rutaViaje";
import type { Viaje } from "@/lib/vagones";

/**
 * La vuelta de un renglón: el mapa con el camino y lo que tarda.
 *
 * Es lo único de la planilla que lleva mapa, y va en un diálogo para no
 * cambiar el gesto de la hoja (ver `app/despacho/page.tsx`): se abre cuando
 * alguien pregunta "¿y eso cuánto se demora?", no mientras se anota.
 */

// MapLibre toca `window` al importarse: fuera del render del servidor, igual
// que en la planeación.
const MapaPlan = dynamic(() => import("./MapaPlan"), { ssr: false });

/** Ida en Azul Cielo, vuelta cargada en Verde Alegría. */
const COLOR_IDA = "#00a3ff";
const COLOR_VUELTA = "#00b602";
const COLOR_PLANTA = "#0154ac";

/* ============================== la celda ============================== */

/**
 * Lo que va en la columna "Ruta": kilómetros y duración de la vuelta, como un
 * botón que abre el mapa. El clic no puede llegar al renglón, que abriría la
 * corrección.
 */
export function CeldaRuta({
  viaje,
  resultado,
  onAbrir,
  ancho,
}: {
  viaje: Viaje;
  resultado: ResultadoRuta | null;
  onAbrir: () => void;
  /** true en la tarjeta de celular: el botón ocupa el renglón. */
  ancho?: boolean;
}) {
  if (!resultado) {
    return <span className="text-[11px] text-ink-3">Calculando…</span>;
  }
  if (!resultado.ok) {
    return (
      <span className="text-[11px] text-ink-3">
        {MOTIVO_SIN_RUTA[resultado.motivo]}
      </span>
    );
  }

  const r = resultado.ruta;
  const regreso = regresoEstimado(viaje, r);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onAbrir();
      }}
      title="Ver la ruta en el mapa"
      className={`rounded-[8px] border border-border px-1.5 py-1 text-left leading-tight hover:bg-surface-2 ${
        ancho ? "w-full" : ""
      }`}
    >
      <span className="mono block text-[12px] font-bold text-ink">
        {fmtKm(r.metrosIda + r.metrosVuelta)} · {fmtDuration(r.minTotal)}
        {r.sinVia > 0 && (
          <span className="ml-1 text-st-detenida" title="Algún tramo va en recta">
            ≈
          </span>
        )}
      </span>
      <span className="block text-[10px] text-ink-3">
        {regreso ? `vuelve ~${fmtTime(regreso)}` : "ida y vuelta"} · ver mapa
      </span>
    </button>
  );
}

/* ============================== el diálogo ============================== */

export function DialogoRuta({
  viaje,
  resultado,
  parametros,
  onParametros,
  onClose,
}: {
  viaje: Viaje;
  resultado: ResultadoRuta | null;
  parametros: ParametrosVuelta;
  onParametros: (p: ParametrosVuelta) => void;
  onClose: () => void;
}) {
  const ruta = resultado?.ok ? resultado.ruta : null;

  const rutasMapa = useMemo<RutaMapa[]>(
    () =>
      (ruta?.tramos ?? []).map((t, i) => ({
        maquinaId: `tramo-${i}`,
        color: t.sentido === "ida" ? COLOR_IDA : COLOR_VUELTA,
        latlngs: t.latlngs,
        aproximada: !t.porVia,
        // Cada sentido por su derecha, como dos carriles. El corrimiento se mide
        // respecto del sentido de la línea: como la vuelta va al revés que la
        // ida, el MISMO signo las pone a lados opuestos de la vía (con signos
        // contrarios quedaban una encima de la otra).
        offset: 4,
      })),
    [ruta]
  );

  const paradasMapa = useMemo<ParadaMapa[]>(
    () =>
      (ruta?.puntos ?? []).map((p) => ({
        lat: p.lat,
        lon: p.lon,
        orden: p.rotulo,
        codigo: p.codigo,
        color:
          p.tipo === "planta" ? COLOR_PLANTA : p.tipo === "vacio" ? COLOR_IDA : COLOR_VUELTA,
        completada: false,
      })),
    [ruta]
  );

  // Encuadra cuando hay algo que encuadrar. El mapa nace con el diálogo, así
  // que basta con pedirlo una vez por ruta.
  const [encuadre, setEncuadre] = useState(0);
  useEffect(() => {
    if (ruta) setEncuadre((n) => n + 1);
  }, [ruta]);

  const regreso = ruta ? regresoEstimado(viaje, ruta) : null;

  return (
    <Dialogo ancho={980} onClose={onClose}>
      <div className="mb-3 flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="card-h2 !mb-0">Ruta del renglón {viaje.consecutivo}</h2>
          <p className="text-[11px] text-ink-3">
            Planta → {viaje.destino_codigo ? `${viaje.destino_codigo} (vacío) → ` : ""}
            {viaje.origen_codigo} (llenos) → Planta
          </p>
        </div>
        <button type="button" className="btn-chip" onClick={onClose}>
          Cerrar
        </button>
      </div>

      <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_300px]">
        <div className="relative h-[42dvh] overflow-hidden rounded-[10px] border border-border md:h-[60dvh]">
          {ruta ? (
            <MapaPlan
              rutas={rutasMapa}
              paradas={paradasMapa}
              maquinas={[]}
              encuadreToken={encuadre}
            />
          ) : (
            <p className="flex h-full items-center justify-center px-4 text-center text-[12px] text-ink-3">
              {resultado && !resultado.ok
                ? MOTIVO_SIN_RUTA[resultado.motivo]
                : "Calculando la ruta…"}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3 text-[12px]">
          {ruta && (
            <>
              <div className="grid grid-cols-2 gap-1.5">
                <Cifra
                  label="Ida"
                  color={COLOR_IDA}
                  km={fmtKm(ruta.metrosIda)}
                  min={fmtDuration(ruta.minIda)}
                />
                <Cifra
                  label="Vuelta"
                  color={COLOR_VUELTA}
                  km={fmtKm(ruta.metrosVuelta)}
                  min={fmtDuration(ruta.minVuelta)}
                />
              </div>

              <div className="tile p-2.5">
                <div className="t-label">Vuelta completa</div>
                <div className="t-value text-[20px]">{fmtDuration(ruta.minTotal)}</div>
                <div className="text-[11px] text-ink-2">
                  {fmtKm(ruta.metrosIda + ruta.metrosVuelta)} andando +{" "}
                  {fmtDuration(ruta.minManiobras)} de maniobras
                </div>
                {viaje.salida_en && regreso && (
                  <div className="mt-1 text-[11px] text-ink-2">
                    Salió {fmtTime(viaje.salida_en)} · vuelve a planta ~
                    <strong className="text-ink">{fmtTime(regreso)}</strong>
                  </div>
                )}
              </div>

              <ol className="flex flex-col gap-1">
                {ruta.tramos.map((t, i) => (
                  <li key={i} className="flex items-baseline gap-2 leading-tight">
                    <span
                      className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                      style={{ background: t.sentido === "ida" ? COLOR_IDA : COLOR_VUELTA }}
                    />
                    <span className="min-w-0 flex-1 text-ink-2">
                      {t.desde} → {t.hasta}
                      {!t.porVia && <span className="text-st-detenida"> · en recta</span>}
                    </span>
                    <span className="mono shrink-0 text-ink">
                      {fmtKm(t.metros)} · {fmtDuration(t.minutos)}
                    </span>
                  </li>
                ))}
              </ol>

              {(ruta.sinVia > 0 || ruta.vacioSinUbicar) && (
                <p className="rounded-[10px] bg-[#fdf4e3] px-2.5 py-2 text-[11px] leading-tight text-st-detenida">
                  {ruta.sinVia > 0 &&
                    "Algún tramo no se pudo resolver por las vías y va en línea recta (punteado): esos kilómetros son una aproximación. "}
                  {ruta.vacioSinUbicar &&
                    "El acopio donde se deja el vacío no tiene coordenada, así que no entra en la ruta."}
                </p>
              )}
            </>
          )}

          <Parametros valor={parametros} onChange={onParametros} />
        </div>
      </div>
    </Dialogo>
  );
}

function Cifra({
  label,
  color,
  km,
  min,
}: {
  label: string;
  color: string;
  km: string;
  min: string;
}) {
  return (
    <div className="tile p-2.5">
      <div className="t-label flex items-center gap-1.5">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
      </div>
      <div className="t-value text-[18px]">{min}</div>
      <div className="mono text-[11px] text-ink-2">{km}</div>
    </div>
  );
}

/**
 * Las suposiciones que convierten kilómetros en minutos, a la vista.
 *
 * Están acá y no escondidas en una constante porque son lo que hace que el
 * tiempo sea creíble o no: quien despacha sabe cuánto anda un tractor cargado
 * mejor que esta app.
 */
function Parametros({
  valor,
  onChange,
}: {
  valor: ParametrosVuelta;
  onChange: (p: ParametrosVuelta) => void;
}) {
  const campo = (k: keyof ParametrosVuelta, label: string, unidad: string, min: number) => (
    <label className="flex items-center gap-2">
      <span className="min-w-0 flex-1 text-[11px] text-ink-2">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        min={min}
        step={1}
        value={valor[k]}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n) && n >= min) onChange({ ...valor, [k]: n });
        }}
        className="field mono w-[64px] !py-1 text-right"
      />
      <span className="w-[34px] text-[10px] text-ink-3">{unidad}</span>
    </label>
  );

  return (
    <details className="rounded-[10px] border border-border p-2.5">
      <summary className="cursor-pointer text-[11px] font-bold text-ink-2">
        Supuestos del tiempo
      </summary>
      <p className="mb-2 mt-1 text-[10.5px] leading-tight text-ink-3">
        La distancia sale de las vías; el tiempo, de estas velocidades. Cambian
        todas las rutas de la planilla y quedan guardadas en este navegador.
      </p>
      <div className="flex flex-col gap-1.5">
        {campo("velIdaKmh", "Velocidad de ida", "km/h", 1)}
        {campo("velVueltaKmh", "Velocidad cargado", "km/h", 1)}
        {campo("minDejarVacio", "Dejar vagón vacío", "min", 0)}
        {campo("minEnganche", "Enganchar llenos", "min", 0)}
      </div>
      <button
        type="button"
        className="mt-2 text-[11px] text-accent underline"
        onClick={() => onChange(PARAMETROS_POR_DEFECTO)}
      >
        Volver a los valores de arranque
      </button>
    </details>
  );
}
