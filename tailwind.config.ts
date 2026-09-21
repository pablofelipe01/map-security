import type { Config } from "tailwindcss";

/**
 * Tema Sirius: blanco, limpio, azul Sirius, esquinas redondeadas. Los valores
 * son los del manual de marca Sirius 2023 y replican uno a uno los tokens de
 * `globals.css`, de modo que un color definido aquí y uno escrito allá no
 * puedan divergir.
 *
 * Los grises se derivan de Imperial (#1A1A33) mezclado con blanco, porque el
 * manual no trae escala de grises y un gris neutro al lado de esta paleta se
 * ve sucio.
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
        bg: "#ecf1f4", // Sutileza (gradiente)
        surface: {
          DEFAULT: "#ffffff",
          2: "#f3f9f0", // Primer retoño (gradiente)
        },
        border: "#bcd7ea", // Sutileza
        ink: {
          DEFAULT: "#1a1a33", // Imperial
          2: "#5a5a73", // Imperial 55%
          3: "#9e9eaf", // Imperial 35%
        },
        accent: {
          DEFAULT: "#0154ac", // Azul Barranca
          2: "#00a3ff", // Azul Cielo
        },
        brand: {
          green: "#00b602", // Verde Alegría
        },
        // Estados operativos. Fuera de la paleta de marca a propósito: avisan,
        // no decoran (ver la nota en globals.css). Siempre acompañados de texto
        // o ícono, nunca solo color: un supervisor daltónico tiene que poder
        // leer la flota.
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
        card: "0 2px 10px rgba(26, 26, 51, .08), 0 1px 3px rgba(26, 26, 51, .06)",
        tile: "0 1px 3px rgba(26, 26, 51,.05)",
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
