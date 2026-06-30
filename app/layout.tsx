import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Map Security · Rastreo Mesh",
  description:
    "Monitoreo en vivo de nodos mesh Meshtastic — recorrido GPS sobre satélite/3D.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={`${inter.variable} ${mono.variable}`}>
      <body className="bg-base-900 text-slate-100 antialiased">{children}</body>
    </html>
  );
}
