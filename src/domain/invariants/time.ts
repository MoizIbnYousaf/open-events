/**
 * A canonical UTC instant is a strict ISO 8601 UTC string in the exact
 * `YYYY-MM-DDTHH:mm:ss.sssZ` form produced by `Date.toISOString()`. Anything
 * else (date-only, offset, non-UTC, unparseable) is rejected so that
 * epoch comparisons are trustworthy.
 */
export function isValidUtcInstant(value: string): boolean {
  if (value.length === 0) return false
  const millis = Date.parse(value)
  if (!Number.isFinite(millis)) return false
  return value === new Date(millis).toISOString()
}
