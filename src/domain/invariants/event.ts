import type { Event, EventDates } from '../event.ts'
import { isValidUtcInstant } from './time.ts'

export type EventConfigIssueCode = 'invalid_timezone' | 'invalid_utc_instant' | 'invalid_date_range'

export interface EventConfigIssue {
  readonly code: EventConfigIssueCode
  readonly message: string
}

/** Ends must follow starts (epoch comparison on canonical UTC instants). */
export function areEventDatesValid(dates: EventDates): boolean {
  const start = Date.parse(dates.startsAt)
  const end = Date.parse(dates.endsAt)
  return Number.isFinite(start) && Number.isFinite(end) && end > start
}

/**
 * Sanity check for an IANA timezone identifier. Full IANA validation is
 * deferred to Temporal (M5/M6); this rejects obvious garbage only.
 */
export function isValidIanaTimezone(timezone: string): boolean {
  const trimmed = timezone.trim()
  if (trimmed.length === 0 || trimmed.length > 64) return false
  return /^[A-Za-z0-9_+.-]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(trimmed)
}

export function validateEventConfig(event: Event): readonly EventConfigIssue[] {
  const issues: EventConfigIssue[] = []
  if (!isValidIanaTimezone(event.timezone)) {
    issues.push({
      code: 'invalid_timezone',
      message: `'${event.timezone}' is not a valid IANA timezone identifier`,
    })
  }
  if (event.dates !== null) {
    if (!isValidUtcInstant(event.dates.startsAt)) {
      issues.push({
        code: 'invalid_utc_instant',
        message: `'${event.dates.startsAt}' is not a canonical UTC instant`,
      })
    }
    if (!isValidUtcInstant(event.dates.endsAt)) {
      issues.push({
        code: 'invalid_utc_instant',
        message: `'${event.dates.endsAt}' is not a canonical UTC instant`,
      })
    }
    if (
      isValidUtcInstant(event.dates.startsAt) &&
      isValidUtcInstant(event.dates.endsAt) &&
      !areEventDatesValid(event.dates)
    ) {
      issues.push({ code: 'invalid_date_range', message: 'Event end must be after event start' })
    }
  }
  return issues
}
