import type { Event, EventId, EventSlug, EventStatus, IanaTimezone, UtcInstant } from '../../domain'

/** API response shape for a single event. */
export interface EventDto {
  readonly id: EventId
  readonly slug: EventSlug
  readonly name: string
  readonly timezone: IanaTimezone
  readonly status: EventStatus
  readonly startsAt: UtcInstant | null
  readonly endsAt: UtcInstant | null
}

/** Maps a domain event to its public API representation. */
export function toEventDto(event: Event): EventDto {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    status: event.status,
    startsAt: event.dates?.startsAt ?? null,
    endsAt: event.dates?.endsAt ?? null,
  }
}
