import type { Metadata } from "next";

/**
 * Sólo existe para ponerle título propio a la pestaña del despacho.
 *
 * `app/despacho/page.tsx` es un componente de cliente —tiene estado, mapa y
 * formularios— y desde ahí no se puede exportar `metadata`. Un layout es un
 * componente de servidor, así que la declara él. No envuelve nada: el marco
 * visual (html, body, tipografías) lo pone el layout raíz y aquí no hay nada
 * que agregar encima.
 */
export const metadata: Metadata = {
  title: "SiriusFleet · Despacho de recolección",
  description:
    "Planeación de recolección de fruto: a qué acopios va cada máquina en la jornada y por dónde iría.",
};

export default function DespachoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
