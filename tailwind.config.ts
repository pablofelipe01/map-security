import type { Config } from "tailwindcss";

/**
 * Tema Sirius (siriusagentic.com): blanco, limpio, azul Sirius, esquinas
 * redondeadas. Los valores replican los tokens del patrón SiriusFleet, de modo
 * que un color definido aquí y uno escrito en `globals.css` no puedan
 * divergir.
 */
const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#f2f5f9",
        surface: {
          DEFAULT: "#ffffff",
          2: "#f2f6fb",
        },
        border: "#e1e8f0",
        ink: {
          DEFAULT: "#171717",
          2: "#55636f",
          3: "#8a99a8",
        },
        accent: {
          DEFAULT: "#0a55a5", // azul Sirius (logo)
          2: "#00a5e9", // cian del punto de la i
        },
        brand: {
          green: "#76b82a", // verde del logo
        },
        // Estados operativos. Siempre acompañados de texto o ícono, nunca
        // solo color: un supervisor daltónico tiene que poder leer la flota.
        st: {
          activa: "#0ca30c",
          detenida: "#b97a00",
          offline: "#7b8794",
          alerta: "#d03b3b",
        },
      },
      borderRadius: {
        card: "14px",
      },
      fontFamily: {
        sans: ["var(--font-nunito)", "-apple-system", "Segoe UI", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 2px 10px rgba(13, 42, 78, .08), 0 1px 3px rgba(13, 42, 78, .06)",
        tile: "0 1px 3px rgba(13,42,78,.05)",
      },
      keyframes: {
        "mk-pulse": {
          "0%": { boxShadow: "0 0 0 0 rgba(255,255,255,.45)" },
          "70%": { boxShadow: "0 0 0 12px rgba(255,255,255,0)" },
          "100%": { boxShadow: "0 0 0 0 rgba(255,255,255,0)" },
        },
      },
      animation: {
        "mk-pulse": "mk-pulse 2s infinite",
      },
    },
  },
  plugins: [],
};

export default config;
