import type { TipoMaquina } from "./tractores";
import type { TractorEstado } from "./types";

/**
 * Íconos de máquina del patrón SiriusFleet.
 *
 * Se generan como cadena de SVG y no como componente de React porque el mismo
 * marcado tiene que servir en dos sitios: dentro de la UI (React) y dentro de
 * un `L.divIcon` de Leaflet, que sólo acepta HTML en texto. Tenerlo una sola
 * vez evita que el tractor del mapa y el de la lista se vayan pareciendo cada
 * vez menos.
 */
export function machineSVG(tipo: TipoMaquina, color: string): string {
  const c = color || "#0a55a5";

  if (tipo === "aspersora") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
      <rect x="8" y="26" width="26" height="16" rx="7" fill="${c}"/>
      <rect x="34" y="20" width="16" height="22" rx="5" fill="${c}" stroke="#0b0e12" stroke-width="1.5"/>
      <rect x="37" y="24" width="9" height="8" rx="3" fill="#cfe9ff"/>
      <circle cx="41.5" cy="28" r="1.6" fill="#0b0e12"/>
      <ellipse cx="19" cy="24" rx="10" ry="7" fill="#e6edf4" stroke="#0b0e12" stroke-width="1.5"/>
      <path d="M4 40 L0 46 M10 42 L7 48 M16 43 L15 49" stroke="#9fd8ff" stroke-width="2" stroke-linecap="round"/>
      <circle cx="18" cy="47" r="8" fill="#22272e" stroke="#0b0e12" stroke-width="2"/>
      <circle cx="18" cy="47" r="3.4" fill="#5d6a78"/>
      <circle cx="45" cy="47" r="10" fill="#22272e" stroke="#0b0e12" stroke-width="2"/>
      <circle cx="45" cy="47" r="4.4" fill="#5d6a78"/>
    </svg>`;
  }

  if (tipo === "retro") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
      <path d="M36 24 L52 10 L56 14 L44 28" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
      <path d="M54 12 l6 8 -8 2 z" fill="#e6edf4" stroke="#0b0e12" stroke-width="1.5"/>
      <rect x="10" y="24" width="28" height="18" rx="6" fill="${c}"/>
      <rect x="14" y="14" width="16" height="16" rx="5" fill="${c}" stroke="#0b0e12" stroke-width="1.5"/>
      <rect x="17" y="18" width="10" height="8" rx="3" fill="#cfe9ff"/>
      <circle cx="22" cy="22" r="1.6" fill="#0b0e12"/>
      <rect x="6" y="42" width="42" height="10" rx="5" fill="#22272e" stroke="#0b0e12" stroke-width="2"/>
      <circle cx="14" cy="47" r="3" fill="#5d6a78"/><circle cx="27" cy="47" r="3" fill="#5d6a78"/><circle cx="40" cy="47" r="3" fill="#5d6a78"/>
    </svg>`;
  }

  // tractor (por defecto)
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
    <rect x="40" y="8" width="4" height="12" rx="2" fill="#39424d"/>
    <circle cx="42" cy="7" r="2.4" fill="#9aa7b4" opacity=".7"/>
    <path d="M10 34 h16 v-12 a4 4 0 0 1 4-4 h10 a6 6 0 0 1 6 6 v14 h4 a4 4 0 0 1 4 4 v4 h-44 v-8 a4 4 0 0 1 4-4z" fill="${c}"/>
    <rect x="28" y="20" width="14" height="12" rx="4" fill="#cfe9ff" stroke="#0b0e12" stroke-width="1.5"/>
    <circle cx="35" cy="26" r="2" fill="#0b0e12"/>
    <path d="M31 30 q4 2.6 8 0" stroke="#0b0e12" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <circle cx="17" cy="46" r="8" fill="#22272e" stroke="#0b0e12" stroke-width="2"/>
    <circle cx="17" cy="46" r="3.4" fill="#5d6a78"/>
    <circle cx="45" cy="44" r="11" fill="#22272e" stroke="#0b0e12" stroke-width="2"/>
    <circle cx="45" cy="44" r="4.8" fill="#5d6a78"/>
    <path d="M45 33 v4 M45 51 v4 M34 44 h4 M52 44 h4" stroke="#5d6a78" stroke-width="2"/>
  </svg>`;
}

/** Escapa texto que va a inyectarse como HTML (etiquetas, nombres de nodo). */
export function esc(s: unknown): string {
  return String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] as string
  );
}

/**
 * HTML del marcador del mapa: ícono + anillo de estado + etiqueta con el código.
 *
 * El espejado (`flip`) sigue el rumbo: con rumbo al este la máquina se dibuja
 * mirando a la derecha. Es un detalle del patrón que cuesta nada y hace que el
 * mapa se lea de un vistazo — sobre todo aquí, donde el dato llega con hasta
 * 10 min de atraso y saber para dónde iba es media respuesta.
 */
export function markerHTML(opts: {
  tipo: TipoMaquina;
  color: string;
  codigo: string;
  estado: TractorEstado;
  rumbo: number | null;
}): string {
  const flip = opts.rumbo != null && opts.rumbo > 180 ? "flip" : "";
  return `<div class="mk ${opts.estado} ${flip}">
    <div class="mk-ring"></div>
    ${machineSVG(opts.tipo, opts.color)}
    <span class="mk-label">${esc(opts.codigo)}</span>
  </div>`;
}
