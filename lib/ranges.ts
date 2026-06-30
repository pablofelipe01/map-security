import { BOGOTA_TZ } from "./geo";

export type RangeKey = "24h" | "today" | "yesterday" | "7d" | "custom";

export interface TimeRange {
  fromISO: string;
  toISO: string;
}

/**
 * Inicio de un día (00:00) en Bogotá, devuelto como Date UTC.
 * offsetDays=0 → hoy, -1 → ayer.
 */
function bogotaDayStart(offsetDays: number): Date {
  // Bogotá es UTC-5 fijo (sin DST).
  const now = new Date();
  // "ahora" en Bogotá
  const bogotaNow = new Date(
    now.toLocaleString("en-US", { timeZone: BOGOTA_TZ })
  );
  bogotaNow.setDate(bogotaNow.getDate() + offsetDays);
  bogotaNow.setHours(0, 0, 0, 0);
  // ese instante local Bogotá → UTC sumando 5h
  return new Date(bogotaNow.getTime() + 5 * 3600_000);
}

/** Resuelve un preset a un rango ISO {from,to}. */
export function resolveRange(key: RangeKey): TimeRange {
  const now = new Date();
  switch (key) {
    case "24h":
      return {
        fromISO: new Date(now.getTime() - 24 * 3600_000).toISOString(),
        toISO: now.toISOString(),
      };
    case "today": {
      return {
        fromISO: bogotaDayStart(0).toISOString(),
        toISO: now.toISOString(),
      };
    }
    case "yesterday": {
      return {
        fromISO: bogotaDayStart(-1).toISOString(),
        toISO: bogotaDayStart(0).toISOString(),
      };
    }
    case "7d":
      return {
        fromISO: new Date(now.getTime() - 7 * 24 * 3600_000).toISOString(),
        toISO: now.toISOString(),
      };
    default:
      return {
        fromISO: new Date(now.getTime() - 24 * 3600_000).toISOString(),
        toISO: now.toISOString(),
      };
  }
}

export const RANGE_LABELS: Record<Exclude<RangeKey, "custom">, string> = {
  "24h": "Últimas 24h",
  today: "Hoy",
  yesterday: "Ayer",
  "7d": "7 días",
};

/** Convierte un Date a string para <input type="datetime-local"> en hora Bogotá. */
export function toLocalInput(d: Date): string {
  const bogota = new Date(d.toLocaleString("en-US", { timeZone: BOGOTA_TZ }));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${bogota.getFullYear()}-${pad(bogota.getMonth() + 1)}-${pad(
    bogota.getDate()
  )}T${pad(bogota.getHours())}:${pad(bogota.getMinutes())}`;
}

/** Interpreta un valor de <input datetime-local> (hora Bogotá) como ISO UTC. */
export function fromLocalInput(value: string): string {
  // value = "YYYY-MM-DDTHH:mm" en hora Bogotá (UTC-5)
  const [date, time] = value.split("T");
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  // Bogotá → UTC sumando 5h
  return new Date(Date.UTC(y, mo - 1, d, h + 5, mi)).toISOString();
}
