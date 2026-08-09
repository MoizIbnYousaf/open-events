import type {
  Event,
  EventDates,
  EventId,
  EventSlug,
  EventStatus,
  IanaTimezone,
  UtcInstant,
} from '../../domain'

/** Admin `GET/PATCH /api/admin/events/:slug` response body. */
export interface AdminEventConfigDto {
  readonly id: EventId
  readonly slug: EventSlug
  readonly name: string
  readonly timezone: IanaTimezone
  readonly status: EventStatus
  readonly startsAt: UtcInstant | null
  readonly endsAt: UtcInstant | null
  readonly websiteUrl: string | null
  readonly organizerContact: string | null
  readonly venue: string | null
  readonly eventType: string | null
}

/** Partial admin update; omitted fields keep their current value. */
export interface UpdateEventConfigInput {
  readonly name?: string
  readonly timezone?: IanaTimezone
  readonly dates?: EventDates | null
  readonly status?: EventStatus
  readonly websiteUrl?: string | null
  readonly organizerContact?: string | null
  readonly venue?: string | null
  readonly eventType?: string | null
}

export function toAdminEventConfigDto(event: Event): AdminEventConfigDto {
  return {
    id: event.id,
    slug: event.slug,
    name: event.name,
    timezone: event.timezone,
    status: event.status,
    startsAt: event.dates?.startsAt ?? null,
    endsAt: event.dates?.endsAt ?? null,
    websiteUrl: event.websiteUrl ?? null,
    organizerContact: event.organizerContact ?? null,
    venue: event.venue ?? null,
    eventType: event.eventType ?? null,
  }
}
