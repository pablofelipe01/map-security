import type { Metadata } from "next";

/**
 * Sólo existe para ponerle título propio a la pestaña del despacho.
 *
 * `app/despacho/page.tsx` es un componente de cliente —tiene estado y
 * formularios— y desde ahí no se puede exportar `metadata`. Un layout es un
 * componente de servidor, así que la declara él. No envuelve nada: el marco
 * visual (html, body, tipografías) lo pone el layout raíz y aquí no hay nada
 * que agregar encima.
 *
 * `/despacho/rutas` trae el suyo, porque de lo contrario heredaría este título
 * y la pestaña diría "planilla" mientras se está planeando la jornada.
 */
export const metadata: Metadata = {
  title: "SiriusFleet · Despacho",
  description:
    "Planilla de despacho de vagones: qué se reportó, quién fue y dónde quedó cada vagón.",
};

export default function DespachoLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
