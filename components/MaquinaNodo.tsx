"use client";

import { useMemo, useState } from "react";
import {
  actualizarMaquina,
  asignarNodo,
  crearMaquina,
  desasignarNodo,
  maquinaDeNodoEn,
  nodoDeMaquinaEn,
  type Flota,
  type MaquinaRow,
} from "@/lib/registro";
import { COLOR_DEFAULT, TIPOS_MAQUINA, type TipoMaquina } from "@/lib/tractores";
import { edadMin, fmtEdad } from "@/lib/fleet";
import { puestoDe } from "@/lib/puestos";
import type { SitioRed } from "@/lib/red";
import type { NodeRow } from "@/lib/types";
import { Aviso, Campo, Dialogo, SelectorColor } from "./Form";

interface Props {
  flota: Flota;
  /** Todos los nodos que el poller conoce, para el buscador. */
  nodos: NodeRow[];
  /**
   * Los sitios de la malla, para reconocer cuál de esos nodos es una antena.
   * `null` = no se pudo leer, que NO es lo mismo que "no hay antenas" y por eso
   * el diálogo lo dice en vez de dejar la lista limpia.
   */
  sitios: SitioRed[] | null;
  /** Instante al que se resuelve qué nodo lleva quién (epoch ms). */
  instante: number;
  /** null = dar de alta una máquina nueva. */
  maquina: MaquinaRow | null;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

/**
 * Alta de una máquina y montaje de su nodo, en un solo paso.
 *
 * `FlotaAdmin` y `AsignacionModal` ya hacen partes de esto, pero cada uno desde
 * su lado: el primero da de alta sin nodo, el segundo monta un nodo en el que
 * se hizo clic en el mapa. Desde el despacho la pregunta llega al revés —"entró
 * un tractor nuevo, ¿cuál de los radios le montamos?"— y ninguno de los dos la
 * contesta sin salirse a la torre.
 *
 * Lo que este diálogo agrega de verdad es el estado del nodo ANTES de montarlo:
 * la lista dice cuál está libre y cuál va montado en qué máquina, y mover uno
 * ocupado exige confirmarlo. La base ya lo permite —`asignar_nodo` cierra el
 * tramo anterior en la misma transacción— y justo por eso el aviso tiene que
 * estar aquí: reasignar no falla, funciona, y deja a la otra máquina ciega en
 * el mapa sin decir nada.
 */
export default function MaquinaNodo({
  flota,
  nodos,
  sitios,
  instante,
  maquina,
  onClose,
  onChanged,
}: Props) {
  const nodoActual = maquina ? nodoDeMaquinaEn(flota, maquina.id, instante) : null;

  const [codigo, setCodigo] = useState(maquina?.codigo ?? "");
  const [nombre, setNombre] = useState(maquina?.nombre ?? "");
  const [tipo, setTipo] = useState<TipoMaquina>(maquina?.tipo ?? "tractor");
  const [color, setColor] = useState(maquina?.color || COLOR_DEFAULT);

  const [nodoSel, setNodoSel] = useState<string | null>(nodoActual);
  const [busqueda, setBusqueda] = useState("");
  const [confirmado, setConfirmado] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Los nodos que NO son de flota, con el motivo.
   *
   * Un nodo montado en una antena o clavado en la portería no se puede asignar
   * a un tractor: el aparato no se mueve de ahí. Montárselo a una máquina la
   * dibujaría quieta sobre el repetidor toda la jornada —y de paso dejaría la
   * ficha del sitio hablando de un tractor— sin que nada fallara, que es la
   * peor forma de equivocarse.
   *
   * Las antenas salen de `v_mesh_health` y no de una lista aquí, a propósito:
   * dar de alta una antena es un INSERT (ver README), y una lista en el código
   * quedaría desactualizada el día que entre el próximo repetidor.
   */
  const noEsFlota = useMemo(() => {
    const out = new Map<string, string>();
    for (const s of sitios ?? []) {
      if (s.node_id) out.set(s.node_id, `antena · ${s.site_name}`);
    }
    for (const n of nodos) {
      const p = puestoDe(n.node_id);
      // El puesto gana al rótulo de antena: es el nombre con el que se conoce
      // el sitio en campo.
      if (p) out.set(n.node_id, `puesto fijo · ${p.nombre}`);
    }
    return out;
  }, [sitios, nodos]);

  /** Los nodos con la máquina que hoy los lleva, ya resuelta. */
  const lista = useMemo(() => {
    const q = busqueda.trim().toLowerCase();
    return nodos
      .map((n) => ({
        nodo: n,
        // El instante importa: un nodo que estuvo montado el martes está libre
        // hoy, y ofrecerlo como ocupado sería pedir que se desmonte algo que ya
        // nadie lleva.
        dueno: maquinaDeNodoEn(flota, n.node_id, instante),
        bloqueo: noEsFlota.get(n.node_id) ?? null,
      }))
      .filter(({ nodo, dueno, bloqueo }) => {
        if (!q) return true;
        return [
          nodo.node_id,
          nodo.long_name,
          nodo.short_name,
          dueno?.codigo,
          dueno?.nombre,
          // Buscar "antena" o el nombre del sitio también encuentra: es la
          // forma de comprobar por qué un nodo no aparece como libre.
          bloqueo,
        ].some((v) => v?.toLowerCase().includes(q));
      })
      .sort((a, b) => {
        // Primero el que ya lleva esta máquina, después los libres, y al final
        // lo que no se puede montar. Montar uno libre no le quita el mapa a
        // nadie y es lo que se quiere casi siempre.
        const peso = (x: typeof a) =>
          x.bloqueo ? 3 : x.nodo.node_id === nodoActual ? 0 : x.dueno ? 2 : 1;
        return peso(a) - peso(b) || a.nodo.node_id.localeCompare(b.nodo.node_id);
      });
  }, [nodos, flota, instante, busqueda, nodoActual, noEsFlota]);

  /** La máquina a la que se le quitaría el nodo elegido. */
  const leQuitaA = useMemo(() => {
    if (!nodoSel || nodoSel === nodoActual) return null;
    const d = maquinaDeNodoEn(flota, nodoSel, instante);
    return d && d.id !== maquina?.id ? d : null;
  }, [nodoSel, nodoActual, flota, instante, maquina?.id]);

  // Reasignar se confirma aparte, y elegir otro nodo vuelve a pedirlo: la
  // confirmación es sobre ESA máquina que se queda ciega, no sobre la idea.
  const elegir = (id: string | null) => {
    setNodoSel(id);
    setConfirmado(false);
  };

  /**
   * Cuántos de los nodos conocidos se pueden montar en una máquina.
   *
   * Se cuenta sobre `nodos` y no restando `noEsFlota.size`: la malla puede
   * tener dada de alta una antena cuyo radio el poller todavía no ha visto, y
   * esa no está en la lista para descontarla.
   */
  const montables = nodos.filter((n) => !noEsFlota.has(n.node_id)).length;

  const cambioDeNodo = nodoSel !== nodoActual;
  const faltaConfirmar = leQuitaA != null && !confirmado;
  const listo =
    codigo.trim() !== "" &&
    nombre.trim() !== "" &&
    !faltaConfirmar &&
    !(nodoSel && noEsFlota.has(nodoSel));

  const guardar = async () => {
    setGuardando(true);
    setError(null);
    try {
      let id = maquina?.id;
      if (id) {
        await actualizarMaquina(id, { codigo, nombre, tipo, color });
      } else {
        id = (await crearMaquina({ codigo, nombre, tipo, color })).id;
      }

      // El botón ya está bloqueado, pero la comprobación se repite aquí: entre
      // que se eligió el nodo y que se guardó pudo llegar la malla y descubrir
      // que ese nodo era una antena.
      if (nodoSel && noEsFlota.has(nodoSel)) {
        throw new Error(
          `${nodoSel} es ${noEsFlota.get(nodoSel)}: no va montado en una máquina.`
        );
      }

      // El nodo va después de la máquina y no al revés: si el alta falla por
      // código repetido, ningún radio se movió de sitio.
      if (cambioDeNodo) {
        if (nodoSel) await asignarNodo(nodoSel, id);
        else if (nodoActual) await desasignarNodo(nodoActual);
      }

      await onChanged();
      onClose();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setGuardando(false);
    }
  };

  return (
    <Dialogo ancho={460} bloqueado={guardando} onClose={onClose}>
      <div className="mb-3 text-[15px] font-extrabold">
        {maquina ? `Máquina ${maquina.codigo}` : "Nueva máquina"}
      </div>

      <div className="grid grid-cols-2 gap-x-2">
        <Campo label="Código">
          <input
            className="field font-mono"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value)}
            placeholder="T-01"
            autoComplete="off"
          />
        </Campo>
        <Campo label="Nombre">
          <input
            className="field"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="Rocinante"
            autoComplete="off"
          />
        </Campo>
      </div>

      <div className="grid grid-cols-2 gap-x-2">
        <Campo label="Tipo">
          <select
            className="field"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as TipoMaquina)}
          >
            {TIPOS_MAQUINA.map((t) => (
              <option key={t.valor} value={t.valor}>
                {t.label}
              </option>
            ))}
          </select>
        </Campo>
        <Campo label="Color en el mapa">
          <SelectorColor valor={color} onChange={setColor} />
        </Campo>
      </div>

      {/* ------------------------------ nodo ------------------------------ */}
      <div className="border-t border-border pt-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="t-label">Nodo montado</span>
          <span className="text-[10px] text-ink-3">
            {montables} de {nodos.length} montables
          </span>
        </div>

        <p className="mb-2 mt-1 text-[10.5px] leading-tight text-ink-3">
          Sin nodo la máquina se puede planear igual; lo que no se puede es
          seguirla en el mapa. Las antenas y los puestos fijos salen en la lista
          apagados: ese aparato no se mueve del sitio.
        </p>

        {sitios === null && (
          <p className="mb-2 rounded-[10px] bg-[#fff6e5] px-2.5 py-2 text-[10.5px] leading-tight text-ink">
            No se pudo leer la malla, así que las antenas no se pueden reconocer
            y salen como si fueran radios libres. Verifica el nodo en la torre
            antes de montarlo.
          </p>
        )}

        <input
          className="field mb-2"
          value={busqueda}
          onChange={(e) => setBusqueda(e.target.value)}
          placeholder="Buscar nodo por id, nombre o máquina…"
          autoComplete="off"
          aria-label="Buscar nodo"
        />

        <div className="max-h-[220px] overflow-y-auto rounded-[10px] border border-border">
          <OpcionNodo
            activa={nodoSel === null}
            onClick={() => elegir(null)}
            titulo="Sin nodo"
            detalle={
              nodoActual
                ? `desmonta ${nodoActual}: deja de verse en el mapa`
                : "se planea igual, pero no se sigue en el mapa"
            }
          />

          {lista.length === 0 && (
            <p className="px-2.5 py-3 text-center text-[11px] text-ink-3">
              Ningún nodo coincide con la búsqueda.
            </p>
          )}

          {lista.map(({ nodo, dueno, bloqueo }) => {
            const suyo = nodo.node_id === nodoActual;
            const ocupado = dueno != null && dueno.id !== maquina?.id;
            return (
              <OpcionNodo
                key={nodo.node_id}
                activa={nodoSel === nodo.node_id}
                // Se listan y no se esconden: un nodo que falta de la lista
                // parece un error de la app y manda a buscarlo a la torre. Que
                // esté ahí, apagado y con el motivo, contesta la pregunta.
                bloqueado={bloqueo != null}
                onClick={() => elegir(nodo.node_id)}
                titulo={nodo.node_id}
                mono
                etiqueta={nodo.short_name || nodo.long_name || null}
                detalle={
                  bloqueo ??
                  (suyo
                    ? "montado en esta máquina"
                    : ocupado
                      ? `montado en ${dueno.codigo}${dueno.nombre ? ` · ${dueno.nombre}` : ""}`
                      : "libre")
                }
                tono={bloqueo ? "fijo" : suyo ? "propio" : ocupado ? "ocupado" : "libre"}
                visto={fmtEdad(edadMin(nodo.last_seen))}
              />
            );
          })}
        </div>

        {leQuitaA && (
          <div className="mt-2 rounded-[10px] bg-[#fff6e5] px-2.5 py-2">
            <p className="text-[11px] leading-tight text-ink">
              <b className="font-mono">{nodoSel}</b> va montado hoy en{" "}
              <b>{leQuitaA.codigo}</b>
              {leQuitaA.nombre ? ` (${leQuitaA.nombre})` : ""}. Montarlo aquí lo
              desmonta de allá, y esa máquina queda sin posición en el mapa hasta
              que se le monte otro. Lo ya recorrido no se pierde: el tramo se
              cierra con la hora de ahora.
            </p>
            <button
              type="button"
              className={`btn-chip mt-2 ${confirmado ? "btn-chip-solid" : ""}`}
              onClick={() => setConfirmado((v) => !v)}
            >
              {confirmado
                ? "✓ Reasignación confirmada"
                : `Sí, quitárselo a ${leQuitaA.codigo}`}
            </button>
          </div>
        )}
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
          onClick={() => void guardar()}
          disabled={guardando || !listo}
        >
          {guardando
            ? "Guardando…"
            : maquina
              ? "Guardar cambios"
              : nodoSel
                ? "Crear y montar nodo"
                : "Crear máquina"}
        </button>
      </div>
    </Dialogo>
  );
}

/** Una fila de la lista de nodos. */
function OpcionNodo({
  activa,
  bloqueado,
  onClick,
  titulo,
  etiqueta,
  detalle,
  mono,
  tono,
  visto,
}: {
  activa: boolean;
  /** Es infraestructura: se ve, se explica, no se elige. */
  bloqueado?: boolean;
  onClick: () => void;
  titulo: string;
  etiqueta?: string | null;
  detalle: string;
  mono?: boolean;
  tono?: "propio" | "libre" | "ocupado" | "fijo";
  visto?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={bloqueado}
      aria-pressed={activa}
      className={`flex w-full items-center gap-2 border-b border-border px-2.5 py-2 text-left last:border-b-0 ${
        bloqueado
          ? "cursor-not-allowed bg-bg opacity-60"
          : activa
            ? "bg-surface-2"
            : "hover:bg-surface-2"
      }`}
    >
      <span
        className={`h-3.5 w-3.5 shrink-0 rounded-full border-[1.5px] ${
          bloqueado
            ? "border-border bg-border"
            : activa
              ? "border-accent bg-accent"
              : "border-border"
        }`}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1.5">
          <span
            className={`truncate text-[12px] font-bold ${mono ? "font-mono" : ""}`}
          >
            {titulo}
          </span>
          {etiqueta && (
            <span className="min-w-0 truncate text-[10.5px] text-ink-2">
              {etiqueta}
            </span>
          )}
        </span>
        <span
          className={`block truncate text-[10.5px] ${
            tono === "ocupado"
              ? "text-st-detenida"
              : tono === "propio"
                ? "text-st-activa"
                : "text-ink-3"
          } ${tono === "fijo" ? "italic" : ""}`}
        >
          {detalle}
        </span>
      </span>
      {visto && (
        <span
          className="shrink-0 font-mono text-[10px] text-ink-3"
          title="Último contacto del nodo"
        >
          {visto}
        </span>
      )}
    </button>
  );
}
