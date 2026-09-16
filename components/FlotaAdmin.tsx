"use client";

import { useState } from "react";
import {
  actualizarMaquina,
  actualizarOperador,
  crearMaquina,
  crearOperador,
  nodoDeMaquinaEn,
  operadorDeMaquinaEn,
  type Flota,
  type MaquinaRow,
  type OperadorRow,
} from "@/lib/registro";
import { COLOR_DEFAULT, TIPOS_MAQUINA, type TipoMaquina } from "@/lib/tractores";
import { Aviso, Campo, Dialogo, SelectorColor } from "./Form";
import { MiniIcon } from "./SidePanel";

interface Props {
  flota: Flota;
  /** Instante al que se muestran las asignaciones vigentes (epoch ms). */
  instante: number;
  onClose: () => void;
  onChanged: () => Promise<void> | void;
}

type Pestana = "maquinas" | "operadores";

/**
 * Administración del parque: el maestro de máquinas y el de operadores.
 *
 * Aquí se da de alta y se corrige; asignar y relevar se hace desde el nodo
 * (ver `AsignacionModal`). La separación es a propósito: el maestro casi no
 * cambia y la asignación cambia todos los días, y mezclarlos llevaba a editar
 * el tractor cuando lo que se quería era cambiar el turno.
 *
 * Nada se borra, se desactiva: un recorrido de hace un mes tiene que poder
 * seguir diciendo de quién era la máquina.
 */
export default function FlotaAdmin({
  flota,
  instante,
  onClose,
  onChanged,
}: Props) {
  const [pestana, setPestana] = useState<Pestana>("maquinas");
  const [guardando, setGuardando] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <Dialogo ancho={440} bloqueado={guardando} onClose={onClose}>
      <div className="mb-3 text-[15px] font-extrabold">Registro de flota</div>

      <div className="mb-3 grid grid-cols-2 gap-1.5 rounded-xl bg-surface-2 p-1">
        <Tab activa={pestana === "maquinas"} onClick={() => setPestana("maquinas")}>
          Máquinas ({flota.maquinas.length})
        </Tab>
        <Tab
          activa={pestana === "operadores"}
          onClick={() => setPestana("operadores")}
        >
          Operadores ({flota.operadores.length})
        </Tab>
      </div>

      {pestana === "maquinas" ? (
        <Maquinas
          flota={flota}
          instante={instante}
          guardando={guardando}
          correr={correr}
        />
      ) : (
        <Operadores flota={flota} guardando={guardando} correr={correr} />
      )}

      {error && <Aviso>{error}</Aviso>}

      <button className="btn-ghost mt-3" onClick={onClose} disabled={guardando}>
        Cerrar
      </button>
    </Dialogo>
  );
}

type Correr = (fn: () => Promise<void>) => Promise<void>;

/* ============================== máquinas ============================== */

function Maquinas({
  flota,
  instante,
  guardando,
  correr,
}: {
  flota: Flota;
  instante: number;
  guardando: boolean;
  correr: Correr;
}) {
  const [nueva, setNueva] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [nombre, setNombre] = useState("");
  const [tipo, setTipo] = useState<TipoMaquina>("tractor");
  const [color, setColor] = useState(COLOR_DEFAULT);
  const [editando, setEditando] = useState<MaquinaRow | null>(null);

  const guardar = () =>
    correr(async () => {
      if (editando) {
        await actualizarMaquina(editando.id, { codigo, nombre, tipo, color });
      } else {
        await crearMaquina({ codigo, nombre, tipo, color });
      }
      cerrar();
    });

  const cerrar = () => {
    setNueva(false);
    setEditando(null);
    setCodigo("");
    setNombre("");
    setTipo("tractor");
    setColor(COLOR_DEFAULT);
  };

  const abrirEdicion = (m: MaquinaRow) => {
    setEditando(m);
    setNueva(true);
    setCodigo(m.codigo);
    setNombre(m.nombre);
    setTipo(m.tipo);
    setColor(m.color);
  };

  return (
    <>
      {flota.maquinas.length === 0 && !nueva && (
        <p className="py-2 text-[12.5px] text-ink-3">
          Todavía no hay máquinas registradas.
        </p>
      )}

      {flota.maquinas.map((m) => {
        const nodo = nodoDeMaquinaEn(flota, m.id, instante);
        const op = operadorDeMaquinaEn(flota, m.id, instante);
        return (
          <div
            key={m.id}
            className={`flex items-center gap-2.5 rounded-xl px-1.5 py-2 hover:bg-surface-2 ${
              m.activa ? "" : "opacity-45"
            }`}
          >
            <MiniIcon tipo={m.tipo} color={m.color} className="h-[30px] w-[30px]" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold">
                {m.nombre}
                <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-2">
                  {m.codigo}
                </span>
              </div>
              <div className="truncate text-[11px] text-ink-2">
                {nodo ? `nodo ${nodo}` : "sin nodo montado"}
                {op ? ` · ${op.nombre}` : ""}
              </div>
            </div>
            <button
              className="shrink-0 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-white hover:text-accent"
              title="Editar"
              onClick={() => abrirEdicion(m)}
            >
              ✎
            </button>
            <button
              className="shrink-0 rounded-lg px-1.5 py-1 text-[10px] font-bold uppercase tracking-[1px] text-ink-3 hover:bg-white hover:text-accent"
              title={
                m.activa
                  ? "Dar de baja: deja de ofrecerse al asignar, y su historia se conserva"
                  : "Volver a poner en servicio"
              }
              disabled={guardando}
              onClick={() =>
                correr(() => actualizarMaquina(m.id, { activa: !m.activa }).then(() => {}))
              }
            >
              {m.activa ? "baja" : "alta"}
            </button>
          </div>
        );
      })}

      {nueva ? (
        <div className="mt-2 rounded-xl bg-surface-2 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Código">
              <input
                className="field w-full font-mono"
                value={codigo}
                onChange={(e) => setCodigo(e.target.value)}
                placeholder="T-01"
                autoComplete="off"
              />
            </Campo>
            <Campo label="Nombre">
              <input
                className="field w-full"
                value={nombre}
                onChange={(e) => setNombre(e.target.value)}
                placeholder="Rocinante"
                autoComplete="off"
              />
            </Campo>
          </div>
          <Campo label="Tipo">
            <select
              className="field w-full"
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
          <button
            className="btn"
            disabled={guardando || !codigo.trim() || !nombre.trim()}
            onClick={guardar}
          >
            {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear máquina"}
          </button>
          <button className="btn-ghost mt-2" onClick={cerrar} disabled={guardando}>
            Cancelar
          </button>
        </div>
      ) : (
        <button className="btn mt-2" onClick={() => setNueva(true)}>
          ➕ Nueva máquina
        </button>
      )}
    </>
  );
}

/* ============================= operadores ============================= */

function Operadores({
  flota,
  guardando,
  correr,
}: {
  flota: Flota;
  guardando: boolean;
  correr: Correr;
}) {
  const [nuevo, setNuevo] = useState(false);
  const [nombre, setNombre] = useState("");
  const [documento, setDocumento] = useState("");
  const [telefono, setTelefono] = useState("");
  const [editando, setEditando] = useState<OperadorRow | null>(null);

  const cerrar = () => {
    setNuevo(false);
    setEditando(null);
    setNombre("");
    setDocumento("");
    setTelefono("");
  };

  const guardar = () =>
    correr(async () => {
      if (editando) {
        await actualizarOperador(editando.id, { nombre, documento, telefono });
      } else {
        await crearOperador({ nombre, documento, telefono });
      }
      cerrar();
    });

  const abrirEdicion = (o: OperadorRow) => {
    setEditando(o);
    setNuevo(true);
    setNombre(o.nombre);
    setDocumento(o.documento ?? "");
    // El teléfono guardado no se puede precargar: no sale de la base (ver
    // `OperadorRow`). El campo arranca vacío y sólo pisa lo que hay si se
    // escribe algo.
    setTelefono("");
  };

  return (
    <>
      {flota.operadores.length === 0 && !nuevo && (
        <p className="py-2 text-[12.5px] text-ink-3">
          Todavía no hay operadores registrados.
        </p>
      )}

      {flota.operadores.map((o) => {
        const turno = flota.turnos.find(
          (t) => t.operador_id === o.id && t.hasta == null
        );
        const maq = turno
          ? flota.maquinas.find((m) => m.id === turno.maquina_id)
          : null;
        return (
          <div
            key={o.id}
            className={`flex items-center gap-2.5 rounded-xl px-1.5 py-2 hover:bg-surface-2 ${
              o.activo ? "" : "opacity-45"
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-bold">{o.nombre}</div>
              <div className="truncate text-[11px] text-ink-2">
                {maq ? `al mando de ${maq.nombre}` : "sin turno abierto"}
                {o.documento ? ` · ${o.documento}` : ""}
              </div>
            </div>
            <button
              className="shrink-0 rounded-lg px-1.5 py-1 text-[13px] text-ink-3 hover:bg-white hover:text-accent"
              title="Editar"
              onClick={() => abrirEdicion(o)}
            >
              ✎
            </button>
            <button
              className="shrink-0 rounded-lg px-1.5 py-1 text-[10px] font-bold uppercase tracking-[1px] text-ink-3 hover:bg-white hover:text-accent"
              title={
                o.activo
                  ? "Dar de baja: deja de ofrecerse al asignar turnos"
                  : "Volver a poner en servicio"
              }
              disabled={guardando}
              onClick={() =>
                correr(() =>
                  actualizarOperador(o.id, { activo: !o.activo }).then(() => {})
                )
              }
            >
              {o.activo ? "baja" : "alta"}
            </button>
          </div>
        );
      })}

      {nuevo ? (
        <div className="mt-2 rounded-xl bg-surface-2 p-2.5">
          <Campo label="Nombre">
            <input
              className="field w-full"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Juan Pérez"
              autoComplete="off"
            />
          </Campo>
          <div className="grid grid-cols-2 gap-2">
            <Campo label="Documento (opcional)">
              <input
                className="field w-full font-mono"
                value={documento}
                onChange={(e) => setDocumento(e.target.value)}
                autoComplete="off"
              />
            </Campo>
            <Campo label="Teléfono (opcional)">
              <input
                className="field w-full font-mono"
                value={telefono}
                onChange={(e) => setTelefono(e.target.value)}
                placeholder={editando ? "Sin cambios" : ""}
                autoComplete="off"
              />
            </Campo>
          </div>
          <button
            className="btn"
            disabled={guardando || !nombre.trim()}
            onClick={guardar}
          >
            {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear operador"}
          </button>
          <button className="btn-ghost mt-2" onClick={cerrar} disabled={guardando}>
            Cancelar
          </button>
        </div>
      ) : (
        <button className="btn mt-2" onClick={() => setNuevo(true)}>
          ➕ Nuevo operador
        </button>
      )}
    </>
  );
}

function Tab({
  activa,
  onClick,
  children,
}: {
  activa: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-lg px-2 py-1.5 text-[11px] font-bold transition ${
        activa ? "bg-white text-accent shadow-tile" : "text-ink-2"
      }`}
    >
      {children}
    </button>
  );
}
