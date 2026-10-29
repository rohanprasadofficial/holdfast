// Schedules are stored as minutes; the form takes "every N minutes|hours|days".
export const UNITS = { minutes: 1, hours: 60, days: 1440 } as const;
export type Unit = keyof typeof UNITS;

// The cron wakes every 5 minutes, so shorter intervals couldn't be honoured.
export const MIN_INTERVAL = 5;
export const MAX_INTERVAL = 365 * 1440;

/** Minutes from the form fields, or null when invalid or out of range. */
export function parseInterval(every: unknown, unit: unknown): number | null {
  const n = Number(every);
  if (!Number.isInteger(n) || typeof unit !== "string" || !Object.hasOwn(UNITS, unit)) return null;
  const min = n * UNITS[unit as Unit];
  return min >= MIN_INTERVAL && min <= MAX_INTERVAL ? min : null;
}

/** Largest whole unit: 90 → [90, "minutes"], 120 → [2, "hours"], 2880 → [2, "days"]. */
export const splitInterval = (min: number): [number, Unit] =>
  min % 1440 === 0 ? [min / 1440, "days"] : min % 60 === 0 ? [min / 60, "hours"] : [min, "minutes"];

export function describeInterval(min: number) {
  const [n, unit] = splitInterval(min);
  return n === 1 ? `Every ${unit.slice(0, -1)}` : `Every ${n} ${unit}`;
}
