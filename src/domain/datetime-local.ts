/**
 * Convert a `datetime-local` wall clock (YYYY-MM-DDTHH:mm) in an IANA zone
 * to the canonical UTC instant this product stores, and the reverse.
 *
 * Suffixing `Z` treats the organizer's typed clock as UTC. A conference in
 * America/Los_Angeles then opens or closes the review window eight hours off.
 */

function part(
  parts: readonly Intl.DateTimeFormatPart[],
  type: Intl.DateTimeFormatPartTypes,
): number {
  return Number(parts.find((entry) => entry.type === type)?.value)
}

function offsetMs(timeZone: string, utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utcMs))
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

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

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
  let utc = naiveUtc - offsetMs(timeZone, naiveUtc)
  const shifted = offsetMs(timeZone, utc)
  if (shifted !== offsetMs(timeZone, naiveUtc)) {
    utc = naiveUtc - shifted
  }
  return new Date(utc).toISOString()
}

/** A stored UTC instant as a `datetime-local` value in `timeZone`. */
export function utcInstantToDatetimeLocal(
  instant: string | null | undefined,
  timeZone: string,
): string {
  if (typeof instant !== 'string' || instant === '') return ''
  const ms = Date.parse(instant)
  if (!Number.isFinite(ms)) return ''
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms))
  const year = parts.find((entry) => entry.type === 'year')?.value
  const month = parts.find((entry) => entry.type === 'month')?.value
  const day = parts.find((entry) => entry.type === 'day')?.value
  const hour = parts.find((entry) => entry.type === 'hour')?.value
  const minute = parts.find((entry) => entry.type === 'minute')?.value
  if (
    year === undefined ||
    month === undefined ||
    day === undefined ||
    hour === undefined ||
    minute === undefined
  ) {
    return ''
  }
  return `${year}-${month}-${day}T${hour}:${minute}`
}
