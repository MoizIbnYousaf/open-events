import type { UtcInstant } from '../domain'
import { isValidUtcInstant } from '../domain/invariants/time.ts'

export function addMillis(instant: UtcInstant, millis: number): UtcInstant {
  if (!isValidUtcInstant(instant)) {
    throw new RangeError(`'${instant}' is not a canonical UTC instant`)
  }
  if (!Number.isFinite(millis) || millis <= 0) {
    throw new RangeError(`millis must be a positive finite number (got ${millis})`)
  }
  const base = Date.parse(instant)
  const result = base + millis
  const maxDateMs = 8_640_000_000_000_000
  if (!Number.isSafeInteger(result) || result > maxDateMs || result < -maxDateMs) {
    throw new RangeError('addMillis: result overflows the representable date range')
  }
  return new Date(result).toISOString()
}
