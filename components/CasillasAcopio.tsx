"use client";

import { useId, useMemo, useRef, useState } from "react";
import { normBloque, normNum, resolverAcopio } from "@/lib/vagones";
import { estaUbicado, type Acopio } from "@/lib/acopios";

/**
 * Las dos casillas del papel: BLOQUE y ACOPIO.
 *
 * SE ESCRIBE COMO EN LA HOJA, a propósito. El que despacha lleva años
 * anotando "334" y "68" en dos cuadritos, y el selector de acopios que ya
 * existe (`components/SelectorAcopios.tsx`) le pediría buscar "B.334-P.2 (R.)
 * · 68" en una lista de 845. Ese selector es para el coordinador que arma una
 * ruta mirando el mapa; éste es para el señor que tiene el radio en la oreja y
 * tres renglones atrasados. Dos campos cortos se llenan sin mirar.
 *
 * CON LISTA, PARA CUANDO NO SE SABE DE MEMORIA. Cada casilla despliega lo que
 * hay mientras se escribe: la de bloque, los bloques con cuántos acopios
 * tienen; la de acopio, sólo los acopios de ESE bloque. Escribir "33" y ver
 * B.334 y B.335 con sus acopios ahorra la vuelta al plano, y el que ya se lo
 * sabe sigue escribiendo de corrido sin tocar la lista.
 *
 * LO QUE AGREGA SOBRE EL PAPEL. En la hoja esos dos números no los comprueba
 * nadie: si el bloque no existe, el renglón queda apuntando a ninguna parte y
 * se descubre cuando el tractor llega y no hay nada. Acá se resuelven contra la
 * tabla mientras se escribe y el resultado se ve debajo.
 *
 * Y SI DE VERDAD NO ESTÁ. Un bloque o un acopio que el plano no trae se puede
 * dar de alta desde la misma lista (`onCrearAcopio`). Queda "por ubicar": sin
 * coordenada, sirve para anotar el renglón pero no aparece en el mapa hasta
 * que alguien lo ubique (ver supabase/acopios-registro.sql). Sin esto, el
 * reporte de un acopio nuevo se quedaba en el papel.
 */

interface Props {
  bloque: string;
  num: string;
  acopios: Acopio[];
  onChange: (bloque: string, num: string) => void;
  /** El acopio que quedó resuelto, o null. Sube para que el padre lo guarde. */
  onResuelto: (acopio: Acopio | null) => void;
  /**
   * Da de alta un acopio que no está en la tabla. Sin esto la lista no ofrece
   * registrar nada. El padre lo agrega a `acopios` al volver.
   */
  onCrearAcopio?: (bloque: string, num: string) => Promise<Acopio>;
  /** Rótulo de la pareja de casillas ("Vagones llenos", "Ubicación"). */
  label: string;
  /** Sin esto, no llenar las casillas es un error; con esto, es lo normal. */
  opcional?: boolean;
  disabled?: boolean;
  /**
   * Presentación de formulario vertical: rótulo legible, cada casilla con su
   * nombre encima y las dos repartiéndose el ancho también en escritorio. El
   * placeholder solo desaparece en cuanto se escribe, y en un formulario que se
   * llena de arriba abajo el que vuelve a mirar tiene que saber cuál era cuál.
   */
  amplio?: boolean;
}

/** Tope de opciones en la lista: más no se leen, se escribe una cifra más. */
const MAX_OPCIONES = 40;

export default function CasillasAcopio({
  bloque,
  num,
  acopios,
  onChange,
  onResuelto,
  onCrearAcopio,
  label,
  opcional,
  disabled,
  amplio,
}: Props) {
  const vacio = !bloque.trim() && !num.trim();
  const refNum = useRef<HTMLInputElement>(null);

  /**
   * El acopio elegido de la lista, si el texto sigue diciendo lo mismo. Hace
   * falta porque el texto solo no siempre alcanza: el `B.5 · 2` está duplicado
   * en el plano, y quien lo eligió de la lista ya dijo cuál.
   */
  const [elegido, setElegido] = useState<Acopio | null>(null);
  const [creando, setCreando] = useState(false);
  const [errorCrear, setErrorCrear] = useState<string | null>(null);

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

  const vigente =
    elegido && candidatos.some((c) => c.id === elegido.id) ? elegido : null;
  const unico = vigente ?? (candidatos.length === 1 ? candidatos[0] : null);

  // El padre se entera del resultado sin guardarlo dos veces: lo que se guarda
  // es el id del acopio, y las casillas son sólo cómo se escribió.
  const emitir = (b: string, n: string, cual: Acopio | null = null) => {
    setElegido(cual);
    setErrorCrear(null);
    onChange(b, n);
    if (cual) return onResuelto(cual);
    const c = !b.trim() && !n.trim() ? [] : resolverAcopio(acopios, b, n);
    onResuelto(c.length === 1 ? c[0] : null);
  };

  /* ---------------------------- opciones ---------------------------- */

  /** Bloque normalizado → cuántos acopios tiene. "" = sin bloque rotulado. */
  const bloques = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of acopios) {
      const k = normBloque(a.bloque ?? "");
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return [...m].sort(([a], [b]) =>
      a === "" ? 1 : b === "" ? -1 : a.localeCompare(b, "es", { numeric: true })
    );
  }, [acopios]);

  const qBloque = normBloque(bloque);
  const bloqueExiste = bloques.some(([k]) => k === qBloque);

  // Las opciones se arman en cada render y no con useMemo: llevan `emitir`, que
  // cierra sobre los callbacks del padre, y son cuentas sobre ~850 filas.
  const opcionesBloque = ((): Opcion[] => {
    // Lo que empieza igual primero ("33" → 330, 334…) y después lo que sólo
    // lo contiene ("33" → 133): así se escribe el bloque, de izquierda a derecha.
    const empiezan = bloques.filter(([k]) => k.startsWith(qBloque));
    const contienen = qBloque
      ? bloques.filter(([k]) => !k.startsWith(qBloque) && k.includes(qBloque))
      : [];
    const out: Opcion[] = [...empiezan, ...contienen]
      .slice(0, MAX_OPCIONES)
      .map(([k, n]) => ({
        clave: `b:${k}`,
        titulo: k ? `B.${k}` : "Sin bloque",
        detalle: `${n} ${n === 1 ? "acopio" : "acopios"}`,
        elegir: () => {
          emitir(k, num);
          refNum.current?.focus();
        },
      }));
    if (qBloque && !bloqueExiste && onCrearAcopio) {
      out.push({
        clave: "b:nuevo",
        titulo: `Bloque nuevo B.${qBloque}`,
        detalle: "No está en el plano. Escribe el acopio y regístralo.",
        nuevo: true,
        elegir: () => refNum.current?.focus(),
      });
    }
    return out;
  })();

  const delBloque = useMemo(
    () =>
      acopios
        .filter((a) => normBloque(a.bloque ?? "") === qBloque)
        .sort((a, b) =>
          (a.num ?? "").localeCompare(b.num ?? "", "es", { numeric: true })
        ),
    [acopios, qBloque]
  );

  const qNum = normNum(num);
  const numExiste = delBloque.some((a) => normNum(a.num ?? "") === qNum);

  const registrar = async () => {
    if (!onCrearAcopio) return;
    setCreando(true);
    setErrorCrear(null);
    try {
      const a = await onCrearAcopio(qBloque, qNum);
      emitir(normBloque(a.bloque ?? qBloque), a.num ?? qNum, a);
    } catch (e) {
      setErrorCrear(e instanceof Error ? e.message : String(e));
    } finally {
      setCreando(false);
    }
  };

  const opcionesNum = ((): Opcion[] => {
    const out: Opcion[] = delBloque
      .filter((a) => normNum(a.num ?? "").startsWith(qNum))
      .slice(0, MAX_OPCIONES)
      .map((a) => ({
        clave: `a:${a.id}`,
        titulo: a.num ?? "Sin número",
        detalle: estaUbicado(a) ? (a.lote ?? a.codigo) : "Por ubicar",
        elegir: () => emitir(qBloque, a.num ?? "", a),
      }));
    if (qNum && qBloque && !numExiste && onCrearAcopio) {
      out.push({
        clave: "a:nuevo",
        titulo: `Registrar acopio ${qNum} en B.${qBloque}`,
        detalle: bloqueExiste
          ? "No está en el plano. Queda por ubicar en el mapa."
          : "Bloque y acopio nuevos. Quedan por ubicar en el mapa.",
        nuevo: true,
        elegir: () => void registrar(),
      });
    }
    return out;
  })();

  /* ---------------------------- vista ---------------------------- */

  const campoBloque = (
    <Combo
      valor={bloque}
      placeholder={amplio ? "Ej. 334" : "Bloque"}
      etiqueta={`${label}: bloque`}
      amplio={amplio}
      disabled={disabled || creando}
      opciones={opcionesBloque}
      vacia="Ningún bloque empieza así."
      onChange={(v) => emitir(v, num)}
    />
  );
  const campoNum = (
    <Combo
      valor={num}
      placeholder={amplio ? "Ej. 68" : "Acopio"}
      etiqueta={`${label}: acopio`}
      amplio={amplio}
      alfanumerico
      alDerecha
      inputRef={refNum}
      disabled={disabled || creando}
      opciones={opcionesNum}
      vacia={
        qBloque || bloqueExiste
          ? bloqueExiste
            ? `Ningún acopio del B.${qBloque} empieza así.`
            : "Escribe el número del acopio."
          : "Primero el bloque."
      }
      onChange={(v) => emitir(bloque, v)}
    />
  );

  return (
    <div>
      {amplio ? (
        <>
          <span className="mb-1.5 block text-[13px] font-bold text-ink">
            {label}
            {opcional && (
              <span className="ml-1.5 font-normal text-ink-3">(opcional)</span>
            )}
          </span>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">Bloque</span>
              {campoBloque}
            </label>
            <label className="block">
              <span className="mb-1 block text-[11px] text-ink-3">Acopio</span>
              {campoNum}
            </label>
          </div>
        </>
      ) : (
        <>
          <span className="t-label mb-1 block">{label}</span>

          {/* En celular las dos casillas se reparten el ancho disponible (con
              tope, para que no queden dos campos gigantes para dos dígitos); en
              escritorio vuelven a medir lo que mide el dato. */}
          <div className="flex items-center gap-1.5">
            {campoBloque}
            <span className="text-ink-3">·</span>
            {campoNum}
          </div>
        </>
      )}

      <div
        className={`mt-1 min-h-[14px] leading-tight ${
          amplio ? "text-[11.5px]" : "text-[10px]"
        }`}
      >
        {creando ? (
          <span className="text-ink-3">Registrando acopio…</span>
        ) : errorCrear ? (
          <span className="text-st-alerta">{errorCrear}</span>
        ) : vacio ? (
          <span className="text-ink-3">
            {opcional ? "Sin ubicación de vagón" : "Escribe bloque y acopio"}
          </span>
        ) : unico ? (
          <span className="text-brand-green">
            {unico.codigo}
            {!estaUbicado(unico) && (
              <span className="ml-1.5 text-st-detenida">· por ubicar en el mapa</span>
            )}
          </span>
        ) : !num.trim() ? (
          // Es el paso siguiente, no un error: recién se eligió el bloque.
          <span className="text-ink-3">Falta el acopio.</span>
        ) : candidatos.length === 0 ? (
          <span className="text-st-alerta">
            No hay un acopio {bloque.trim() ? `en el bloque ${bloque.trim()}` : "sin bloque"} con
            ese número.
            {onCrearAcopio && bloque.trim() && (
              <>
                {" "}
                <button
                  type="button"
                  className="font-bold text-accent underline"
                  disabled={disabled}
                  onClick={() => void registrar()}
                >
                  Registrarlo
                </button>
              </>
            )}
          </span>
        ) : (
          <span className="text-st-detenida">
            Hay {candidatos.length} acopios así ({candidatos.map((c) => c.codigo).join(", ")}).
            Elige cuál en la lista.
          </span>
        )}
      </div>
    </div>
  );
}

/* ------------------------------ combo ------------------------------ */

interface Opcion {
  clave: string;
  titulo: string;
  detalle?: string;
  /** Registrar algo que no existe: se pinta distinto para que no se elija sin querer. */
  nuevo?: boolean;
  elegir: () => void;
}

/**
 * Una casilla con su lista desplegable.
 *
 * Es una lista propia y no un `<datalist>`: el del navegador no deja poner una
 * opción de "registrar nuevo", se ve distinto en cada celular y en Android no
 * filtra por "empieza con". La lista se abre al enfocar, filtra mientras se
 * escribe, y se maneja con flechas y Enter; Escape la cierra. Escribir sin
 * mirarla sigue funcionando igual que antes: la casilla es texto.
 *
 * El bloque siempre es un número, así que abre el teclado numérico. El acopio
 * no: hay "8A", "14B", "9CON10", y con el teclado numérico del celular esas
 * letras no se pueden escribir. Por eso `alfanumerico` abre el teclado normal
 * en mayúsculas.
 */
function Combo({
  valor,
  placeholder,
  etiqueta,
  amplio,
  alfanumerico,
  alDerecha,
  inputRef,
  disabled,
  opciones,
  vacia,
  onChange,
}: {
  valor: string;
  placeholder: string;
  etiqueta: string;
  amplio?: boolean;
  alfanumerico?: boolean;
  /** La lista se alinea al borde derecho (la casilla de la derecha). */
  alDerecha?: boolean;
  inputRef?: React.RefObject<HTMLInputElement>;
  disabled?: boolean;
  opciones: Opcion[];
  vacia: string;
  onChange: (v: string) => void;
}) {
  const idLista = useId();
  const [abierta, setAbierta] = useState(false);
  const [activa, setActiva] = useState(0);
  const i = Math.min(activa, Math.max(0, opciones.length - 1));

  const elegir = (o: Opcion) => {
    setAbierta(false);
    o.elegir();
  };

  return (
    <div
      className={`relative ${amplio ? "" : "min-w-0 flex-1 md:max-w-[62px] md:flex-none"}`}
    >
      <input
        ref={inputRef}
        className="field mono w-full text-center"
        value={valor}
        placeholder={placeholder}
        aria-label={etiqueta}
        role="combobox"
        aria-expanded={abierta}
        aria-controls={idLista}
        aria-autocomplete="list"
        aria-activedescendant={abierta && opciones[i] ? `${idLista}-${i}` : undefined}
        inputMode={alfanumerico ? "text" : "numeric"}
        autoCapitalize={alfanumerico ? "characters" : "off"}
        autoCorrect="off"
        spellCheck={false}
        autoComplete="off"
        disabled={disabled}
        onFocus={() => setAbierta(true)}
        onBlur={() => setAbierta(false)}
        onChange={(e) => {
          onChange(e.target.value);
          setAbierta(true);
          setActiva(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setAbierta(true);
            const d = e.key === "ArrowDown" ? 1 : -1;
            setActiva((i + d + opciones.length) % Math.max(1, opciones.length));
          } else if (e.key === "Enter" && abierta && opciones[i]) {
            // Dentro del formulario: sin esto Enter mandaría el renglón.
            e.preventDefault();
            elegir(opciones[i]);
          } else if (e.key === "Escape") {
            setAbierta(false);
          }
        }}
      />

      {abierta && !disabled && (
        <ul
          id={idLista}
          role="listbox"
          aria-label={etiqueta}
          className={`absolute top-full z-30 mt-1 max-h-[260px] w-max min-w-full max-w-[min(300px,calc(100vw-32px))] overflow-y-auto rounded-[10px] border border-border bg-surface p-1 text-left shadow-card ${
            alDerecha ? "right-0" : "left-0"
          }`}
        >
          {opciones.length === 0 && (
            <li className="px-2 py-2 text-[11.5px] text-ink-3">{vacia}</li>
          )}
          {opciones.map((o, k) => (
            <li
              key={o.clave}
              id={`${idLista}-${k}`}
              role="option"
              aria-selected={k === i}
              // mousedown y no click: el click llega después del blur, cuando
              // la lista ya se cerró.
              onMouseDown={(e) => {
                e.preventDefault();
                elegir(o);
              }}
              onMouseEnter={() => setActiva(k)}
              className={`flex min-h-[40px] cursor-pointer flex-col justify-center rounded-lg px-2 py-1 leading-tight ${
                k === i ? "bg-bg" : ""
              } ${o.nuevo ? "border-t border-border" : ""}`}
            >
              <span
                className={`text-[13px] font-bold ${o.nuevo ? "text-accent" : "mono text-ink"}`}
              >
                {o.nuevo ? `＋ ${o.titulo}` : o.titulo}
              </span>
              {o.detalle && (
                <span
                  className={`text-[11px] ${o.detalle === "Por ubicar" ? "text-st-detenida" : "text-ink-3"}`}
                >
                  {o.detalle}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
