import { BOGOTA_TZ } from "./geo";

export interface TimeRange {
  fromISO: string;
  toISO: string;
}

/** Fecha de hoy en Bogotá como "YYYY-MM-DD" (formato de <input type=date>). */
export function todayLocal(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: BOGOTA_TZ });
}

/**
 * Rango UTC que cubre un día completo de Bogotá.
 * Bogotá es UTC-5 fijo (sin horario de verano), así que el día local va de
 * 05:00Z a 05:00Z del siguiente. Hacerlo con aritmética explícita evita el
 * clásico error de tomar el día UTC y perder las primeras 5 horas de la
 * jornada, que en campo son las de más trabajo.
 */
export function dayRange(dateStr: string): TimeRange {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const from = Date.UTC(y, mo - 1, d, 5, 0, 0);
  return {
    fromISO: new Date(from).toISOString(),
    toISO: new Date(from + 24 * 3600_000).toISOString(),
  };
}

/** Corre un "YYYY-MM-DD" n días (n negativo = hacia atrás). */
export function shiftDay(dateStr: string, n: number): string {
  const [y, mo, d] = dateStr.split("-").map(Number);
  const t = Date.UTC(y, mo - 1, d) + n * 24 * 3600_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** Día de Bogotá al que pertenece un instante ISO. */
export function bogotaDay(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: BOGOTA_TZ });
}

/**
 * "2026-09-22" + "14:30" → el instante ISO UTC correspondiente en Bogotá.
 *
 * Es la inversa de `fmtTime` (lib/geo.ts) y existe porque un `<input type=time>`
 * devuelve "HH:mm" pelado: sin el día y sin la zona eso no es un instante. Se
 * hace con aritmética explícita sobre UTC-5 —Bogotá no tiene horario de
 * verano— y no con `new Date("2026-09-22T14:30")`, que interpretaría la hora en
 * la zona del navegador y mandaría a la base la hora de quien esté mirando.
 *
 * Devuelve null si la hora viene vacía o mal escrita: "no se anotó" es un
 * estado normal de la planilla, no un error.
 */
export function bogotaISO(dateStr: string, hhmm: string): string | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) return null;

  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;

  const [y, mo, d] = dateStr.split("-").map(Number);
  if (!y || !mo || !d) return null;

  // +5 porque Bogotá es UTC-5: las 14:30 locales son las 19:30Z.
  return new Date(Date.UTC(y, mo - 1, d, h + 5, min, 0)).toISOString();
}
