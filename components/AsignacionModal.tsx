"use client";

import { useEffect, useMemo, useState } from "react";
import {
  asignarNodo,
  asignarOperador,
  crearMaquina,
  crearOperador,
  desasignarNodo,
  identidadDeNodoEn,
  liberarMaquina,
  maquinasLibres,
  type Flota,
} from "@/lib/registro";
import {
  COLOR_DEFAULT,
  COLORES_FLOTA,
  TIPOS_MAQUINA,
  type TipoMaquina,
} from "@/lib/tractores";
import {
  emparejar,
  tipoDeDescripcion,
  type MaquinaCombustible,
} from "@/lib/combustible";
import type { NodeRow } from "@/lib/types";
import { fmtDateTime } from "@/lib/geo";
import { Aviso, Campo, Dialogo, Seccion, SelectorColor } from "./Form";
import { MiniIcon } from "./SidePanel";
import SelectBuscable, { type OpcionBuscable } from "./SelectBuscable";

interface Props {
  /** Nodo sobre el que se hizo clic. */
  node: NodeRow;
  flota: Flota;
  /** Instante al que se resuelve la asignación vigente (epoch ms). */
  instante: number;
  onClose: () => void;
  /** Vuelve a leer la flota después de escribir. */
  onChanged: () => Promise<void> | void;
  /** Parque de la base de combustible (Airtable). null = todavía no llega o
   *  no respondió: el selector sigue sirviendo con las registradas. */
  catalogo?: MaquinaCombustible[] | null;
}

const NUEVA = "__nueva__";
/** Prefijo de las opciones que vienen del parque de Airtable. */
const PARQUE = "parque:";

/**
 * Diálogo de asignación de un nodo: en qué máquina va montado y quién la maneja.
 *
 * Son dos decisiones separadas y con ritmos distintos —el nodo se cambia de
 * máquina de vez en cuando, el operador rota en el día— así que cada una tiene
 * su propio botón de guardar. Mezclarlas en un solo "Guardar" obligaría a
 * confirmar el tractor cada vez que entra el turno de la noche.
 *
 * Todo lo que se guarda es un tramo con fecha: reasignar no borra lo anterior,
 * lo cierra. Por eso el histórico de la semana pasada sigue sabiendo quién
 * manejaba la semana pasada.
 */
export default function AsignacionModal({
  node,
  flota,
  instante,
  onClose,
  onChanged,
  catalogo,
}: Props) {
  const { maquina, operador } = identidadDeNodoEn(flota, node.node_id, instante);

  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --- máquina ---
  const [maquinaSel, setMaquinaSel] = useState<string>("");
  const [nmCodigo, setNmCodigo] = useState("");
  const [nmNombre, setNmNombre] = useState("");
  const [nmTipo, setNmTipo] = useState<TipoMaquina>("tractor");
  const [nmColor, setNmColor] = useState(COLOR_DEFAULT);

  // --- operador ---
  const [operadorSel, setOperadorSel] = useState<string>("");
  const [noNombre, setNoNombre] = useState("");
  const [noDocumento, setNoDocumento] = useState("");
  const [noTelefono, setNoTelefono] = useState("");

  // Sólo se ofrecen las máquinas que hoy no llevan otro nodo: asignar una
  // ocupada desmontaría el nodo del otro sin que nadie lo pidiera.
  const disponibles = useMemo(
    () => maquinasLibres(flota, instante),
    [flota, instante]
  );
  // Las del parque que todavía no están en el registro. Se cruzan con
  // `emparejar`, el mismo cruce por código que usa el resto de la app ("936" de
  // la torre es "LZT936" del parque), y contra TODAS las registradas —también
  // las inactivas—: ofrecer una que ya existe terminaría en un código repetido.
  const delParque = useMemo(() => {
    if (!catalogo) return [];
    const registradas = new Set(
      flota.maquinas
        .map((m) => emparejar(m.codigo, catalogo)?.codigo)
        .filter(Boolean),
    );
    return catalogo.filter((m) => !registradas.has(m.codigo));
  }, [catalogo, flota.maquinas]);
  const operadoresLibres = useMemo(
    () => flota.operadores.filter((o) => o.activo && o.id !== operador?.id),
    [flota.operadores, operador?.id]
  );

  const opcionesMaquina = useMemo<OpcionBuscable[]>(
    () => [
      ...disponibles.map((m) => ({
        valor: m.id,
        texto: `${m.codigo} · ${m.nombre}`,
        grupo: "Registradas",
      })),
      ...delParque.map((m) => ({
        valor: PARQUE + m.codigo,
        texto: m.descripcion ? `${m.codigo} · ${m.descripcion}` : m.codigo,
        grupo: "Del parque (base de combustible)",
      })),
      { valor: NUEVA, texto: "➕ Registrar una máquina nueva…", siempre: true },
    ],
    [disponibles, delParque]
  );
  const opcionesOperador = useMemo<OpcionBuscable[]>(
    () => [
      ...operadoresLibres.map((o) => ({
        valor: o.id,
        texto: o.nombre + (nodoOcupado(flota, o.id) ? " (en otra máquina)" : ""),
      })),
      { valor: NUEVA, texto: "➕ Registrar un operador nuevo…", siempre: true },
    ],
    [operadoresLibres, flota]
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !guardando) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [guardando, onClose]);

  /** Envuelve una escritura: bloquea, traduce el error y refresca la flota. */
  const correr = async (fn: () => Promise<void>) => {
    setGuardando(true);
    setError(null);
    try {
      await fn();
      await onChanged();
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
    } finally {
      setGuardando(false);
    }
  };

  // Elegir una del parque llena el formulario de máquina nueva con lo que ya se
  // sabe de ella; el nombre y el color se pueden cambiar antes de guardar.
  const elegirMaquina = (valor: string) => {
    setMaquinaSel(valor);
    if (valor.startsWith(PARQUE)) {
      const m = delParque.find((x) => x.codigo === valor.slice(PARQUE.length));
      if (!m) return;
      setNmCodigo(m.codigo);
      setNmNombre(m.descripcion ?? m.codigo);
      setNmTipo(tipoDeDescripcion(m.descripcion));
      // El primer color de la flota que nadie use todavía, para que la nueva
      // se distinga en el mapa sin tener que pensarlo.
      const usados = new Set(flota.maquinas.map((x) => x.color.toLowerCase()));
      setNmColor(
        COLORES_FLOTA.find((c) => !usados.has(c.toLowerCase())) ?? COLOR_DEFAULT,
      );
    } else if (valor === NUEVA) {
      setNmCodigo("");
      setNmNombre("");
      setNmTipo("tractor");
      setNmColor(COLOR_DEFAULT);
    }
  };
  const formularioNueva = maquinaSel === NUEVA || maquinaSel.startsWith(PARQUE);

  const guardarMaquina = () =>
    correr(async () => {
      let id = maquinaSel;
      if (formularioNueva) {
        const m = await crearMaquina({
          codigo: nmCodigo,
          nombre: nmNombre,
          tipo: nmTipo,
          color: nmColor,
        });
        id = m.id;
      }
      if (!id) return;
      await asignarNodo(node.node_id, id);
      setMaquinaSel("");
      setNmCodigo("");
      setNmNombre("");
    });

  const guardarOperador = () =>
    correr(async () => {
      if (!maquina) return;
      let id = operadorSel;
      if (id === NUEVA) {
        const o = await crearOperador({
          nombre: noNombre,
          documento: noDocumento,
          telefono: noTelefono,
        });
        id = o.id;
      }
      if (!id) return;
      await asignarOperador(maquina.id, id);
      setOperadorSel("");
      setNoNombre("");
      setNoDocumento("");
      setNoTelefono("");
    });

  const maquinaNuevaLista =
    nmCodigo.trim() !== "" && nmNombre.trim() !== "";
  const puedeGuardarMaquina =
    !guardando &&
    (formularioNueva ? maquinaNuevaLista : maquinaSel !== "");
  const puedeGuardarOperador =
    !guardando &&
    !!maquina &&
    (operadorSel === NUEVA ? noNombre.trim() !== "" : operadorSel !== "");

  return (
    <Dialogo bloqueado={guardando} onClose={onClose}>
      <div className="mb-3 flex items-center gap-3">
        <MiniIcon
          tipo={maquina?.tipo ?? "tractor"}
          color={maquina?.color ?? "#bcd7ea"}
          className="h-[44px] w-[44px]"
        />
        <div className="min-w-0">
          <div className="text-[15px] font-extrabold leading-tight">
            {maquina ? maquina.nombre : "Nodo sin máquina"}
          </div>
          <div className="truncate font-mono text-[11px] text-ink-2">
            {node.node_id}
            {node.long_name ? ` · ${node.long_name}` : ""}
          </div>
        </div>
      </div>

      {/* ------------------------- máquina ------------------------- */}
      <Seccion titulo="Máquina">
        {maquina ? (
          <div className="kv mb-2">
            <span className="text-ink-2">Montado en</span>
            <span className="text-right font-semibold">
              {maquina.nombre}
              <span className="ml-1.5 font-mono text-[11px] text-ink-2">
                {maquina.codigo}
              </span>
            </span>
          </div>
        ) : (
          <p className="mb-2 text-[11.5px] leading-tight text-ink-2">
            Este nodo no está asignado a ninguna máquina: el mapa lo muestra con
            su nombre de fábrica.
          </p>
        )}

        <Campo
          label={maquina ? "Pasar a otra máquina" : "Asignar máquina"}
          grupo
          ayuda={
            catalogo
              ? "Registradas: sólo las que no llevan otro nodo. Del parque: las de la base de combustible que aún no están registradas."
              : "Sólo aparecen las que no llevan otro nodo montado."
          }
        >
          <SelectBuscable
            valor={maquinaSel}
            opciones={opcionesMaquina}
            onChange={elegirMaquina}
            placeholder="Código o nombre…"
            disabled={guardando}
          />
        </Campo>

        {formularioNueva && (
          <div className="mb-2 rounded-xl bg-surface-2 p-2.5">
            <div className="grid grid-cols-2 gap-2">
              <Campo label="Código">
                {/* El del parque no se edita: es la llave con la que se cruzan
                    los tanqueos de esa máquina. */}
                <input
                  className="field w-full font-mono"
                  value={nmCodigo}
                  readOnly={maquinaSel !== NUEVA}
                  onChange={(e) => setNmCodigo(e.target.value)}
                  placeholder="T-01"
                  autoComplete="off"
                />
              </Campo>
              <Campo label="Nombre">
                <input
                  className="field w-full"
                  value={nmNombre}
                  onChange={(e) => setNmNombre(e.target.value)}
                  placeholder="Rocinante"
                  autoComplete="off"
                />
              </Campo>
            </div>
            <Campo label="Tipo">
              <select
                className="field w-full"
                value={nmTipo}
                onChange={(e) => setNmTipo(e.target.value as TipoMaquina)}
              >
                {TIPOS_MAQUINA.map((t) => (
                  <option key={t.valor} value={t.valor}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo label="Color en el mapa">
              <SelectorColor valor={nmColor} onChange={setNmColor} />
            </Campo>
          </div>
        )}

        <button
          className="btn"
          disabled={!puedeGuardarMaquina}
          onClick={guardarMaquina}
        >
          {guardando ? "Guardando…" : "Guardar máquina"}
        </button>

        {maquina && (
          <button
            className="btn-ghost mt-2"
            disabled={guardando}
            onClick={() => correr(() => desasignarNodo(node.node_id))}
            title="El nodo queda sin máquina desde ahora; lo anterior se conserva"
          >
            Desmontar de la máquina
          </button>
        )}
      </Seccion>

      {/* ------------------------ operador ------------------------ */}
      <Seccion titulo="Operador al mando">
        {!maquina ? (
          <p className="text-[11.5px] leading-tight text-ink-2">
            Primero hay que decir en qué máquina va el nodo: el turno se asigna
            a la máquina, no al nodo.
          </p>
        ) : (
          <>
            <div className="kv mb-2">
              <span className="text-ink-2">Ahora maneja</span>
              <span className="text-right font-semibold">
                {operador?.nombre ?? "—"}
              </span>
            </div>

            <Campo label="Entregar el turno a" grupo>
              <SelectBuscable
                valor={operadorSel}
                opciones={opcionesOperador}
                onChange={setOperadorSel}
                placeholder="Nombre del operador…"
                disabled={guardando}
              />
            </Campo>

            {operadorSel === NUEVA && (
              <div className="mb-2 rounded-xl bg-surface-2 p-2.5">
                <Campo label="Nombre">
                  <input
                    className="field w-full"
                    value={noNombre}
                    onChange={(e) => setNoNombre(e.target.value)}
                    placeholder="Juan Pérez"
                    autoComplete="off"
                  />
                </Campo>
                <div className="grid grid-cols-2 gap-2">
                  <Campo label="Documento (opcional)">
                    <input
                      className="field w-full font-mono"
                      value={noDocumento}
                      onChange={(e) => setNoDocumento(e.target.value)}
                      autoComplete="off"
                    />
                  </Campo>
                  <Campo label="Teléfono (opcional)">
                    <input
                      className="field w-full font-mono"
                      value={noTelefono}
                      onChange={(e) => setNoTelefono(e.target.value)}
                      autoComplete="off"
                    />
                  </Campo>
                </div>
              </div>
            )}

            <button
              className="btn"
              disabled={!puedeGuardarOperador}
              onClick={guardarOperador}
            >
              {guardando ? "Guardando…" : "Registrar relevo"}
            </button>

            {operador && (
              <button
                className="btn-ghost mt-2"
                disabled={guardando}
                onClick={() => correr(() => liberarMaquina(maquina.id))}
                title="Cierra el turno: la máquina queda sin nadie al mando"
              >
                Cerrar turno de {operador.nombre}
              </button>
            )}

            <p className="mt-2 text-[10px] leading-tight text-ink-3">
              El relevo queda fechado en este momento. Si entró hace rato,
              corrígelo después desde el registro: lo que se guarda es el tramo,
              no el último valor.
            </p>
          </>
        )}
      </Seccion>

      {/* ------------------------ historial ------------------------ */}
      {maquina && <Historial flota={flota} maquinaId={maquina.id} />}

      {error && <Aviso>{error}</Aviso>}

      <button className="btn-ghost mt-3" onClick={onClose} disabled={guardando}>
        Cerrar
      </button>
    </Dialogo>
  );
}

/** Los últimos relevos de la máquina, para ver que quedó como se quería. */
function Historial({
  flota,
  maquinaId,
}: {
  flota: Flota;
  maquinaId: string;
}) {
  const turnos = flota.turnos
    .filter((t) => t.maquina_id === maquinaId)
    .sort((a, b) => Date.parse(b.desde) - Date.parse(a.desde))
    .slice(0, 5);

  if (turnos.length === 0) return null;

  return (
    <Seccion titulo="Últimos turnos">
      {turnos.map((t) => {
        const o = flota.operadores.find((x) => x.id === t.operador_id);
        return (
          <div key={t.id} className="kv">
            <span className="text-ink-2">{o?.nombre ?? "—"}</span>
            <span className="text-right font-mono text-[11px]">
              {fmtDateTime(t.desde)} → {t.hasta ? fmtDateTime(t.hasta) : "ahora"}
            </span>
          </div>
        );
      })}
    </Seccion>
  );
}

/** true si esa persona tiene un turno abierto en alguna máquina. */
function nodoOcupado(flota: Flota, operadorId: string): boolean {
  return flota.turnos.some(
    (t) => t.operador_id === operadorId && t.hasta == null
  );
}
