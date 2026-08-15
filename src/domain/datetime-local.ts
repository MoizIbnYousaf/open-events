/**
 * Convert a `datetime-local` wall clock (YYYY-MM-DDTHH:mm) in an IANA zone
 * to the canonical UTC instant this product stores, and the reverse.
 *
 * Nonexistent spring-forward wall times are rejected. When a fall-back hour
 * occurs twice, the earlier instant is chosen deterministically.
 */

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  return Number(parts.find((entry) => entry.type === type)?.value)
}

function formatter(timeZone: string, includeSeconds: boolean): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    ...(includeSeconds ? { second: '2-digit' as const } : {}),
    hourCycle: 'h23',
  })
}

function offsetMs(timeZone: string, utcMs: number): number {
  const parts = formatter(timeZone, true).formatToParts(new Date(utcMs))
  const asUtc = Date.UTC(
    part(parts, 'year'),
    part(parts, 'month') - 1,
    part(parts, 'day'),
    part(parts, 'hour'),
    part(parts, 'minute'),
    part(parts, 'second'),
  )
  return asUtc - utcMs
}

function localValue(utcMs: number, timeZone: string): string {
  const parts = formatter(timeZone, false).formatToParts(new Date(utcMs))
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((entry) => entry.type === type)?.value
  return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}`
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/
const HOUR_MS = 60 * 60 * 1000

/** A `datetime-local` value in `timeZone` as the canonical UTC instant. */
export function datetimeLocalToUtcInstant(local: string, timeZone: string): string | null {
  if (local === '') return null
  const match = LOCAL_PATTERN.exec(local)
  if (match === null) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const hour = Number(match[4])
  const minute = Number(match[5])
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0)
  const naive = new Date(naiveUtc)
  if (
    naive.getUTCFullYear() !== year ||
    naive.getUTCMonth() !== month - 1 ||
    naive.getUTCDate() !== day ||
    naive.getUTCHours() !== hour ||
    naive.getUTCMinutes() !== minute
  ) {
    return null
  }

  try {
    const offsets = new Set<number>()
    for (let delta = -48 * HOUR_MS; delta <= 48 * HOUR_MS; delta += 6 * HOUR_MS) {
      offsets.add(offsetMs(timeZone, naiveUtc + delta))
    }
    const candidates = [...offsets]
      .map((offset) => naiveUtc - offset)
      .filter((candidate) => localValue(candidate, timeZone) === local)
      .sort((left, right) => left - right)
    const chosen = candidates[0]
    return chosen === undefined ? null : new Date(chosen).toISOString()
  } catch {
    return null
  }
}

/** A stored UTC instant as a `datetime-local` value in `timeZone`. */
export function utcInstantToDatetimeLocal(
  instant: string | null | undefined,
  timeZone: string,
): string {
  if (typeof instant !== 'string' || instant === '') return ''
  const ms = Date.parse(instant)
  if (!Number.isFinite(ms)) return ''
  try {
    return localValue(ms, timeZone)
  } catch {
    return ''
  }
}
