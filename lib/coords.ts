/**
 * Leer unas coordenadas escritas por una persona.
 *
 * DE DÓNDE SALE ESTO. En campo las coordenadas llegan en el formato que le da
 * la gana al aparato que las produjo: Google Earth las escribe
 * `4°31'37.94"N 72°58'39.11"W`, un GPS de mano las da en decimal, y alguien que
 * las copia de un WhatsApp las pega con los símbolos cambiados o sin ninguno.
 * Todas dicen lo mismo y el mapa tiene que aceptarlas todas.
 *
 * LA REGLA QUE MANDA: ANTES DE ADIVINAR, RECHAZAR. Un buscador de coordenadas
 * que interpreta mal no falla, que sería recuperable — dibuja un punto en otro
 * lado y lo afirma con la misma cara que si estuviera bien. Alguien manda un
 * tractor allá. Por eso este módulo sólo acepta lo que puede leer sin
 * suposiciones, y donde hay dos lecturas posibles devuelve null en vez de
 * escoger una.
 *
 * El caso concreto que obliga a esa regla es la coma. En Colombia se escribe
 * "4,52" tanto como "4.52", y a la vez la coma es el separador habitual entre
 * las dos coordenadas. `4,52 -72,97` puede ser dos números decimales o cuatro
 * enteros; leído como grados y minutos daría un punto a kilómetros de donde la
 * persona quería, y perfectamente creíble. Así que:
 *
 *   · con marcas (° ' ") se lee como grados/minutos/segundos, sin ambigüedad;
 *   · sin marcas, sólo se aceptan DOS números, que son grados decimales;
 *   · cuatro o seis números sueltos se rechazan con un mensaje que dice qué
 *     falta, en vez de elegir una lectura.
 */

/** Un punto del mundo. Mismo nombre de campos que usa el resto de la app. */
export interface Coordenada {
  lat: number;
  lon: number;
}

/** Lo que devuelve el parser: el punto, o por qué no se pudo leer. */
export type Lectura =
  | { ok: true; punto: Coordenada }
  | { ok: false; error: string };

/* ============================== normalizar ============================== */

/**
 * Deja el texto en una forma que las expresiones de abajo puedan mirar.
 *
 * Los teclados y los copiar-pegar traen media docena de caracteres que
 * significan lo mismo: la comilla tipográfica ’ por el minuto, ″ o dos apóstrofes
 * por el segundo, º (ordinal masculino) por ° (grado). Unificarlos acá es lo que
 * evita que la expresión regular tenga que conocerlos a todos.
 */
function normalizar(texto: string): string {
  return texto
    .trim()
    .toUpperCase()
    // Grado: ordinal masculino y la "o" volada que mete algún teclado.
    .replace(/[º˚]/g, "°")
    // Minuto: prima, comilla tipográfica, acento agudo suelto.
    .replace(/[′’´`]/g, "'")
    // Segundo: doble prima, comillas tipográficas, y el clásico '' (dos
    // apóstrofes) que se escribe cuando el teclado no tiene ″.
    .replace(/[″”“]/g, '"')
    .replace(/''/g, '"')
    // "O" de Oeste: en español se escribe O y en inglés W, y las dos aparecen.
    // Se normaliza a W para no arrastrar el caso por todo el módulo. Va al
    // final para no tocar la "O" que ya se convirtió arriba.
    .replace(/\bO\b/g, "W")
    .replace(/\s+/g, " ");
}

/* ============================== una mitad ============================== */

/**
 * Grados, minutos y segundos, con el grado obligatorio.
 *
 * El `°` es obligatorio a propósito: es lo único que distingue "4 31 37" (tres
 * números sueltos, que no se sabe qué son) de "4°31'37"" (que sí). Los minutos
 * y los segundos son opcionales porque `4°31.6'` y `4°` son escrituras
 * legítimas de lo mismo.
 */
const DMS =
  /^(\d{1,3}(?:\.\d+)?)°\s*(?:(\d{1,2}(?:\.\d+)?)'\s*(?:(\d{1,2}(?:\.\d+)?)"?)?)?$/;

/** Un número decimal con signo, y nada más. */
const DECIMAL = /^-?\d{1,3}(?:\.\d+)?$/;

interface Mitad {
  /** Siempre positivo cuando venía con letra de hemisferio; con signo si no. */
  valor: number;
  /** N, S, E, W — o null si se escribió con signo en vez de letra. */
  hemi: "N" | "S" | "E" | "W" | null;
}

/**
 * Lee una de las dos mitades: "4°31'37.94"N", "-72.9775", "72°58'W".
 *
 * La letra puede ir delante o detrás porque las dos formas circulan ("N 4°31'"
 * lo escriben los aparatos náuticos). Lo que NO se acepta es letra Y signo a la
 * vez: `-4°31'S` dice dos veces el hemisferio y una de las dos está de más, así
 * que no hay forma de saber cuál respetar.
 */
function leerMitad(bruto: string): Mitad | null {
  let s = bruto.trim();
  if (!s) return null;

  let hemi: Mitad["hemi"] = null;

  const detras = /^(.*?)\s*([NSEW])$/.exec(s);
  const delante = /^([NSEW])\s*(.*)$/.exec(s);
  if (detras) {
    hemi = detras[2] as Mitad["hemi"];
    s = detras[1].trim();
  } else if (delante) {
    hemi = delante[1] as Mitad["hemi"];
    s = delante[2].trim();
  }

  if (!s) return null;

  // Signo y letra a la vez: se rechaza en vez de elegir cuál gana.
  if (hemi && s.startsWith("-")) return null;

  const dms = DMS.exec(s);
  if (dms) {
    const g = Number(dms[1]);
    const m = dms[2] ? Number(dms[2]) : 0;
    const seg = dms[3] ? Number(dms[3]) : 0;
    // 61 minutos no es una escritura alternativa de 1°1': es un error de
    // tecleo, y aceptarlo produciría un punto plausible en el sitio equivocado.
    if (m >= 60 || seg >= 60) return null;
    return { valor: g + m / 60 + seg / 3600, hemi };
  }

  if (DECIMAL.test(s)) return { valor: Number(s), hemi };

  return null;
}

/* ============================== el texto entero ============================== */

/**
 * Parte el texto en sus dos mitades.
 *
 * Con letras de hemisferio el corte es evidente: va justo después de la primera
 * letra que aparece (o justo antes de la segunda, si van delante). Sin letras,
 * se corta por la coma o por el espacio. Esa diferencia es la que permite que
 * `4°31'37"N 72°58'39"W` funcione aunque tenga espacios por todas partes.
 */
function partir(s: string): [string, string] | null {
  // Letras detrás: "…N …W" — el corte va después de la primera.
  const detras = /^(.*?[NSEW])\s*,?\s*(.+[NSEW])$/.exec(s);
  if (detras) return [detras[1], detras[2]];

  // Letras delante: "N… W…" — el corte va antes de la segunda.
  const delante = /^([NSEW][^NSEW]*?)\s*,?\s*([NSEW].*)$/.exec(s);
  if (delante) return [delante[1], delante[2]];

  // Sin letras: coma, o espacio si no hay coma.
  const porComa = s.split(",");
  if (porComa.length === 2) return [porComa[0], porComa[1]];

  const porEspacio = s.split(" ");
  if (porEspacio.length === 2) return [porEspacio[0], porEspacio[1]];

  return null;
}

/**
 * Lee unas coordenadas escritas a mano.
 *
 * Acepta, entre otras:
 *   4°31'37.94"N 72°58'39.11"W
 *   4° 31' 37.94" N, 72° 58' 39.11" W
 *   4.526928, -72.977531
 *   N4°31' W72°58'
 *
 * Y rechaza con un mensaje —nunca en silencio, nunca adivinando— lo que no
 * puede leer sin suponer.
 */
export function leerCoordenadas(texto: string): Lectura {
  const s = normalizar(texto);
  if (!s) return { ok: false, error: "Escribe unas coordenadas." };

  const partes = partir(s);
  if (!partes) {
    // El caso frecuente y peligroso: números sueltos sin marcas. Se nombra
    // aparte porque el consejo es distinto —no falta un separador, faltan los
    // símbolos— y porque es exactamente donde adivinar haría daño.
    const numeros = s.split(/[\s,]+/).filter(Boolean).length;
    if (numeros > 2) {
      return {
        ok: false,
        error:
          "Faltan los símbolos: escribe 4°31'37.94\"N 72°58'39.11\"W, o dos números decimales.",
      };
    }
    return {
      ok: false,
      error: "Hacen falta las dos coordenadas, separadas por coma o espacio.",
    };
  }

  const a = leerMitad(partes[0]);
  const b = leerMitad(partes[1]);
  if (!a || !b) return { ok: false, error: "No se entiende. Revisa el formato." };

  const resuelto = asignar(a, b);
  if (!resuelto) {
    return {
      ok: false,
      error: "No se sabe cuál es la latitud y cuál la longitud.",
    };
  }

  const { lat, lon } = resuelto;
  if (Math.abs(lat) > 90) {
    return { ok: false, error: "La latitud tiene que estar entre -90 y 90." };
  }
  if (Math.abs(lon) > 180) {
    return { ok: false, error: "La longitud tiene que estar entre -180 y 180." };
  }

  return { ok: true, punto: { lat, lon } };
}

/**
 * Decide cuál de las dos mitades es la latitud.
 *
 * Con letras lo dice la letra, y de paso se detecta el error de escribir dos
 * veces el mismo eje ("N … S"). Sin letras manda el orden convencional —primero
 * la latitud, como las escribe todo el mundo— con una excepción que no es
 * adivinanza sino aritmética: si el primer número pasa de 90 no puede ser una
 * latitud, así que venían al revés. Eso cubre el error de pegar lo que copió de
 * una herramienta que las da en orden lon/lat, sin inventar nada.
 */
function asignar(a: Mitad, b: Mitad): Coordenada | null {
  const eje = (m: Mitad) =>
    m.hemi === "N" || m.hemi === "S" ? "lat" : m.hemi ? "lon" : null;

  const ea = eje(a);
  const eb = eje(b);

  // Una sola letra deja el otro eje sin declarar: se sabe igual, porque los
  // ejes son dos y uno ya está tomado.
  if (ea && eb && ea === eb) return null;

  const conSigno = (m: Mitad, negativo: "S" | "W") =>
    m.hemi === negativo ? -Math.abs(m.valor) : m.valor;

  if (ea === "lat" || eb === "lon") {
    return { lat: conSigno(a, "S"), lon: conSigno(b, "W") };
  }
  if (ea === "lon" || eb === "lat") {
    return { lat: conSigno(b, "S"), lon: conSigno(a, "W") };
  }

  // Ninguna letra: orden convencional, salvo que el primero no quepa como
  // latitud.
  if (Math.abs(a.valor) > 90 && Math.abs(b.valor) <= 90) {
    return { lat: b.valor, lon: a.valor };
  }
  return { lat: a.valor, lon: b.valor };
}

/* ============================== escribir ============================== */

/**
 * El punto de vuelta en grados, minutos y segundos.
 *
 * Se muestra junto al decimal después de buscar, y no es adorno: es cómo la
 * persona comprueba que el buscador entendió lo que escribió. Si tecleó
 * `4°31'37.94"N` y le responde `4°31'37.9"N`, sabe que está bien; si le
 * responde otra cosa, lo ve antes de mandar a nadie para allá.
 */
export function aDMS(c: Coordenada): string {
  return `${grados(c.lat, "N", "S")} ${grados(c.lon, "E", "W")}`;
}

function grados(v: number, mas: string, menos: string): string {
  const abs = Math.abs(v);
  const g = Math.floor(abs);
  const mFloat = (abs - g) * 60;
  const m = Math.floor(mFloat);
  const s = (mFloat - m) * 60;
  return `${g}°${String(m).padStart(2, "0")}'${s.toFixed(2).padStart(5, "0")}"${
    v < 0 ? menos : mas
  }`;
}

/** El punto en decimal, con la precisión que tiene sentido (~0.1 m). */
export function aDecimal(c: Coordenada): string {
  return `${c.lat.toFixed(6)}, ${c.lon.toFixed(6)}`;
}
