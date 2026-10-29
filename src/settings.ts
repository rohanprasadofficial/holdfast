export const DEFAULTS = { retention_days: 30, default_interval: 1440 };
export type Settings = typeof DEFAULTS;

export async function getSettings(db: D1Database): Promise<Settings> {
  const { results } = await db.prepare("SELECT key, value FROM settings").all<{ key: string; value: string }>();
  return { ...DEFAULTS, ...Object.fromEntries(results.filter((r) => r.key in DEFAULTS).map((r) => [r.key, Number(r.value)])) };
}

export const saveSetting = (db: D1Database, key: keyof Settings, value: number) =>
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, String(value)).run();

/** Whole days from 0 (keep forever) to 3650, or null. */
export function parseRetention(v: unknown): number | null {
  const n = Number(v);
  return typeof v === "string" && v.trim() !== "" && Number.isInteger(n) && n >= 0 && n <= 3650 ? n : null;
}
