import { useEffect, useState } from "react";
import { grafoVias, rutearRastro, type Tramo } from "./rutas";

/** Lo mínimo que el hook necesita de un rastro para poder rutearlo. */
interface RastroRuteable {
  nodeId: string;
  latlngs: [number, number][];
}

/**
 * Rutea los rastros por la malla vial (ver lib/rutas.ts) sin bloquear la UI.
 *
 * Devuelve null mientras el grafo se arma —el mapa dibuja las rectas de siempre
 * durante ese lapso, así que nunca se queda en blanco esperando— y a partir de
 * ahí un mapa nodeId → tramos, con un tramo por cada par de fixes consecutivos.
 *
 * El trabajo se corta por máquina y cede el hilo entre una y otra. Armar el
 * grafo cuesta ~200 ms y rutear una jornada completa de la flota otros ~150 ms:
 * en un solo bloque eso se siente como un tirón al abrir el día, y repartido no
 * se nota. El `cancelado` evita que una tanda vieja pise el resultado de la
 * nueva cuando el usuario cambia de fecha antes de que termine.
 */
export function useRutasPorVia(
  rastros: RastroRuteable[]
): Map<string, Tramo[]> | null {
  const [rutas, setRutas] = useState<Map<string, Tramo[]> | null>(null);

  // Las rutas dependen sólo de la geometría: si vuelve el mismo día con los
  // mismos fixes (el sondeo en vivo recarga cada minuto), no hay que recalcular
  // ni volver a renderizar. Se resume en un hash barato en vez de comparar el
  // array, que llega nuevo en cada sondeo aunque traiga los mismos puntos.
  const huella = rastros.map((r) => `${r.nodeId}:${hash(r.latlngs)}`).join("|");

  useEffect(() => {
    let cancelado = false;

    // Se descarta el resultado anterior ANTES de recalcular. Sin esto, al
    // cambiar de fecha los rastros del día nuevo encontrarían en el mapa las
    // rutas del día viejo (la clave es el node_id, que no cambia) y el mapa
    // dibujaría el recorrido de ayer mientras termina el cálculo. Vale más
    // mostrar un instante de rectas que un recorrido que no ocurrió.
    setRutas(null);

    (async () => {
      const g = await grafoVias();
      if (cancelado || !g) return;

      const out = new Map<string, Tramo[]>();
      for (const r of rastros) {
        if (cancelado) return;
        if (r.latlngs.length >= 2) out.set(r.nodeId, rutearRastro(g, r.latlngs));
        // Cede el hilo entre máquinas para que el mapa siga respondiendo. Tiene
        // que ser una macrotarea: con una microtarea (`await Promise.resolve()`)
        // el navegador nunca alcanza a pintar entre una máquina y la siguiente.
        await new Promise((r) => setTimeout(r, 0));
      }
      if (!cancelado) setRutas(out);
    })();

    return () => {
      cancelado = true;
    };
    // `huella` resume la geometría de `rastros`; depender del array recrearía
    // el cálculo en cada sondeo aunque no hubiera fixes nuevos.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huella]);

  return rutas;
}

/** Hash rápido (FNV-1a de 32 bits) de una polilínea, para detectar cambios. */
function hash(latlngs: [number, number][]): string {
  let h = 0x811c9dc5;
  for (const [la, lo] of latlngs) {
    // Los fixes traen ~7 decimales; a 1e5 (≈1 m) ya son dos enteros distintos
    // para dos posiciones distinguibles, y estables entre recargas.
    const v = Math.round(la * 1e5) * 31 + Math.round(lo * 1e5);
    h = Math.imul(h ^ (v & 0xffff), 0x01000193);
    h = Math.imul(h ^ (v >>> 16), 0x01000193);
  }
  return `${latlngs.length}.${(h >>> 0).toString(36)}`;
}
