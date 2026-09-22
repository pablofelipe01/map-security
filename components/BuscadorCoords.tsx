"use client";

import { useState } from "react";
import { aDMS, aDecimal, leerCoordenadas, type Coordenada } from "@/lib/coords";

/**
 * Buscar un punto por coordenadas y ponerlo en el mapa.
 *
 * PARA QUÉ. Las coordenadas llegan de afuera —un reporte por radio, un
 * WhatsApp, una ficha de campo— y hasta ahora no había forma de ver dónde
 * caían. El mapa sabe pintar todo lo que está en la base; esto es lo único que
 * pinta algo que no está en ninguna parte todavía.
 *
 * LO QUE MUESTRA DESPUÉS DE BUSCAR ES LA MITAD DEL TRABAJO. Devuelve el punto
 * escrito en las dos notaciones, grados y decimal. No es adorno: es cómo la
 * persona comprueba que el buscador entendió lo que tecleó. Si escribió
 * `4°31'37.94"N` y le responde lo mismo, está bien; si le responde otra cosa,
 * lo ve ANTES de mandar a alguien para allá. Un buscador de coordenadas que
 * interpreta mal no falla de forma visible — dibuja un punto en otro lado con
 * la misma cara de siempre.
 *
 * NO SE BUSCA MIENTRAS SE ESCRIBE. `4°31'` es un prefijo válido de
 * `4°31'37.94"N` y buscar a cada tecla haría que el mapa saltara a tres sitios
 * equivocados camino del bueno, además de marcar en rojo todo lo que todavía no
 * se ha terminado de escribir. Se busca al enviar, y el error aparece entonces.
 */

interface Props {
  /** Se llama con el punto leído. `null` = se limpió la búsqueda. */
  onBuscar: (punto: Coordenada | null) => void;
}

export default function BuscadorCoords({ onBuscar }: Props) {
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hallado, setHallado] = useState<Coordenada | null>(null);
  const [abierto, setAbierto] = useState(false);

  const buscar = () => {
    const r = leerCoordenadas(texto);
    if (!r.ok) {
      setError(r.error);
      setHallado(null);
      onBuscar(null);
      return;
    }
    setError(null);
    setHallado(r.punto);
    onBuscar(r.punto);
  };

  const limpiar = () => {
    setTexto("");
    setError(null);
    setHallado(null);
    onBuscar(null);
  };

  /* En celular arranca plegado: es un botón de 44 px hasta que alguien lo
     necesita. Desplegado ocupa casi el ancho de la pantalla, y dejarlo así de
     fijo taparía el mapa —que es el producto— por una función que se usa de vez
     en cuando. En escritorio hay ancho de sobra y va siempre abierto, así que
     `abierto` sólo manda debajo de `md`: el panel se esconde con `hidden
     md:block` en vez de no renderizarse, que es lo que haría desaparecer el
     buscador también en el escritorio. */
  return (
    <>
      {!abierto && (
        <button
          type="button"
          onClick={() => setAbierto(true)}
          aria-label="Buscar coordenadas"
          className="card absolute left-2 top-2 z-[900] grid h-11 w-11 place-items-center text-ink-2 shadow-card transition hover:text-accent md:hidden"
        >
          <Mira />
        </button>
      )}

      <div
        className={`card absolute left-2 top-2 z-[900] w-[min(340px,calc(100%-1rem))] p-2 shadow-card ${
          abierto ? "" : "hidden md:block"
        }`}
      >
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 pl-1 text-ink-3">
            <Mira />
          </span>

          <input
            // Sin forzar el tamaño de letra: `.field` lo sube a 16 px en pantalla
            // táctil, y por debajo de eso Safari en iOS hace zoom solo al enfocar
            // el campo y deja el mapa descuadrado.
            className="field mono min-w-0 flex-1"
            value={texto}
            placeholder={`4°31'37.94"N 72°58'39.11"W`}
            autoComplete="off"
            spellCheck={false}
            aria-label="Coordenadas"
            onChange={(e) => {
              setTexto(e.target.value);
              // El error se borra al primer cambio: seguir señalando en rojo lo
              // que la persona ya está corrigiendo sólo estorba.
              if (error) setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") buscar();
              if (e.key === "Escape") limpiar();
            }}
          />

          <button
            type="button"
            onClick={buscar}
            disabled={!texto.trim()}
            className="btn-chip btn-chip-solid shrink-0"
          >
            Ir
          </button>

          {/* Cerrar sólo existe en celular, que es donde el buscador tapa algo. */}
          <button
            type="button"
            onClick={() => {
              limpiar();
              setAbierto(false);
            }}
            aria-label="Cerrar el buscador"
            className="btn-chip shrink-0 md:hidden"
          >
            ✕
          </button>
        </div>

        {error && (
          <p className="mt-1.5 px-1 text-[10.5px] leading-tight text-st-alerta">
            {error}
          </p>
        )}

        {hallado && !error && (
          <div className="mt-1.5 flex items-start gap-2 px-1">
            <div className="mono min-w-0 flex-1 text-[10.5px] leading-tight text-ink-2">
              <div className="font-bold text-ink">{aDMS(hallado)}</div>
              <div>{aDecimal(hallado)}</div>
            </div>
            <button
              type="button"
              onClick={limpiar}
              className="back-link shrink-0 !text-[10.5px]"
            >
              Quitar
            </button>
          </div>
        )}
      </div>
    </>
  );
}

/** Retícula: el mismo dibujo que queda marcando el punto en el mapa. */
function Mira() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="5" stroke="currentColor" strokeWidth="1.6" />
      <path
        d="M8 0.5v3M8 12.5v3M0.5 8h3M12.5 8h3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
