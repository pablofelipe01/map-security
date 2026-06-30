import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Mission-control dark palette
        base: {
          900: "#05070a",
          850: "#080b11",
          800: "#0c1018",
          700: "#121826",
          600: "#1a2233",
        },
        live: {
          DEFAULT: "#39ff14", // verde-lima "vivo"
          cyan: "#22d3ee",
        },
        idle: "#f59e0b", // ámbar "quieto"
        alert: "#ef4444", // rojo
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
        mono: ["var(--font-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        glow: "0 0 20px -2px rgba(57,255,20,0.5)",
        "glow-cyan": "0 0 24px -4px rgba(34,211,238,0.55)",
        glass: "0 8px 32px -8px rgba(0,0,0,0.6)",
      },
      backdropBlur: {
        xs: "2px",
      },
      keyframes: {
        "pulse-ring": {
          "0%": { transform: "scale(0.7)", opacity: "0.8" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        "fade-in": {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "pulse-ring": "pulse-ring 2s ease-out infinite",
        "fade-in": "fade-in 0.3s ease-out",
      },
    },
  },
  plugins: [],
};

export default config;
