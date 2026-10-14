import type { Metadata } from "next";

/**
 * Título propio para la lista de vueltas pendientes, la que abre el QR.
 * Mismo arreglo que `app/despacho/rutas/layout.tsx`: la página es de cliente.
 */
export const metadata: Metadata = {
  title: "SiriusFleet · Vueltas pendientes",
  description: "Vueltas pendientes por recoger que todavía no salen.",
};

export default function PendientesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
