import type { EstadoEnlace } from "./red";
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
  const c = color || "#0154ac";

  if (tipo === "aspersora") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
      <rect x="8" y="26" width="26" height="16" rx="7" fill="${c}"/>
      <rect x="34" y="20" width="16" height="22" rx="5" fill="${c}" stroke="#1a1a33" stroke-width="1.5"/>
      <rect x="37" y="24" width="9" height="8" rx="3" fill="#bcd7ea"/>
      <circle cx="41.5" cy="28" r="1.6" fill="#1a1a33"/>
      <ellipse cx="19" cy="24" rx="10" ry="7" fill="#ecf1f4" stroke="#1a1a33" stroke-width="1.5"/>
      <path d="M4 40 L0 46 M10 42 L7 48 M16 43 L15 49" stroke="#bcd7ea" stroke-width="2" stroke-linecap="round"/>
      <circle cx="18" cy="47" r="8" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="18" cy="47" r="3.4" fill="#6a6a80"/>
      <circle cx="45" cy="47" r="10" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="45" cy="47" r="4.4" fill="#6a6a80"/>
    </svg>`;
  }

  if (tipo === "camion") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
      <rect x="4" y="18" width="32" height="24" rx="3" fill="#ecf1f4" stroke="#1a1a33" stroke-width="1.5"/>
      <rect x="4" y="26" width="32" height="5" fill="${c}"/>
      <path d="M38 42 V26 a4 4 0 0 1 4-4 h6 l8 10 v10 z" fill="${c}" stroke="#1a1a33" stroke-width="1.5"/>
      <path d="M44 26 h4 l5 6 h-9 z" fill="#bcd7ea" stroke="#1a1a33" stroke-width="1.2"/>
      <rect x="4" y="42" width="52" height="4" rx="2" fill="#43435c"/>
      <circle cx="14" cy="47" r="7" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="14" cy="47" r="3" fill="#6a6a80"/>
      <circle cx="28" cy="47" r="7" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="28" cy="47" r="3" fill="#6a6a80"/>
      <circle cx="48" cy="47" r="7" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="48" cy="47" r="3" fill="#6a6a80"/>
    </svg>`;
  }

  // La volqueta se dibuja con la tolva levantada: es lo que la distingue de un
  // camión a 20 px de alto, que es el tamaño real del ícono en el mapa.
  if (tipo === "volqueta") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
      <path d="M6 40 L10 14 L38 20 L36 42 z" fill="${c}" stroke="#1a1a33" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M10 22 L36 27" stroke="#1a1a33" stroke-width="1.2" opacity=".35"/>
      <path d="M20 40 L32 32" stroke="#43435c" stroke-width="3" stroke-linecap="round"/>
      <path d="M38 42 V26 a4 4 0 0 1 4-4 h6 l8 10 v10 z" fill="${c}" stroke="#1a1a33" stroke-width="1.5"/>
      <path d="M44 26 h4 l5 6 h-9 z" fill="#bcd7ea" stroke="#1a1a33" stroke-width="1.2"/>
      <rect x="6" y="42" width="50" height="4" rx="2" fill="#43435c"/>
      <circle cx="16" cy="47" r="7" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="16" cy="47" r="3" fill="#6a6a80"/>
      <circle cx="30" cy="47" r="7" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="30" cy="47" r="3" fill="#6a6a80"/>
      <circle cx="48" cy="47" r="7" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="48" cy="47" r="3" fill="#6a6a80"/>
    </svg>`;
  }

  if (tipo === "retro") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
      <path d="M36 24 L52 10 L56 14 L44 28" fill="none" stroke="${c}" stroke-width="5" stroke-linecap="round"/>
      <path d="M54 12 l6 8 -8 2 z" fill="#ecf1f4" stroke="#1a1a33" stroke-width="1.5"/>
      <rect x="10" y="24" width="28" height="18" rx="6" fill="${c}"/>
      <rect x="14" y="14" width="16" height="16" rx="5" fill="${c}" stroke="#1a1a33" stroke-width="1.5"/>
      <rect x="17" y="18" width="10" height="8" rx="3" fill="#bcd7ea"/>
      <circle cx="22" cy="22" r="1.6" fill="#1a1a33"/>
      <rect x="6" y="42" width="42" height="10" rx="5" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
      <circle cx="14" cy="47" r="3" fill="#6a6a80"/><circle cx="27" cy="47" r="3" fill="#6a6a80"/><circle cx="40" cy="47" r="3" fill="#6a6a80"/>
    </svg>`;
  }

  // La portería no es una máquina: es un puesto con vigilante. Se dibuja la
  // figura de la persona —gorra, cara y uniforme— y no una caseta, porque a 20
  // px de alto una caseta es un cuadrito indistinguible de cualquier otra cosa
  // del mapa, mientras que una silueta humana se lee de inmediato.
  if (tipo === "porteria") {
    return `<svg viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="32" cy="57" rx="17" ry="4" fill="rgba(0,0,0,.35)"/>
      <path d="M14 55 v-7 a13 13 0 0 1 9-12.4 h18 a13 13 0 0 1 9 12.4 v7 z" fill="${c}" stroke="#1a1a33" stroke-width="1.5" stroke-linejoin="round"/>
      <path d="M26 35.6 L32 44 L38 35.6" fill="#ecf1f4" stroke="#1a1a33" stroke-width="1.2" stroke-linejoin="round"/>
      <circle cx="32" cy="27" r="8.5" fill="#f0d9bf" stroke="#1a1a33" stroke-width="1.5"/>
      <path d="M21 19 a11 9 0 0 1 22 0 z" fill="${c}" stroke="#1a1a33" stroke-width="1.5" stroke-linejoin="round"/>
      <rect x="17" y="18.5" width="30" height="4" rx="2" fill="#1a1a33"/>
      <path d="M29 13.5 h6 v3 h-6 z" fill="#ecf1f4"/>
      <circle cx="22.5" cy="47" r="2.2" fill="#fde68a" stroke="#1a1a33" stroke-width="1"/>
      <path d="M32 46 v9" stroke="#1a1a33" stroke-width="1.2" opacity=".5"/>
    </svg>`;
  }

  // tractor (por defecto)
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="56" rx="22" ry="4" fill="rgba(0,0,0,.35)"/>
    <rect x="40" y="8" width="4" height="12" rx="2" fill="#43435c"/>
    <circle cx="42" cy="7" r="2.4" fill="#9e9eaf" opacity=".7"/>
    <path d="M10 34 h16 v-12 a4 4 0 0 1 4-4 h10 a6 6 0 0 1 6 6 v14 h4 a4 4 0 0 1 4 4 v4 h-44 v-8 a4 4 0 0 1 4-4z" fill="${c}"/>
    <rect x="28" y="20" width="14" height="12" rx="4" fill="#bcd7ea" stroke="#1a1a33" stroke-width="1.5"/>
    <circle cx="35" cy="26" r="2" fill="#1a1a33"/>
    <path d="M31 30 q4 2.6 8 0" stroke="#1a1a33" stroke-width="1.4" fill="none" stroke-linecap="round"/>
    <circle cx="17" cy="46" r="8" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
    <circle cx="17" cy="46" r="3.4" fill="#6a6a80"/>
    <circle cx="45" cy="44" r="11" fill="#2b2b45" stroke="#1a1a33" stroke-width="2"/>
    <circle cx="45" cy="44" r="4.8" fill="#6a6a80"/>
    <path d="M45 33 v4 M45 51 v4 M34 44 h4 M52 44 h4" stroke="#6a6a80" stroke-width="2"/>
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
  /**
   * Aparato declarado del nodo (`lib/dispositivos.ts`). Cuando viene, el
   * marcador lleva una segunda etiqueta con el modelo: el ícono sigue siendo el
   * de la máquina —eso es lo que se mueve por el lote— y la chapita dice con qué
   * aparato se está viendo.
   */
  dispositivo?: string | null;
}): string {
  const flip = opts.rumbo != null && opts.rumbo > 180 ? "flip" : "";
  const chapa = opts.dispositivo
    ? `<span class="mk-dev" style="background:${esc(opts.color)}">${esc(
        opts.dispositivo
      )}</span>`
    : "";
  return `<div class="mk ${opts.estado} ${flip}">
    <div class="mk-ring"></div>
    ${machineSVG(opts.tipo, opts.color)}
    <span class="mk-label">${esc(opts.codigo)}</span>
    ${chapa}
  </div>`;
}

/**
 * Ícono de un nodo fijo de la red mesh.
 *
 * El gateway se distingue del repetidor por el plato del backhaul: es el único
 * que sale a internet (Starlink), y en un mapa de malla saber cuál es el centro
 * vale más que el nombre. Las ondas se dibujan siempre, incluso con el enlace
 * caído: describen lo que el aparato ES, no lo que está haciendo — eso lo dice
 * el color del anillo.
 */
export function antenaSVG(rol: "gateway" | "repetidor", color: string): string {
  const c = color || "#bcd7ea"; // Sutileza, igual que COLOR_RED
  const plato =
    rol === "gateway"
      ? `<path d="M40 30 a9 9 0 0 1 13 6" fill="none" stroke="#ecf1f4" stroke-width="2.5" stroke-linecap="round"/>
         <circle cx="41" cy="30" r="2.6" fill="#ecf1f4" stroke="#1a1a33" stroke-width="1.2"/>`
      : "";
  return `<svg viewBox="0 0 64 64" aria-hidden="true">
    <ellipse cx="32" cy="57" rx="15" ry="3.5" fill="rgba(0,0,0,.35)"/>
    <path d="M22 56 L29 22 h6 l7 34" fill="none" stroke="#ecf1f4" stroke-width="3" stroke-linejoin="round"/>
    <path d="M25 42 h14 M24 48 h17" stroke="#ecf1f4" stroke-width="2" stroke-linecap="round"/>
    <path d="M27 32 h10" stroke="#ecf1f4" stroke-width="2" stroke-linecap="round"/>
    <circle cx="32" cy="17" r="3.4" fill="${c}" stroke="#1a1a33" stroke-width="1.2"/>
    <path d="M24 16 a10 10 0 0 1 3-7" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M18 15 a16 16 0 0 1 5-11" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity=".65"/>
    <path d="M40 16 a10 10 0 0 0-3-7" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"/>
    <path d="M46 15 a16 16 0 0 0-5-11" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round" opacity=".65"/>
    ${plato}
  </svg>`;
}

/**
 * HTML del marcador de una antena: ícono + anillo de estado + nombre del sitio.
 *
 * Lleva el nombre del sitio y no el hex del nodo porque en el mapa la pregunta
 * es "¿qué se cayó?", y la respuesta útil es "Forsoza", no "!49b663b4". El hex
 * está en el tooltip, para quien va a entrar al radio.
 */
export function antenaHTML(opts: {
  rol: "gateway" | "repetidor";
  color: string;
  sitio: string;
  estado: EstadoEnlace;
}): string {
  return `<div class="ant ${opts.estado}">
    <div class="ant-ring"></div>
    ${antenaSVG(opts.rol, opts.color)}
    <span class="ant-label">${esc(opts.sitio)}</span>
  </div>`;
}

/**
 * HTML del marcador de un puesto declarado sin nodo (ver `PUESTOS_SIN_NODO` en
 * lib/puestos.ts): ícono + etiqueta, sin anillo de estado.
 *
 * El anillo se omite a propósito. En los demás marcadores dice qué tan fresco
 * es el dato del aparato, y aquí no hay aparato: pintarlo de cualquier color
 * afirmaría un estado que nadie midió.
 */
export function puestoHTML(opts: { color: string; codigo: string }): string {
  return `<div class="mk">
    ${machineSVG("porteria", opts.color)}
    <span class="mk-label">${esc(opts.codigo)}</span>
  </div>`;
}
