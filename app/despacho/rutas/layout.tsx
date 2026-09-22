import type { Metadata } from "next";

/**
 * Título propio para la planeación de rutas.
 *
 * Sin él heredaría el de `app/despacho/layout.tsx` y la pestaña diría
 * "Despacho" —que ahora es la planilla— mientras se está armando la jornada de
 * los tractores. Mismo arreglo de siempre: la página es de cliente.
 */
export const metadata: Metadata = {
  title: "SiriusFleet · Rutas del día",
  description:
    "Planeación de recolección de fruto: a qué acopios va cada máquina en la jornada y por dónde iría.",
};

export default function RutasLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
