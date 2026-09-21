import type { Metadata, Viewport } from "next";
import { Nunito_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Nunito Sans es la tipografía del patrón SiriusFleet.
const nunito = Nunito_Sans({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
  variable: "--font-nunito",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "SiriusFleet · Flota de tractores",
  description:
    "Torre de control de tractores sobre red mesh Meshtastic: estado, última posición confirmada y recorrido de la labor.",
};

/**
 * Sin esto, un navegador móvil asume una página de escritorio: renderiza a
 * ~980 px virtuales y encoge el resultado para que quepa. El mapa se ve
 * diminuto y ningún ajuste de CSS lo arregla, porque las media queries se
 * evalúan contra esos 980 px y nunca entran. Es el cimiento de todo lo demás.
 *
 * `viewportFit: "cover"` deja pintar el mapa hasta los bordes en pantallas con
 * muesca; la barra superior compensa con `env(safe-area-inset-*)` para no
 * quedar debajo del reloj del sistema.
 *
 * No se fija `maximumScale` ni `userScalable: false` a propósito: bloquear el
 * zoom es una barrera de accesibilidad, y en campo —con sol, guantes o vista
 * cansada— acercar la pantalla es justo lo que alguien va a querer hacer.
 */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ecf1f4",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${nunito.variable} ${mono.variable}`}>
      <body className="bg-bg text-ink antialiased">{children}</body>
    </html>
  );
}
