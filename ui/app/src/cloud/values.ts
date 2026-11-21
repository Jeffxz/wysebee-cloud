/** Reading loosely typed values Wysebee Cloud answers. */

/** An object as such; anything else (null, a list, text) as `{}`. */
export function parseObject(raw: unknown): Record<string, unknown> {
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
}

export function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}
